/* ---------- interazione widget Gaia ---------- */
const lastSet={};
function gBind(e,el,w){
  const t=e.target;
  if(w.type==='gaia'){const b=t.closest('[data-nudge]');if(b){e.preventDefault();nudge(b.dataset.nudge,(b.dataset.nudge==='energy'?5:.05)*+b.dataset.d)}return}
  if(w.type==='patchdeck'){const id=pickDev(w,'patchdeck');
    const c=t.closest('.pd-c');if(c){e.preventDefault();devCmd(id,{action:'enable',service:c.dataset.svc});c.classList.add('fl');setTimeout(()=>c.classList.remove('fl'),300);return}
    const b=t.closest('[data-deck]');if(b){e.preventDefault();devCmd(id,{action:b.dataset.state==='1'?'disable':'enable',service:b.dataset.deck})}return}
  if(w.type==='tddevice'){const id=pickDev(w,w.fam||'');
    const sv=t.closest('.chip[data-svc]');if(sv){e.preventDefault();const on=sv.classList.contains('on');
      if(sv.classList.contains('dv-warn')&&!confirm(`${on?'Spegnere':'Accendere'} "${sv.textContent}" (${sv.dataset.svc}) su ${id}? È un interruttore tecnico di DMX Master.`))return;
      devCmd(id,{action:on?'disable':'enable',service:sv.dataset.svc});return}
    const op=t.closest('.chip[data-opt]');if(op){e.preventDefault();const raw=op.dataset.opt,type=op.dataset.optType;
      const value=type==='number'?Number(raw):type==='boolean'?raw==='true':raw;
      devCmd(id,{action:'set',param:op.dataset.par,value});return}
    const sl=t.closest('.dv-sl');if(sl){dragSlider(e,el,sl,f=>{const mn=+sl.dataset.min,mx=+sl.dataset.max,v=+(mn+(mx-mn)*f).toFixed(4);
      if(G.devices[id]){(G.devices[id].params=G.devices[id].params||{})[sl.dataset.par]=v}sliderSet(sl,f,fmt(v));return()=>devCmd(id,{action:'set',param:sl.dataset.par,value:v})})}
    return}
  if(w.type==='gaiadmx'){const room=pickRoom(w);if(!room)return;const s=G.dmx[room],fid=w.fixture||s?.default_fixture;
    const send=o=>gPub(`gaia/dmx/${room}/command`,fid?{...o,fixture:fid}:o),fx=s?.fixtures?.[fid];
    const p=t.closest('[data-pal]');if(p){e.preventDefault();send({action:'set_palette',palette:p.dataset.pal,fade:.8});return}
    const tl=t.closest('[data-tl]');if(tl){e.preventDefault();if(tl.dataset.tl){send({action:'timeline_load',name:tl.dataset.tl});send({action:'timeline_start'})}else send({action:'timeline_stop'});return}
    const b=t.closest('[data-dz="blackout"]');if(b){e.preventDefault();send({action:'blackout'});return}
    const a=t.closest('[data-dz="audio"]');if(a){e.preventDefault();send({action:fx?.audio_reactive?'audio_reactive_stop':'audio_reactive_start'});return}
    const sl=t.closest('.dv-sl');if(sl)dragSlider(e,el,sl,f=>{if(fx)fx.brightness=f;sliderSet(sl,f,Math.round(f*100)+'%');return()=>send({action:'set_brightness',value:+f.toFixed(3)})})}
}
// trascinamento con invio limitato a ~12 al secondo, più l'ultimo valore al rilascio
function dragSlider(e,el,sl,apply){
  e.preventDefault();sl.setPointerCapture(e.pointerId);el._drag=sl;const r=sl.getBoundingClientRect();let pending=null;
  const mv=ev=>{pending=apply(clamp((ev.clientX-r.left)/r.width));const k=sl.dataset.par||'dz',n=now();if(n-(lastSet[k]||0)>80){lastSet[k]=n;pending();pending=null}};
  mv(e);sl.onpointermove=mv;sl.onpointerup=sl.onpointercancel=()=>{if(pending)pending();sl.onpointermove=sl.onpointerup=sl.onpointercancel=null;el._drag=null};
}
document.addEventListener('submit',e=>{const f=e.target.closest('.ga-in');if(!f)return;e.preventDefault();const i=f.querySelector('input');gSay(i.value);i.value='';G.dirty=true});

