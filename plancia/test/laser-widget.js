'use strict';
// Widget laser registrato (05-widget-registry.js): tocco, aggiornamento nel loop
// e aiuto passano dal registro. Gateway finto iniettato in G (nessun MQTT).
//   node test/laser-widget.js   (incluso in npm run check)
const assert = require('assert');
const { startPlancia, sleep } = require('./browser-harness');
(async () => {
  const p = await startPlancia({ hooks: true });
  try {
    const tabs = await p.ev(`[...document.querySelectorAll('#tabs > *')].map(e=>e.textContent.trim())`);
    await p.ev(`document.querySelectorAll('#tabs > *')[${tabs.indexOf('Laser')}].click();1`);
    await p.ev(`(()=>{const G=window.__planciaTest.G;G.devices['laser-test']={family:'laser',_seen:Date.now(),
      laser:{cubes:[{id:'c1',name:'Prova',online:true,mode:'off',armed:false,streaming:false}],sources:{},found:[]}};G.dirty=true;return 1})()`);
    await sleep(1800);
    assert.equal(await p.ev(`document.querySelector('.lz-card b')?.textContent||''`), 'Prova', 'scheda del cubo non disegnata');
    await p.ev(`document.querySelector('[data-lzs="reset"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));1`);
    await sleep(500);
    assert.match(await p.ev(`document.querySelector('#toast').textContent`), /template/i, 'il tocco non arriva al widget');
    await sleep(300);
    assert.equal(await p.ev(`[...document.querySelectorAll('canvas[data-lzs-cv]')].filter(c=>c.getContext('2d').getImageData(60,60,1,1).data[3]>0).length`), 23, 'miniature delle scene non disegnate');
    // Adatta: figura pesante, la Dimensione proposta arriva al cursore; poi i template tornano com'erano
    await p.ev(`(()=>{const T=window.__planciaTest,R=r=>({closed:true,pts:Array.from({length:96},(_,i)=>[r*Math.cos(i/96*6.2832),r*Math.sin(i/96*6.2832)])});
      T.L.laserScenes=[...T.L.laserScenes,{id:'fit',name:'Pesante',strokes:[R(.95),R(.7)],color:{mode:'fixed',rgb:[1,1,1]},anim:{scale:1},audio:{amount:0,to:'scale'}}];T.G.dirty=true;return 1})()`);
    await sleep(1500);
    await p.ev(`document.querySelector('[data-lzs="edit"][data-lzs-v="fit"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));1`);
    await sleep(500);
    assert.match(await p.ev(`document.querySelector('#lsWeight').textContent`), /pesante/, 'peso della figura');
    assert.equal(await p.ev(`document.querySelector('#lsFit').hidden`), false, 'Adatta visibile');
    await p.ev(`document.querySelector('#lsFit').click();1`);
    await sleep(300);
    assert.equal(await p.ev(`+document.querySelector('#lsScale').value`), 0.5, 'Dimensione adattata');
    assert.match(await p.ev(`document.querySelector('#lsWeight').textContent`), /leggera/, 'dopo Adatta la figura e leggera');
    assert.equal(await p.ev(`document.querySelector('#lsFit').hidden`), true, 'Adatta nascosto su figura leggera');
    await p.ev(`document.querySelector('#lsClose').click();window.__planciaTest.L.laserScenes=window.__planciaTest.L.laserScenes.filter(x=>x.id!=='fit');1`);
    await sleep(300);
    // scena composta: due scene insieme, anteprima disegnata, salvata con il segno dei livelli
    await p.ev(`document.querySelector('[data-lzs="comp"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));1`);
    await sleep(500);
    assert.equal(await p.ev(`document.querySelectorAll('.lzs-ly').length`), 2, 'composta nuova con due livelli');
    assert.ok(await p.ev(`(()=>{const c=document.querySelector('#lcPrev'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>60)n++;return n>50})()`), 'anteprima della composta vuota');
    assert.match(await p.ev(`document.querySelector('#lcWeight').textContent`), /Figura/, 'peso della composta');
    await p.ev(`document.querySelector('#lcAdd').click();1`); await sleep(200);
    assert.equal(await p.ev(`document.querySelectorAll('.lzs-ly').length`), 3, '+ Livello');
    await p.ev(`document.querySelector('#lcSave').click();1`); await sleep(1500);
    assert.equal(await p.ev(`window.__planciaTest.L.laserScenes.filter(x=>x.layers).map(x=>x.layers.length).join()`), '3', 'composta salvata nel progetto');
    assert.match(await p.ev(`document.querySelector('.lzs-c')?.textContent||''`), /3 livelli/, 'segno dei livelli sulla miniatura');
    await p.ev(`window.__planciaTest.L.laserScenes=window.__planciaTest.L.laserScenes.filter(x=>!x.layers);1`);
    await p.ev(`document.querySelector('#helpBtn').click();1`);
    await sleep(800);
    const step=()=>p.ev(`document.querySelector('.tour-tip')?.innerText.split(String.fromCharCode(10)).join(' | ').slice(0,160)`);
    assert.match(await step(), /Pagina Laser \| +\| Laser: scene laser/);
    await p.ev(`[...document.querySelectorAll('.tour-tip button')].find(b=>/avanti|›|→|next/i.test(b.textContent))?.click();1`); await sleep(400);
    assert.match(await step(), /2 \/ \d+ \| Laser \| +\| In alto le Scene laser/);
    assert.deepEqual(p.problems, []);
    console.log('widget laser dal registro: ok');
  } finally { p.close(); }
})().catch(e => { console.error(e); process.exit(1); });
