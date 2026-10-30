'use strict';
// Console Audio (src/52-audio-console.js) nel browser, col motore simulato:
// libreria dal bridge (cache dell'analisi di gaia-audio), due tracce con BPM
// diversi su A e B, A in onda, SYNC su B -> B prende il BPM di A ed e' in fase.
// Senza analisi in cache (macchina senza audio-engine/cache) salta.
//   node test/audio-console.js [--shot file.png]

const fs = require('fs');
const path = require('path');
const CACHE = process.env.AUDIO_CACHE || path.join(__dirname, '..', '..', 'audio-engine', 'cache');
process.env.AUDIO_CACHE = CACHE;   // il bridge della prova gira in una copia della cartella
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  if (!fs.existsSync(CACHE) || !fs.readdirSync(CACHE).some(n => n.endsWith('.json'))) {
    console.log(`console audio: saltato (nessuna analisi in ${CACHE})`);
    return;
  }
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(...t.TPL.consoleaudio.pages());t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    let n = 0;
    for (let i = 0; i < 20 && !n; i++) { await sleep(300); n = await p.ev('window.__planciaTest.AU.tracks.length'); }
    check(n > 0, `libreria dal bridge: ${n} tracce`);
    // due tracce affidabili con BPM diversi (entro il ±8%)
    const pick = await p.ev(`(()=>{const ts=window.__planciaTest.AU.tracks.filter(t=>t.confidence>=.6&&t.seconds>120);
      const a=ts.find(t=>Math.round(t.bpm)===126)||ts[0];const b=ts.find(t=>t.id!==a.id&&t.bpm!==a.bpm&&Math.abs(t.bpm/a.bpm-1)<.05);
      return b?[a.id,b.id,a.bpm,b.bpm]:null})()`);
    check(!!pick, `tracce scelte: ${pick ? `${pick[2]} e ${pick[3]} BPM` : 'nessuna coppia'}`);
    if (pick) {
      await p.ev(`Promise.all([window.__planciaTest.auLoad('A','${pick[0]}'),window.__planciaTest.auLoad('B','${pick[1]}')]).then(()=>1)`);
      await sleep(500);
      await p.ev(`(()=>{const t=window.__planciaTest;t.auCmd({cmd:'deck.seek',deck:'A',pos:60});t.auCmd({cmd:'deck.play',deck:'A'});
        t.auCmd({cmd:'deck.seek',deck:'B',pos:45.123});t.auCmd({cmd:'deck.sync',deck:'B'});t.auCmd({cmd:'deck.play',deck:'B'});
        t.auCmd({cmd:'mix.set',values:{xfader:-.3}});return 1})()`);
      await sleep(2500);
      const s = await p.ev(`(()=>{const t=window.__planciaTest,A=t.AU.decks.A,B=t.AU.decks.B;
        return{a:t.auBpm(A),b:t.auBpm(B),pa:t.auPhase(A),pb:t.auPhase(B),posA:A.pos,play:A.playing&&B.playing,master:t.AU.master}})()`);
      check(s.master === 'A', `master resta A quando parte B (master: ${s.master})`);
      check(s.play && s.posA > 61.5, `A e B in onda, testina A avanzata (${s.posA.toFixed(2)} s)`);
      check(Math.abs(s.a - s.b) < 0.01, `SYNC: BPM di B = A (${s.a.toFixed(2)} / ${s.b.toFixed(2)})`);
      let dp = Math.abs(s.pa - s.pb); dp = Math.min(dp, 1 - dp);
      check(dp < 0.01, `SYNC: B in fase con A (scarto ${(dp * 100).toFixed(2)}% di battito)`);
    }
    if (pick) {
      // trascinare la forma d'onda del deck A (fermo, zoom 4 s): 120 px a sinistra = traccia avanti
      await p.ev(`(()=>{const t=window.__planciaTest;const A=t.AU.decks.A;if(A.playing)t.auCmd({cmd:'deck.play',deck:'A'});
        t.auCmd({cmd:'deck.zoom',deck:'A',value:4});A.snap=true;t.auCmd({cmd:'deck.snap',deck:'A'});return 1})()`);
      await sleep(300);
      const g = await p.ev(`(()=>{const c=document.querySelector('.au-deck[data-deck=A] .au-wave').getBoundingClientRect();
        return{x:c.left+c.width/2,y:c.top+c.height/2,w:c.width,pos:window.__planciaTest.AU.decks.A.pos}})()`);
      const mouse = (type, x) => p.send('Input.dispatchMouseEvent', { type, x, y: g.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
      await mouse('mousePressed', g.x);
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', g.x - 20 * i); await sleep(30); }
      await mouse('mouseReleased', g.x - 120);
      await sleep(200);
      const after = await p.ev('window.__planciaTest.AU.decks.A.pos');
      const want = g.pos + 120 / g.w * 4;
      check(Math.abs(after - want) < 0.01, `trascinamento della forma d'onda: ${g.pos.toFixed(3)} -> ${after.toFixed(3)} s (atteso ${want.toFixed(3)})`);
      await p.ev(`(()=>{const t=window.__planciaTest;t.auCmd({cmd:'deck.cue_down',deck:'A'});t.auCmd({cmd:'deck.cue_up',deck:'A'});return 1})()`);
      const cue = await p.ev('window.__planciaTest.AU.decks.A.cue');
      check(Math.abs(cue - after) < 1e-6, `CUE con SNAP spento salvato esattamente li' (${cue.toFixed(3)} s)`);
    }
    const shot = arg('--shot');
    if (shot) { await p.shot(path.resolve(shot)); console.log('screenshot: ' + path.resolve(shot)); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('console audio: prova fallita:', e.message); process.exitCode = 2; });
