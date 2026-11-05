'use strict';
// Console Audio col motore VERO: gaia-audio serve --no-audio (clock interno,
// nessun suono), bridge della prova collegato al motore, pagina nel browser.
// Due tracce vere su A e B, play, CUE, hot cue, SYNC, mixer: lo stato torna
// dal motore e la pagina lo mostra. Cue e hot cue su una copia della cache.
// Salta se mancano il binario (audio-engine/target/release) o l'analisi.
//   node test/audio-engine-live.js

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

const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function main() {
  if (!fs.existsSync(BIN) || !fs.existsSync(CACHE) || !fs.existsSync(MUSIC)) {
    console.log('motore audio dal vivo: saltato (manca il binario, l\'analisi o la musica)');
    return;
  }
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-audio-live-'));
  for (const n of fs.readdirSync(CACHE)) if (n.endsWith('.json') && !n.endsWith('.cues.json')) fs.copyFileSync(path.join(CACHE, n), path.join(tmpCache, n));
  const port = await freePort();
  const engine = spawn(BIN, ['serve', '--no-audio', '--port', String(port), '--cache', tmpCache, '--root', MUSIC], { stdio: ['ignore', 'pipe', 'pipe'] });
  let elog = '';
  engine.stdout.on('data', d => { elog += d; });
  engine.stderr.on('data', d => { elog += d; });
  for (let i = 0; i < 50 && !elog.includes('in ascolto'); i++) await sleep(100);
  process.env.AUDIO_CACHE = tmpCache;
  process.env.AUDIO_ENGINE_URL = `ws://127.0.0.1:${port}`;
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(...t.TPL.consoleaudio.pages());t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    let live = false;
    for (let i = 0; i < 30 && !live; i++) { await sleep(200); live = await p.ev('window.__planciaTest.AU.live'); }
    check(live, 'pagina collegata al motore (stato audio_state dal bridge)');
    const badge = await p.ev(`document.querySelector('.au-sim')?.textContent||''`);
    check(badge === 'MOTORE · NESSUNA USCITA', `etichetta della libreria: ${badge}`);
    let n = 0;
    for (let i = 0; i < 20 && !n; i++) { await sleep(300); n = await p.ev('window.__planciaTest.AU.tracks.length'); }
    const pick = await p.ev(`(()=>{const ts=window.__planciaTest.AU.tracks.filter(t=>t.confidence>=.6&&t.seconds>120);
      const a=ts[0];const b=ts.find(t=>t.id!==a.id&&Math.abs(t.bpm/a.bpm-1)<.05&&Math.abs(t.bpm-a.bpm)>.5);return b?[a.id,b.id,a.bpm,b.bpm]:null})()`);
    check(!!pick, `tracce: ${pick ? `${pick[2]} e ${pick[3]} BPM` : 'nessuna coppia'}`);
    if (pick) {
      const down = (sel) => p.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
      const up = () => p.ev(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
      await down(`[data-au=load][data-deck=A][data-id="${pick[0]}"]`);
      await down(`[data-au=load][data-deck=B][data-id="${pick[1]}"]`);
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) { await sleep(250); ready = await p.ev(`(()=>{const A=window.__planciaTest.AU.decks;return A.A.track?.id===${JSON.stringify(pick[0])}&&A.B.track?.id===${JSON.stringify(pick[1])}&&!!A.A.baseAt})()`); }
      check(ready, 'tracce caricate dal motore su A e B');
      await down('.au-deck[data-deck=A] [data-au=play]');
      await sleep(2000);
      const a = JSON.parse(await p.ev(`JSON.stringify((({playing,pos,cue})=>({playing,pos,cue}))(window.__planciaTest.AU.decks.A))`));
      check(a.playing && a.pos - a.cue > 1.6 && a.pos - a.cue < 2.6, `A in onda dal motore: ${(a.pos - a.cue).toFixed(2)} s in 2 s`);
      const meter = await p.ev('window.__planciaTest.AU.mix.A.meter');
      check(meter > 0.01, `meter di A dal motore: ${meter.toFixed(3)}`);
      // B: hot cue 1 qui, SYNC, play -> tempo e fase di A
      await down('.au-deck[data-deck=B] [data-au=hot][data-n="0"]'); await up();
      await down('.au-deck[data-deck=B] [data-au=sync]');
      await down('.au-deck[data-deck=B] [data-au=play]');
      await sleep(1500);
      const s = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest.AU,d=T.decks,ph=x=>{const p=60/x.track.bpm;return(((x.pos-x.track.first_beat)/p)%1+1)%1};
        const bpm=x=>x.track.bpm*(1+x.tempo*x.range);return JSON.stringify({bpmA:bpm(d.A),bpmB:bpm(d.B),dp:Math.abs(ph(d.A)-ph(d.B)),hot:d.B.hot[0],master:T.master,sync:d.B.sync})})()`));
      const dp = Math.min(s.dp, 1 - s.dp);
      check(s.sync && Math.abs(s.bpmA - s.bpmB) < 0.05, `SYNC: B a ${s.bpmB.toFixed(2)} BPM come A (${s.bpmA.toFixed(2)})`);
      check(dp < 0.06, `B in fase con A (scarto ${dp.toFixed(3)} di battito, testine interpolate)`);
      check(s.hot != null && s.master === 'A', `hot cue 1 di B a ${s.hot?.toFixed(2)} s, master A`);
      // mixer: crossfader tutto su B -> il meter di A si spegne
      await p.ev(`(()=>{const r=document.querySelector('.au-xf input');r.value=1;r.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
      await sleep(600);
      const m = JSON.parse(await p.ev(`JSON.stringify({a:window.__planciaTest.AU.mix.A.meter,b:window.__planciaTest.AU.mix.B.meter,x:window.__planciaTest.AU.mix.xfader})`));
      check(m.x === 1 && m.a < 0.001 && m.b > 0.01, `crossfader su B: meter A ${m.a.toFixed(4)}, B ${m.b.toFixed(3)}`);
      // CUE in onda: A torna al cue e si ferma
      await down('.au-deck[data-deck=A] [data-au=cue]'); await up(); await sleep(400);
      const c = JSON.parse(await p.ev(`JSON.stringify((({playing,pos,cue})=>({playing,pos,cue}))(window.__planciaTest.AU.decks.A))`));
      check(!c.playing && Math.abs(c.pos - c.cue) < 0.01, 'CUE in onda: A torna al cue, fermo');
      // i punti di B sono salvati dal motore accanto all'analisi
      const saved = path.join(tmpCache, pick[1] + '.cues.json');
      const cues = fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved, 'utf8')) : null;
      check(cues && Math.abs(cues.hot[0] - s.hot) < 0.001 && cues.hot.length === 8, `hot cue salvato dal motore in ${pick[1]}.cues.json`);
    }
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally {
    p.close();
    engine.kill();
    fs.rmSync(tmpCache, { recursive: true, force: true });
  }
  if (fail.length) { console.error(`motore audio dal vivo: ${fail.length} errori\n--- motore ---\n${elog.slice(-1500)}`); process.exit(1); }
}
main().catch(e => { console.error('motore audio dal vivo: prova fallita:', e.message); process.exit(2); });
