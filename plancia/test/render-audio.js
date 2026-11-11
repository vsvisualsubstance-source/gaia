'use strict';
// Audio nel video del Render: la pagina rispecchia lo stato del motore gaia-audio
// (audio_state finto, nessun motore vero) coi file della libreria serviti dal bridge
// (/api/audio/file), in un mix che va solo nel video.
//   node test/render-audio.js   (incluso in npm run check; senza libreria audio si salta)

const { startPlancia, sleep } = require('./browser-harness');
const audioLib = require('../audio-lib');

async function main() {
  const tracks = await audioLib.library();
  let id = null;
  for (const t of tracks) { try { await audioLib.trackFile(t.id); id = t.id; break; } catch { /* file mancante */ } }
  if (!id) { console.log('salto: nessun brano analizzato con il file su questo PC'); return; }
  process.env.AUDIO_CACHE = process.env.AUDIO_CACHE || audioLib.CACHE;   // il bridge di prova parte da una copia: la cache vera
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    // il bridge serve il file, anche a pezzi; niente percorsi a caso
    const base = await p.ev(`location.origin`);
    const r = await fetch(`${base}/api/audio/file?id=${id}`, { headers: { range: 'bytes=0-99' } });
    check(r.status === 206 && (await r.arrayBuffer()).byteLength === 100 && /^audio\//.test(r.headers.get('content-type')), `file del brano a pezzi (Range): ${r.status} ${r.headers.get('content-type')}`);
    check((await fetch(`${base}/api/audio/file?id=..%2F..%2Fx`)).status === 404, 'id non valido: 404');

    const st = (deckA, extra = {}) => JSON.stringify({ type: 'audio_state', decks: { A: deckA, B: { track: null, pos: 0, playing: false, rate: 1 } },
      mix: { A: { gain: 1, fader: 1 }, B: { gain: 1, fader: 1 }, xfader: 0, ...extra } });
    // un clic vero (come quello sulla durata nel tablet): senza, il browser tiene l'audio sospeso
    for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 });
    await p.ev(`(()=>{const T=window.__planciaTest;T.AU.live=true;window.__a=T.recAudioOpen();return !!window.__a})()`);
    await sleep(300);
    check(await p.ev(`window.__a.ctx.state`) === 'running', 'mix del video acceso (dopo un clic)');
    check(await p.ev(`!!window.__a`), 'motore collegato: il mix del video si apre');
    await p.ev(`(()=>{window.__planciaTest.recAudioSync(window.__a,${st({ track: id, pos: 30, playing: true, rate: 1 })});return 1})()`);
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(250); ok = await p.ev(`!!window.__a.decks.A.src`); }
    check(ok, 'deck A in play: il brano viene scaricato, decodificato e parte');
    const pos = await p.ev(`(()=>{const a=window.__a,d=a.decks.A;return d.off+(a.ctx.currentTime-d.t0)*d.rate})()`);
    check(pos > 30.05 && pos < 60, `parte dove è il motore, contando il tempo di caricamento: ${pos.toFixed(2)} s`);
    const g = await p.ev(`(()=>{const T=window.__planciaTest;T.recAudioSync(window.__a,${st({ track: id, pos: pos + 0.05, playing: true, rate: 1 }, { xfader: 1 })});return new Promise(r=>setTimeout(()=>r(window.__a.decks.A.g.gain.value),400))})()`);
    check(g < 0.01, `crossfader tutto su B: deck A muto (${g.toFixed(4)})`);
    await p.ev(`(()=>{window.__s1=window.__a.decks.A.src;return 1})()`);
    // piccolo scarto: si continua; salto: riparte dalla posizione nuova
    await p.ev(`(()=>{const T=window.__planciaTest,a=window.__a,d=a.decks.A,now=d.off+(a.ctx.currentTime-d.t0)*d.rate;
      T.recAudioSync(a,{type:'audio_state',decks:{A:{track:'${id}',pos:now+.05,playing:true,rate:1}},mix:{A:{gain:1,fader:1},xfader:0}});return 1})()`);
    check(await p.ev(`window.__a.decks.A.src===window.__s1`), 'scarto piccolo dal motore: il deck continua senza ripartire');
    await p.ev(`(()=>{window.__planciaTest.recAudioSync(window.__a,{type:'audio_state',decks:{A:{track:'${id}',pos:100,playing:true,rate:1}},mix:{A:{gain:1,fader:1},xfader:0}});return 1})()`);
    ok = false;
    for (let i = 0; i < 20 && !ok; i++) { await sleep(100); ok = await p.ev(`(()=>{const a=window.__a,d=a.decks.A;return !!d.src&&d.src!==window.__s1&&Math.abs(d.off-100)<1})()`); }
    check(ok, 'salto del motore (hot cue, seek): il deck riparte da 100 s');
    await p.ev(`(()=>{window.__planciaTest.recAudioSync(window.__a,{type:'audio_state',decks:{A:{track:'${id}',pos:101,playing:false,rate:1}},mix:{A:{gain:1,fader:1},xfader:0}});return 1})()`);
    check(await p.ev(`!window.__a.decks.A.src`), 'pausa sul motore: il deck si ferma');
    check(await p.ev(`window.__a.dest.stream.getAudioTracks().length===1`), 'il mix dà una traccia audio da mettere nel video');
    // registrazione vera, corta: video della tela + audio del mix
    const rec = await p.ev(`(async()=>{const a=window.__a;window.__planciaTest.recAudioSync(a,{type:'audio_state',decks:{A:{track:'${id}',pos:40,playing:true,rate:1}},mix:{A:{gain:1,fader:1},xfader:0}});
      await new Promise(r=>setTimeout(r,800));
      const cv=document.createElement('canvas');cv.width=320;cv.height=180;document.body.appendChild(cv);const c=cv.getContext('2d');let n=0;const iv=setInterval(()=>{c.fillStyle='hsl('+(n++*20)+',80%,50%)';c.fillRect(0,0,320,180)},50);
      const types=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1,opus','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
      const type=types.find(t=>MediaRecorder.isTypeSupported(t));
      const s=new MediaStream([...cv.captureStream(30).getVideoTracks(),...a.dest.stream.getAudioTracks()]),mr=new MediaRecorder(s,{mimeType:type}),ch=[];
      mr.ondataavailable=e=>ch.push(e.data);const done=new Promise(r=>mr.onstop=r);mr.start(500);await new Promise(r=>setTimeout(r,2500));mr.stop();await done;clearInterval(iv);
      const b=new Blob(ch);return JSON.stringify({type,size:b.size,audio:s.getAudioTracks().length})})()`);
    const rr = JSON.parse(rec);
    check(rr.size > 10000 && rr.audio === 1, `registrazione con video e audio: ${rr.type}, ${(rr.size / 1024).toFixed(0)} kB`);
    await p.ev(`(()=>{window.__planciaTest.recAudioClose(window.__a);return 1})()`);
    check(await p.ev(`window.__a.closed&&!window.__a.decks.A.src`), 'fine registrazione: mix chiuso');
    await p.ev(`(()=>{const T=window.__planciaTest;T.AU.live=false;return T.recAudioOpen()===null})()`).then(v => check(v, 'motore non collegato: video senza audio'));
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  if (fail.length) { console.log(`\n${fail.length} controlli falliti`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
