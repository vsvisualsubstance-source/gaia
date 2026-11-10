'use strict';
// Editor della traccia AUDIO: brano e playlist si scelgono dentro la pagina, senza tendine del browser.
//   node test/audio-cue-picker.js   (incluso in npm run check)
const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const click = sel => p.ev(`document.querySelector(${JSON.stringify(sel)}).click();1`);
  const cue = () => p.ev(`JSON.stringify([...document.querySelectorAll('.acue-row')].map(r=>[r.dataset.k,r.querySelector('.ac-src')?.dataset.id||'',r.querySelector('.ac-src')?.textContent||'']))`);
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    await p.ev(`(()=>{const T=window.__planciaTest;T.AU.tracks=[{id:'a1',title:"Don't Turn It Off",artist:'Forty',seconds:200},{id:'a2',title:'Bliss Science',artist:'Nova',seconds:300},...Array.from({length:120},(_,i)=>({id:'x'+i,title:'Traccia '+i,artist:'',seconds:100}))];
      T.AU.playlists=[{id:'pl1',name:'Apertura',tracks:['a1','a2']}];T.AU.libState='';
      const w=T.L.pages.flatMap(x=>x.widgets).find(x=>x.type==='timeline');window.__w=w;T.openAudioCueEditor(w,[{time:0,label:'',fade:4,src:{kind:'track',id:''}}]);return 1})()`);
    await sleep(200);
    await click('.ac-src');
    await sleep(150);
    check(await p.ev(`document.querySelectorAll('.ac-list [data-id]').length`) === 80, 'elenco limitato a 80 voci');
    await p.ev(`document.querySelector('.ac-find').focus();1`);
    await p.send('Input.insertText', { text: 'turn off' });
    await sleep(150);
    check(await p.ev(`[...document.querySelectorAll('.ac-list [data-id]')].map(b=>b.dataset.id).join()`) === 'a1', 'la ricerca trova parole in qualsiasi ordine, spazi compresi');
    await click('.ac-list [data-id]');
    await sleep(150);
    check(JSON.parse(await cue())[0][1] === 'a1', 'il brano scelto arriva alla riga');
    await click('.ac-kinds [data-k="playlist"]');
    await sleep(150);
    let c = JSON.parse(await cue())[0];
    check(c[0] === 'playlist' && c[1] === '', 'passando a Playlist si sceglie da capo');
    await click('.ac-src');
    await sleep(150);
    await click('.ac-list [data-id="pl1"]');
    await sleep(150);
    c = JSON.parse(await cue())[0];
    check(c[1] === 'pl1' && c[2] === 'Apertura (2)', `playlist scelta (${c[2]})`);
    await click('#acSave');
    await sleep(300);
    const saved = await p.ev(`JSON.stringify(window.__planciaTest.L.audioTimeline.cues[0].src)`);
    check(saved === '{"kind":"playlist","id":"pl1"}', `salvata (${saved})`);
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('scelta brano: prova fallita:', e.message); process.exitCode = 2; });
