'use strict';
// Autoplay nella Libreria della Console Audio: pulsante AUTO, scelta ordine e dissolvenza,
// comando al bridge di prova (senza motore audio) e stato che torna nella barra.
//   node test/audio-auto-ui.js   (incluso in npm run check)

const { startPlancia, sleep } = require('./browser-harness');
const audioLib = require('../audio-lib');

async function main() {
  process.env.AUDIO_CACHE = process.env.AUDIO_CACHE || audioLib.CACHE;   // libreria vera, motore no
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const bar = () => p.ev(`(document.querySelector('.au-auto')||{}).textContent||''`);
  const click = sel => p.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return 0;b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));return 1})()`);
  const choose = label => p.ev(`(()=>{const b=[...document.querySelectorAll('.ui-confirm [data-i]')].find(x=>x.textContent===${JSON.stringify(label)});if(!b)return 0;b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));return 1})()`);
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const T=window.__planciaTest;T.L.pages.push(...T.TPL.consoleaudio.pages());T.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(1500);
    check(/AUTO/.test(await bar()), `fermo: pulsante ▶ AUTO nella Libreria (${await bar()})`);
    check(await click('[data-au="autogo"]') === 1, 'tocco su AUTO');
    await sleep(200);
    const opts = await p.ev(`[...document.querySelectorAll('.ui-confirm [data-i]')].map(b=>b.textContent).join('|')`);
    check(opts === 'A caso', `da tutta la libreria solo "A caso" (${opts})`);
    await choose('A caso'); await sleep(200);
    check(await choose('12 s') === 1, 'scelta la dissolvenza 12 s');
    let txt = '';
    for (let i = 0; i < 20 && !/motore audio non collegato/.test(txt); i++) { await sleep(150); txt = await bar(); }
    check(/AUTO/.test(txt) && /motore audio non collegato/.test(txt), `il bridge l'ha avviato e dice che manca il motore (${txt.trim()})`);
    check(await p.ev(`(()=>{const a=window.__planciaTest.G.audioAuto;return a&&a.active&&a.mode==='shuffle'&&a.fade===12&&a.sourceName==='Tutta la libreria'})()`), 'stato dal bridge: a caso, 12 s, tutta la libreria');
    // stato in onda (come dal bridge col motore vero): brano, posizione, prossimo
    await p.ev(`(()=>{window.__planciaTest.G.audioAuto=({active:true,mode:'order',fade:8,source:'pl',sourceName:'Sera',waiting:false,stopping:false,error:'',
      now:{id:'a',title:'Alfa',artist:'X',deck:'B',pos:75,len:200},next:{id:'b',title:'Beta',artist:'',deck:'A',len:180},count:2});return 1})()`);
    await sleep(300);
    txt = await bar();
    check(/B · Alfa – X/.test(txt) && /1:15 \/ 3:20/.test(txt) && /→ Beta/.test(txt), `in onda: deck, titolo, tempo e prossimo (${txt.trim()})`);
    await p.ev(`(()=>{window.__planciaTest.G.audioAuto=({active:true,mode:'order',fade:8,sourceName:'Sera',waiting:true,stopping:false,error:'',now:null,next:null});return 1})()`);
    await sleep(300);
    check(/comanda la traccia AUDIO/.test(await bar()) && await p.ev(`document.querySelector('[data-au="autonext"]').disabled`), 'timeline AUDIO accesa: in attesa, ⏭ spento');
    // stop vero sul bridge: torna il pulsante AUTO
    await p.ev(`(()=>{window.__planciaTest.G.audioAuto=({active:true,mode:'shuffle',fade:12,sourceName:'Tutta la libreria',waiting:false,stopping:false,error:'',now:null,next:null});return 1})()`);
    await sleep(300);
    await click('[data-au="autostop"]');
    let off = false;
    for (let i = 0; i < 20 && !off; i++) { await sleep(150); off = /▶ AUTO/.test(await bar()); }
    check(off, `■: il bridge ferma l'autoplay e torna ▶ AUTO (${(await bar()).trim()})`);
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('autoplay: prova fallita:', e.message); process.exitCode = 2; });
