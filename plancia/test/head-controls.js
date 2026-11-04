'use strict';
// Teste mobili costruite dal modello vero (src/64-head-controls.js): gobo e ruota
// colori del modello, zoom/focus spenti se mancano, posizioni di TD, pagina
// movimento senza doppioni (uiRev 16). La pagina gira in simulazione.
const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    // DMX Master finto: due teste Wecam (ruota, niente zoom/focus) e le posizioni di TD
    await p.ev(`(()=>{const T=window.__planciaTest,d=T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{})};
      d.params={...(d.params||{}),heads_list:[{uid:'u1',name:'MH1',profile:'Wecam',selected:true},{uid:'u2',name:'MH2',profile:'Wecam'}],
        dmx_models:[{model:'Wecam',kind:'heads',channels:['pan','pan_fine','tilt','tilt_fine','color','gobo','shutter','dimmer','speed'],footprint:9,
          colors:[{name:'Weiss',value:0,rgb:[1,1,1]},{name:'Rot',value:8,rgb:[1,0,0]},{name:'Blau',value:29,rgb:[0,0,1]}],
          gobos:[{name:'Gobo_1',value:0},{name:'Gobo_2',value:8},{name:'Open',value:16}]}]};
      T.G.dxm['td-dmx-win']={...(T.G.dxm['td-dmx-win']||{}),heads:{programmer:{positions:[{index:0,position:'Centro',label:'Centro'},{index:1,position:'Palco',label:'Palco vero'}]}}};
      [...document.querySelectorAll('#groups > *')].find(b=>b.textContent==='Teste').click()})()`);
    await sleep(300);
    await p.ev(`[...document.querySelectorAll('#tabs > *')].find(b=>b.textContent==='Teste mobili').click()`);
    await sleep(900);
    const r = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest,pg=T.L.pages.find(x=>x.name==='Teste mobili'),el=w=>document.querySelector('[data-id="'+w.id+'"]');
      const wid=(f)=>pg.widgets.find(f),names=w=>[...el(w).querySelectorAll('.si .nm')].map(n=>n.textContent);
      const gobo=wid(w=>w.addr==='/mh/gobo'),pos=wid(w=>w.addr==='/mh/position'),col=wid(w=>w.type==='color'&&w.addr==='/mh/color'),zoom=wid(w=>w.addr==='/mh/zoom'),dim=wid(w=>w.addr==='/mh/dimmer');
      return JSON.stringify({gobo:names(gobo),pos:names(pos),wheel:[...el(col).querySelectorAll('[data-wh]')].map(i=>i.title),zoomNa:el(zoom).classList.contains('na'),dimNa:el(dim).classList.contains('na')})})()`));
    check(r.gobo.join() === 'Gobo 1,Gobo 2,Open', `Gobo dal modello: ${r.gobo.join(', ')}`);
    check(r.pos.slice(0, 2).join() === 'Centro,Palco vero' && r.pos.includes('💾 Salva') && r.pos.includes('📷 Scena'), `Posizioni da TD con Salva e Scena: ${r.pos.join(', ')}`);
    check(r.wheel.join() === 'Weiss,Rot,Blau', `Colore: slot della ruota ${r.wheel.join(', ')}`);
    check(r.zoomNa && !r.dimNa, 'Zoom spento (il modello non lo ha), Dimmer attivo');

    // tocco su uno slot: /mh/colorwheel con l'indice
    const sent = await p.ev(`(()=>{const T=window.__planciaTest,pg=T.L.pages.find(x=>x.name==='Teste mobili'),col=pg.widgets.find(w=>w.type==='color'&&w.addr==='/mh/color');
      const out=[],orig=window.WebSocket.prototype.send;window.WebSocket.prototype.send=function(m){out.push(String(m));return orig.apply(this,arguments)};
      document.querySelector('[data-id="'+col.id+'"] [data-wh="1"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      window.WebSocket.prototype.send=orig;return JSON.stringify(out.map(m=>{try{return JSON.parse(m)}catch{return m}}).filter(m=>m.address==='/mh/colorwheel'))})()`);
    check(JSON.parse(sent).some(m => m.args?.[0] === 1), `slot Rot -> /mh/colorwheel 1 (${sent.slice(0, 120)})`);

    // pagina movimento: un layout uiRev 15 con i doppioni
    const mv = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest,W=(type,x,y,w,h,o={})=>({id:'m'+Math.random(),type,x,y,w,h,label:type,addr:'',...o});
      const pg={id:'tm',name:'Teste · movimento',widgets:[W('timeline',0,0,16,4,{addr:'/show',tracks:['heads','motion']}),W('headmotion',0,4,9,6),W('scenes',9,4,7,2,{addr:'/mh/select/heads',mode:'head-select'}),
        W('scenes',9,6,4,2,{addr:'/mh/position'}),W('scenes',13,6,3,2,{mode:'head-presets'}),W('xy',9,8,5,2,{addr:'/mh/pantilt'}),W('fader',14,8,2,2,{addr:'/mh/dimmer'})]};
      T.L.pages=[pg];T.L.uiRev=15;T.migrations.find(m=>m[0]==='migrateUiHeadPages')[1]();
      return JSON.stringify({w:pg.widgets.map(w=>[w.type,w.x,w.y,w.w,w.h,w.onlyTracks||null]),rev:T.L.uiRev,backup:!!T.L.pagesBackup?.testeMovimento_20261104})})()`));
    check(JSON.stringify(mv.w) === JSON.stringify([['timeline', 0, 0, 16, 4, ['heads', 'motion']], ['headmotion', 0, 4, 16, 6, null]]) && mv.rev === 16 && mv.backup, `Teste · movimento senza doppioni: ${JSON.stringify(mv.w)}`);
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`head-controls: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
