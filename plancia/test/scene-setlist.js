'use strict';
// Scaletta delle scene per progetto: Scene GO e blocco Scene mostrano solo le scene scelte,
// mandano il numero vero di TD, e l'editor salva scelta e ordine nel progetto.
//   node test/scene-setlist.js   (incluso in npm run check)

const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const pick = sel => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error(${JSON.stringify('manca ' + sel)});return e})()`;
  const down = sel => p.ev(`${pick(sel)}.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))`);
  const click = sel => p.ev(`${pick(sel)}.click()`);
  const rows = () => p.ev(`[...document.querySelectorAll('.cs-row b')].map(x=>x.textContent)`);
  const sentScenes = () => p.ev(`window.__sent.filter(m=>m.address==='/dmx/scene').map(m=>m.args[0]?.value??m.args[0])`);
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const T=window.__planciaTest;
      const cat=['a','b','c','d','e'].map((id,index)=>({id,index,label:id.toUpperCase(),categories:['palette'],cues:[]}));
      T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{}),ts:Date.now(),params:{...(T.G.devices['td-dmx-win']?.params||{}),show_scene_catalog:cat}};
      const L=T.demoProjectLayout();
      L.pages.push(T.P('Scaletta',[T.W('cuestack',0,0,4,10,{label:'Scene GO'}),{...T.W('scenes',4,0,6,5,{label:'Scene',addr:'/dmx/scene',items:'',cols:3,value:-1}),id:'scb'}]));
      T.L=L;T.render();const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(2200);
    check((await rows()).join() === 'A,B,C,D,E', 'senza scaletta: tutte le scene, come prima');

    await p.ev(`(()=>{const T=window.__planciaTest;T.L.sceneSetlist=['d','b','sparita'];T.render();return 1})()`);
    await sleep(2200);
    check((await rows()).join() === 'D,B', `scaletta: ordine del progetto (${await rows()})`);
    check(await p.ev(`document.querySelector('.cs-setlist').textContent.includes('2 di 5')`), 'contatore 2 di 5');
    const tiles = await p.ev(`[...document.querySelectorAll('.w[data-id="scb"] .si[data-i]')].map(x=>x.dataset.i)`);
    check(tiles.join() === '3,1', `blocco Scene: numeri veri di TD (${tiles})`);

    await down('.cs-go');
    await sleep(200);
    await down('.w[data-id="scb"] .si[data-i="1"]');
    await sleep(200);
    const sent = await sentScenes();
    check(sent.join() === '3,1', `GO e blocco mandano il numero di TD (${sent})`);

    await down('.cs-setlist');
    await sleep(300);
    const names = () => p.ev(`[...document.querySelectorAll('.sl-row b')].map(x=>x.textContent)`);
    check((await names()).join() === 'D,B,A,C,E', `editor: prima la scaletta, poi il resto (${await names()})`);
    await p.ev(`(()=>{const c=document.querySelector('.sl-row[data-sl="a"] .sl-on');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    await sleep(200);
    await click('.sl-row[data-sl="a"] [data-sl-move="-1"]');
    await sleep(200);
    await click('#slSave');
    await sleep(2200);
    const saved = await p.ev(`window.__planciaTest.L.sceneSetlist.join()`);
    check(saved === 'd,a,b', `salvata con ordine e aggiunta (${saved})`);
    check((await rows()).join() === 'D,A,B', 'Scene GO aggiornata dopo il salvataggio');
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('scaletta: prova fallita:', e.message); process.exitCode = 2; });
