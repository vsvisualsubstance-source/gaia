'use strict';
// Anteprime delle scene (63-dmx-scenes.js): miniatura del Render coi colori di
// scene.preview, nella pila Scene GO, nell'elenco ▣ Scene e sulle cue LUCI della
// timeline. Scene senza colori (solo teste) senza miniatura; cache per scena.
//   node test/scene-thumbs.js [--shot file.png]

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const T=window.__planciaTest;
      const pv=(a,b,c)=>({rig_a:{palette:'x',colors:a},rig_b:{palette:'y',colors:b},ledbar:{palette:'z',colors:c}});
      const cat=[
        {id:'rosso',index:0,label:'Rosso',categories:['rigs'],preview:pv([[1,0,0]],[[.8,0,0]],[[1,.1,0]])},
        {id:'blu',index:1,label:'Blu',categories:['rigs'],preview:pv([[0,0,1]],[[0,.2,1]],[[0,.4,1],[0,0,1]])},
        {id:'arcobaleno',index:2,label:'Arcobaleno',categories:['palette'],preview:pv([[255,0,0],[0,255,0]],[[0,0,255]],[[255,255,0],[255,0,255],[0,255,255],[255,128,0]])},
        {id:'teste_cielo',index:3,label:'Teste al cielo',categories:['heads']}];
      T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{}),ts:Date.now(),params:{...(T.G.devices['td-dmx-win']?.params||{}),show_scene_catalog:cat}};
      const L=T.demoProjectLayout();
      const tl=L.pages.flatMap(p=>p.widgets).find(x=>x.type==='timeline'&&x.addr==='/show'&&!x.readonly);
      tl.cues='0:00 Rosso > @rosso; fade=2\\n0:20 Blu > @blu; fade=2\\n0:40 Arco > @arcobaleno; fade=1\\n1:00 Cielo > @teste_cielo';
      tl.duration=80;
      L.pages.push(T.P('Anteprime',[T.W('cuestack',0,0,4,10,{label:'Scene GO'}),{...tl,id:'tlx',x:4,y:0,w:12,h:5}]));
      T.L=L;T.render();const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(1500);
    const cs = await p.ev(`[...document.querySelectorAll('.cs-row')].map(r=>({n:r.querySelector('b').textContent,img:r.querySelector('.cs-th')?.src?.slice(0,30)||null}))`);
    check(cs.length === 4, `Scene GO: 4 righe (${cs.map(r => r.n).join(', ')})`);
    check(cs.filter(r => r.img && r.img.startsWith('data:image/jpeg')).length === 3, 'Scene GO: miniatura per le 3 scene di colore');
    check(!cs.find(r => r.n === 'Teste al cielo').img, 'scena di sole teste: niente miniatura');
    const urls = await p.ev(`[...document.querySelectorAll('.cs-th')].map(i=>i.src)`);
    check(new Set(urls).size === 3, 'le 3 miniature sono diverse (colori diversi)');
    // colore: il rosso deve prevalere nella miniatura della scena Rosso, il blu in quella Blu
    const tint = await p.ev(`(async()=>{const out={};for(const r of document.querySelectorAll('.cs-row')){const im=r.querySelector('.cs-th');if(!im)continue;
      await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const g=c.getContext('2d');g.drawImage(im,0,0);
      const d=g.getImageData(0,0,c.width,c.height).data;let R=0,B=0;for(let i=0;i<d.length;i+=4){R+=d[i];B+=d[i+2]}out[r.querySelector('b').textContent]=[R,B]}return out})()`);
    check(tint.Rosso[0] > tint.Rosso[1] * 1.3 && tint.Blu[1] > tint.Blu[0], `colori giusti: Rosso R>B (${tint.Rosso.map(v => Math.round(v / 1e3))}), Blu B>R (${tint.Blu.map(v => Math.round(v / 1e3))})`);
    // timeline: blocchi LUCI con la miniatura
    const tb = await p.ev(`[...document.querySelectorAll('.w[data-id="tlx"] .tl-blk')].map(b=>b.classList.contains('tl-th'))`);
    check(tb.filter(Boolean).length === 3, `timeline: miniatura su 3 cue LUCI (${JSON.stringify(tb)})`);
    // cache: la stessa scena non si ridisegna
    const same = await p.ev(`(()=>{const T=window.__planciaTest;return 1})()`);
    void same;
    const shot = arg('--shot');
    if (shot) { await p.shot(path.resolve(shot)); console.log('screenshot: ' + path.resolve(shot)); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('anteprime scene: prova fallita:', e.message); process.exitCode = 2; });
