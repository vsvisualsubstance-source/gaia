'use strict';
// Traccia AUDIO della timeline col motore VERO (gaia-audio serve --no-audio):
// cue con una playlist di due brani scritta dall'editor, AUDIO in TIMELINE,
// orologio dello show finto su un topic MQTT di prova (non tocca lo show vero).
// Controlla: primo brano su A alla posizione dell'orologio, dissolvenza A -> B
// col secondo brano, A fermo dopo, pausa dello show = pausa del deck.
// Salta senza binario, analisi, musica o broker MQTT.
//   node test/audio-timeline-live.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { startPlancia, sleep } = require('./browser-harness');

const ENGINE_DIR = path.join(__dirname, '..', '..', 'audio-engine');
const BIN = path.join(ENGINE_DIR, 'target', 'release', process.platform === 'win32' ? 'gaia-audio.exe' : 'gaia-audio');
const CACHE = process.env.AUDIO_CACHE_SRC || path.join(ENGINE_DIR, 'cache');
const MUSIC = process.env.GAIA_MUSIC || 'C:\\gaia-docker-cfg\\core-node-0\\musica';
const BROKER = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883';
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function main() {
  if (!fs.existsSync(BIN) || !fs.existsSync(CACHE) || !fs.existsSync(MUSIC)) { console.log('timeline audio dal vivo: saltato (manca binario, analisi o musica)'); return; }
  const mqtt = require('mqtt');
  const pub = mqtt.connect(BROKER, { connectTimeout: 3000, reconnectPeriod: 0 });
  const okMqtt = await new Promise(r => { pub.on('connect', () => r(true)); pub.on('error', () => r(false)); setTimeout(() => r(false), 3500); });
  if (!okMqtt) { pub.end(true); console.log('timeline audio dal vivo: saltato (broker MQTT non raggiungibile)'); return; }
  const topic = `gaia/test/audio-clock-${process.pid}`;
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-audio-tl-'));
  const names = fs.readdirSync(CACHE).filter(n => /^[0-9a-f]{16}\.json$/.test(n));
  for (const n of names) fs.copyFileSync(path.join(CACHE, n), path.join(tmpCache, n));
  // due brani affidabili, lunghi almeno 2 minuti
  const tracks = names.map(n => ({ id: n.slice(0, 16), ...JSON.parse(fs.readFileSync(path.join(CACHE, n), 'utf8')) })).filter(t => t.seconds > 120).slice(0, 2);
  const [t1, t2] = tracks;
  fs.writeFileSync(path.join(tmpCache, 'playlists.json'), JSON.stringify({ playlists: [{ id: 'pl-prova', name: 'Prova timeline', tracks: [t1.id, t2.id], updated: new Date().toISOString() }] }));
  const port = await freePort();
  const engine = spawn(BIN, ['serve', '--no-audio', '--port', String(port), '--cache', tmpCache, '--root', MUSIC], { stdio: ['ignore', 'pipe', 'pipe'] });
  let elog = '';
  engine.stdout.on('data', d => { elog += d; }); engine.stderr.on('data', d => { elog += d; });
  for (let i = 0; i < 50 && !elog.includes('in ascolto'); i++) await sleep(100);
  // solo la timeline audio del bridge di prova usa il broker vero, e solo per l'orologio finto su un topic di prova
  Object.assign(process.env, { AUDIO_CACHE: tmpCache, AUDIO_ENGINE_URL: `ws://127.0.0.1:${port}`, SHOW_CLOCK_TOPIC: topic, AUDIO_TL_MQTT: BROKER });
  // orologio finto: posizione e play, pubblicato ogni 300 ms
  let clk = { base: 0, at: Date.now(), playing: true };
  const pos = () => clk.base + (clk.playing ? (Date.now() - clk.at) / 1000 : 0);
  const setClock = (p, playing = true) => { clk = { base: p, at: Date.now(), playing }; tick(); };
  const tick = () => pub.publish(topic, JSON.stringify({ pos: pos(), playing: clk.playing, rate: 1, length: 3600 }));
  const clockTimer = setInterval(tick, 300);
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const decks = async () => JSON.parse(await p.ev(`JSON.stringify(Object.fromEntries(['A','B'].map(k=>{const d=window.__planciaTest.AU.decks[k],m=window.__planciaTest.AU.mix[k];return[k,{track:d.track?.id||null,pos:+d.pos.toFixed(2),playing:d.playing,fader:+m.fader.toFixed(2)}]})))`));
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    // console audio (per lo stato dei deck) e libreria
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(...t.TPL.consoleaudio.pages());t.render();return 1})()`);
    for (let i = 0; i < 30; i++) { await sleep(200); if (await p.ev('window.__planciaTest.AU.tracks.length>0&&window.__planciaTest.AU.playlists.length>0&&window.__planciaTest.AU.live')) break; }
    // cue dall'editor: playlist a 0:00, dissolvenza 4 s; poi AUDIO in TIMELINE (conferma automatica)
    const saved = await p.ev(`(async()=>{const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms));
      new MutationObserver(()=>{const b=document.querySelector('.ui-confirm [data-v="1"]');if(b)b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}).observe(document.body,{childList:true,subtree:true});
      const w=T.L.pages.flatMap(p=>p.widgets).find(x=>x.type==='timeline'&&!x.onlyTracks);
      T.openAudioCueEditor(w,[{time:0,label:'Apertura',fade:4,src:{kind:'playlist',id:''}}]);await z(200);
      const pl=document.querySelector('.ac-pl');pl.value='pl-prova';document.querySelector('#acSave').click();await z(200);
      await T.toggleAudioActive();await z(300);return JSON.stringify(T.audioDoc())})()`);
    const doc = JSON.parse(saved);
    check(doc.active && doc.cues.length === 1 && doc.cues[0].src.id === 'pl-prova', `cue salvata dall'editor e AUDIO in TIMELINE (${doc.cues[0]?.src?.kind})`);
    setClock(20);
    await sleep(3500);
    let d = await decks();
    check(d.A.track === t1.id && d.A.playing && Math.abs(d.A.pos - pos()) < 0.6 && d.A.fader === 1, `brano 1 su A alla posizione dello show: ${d.A.pos} s (show ${pos().toFixed(2)})`);
    // salto appena prima della dissolvenza (il brano 2 parte a len1 - 4, dissolvenza di 4 s), misura a meta'
    const start2 = t1.seconds - 4;
    setClock(start2 + 0.3);
    await sleep(1500);
    d = await decks();
    const x = (pos() - start2) / 4;
    check(d.A.playing && d.B.playing && d.B.track === t2.id && Math.abs(d.B.pos - (pos() - start2)) < 0.6, `dissolvenza: A e B in onda, B a ${d.B.pos} s`);
    check(x < 1 && d.A.fader < 0.9 && d.A.fader > 0.1 && d.B.fader > 0.1 && d.B.fader < 0.9, `fader in dissolvenza a ${(x * 100).toFixed(0)}%: A ${d.A.fader}, B ${d.B.fader}`);
    await sleep(3500);
    d = await decks();
    check(!d.A.playing && d.B.playing && d.B.fader === 1, `dopo la dissolvenza: A fermo, B a pieno (${d.B.pos} s)`);
    // show in pausa: il deck si ferma
    setClock(pos(), false);
    await sleep(1200);
    d = await decks();
    check(!d.B.playing, 'show in pausa: B in pausa');
    const st = await p.ev('JSON.stringify(window.__planciaTest.G.audioTlSt||null)');
    check(/"engine":true/.test(st) && /"clock":true/.test(st), `stato della timeline dal bridge: ${st.slice(0, 120)}`);
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally {
    clearInterval(clockTimer);
    p.close(); engine.kill(); pub.end(true);
    fs.rmSync(tmpCache, { recursive: true, force: true });
  }
  if (fail.length) { console.error(`timeline audio dal vivo: ${fail.length} errori\n--- motore ---\n${elog.slice(-1500)}`); process.exit(1); }
}
main().catch(e => { console.error('timeline audio dal vivo: prova fallita:', e.message); process.exit(2); });
