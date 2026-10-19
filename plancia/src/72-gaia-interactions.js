/* ---------- interazione widget Gaia ---------- */
const lastSet={};
function gBind(e,el,w){
  const t=e.target;
  if(w.type==='gaia'){const b=t.closest('[data-nudge]');if(b){e.preventDefault();nudge(b.dataset.nudge,(b.dataset.nudge==='energy'?5:.05)*+b.dataset.d)}return}
  if(w.type==='patchdeck'){const id=pickDev(w,'patchdeck');
    const c=t.closest('.pd-c');if(c){e.preventDefault();devCmd(id,{action:'enable',service:c.dataset.svc});c.classList.add('fl');setTimeout(()=>c.classList.remove('fl'),300);return}
    const b=t.closest('[data-deck]');if(b){e.preventDefault();devCmd(id,{action:b.dataset.state==='1'?'disable':'enable',service:b.dataset.deck})}return}
  if(w.type==='tddevice'){const id=pickDev(w,w.fam||'');
    const sv=t.closest('.chip[data-svc]');if(sv){e.preventDefault();devCmd(id,{action:sv.classList.contains('on')?'disable':'enable',service:sv.dataset.svc});return}
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
