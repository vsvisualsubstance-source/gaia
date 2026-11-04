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

    // preset da tutte e due le parti: DMX Master finto che risponde ai comandi heads_preset_*
    const pr = JSON.parse(await p.ev(`(async()=>{const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms)),d=T.G.devices['td-dmx-win'],pub=[];
      new MutationObserver(()=>{const b=document.querySelector('.ui-confirm [data-v="1"]');if(b)b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}).observe(document.body,{childList:true,subtree:true});
      d.params.heads_presets=[{index:0,preset:'solo_td',label:'Solo TD',heads:{}}];let seq=0;d.params.heads_last_result={seq};
      const was={ok:T.G.ok,client:T.G.client};T.G.ok=true;T.G.client={publish:(t,b)=>{const m=JSON.parse(b);pub.push([m.param,m.value]);const L=d.params.heads_presets;
        if(m.param==='heads_preset_store'&&!L.some(x=>x.preset===m.value.preset))L.push({index:L.length,preset:m.value.preset,label:m.value.label,heads:{}});
        if(m.param==='heads_preset_rename'){const x=L.find(x=>x.preset===m.value.preset);x.preset=m.value.to;x.label=m.value.label}
        if(m.param==='heads_preset_remove')d.params.heads_presets=L.filter(x=>x.preset!==m.value);
        d.params.heads_last_result={seq:++seq,ok:true}}};
      const pg=T.L.pages.find(x=>x.name==='Teste mobili'),w=pg.widgets.find(x=>x.mode==='head-presets'),dim=pg.widgets.find(x=>x.addr==='/mh/dimmer');
      w.headPresets=[{name:'Locale',values:[{id:dim.id,value:.4}]}];T.render();await z(300);
      document.querySelector('[data-id="'+w.id+'"] [data-act="manage-presets"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(200);
      const where=()=>[...document.querySelectorAll('.pr-where')].map(x=>x.textContent),out={before:where(),up:!!document.querySelector('#presetUp'),down:!!document.querySelector('#presetDown')};
      document.querySelector('#presetUp').click();await z(1500);out.afterUp=where();
      document.querySelector('#presetDown').click();await z(200);out.afterDown=where();out.names=w.headPresets.map(x=>x.name);
      document.querySelector('#presetNewName').value='Nuovo';document.querySelector('#presetAdd').click();await z(500);
      const inp=document.querySelector('[data-preset-name="0"]');inp.value='Locale 2';inp.dispatchEvent(new Event('change'));await z(500);
      document.querySelector('[data-preset-action="delete"][data-preset-index="2"]').click();await z(500);
      out.tdNames=d.params.heads_presets.map(x=>x.label);out.final=w.headPresets.map(x=>x.name);out.pub=pub.map(x=>x[0]).filter(x=>String(x).startsWith('heads_preset'));
      document.querySelector('#presetClose').click();T.G.ok=was.ok;T.G.client=was.client;return JSON.stringify(out)})()`));
    check(pr.before.join('|') === 'solo Plancia' && pr.up && pr.down, `preset: dove sta ognuno, ⇪ e ⇩ (${pr.before.join(', ')})`);
    check(pr.afterUp.join('|') === '✓ Plancia e DMX Master', '⇪ TD: il preset della Plancia ora è anche in DMX Master');
    check(pr.names.join() === 'Locale,Solo TD' && pr.afterDown.join('|') === '✓ Plancia e DMX Master|✓ Plancia e DMX Master', '⇩ TD: il preset di DMX Master ora è anche qui');
    check(pr.final.join() === 'Locale 2,Solo TD' && pr.tdNames.join() === 'Solo TD,Locale 2', `nuovo, rinomina ed elimina valgono in tutte e due: Plancia ${pr.final.join(', ')} · TD ${pr.tdNames.join(', ')}`);
    check(pr.pub.join() === 'heads_preset_store,heads_preset_store,heads_preset_rename,heads_preset_remove', `comandi a DMX Master: ${pr.pub.join(', ')}`);

    // colore che segue un gruppo (nota TD 64) e scene "solo colore" in TESTE POS. (OPS 47)
    const fl = JSON.parse(await p.ev(`(async()=>{const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms)),d=T.G.devices['td-dmx-win'],pub=[];
      T.G.dxm['td-dmx-win'].heads.programmer.color_follow_groups=[{group:'rig_a',alias:'front',label:'Front'},{group:'rig_b',alias:'back',label:'Back'}];
      d.params.heads_color_follow=null;d.params.show_scene_catalog=[{id:'teste_pubblico',index:0,label:'Teste pubblico',categories:['heads']}];let seq=0;
      const was={ok:T.G.ok,client:T.G.client};T.G.ok=true;T.G.client={publish:(t,b)=>{const m=JSON.parse(b);pub.push(m.param||m.address||'');
        if(m.param==='heads_color_follow')d.params.heads_color_follow=m.value;
        if(m.param==='show_scene_capture'){const c=d.params.show_scene_catalog;c.push({id:m.value.name,index:c.length,label:m.value.label,categories:m.value.categories})}
        d.params.heads_last_result={seq:++seq,ok:true}}};
      await z(1200);const pg=T.L.pages.find(x=>x.name==='Teste mobili'),col=pg.widgets.find(w=>w.type==='color'&&w.addr==='/mh/color'),el=()=>document.querySelector('[data-id="'+col.id+'"]');
      const btns=[...el().querySelectorAll('[data-fl]')].map(b=>b.textContent);
      el().querySelector('[data-fl="rig_b"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(900);
      const on=[...el().querySelectorAll('[data-fl].on')].map(b=>b.textContent);
      // senza la categoria heads_color le scelte rapide non ci sono
      const lane=async()=>{const tl=T.L.pages.find(x=>x.name==='Timeline').widgets.find(x=>x.type==='timeline');
        [...document.querySelectorAll('#groups > *')].find(b=>b.textContent==='Show').click();await z(200);
        [...document.querySelectorAll('#tabs > *')].find(b=>b.textContent==='Timeline').click();await z(500);
        const l=document.querySelector('[data-id="'+tl.id+'"] [data-trk="heads"]')||document.querySelector('[data-id="'+tl.id+'"] .tl-hlane');
        const r=l.getBoundingClientRect();l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width*.3,clientY:r.top+5}));await z(300);
        return[...document.querySelectorAll('.ui-choose button')].map(b=>b.textContent)};
      const without=(await lane()).filter(x=>x.startsWith('🎨'));document.querySelector('.ui-choose [data-v="cancel"],.ui-choose .ghost')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(200);
      T.G.dxm['td-dmx-win'].show={...(T.G.dxm['td-dmx-win'].show||{}),categories:[{id:'heads',label:'Teste'},{id:'heads_color',label:'Colore teste'}]};
      const withCat=(await lane()).filter(x=>x.startsWith('🎨'));
      const b=[...document.querySelectorAll('.ui-choose button')].find(x=>x.textContent==='🎨 Colore: Rot');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(1800);
      const made=d.params.show_scene_catalog.find(s=>s.id==='teste_col_rot');
      T.G.ok=was.ok;T.G.client=was.client;
      return JSON.stringify({btns,on,without,withCat,made,pub:pub.filter(x=>/color|scene_capture/.test(x))})})()`));
    check(fl.btns.join() === 'Fisso,segue Front,segue Back' && fl.on.join() === 'segue Back', `Colore teste: Fisso / segue… (${fl.btns.join(', ')}; acceso ${fl.on.join()})`);
    check(fl.without.length === 0, 'TESTE POS.: senza la categoria solo colore, niente scelte rapide');
    check(fl.withCat.includes('🎨 Colore: Rot') && fl.withCat.includes('🎨 Colore: segue Back'), `TESTE POS.: con la categoria, ${fl.withCat.join(', ')}`);
    check(fl.made && JSON.stringify(fl.made.categories) === '["heads_color"]' && fl.pub.join() === 'heads_color_follow,show_scene_capture', `scena solo colore creata: ${JSON.stringify(fl.made)} · ${fl.pub.join(', ')}`);

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
