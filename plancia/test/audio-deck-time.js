'use strict';
// Deck della Console Audio: conto alla rovescia e durata accanto al titolo, griglia per
// frasi nella panoramica (una riga ogni N battute, mai troppo fitta). Motore simulato.
//   node test/audio-deck-time.js [--shot file.png]   (incluso in npm run check)

const fs = require('fs');
const path = require('path');
const os = require('os');
const CACHE = process.env.AUDIO_CACHE || path.join(__dirname, '..', '..', 'audio-engine', 'cache');
const { startPlancia, sleep } = require('./browser-harness');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  if (!fs.existsSync(CACHE) || !fs.readdirSync(CACHE).some(n => n.endsWith('.json'))) { console.log('deck: saltato (nessuna analisi)'); return; }
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'plancia-audio-'));
  for (const n of fs.readdirSync(CACHE)) if (n.endsWith('.json') && !n.endsWith('.cues.json')) fs.copyFileSync(path.join(CACHE, n), path.join(tmpCache, n));
  process.env.AUDIO_CACHE = tmpCache;
  process.env.AUDIO_ENGINE_URL = 'ws://127.0.0.1:9';
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(...t.TPL.consoleaudio.pages());t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    let n = 0;
    for (let i = 0; i < 20 && !n; i++) { await sleep(300); n = await p.ev('window.__planciaTest.AU.tracks.length'); }
    const id = await p.ev(`(window.__planciaTest.AU.tracks.find(t=>t.confidence>=.6&&t.seconds>200)||{}).id`);
    check(!!id, 'brano con griglia affidabile');
    await p.ev(`window.__planciaTest.auLoad('A',${JSON.stringify(id)})`);
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) { await sleep(250); ok = await p.ev(`!!window.__planciaTest.AU.decks.A.track`); }
    // posizione e tempo noti, deck fermo: il conto alla rovescia non cambia durante la lettura
    const sec = await p.ev(`(()=>{const d=window.__planciaTest.AU.decks.A;d.playing=false;d.pos=60;d.tempo=0;return d.track.seconds})()`);
    await sleep(300);
    const dur = () => p.ev(`(()=>{const e=document.querySelector('.au-deck[data-deck="A"] .au-dur');return JSON.stringify({b:e.querySelector('b').textContent,i:e.querySelector('i').textContent,end:e.classList.contains('end')})})()`);
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    let v = JSON.parse(await dur());
    check(v.b === '-' + fmt(sec - 60) && v.i === fmt(sec) && !v.end, `accanto al titolo: ${v.b} che mancano, durata ${v.i}`);
    // accelerato del 4%: finisce prima
    await p.ev(`(()=>{const d=window.__planciaTest.AU.decks.A;d.range=.08;d.tempo=.5;return 1})()`);
    await sleep(300);
    v = JSON.parse(await dur());
    check(v.b === '-' + fmt((sec - 60) / 1.04), `con +4% di tempo il conto tiene conto della velocità: ${v.b}`);
    await p.ev(`(()=>{const d=window.__planciaTest.AU.decks.A;d.tempo=0;d.pos=d.track.seconds-20;return 1})()`);
    await sleep(300);
    v = JSON.parse(await dur());
    check(v.end && v.b === '-0:20', `ultimi 30 secondi: in rosso (${v.b})`);
    // griglia per frasi: righe almeno a 9 px, ogni quarta marcata, nessuna senza griglia affidabile
    const g = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest,d=T.AU.decks.A,W=700,l=T.auPhraseGrid(d,W),gaps=l.slice(1).map((x,i)=>x.x-l[i].x);
      const bad={...d,track:{...d.track,confidence:.1,locked:false}};
      return JSON.stringify({n:l.length,bars:l[0]&&l[0].bars,min:Math.min(...gaps),strong:l.filter(x=>x.strong).length,none:T.auPhraseGrid(bad,W).length})})()`));
    check(g.n > 4 && g.min >= 9 && [4, 8, 16, 32, 64].includes(g.bars), `panoramica: ${g.n} righe ogni ${g.bars} battute, distanza minima ${g.min.toFixed(1)} px`);
    check(g.strong >= 1 && g.strong < g.n, `ogni quarta riga marcata (${g.strong} su ${g.n})`);
    check(g.none === 0, 'griglia incerta: nessuna riga');
    await p.ev(`(()=>{window.__planciaTest.AU.decks.A.pos=95;return 1})()`);
    await sleep(400);
    const shot = arg('--shot');
    if (shot) await p.shot(path.resolve(shot));
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); fs.rmSync(tmpCache, { recursive: true, force: true }); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('deck: prova fallita:', e.message); process.exitCode = 2; });