/* ---------- tipi di widget della famiglia Gaia (MQTT, nessun indirizzo OSC) ---------- */
// gaia = mood, pensieri e chat; patchdeck = i due deck; tddevice = pannello di un
// device TD; gaiadmx = DMX della stanza. Contenuto, disegno e tocco restano le
// funzioni comuni della famiglia (gInner, gPaint, gBind in 71/72).
// spec comune della famiglia; il widget gaia ha in piu' un canvas (orbita animata)
// e un'impaginazione stretta sotto 8 colonne
const gaiaWidget=(size,label,extra={})=>({size,label,showsValue:false,showsAddr:false,refreshOnResize:true,oscAddress:false,
  // ispettore: device (o stanza) da seguire, deck del PatchDeck, tipo di device, stanza della chat di Gaia
  inspector:{html(w){const T=w.type,deviceOptions=T==='tddevice'?devIds(w.fam||''):devIds('');
      return `${T!=='gaia'?`<label>${T==='gaiadmx'?'Stanza':'Device'}<select id="gDev"><option value="">Automatico</option>${(T==='gaiadmx'?Object.keys(G.dmx).sort():deviceOptions).map(x=>`<option value="${esc(x)}"${x===(T==='gaiadmx'?w.stanza:w.device)?' selected':''}>${esc(x)}</option>`).join('')}</select></label>`:''}
    ${T==='patchdeck'?`<label>Deck<select id="gDeck"><option value="a">Deck A</option><option value="b">Deck B</option></select></label>`:''}
    ${T==='tddevice'?`<label>Tipo di device (per la scelta automatica)<select id="gFam"><option value="">Qualsiasi</option><option value="patchdeck">PatchDeck</option><option value="mixeraudio">Controller (mixeraudio)</option><option value="dmx">DMX V8</option></select></label>`:''}
    ${T==='gaia'?`<label>Stanza della chat<input id="gSt2" class="mono"></label><p class="hint">I messaggi vanno su <code>gaia/voice/command/&lt;stanza&gt;</code> come un comando vocale. I tasti − e + spostano il mood via <code>gaia/touchdesigner/mood</code>: in Admin → Automazioni va acceso "touchdesignerMood".</p>`:''}
    ${T!=='gaia'?'<p class="hint">Device e stanze compaiono qui quando pubblicano il loro stato sul broker di Gaia.</p>':''}`},
    bind(w,{on,val}){const T=w.type;
  if($('#gDev')){val('#gDev',T==='gaiadmx'?(w.stanza||''):(w.device||''));
    if(T==='tddevice')$('#gDev').addEventListener('change',e=>{w.device=e.target.value;save();refresh(w)});
    else on('#gDev',v=>{if(T==='gaiadmx')w.stanza=v;else w.device=v},'change')}
  if(T==='patchdeck'){val('#gDeck',w.deck||'a');on('#gDeck',v=>w.deck=v,'change')}
  if(T==='tddevice'){val('#gFam',w.fam||'');$('#gFam').addEventListener('change',e=>{
    w.fam=e.target.value;if(w.device&&!devIds(w.fam).includes(w.device))w.device='';
    save();refresh(w);renderInsp();
  })}
  if(T==='gaia'){val('#gSt2',GC.stanza);on('#gSt2',v=>{GC.stanza=v.trim()||'studio';store.set(GKEY,GC)},'change',false)}}},
  inner:gInner,paint:gPaint,onPointer:gBind,
  help:w=>[w.label||NAMES[w.type]||w.type,'Controllo di Gaia / TouchDesigner via MQTT.'],
  tick:(el,w,{repaint})=>{if(repaint)gPaint(el,w)},...extra});
registerWidget('gaia',gaiaWidget([10,8],'Gaia',{
  mounted:(el,w)=>{sizeCanvas(el);el.classList.toggle('narrow',w.w<8)},
  tick:(el,w,{repaint,now})=>{if(repaint)gPaint(el,w);gOrb(el,now)}}));
registerWidget('patchdeck',gaiaWidget([8,6],'PatchDeck'));
registerWidget('tddevice',gaiaWidget([8,4],'Device TD'));
registerWidget('gaiadmx',gaiaWidget([6,6],'DMX stanza'));
