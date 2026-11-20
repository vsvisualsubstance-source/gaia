'use strict';
// Musica nel Render 3D (20/11): la registrazione del ⏺ del Render tiene lo stato dei deck del
// motore audio (62-light-frames.js, doc.audio); il Render 3D lo suona in sincrono e lo mette
// nell'MP4 esportato. Motore finto (audio_state a mano), brani veri della libreria.
//   node test/render3d-audio.js   (senza libreria audio o senza scansione si salta)

const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');
const audioLib = require('../audio-lib');

const SCAN = path.join(__dirname, '..', 'data', 'render3d');

async function main() {
  const tracks = await audioLib.library();
  let id = null;
  for (const t of tracks) { try { await audioLib.trackFile(t.id); if ((t.duration || 999) > 90) { id = t.id; break; } } catch { /* file mancante */ } }
  if (!id) { console.log('salto: nessun brano analizzato con il file su questo PC'); return; }
  if (!fs.existsSync(path.join(SCAN, 'scan.js'))) { console.log('salto: manca la scansione (data/render3d)'); return; }
  process.env.AUDIO_CACHE = process.env.AUDIO_CACHE || audioLib.CACHE;
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    // --- Plancia: stato dei deck nella registrazione, solo quando cambia ---
    const doc = await p.ev(`(async()=>{const T=window.__planciaTest,AU=T.AU,sl=ms=>new Promise(r=>setTimeout(r,ms));
      const st=(pos,playing,xf=0)=>({type:'audio_state',decks:{A:{track:'${id}',pos,playing,rate:1},B:{track:null,pos:0,playing:false,rate:1}},mix:{A:{gain:1,fader:1},B:{gain:1,fader:1},xfader:xf}});
      AU.live=true;AU.lastState=st(10,true);AU.liveAt=performance.now()-100;
      T.lfStart(30);const t0=performance.now();T.lfBegin(t0);T.lfEnd();
      await sl(400);T.lfAudio(st(10.5,true));            // posizione che scorre: niente di nuovo
      await sl(300);T.lfAudio(st(10.8,true,1));          // crossfader su B: deck A muto
      await sl(300);T.lfAudio(st(11.1,false,1));         // pausa
      T.lfBegin(performance.now());T.lfEnd();
      return T.lfStop()})()`);
    const au = doc?.audio || [];
    check(au.length === 3, `3 eventi audio (inizio, crossfader, pausa): ${au.length} ${JSON.stringify(au.map(e => [e.t, e.pos, e.playing, e.g]))}`);
    check(au[0] && au[0].t === 0 && au[0].pos > 10.05 && au[0].pos < 10.3 && au[0].playing && au[0].g > 0.6, `stato preso prima del primo fotogramma: parte da 0 alla posizione giusta (${au[0]?.pos})`);
    check(au[1] && au[1].g < 0.01 && au[2] && !au[2].playing, 'crossfader e pausa registrati');

    // --- Render 3D: registrazione con musica (30 s del brano, poi salto a 60 s) ---
    fs.cpSync(SCAN, path.join(p.tmp, 'render3d'), { recursive: true });
    const base = await p.ev('location.origin');
    const frames = Array.from({ length: 91 }, (_, i) => ({ t: Math.round(i * 1000 / 30), f: {} }));
    const rec = { app: 'plancia-light-frames', v: 1, fps: 30, created: new Date().toISOString(), project: 'prova musica', duration: 3,
      stage: { width: 10, depth: 8, trussHeight: 5 }, fixtures: [],
      audio: [{ t: 0, k: 'A', track: id, pos: 30, playing: true, rate: 1, g: 1 }, { t: 1500, k: 'A', track: id, pos: 31.5, playing: true, rate: 1, g: 0.5 },
        { t: 2000, k: 'A', track: id, pos: 60, playing: true, rate: 1, g: 1 }], frames };
    const up = await fetch(`${base}/api/light-frames?name=prova_musica`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }).then(r => r.json());
    check(up.ok, 'registrazione con musica salvata sul bridge');
    await p.send('Page.navigate', { url: `${base}/render3d/?frames=${encodeURIComponent(up.file)}` });
    let msg = '';
    for (let i = 0; i < 80 && !/pronti/.test(msg); i++) { await sleep(250); msg = await p.ev(`document.getElementById('frAuMsg')?.textContent||''`); }
    check(/1\/1 brani pronti/.test(msg), `Render 3D: brano caricato (${msg})`);
    check(await p.ev(`getComputedStyle(document.getElementById('frAuRow')).display!=='none'`), 'riga "musica della registrazione" visibile');
    const runs = await p.ev(`JSON.stringify(window.__r3d.faRuns(window.__r3d.FA.ev.A,3))`);
    check(JSON.parse(runs).length === 2, `tratti continui: 2 (il cambio di volume non spezza, il salto si') ${runs}`);
    for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: 700, y: 400, button: 'left', clickCount: 1 });
    await sleep(600);
    const live = await p.ev(`(()=>{const {FR,FA}=window.__r3d,d=FA.decks.A;return {state:FA.ctx.state,src:!!d?.src,t:FR.t,pos:d&&d.src?d.off+(FA.ctx.currentTime-d.t0)*d.rate:null}})()`);
    const want = live.t < 2 ? 30 + live.t : 60 + (live.t - 2);
    check(live.state === 'running' && live.src, `in play il deck A suona (contesto ${live.state})`);
    check(live.pos != null && Math.abs(live.pos - want) < 0.3, `in sincrono con la registrazione: brano ${live.pos?.toFixed(2)} s, atteso ${want.toFixed(2)} s`);
    await p.ev(`(()=>{document.getElementById('play').click();return 1})()`);
    await sleep(200);
    check(await p.ev(`!window.__r3d.FA.decks.A.src`), 'pausa: la musica si ferma');

    // --- export MP4 con la musica ---
    await p.ev(`(()=>{window._lastExport=null;document.getElementById('exRes').value='1280x720';document.getElementById('exDur').value='full';document.getElementById('exGo').click();return 1})()`);
    let blob = 0;
    for (let i = 0; i < 240 && !blob; i++) { await sleep(500); blob = await p.ev(`window._lastExport?window._lastExport.size:0`); }
    const ex = await p.ev(`document.getElementById('exMsg').textContent`);
    check(blob > 0, `export finito (${(blob / 1048576).toFixed(2)} MB): ${ex}`);
    const boxes = await p.ev(`(async()=>{const b=new Uint8Array(await window._lastExport.arrayBuffer()),s=new TextDecoder('latin1').decode(b);return {soun:s.includes('soun'),aac:s.includes('mp4a'),opus:s.includes('Opus'),vide:s.includes('vide')}})()`);
    check(boxes.vide && boxes.soun && (boxes.aac || boxes.opus), `MP4 con traccia video e audio (${boxes.aac ? 'AAC' : boxes.opus ? 'Opus' : 'nessun codec audio'})`);
    // l'audio dell'MP4 decodificato: c'e' suono e dura quanto il video
    const dec = await p.ev(`(async()=>{const ac=new OfflineAudioContext(2,48000,48000);const ab=await ac.decodeAudioData(await window._lastExport.arrayBuffer());let m=0;const d=ab.getChannelData(0);for(let i=0;i<d.length;i+=37)m=Math.max(m,Math.abs(d[i]));return {dur:ab.duration,peak:m}})()`).catch(e => ({ err: e.message }));
    check(dec.dur > 2.7 && dec.dur < 3.4 && dec.peak > 0.01, `audio dell'MP4: ${dec.dur?.toFixed(2)} s, picco ${dec.peak?.toFixed(3)} ${dec.err || ''}`);
    check(!p.problems.length, 'nessuna eccezione nella pagina' + (p.problems.length ? ': ' + p.problems.slice(0, 3).join(' | ') : ''));
  } finally { p.close(); }
  if (fail.length) { console.log(`\n${fail.length} controlli falliti`); process.exitCode = 1; } else console.log('\ntutto ok');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
