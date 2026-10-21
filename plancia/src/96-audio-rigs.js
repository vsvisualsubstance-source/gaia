/* ---------- reattivita' audio dei rig (gruppi chase di DMX Master) ---------- */
// In DMX Master l'audio e' per RIG: il dimmer segue l'audio tra
// dmx_<rig>_min_dimmer e _max_dimmer, il kick da' il colpo
// (servizio dmx_<rig>_kick_enable, soglia/boost/decay), la sorgente e'
// dmx_<rig>_audio_source (a|b). Non c'e' un interruttore "audio": OFF qui
// = minimo uguale al massimo (luce ferma al massimo) e kick spento; i
// valori di prima restano in L.audioRestore per riaccendere. Per la
// singola luce serve un campo nuovo in DMX Master (richiesto in "OPS, 24").
const AUDIO_PRESETS=[ // valori indicativi, si regolano dal vivo e si salvano come preset propri
  {name:'Statico',desc:'luce ferma, niente audio',p:{min_dimmer:255,max_dimmer:255},kick:false},
  {name:'Morbido',desc:'respira con la musica',p:{min_dimmer:90,max_dimmer:255,smooth_factor:.12,kick_boost:40},kick:false},
  {name:'Club',desc:'segue forte, colpo sul kick',p:{min_dimmer:20,max_dimmer:255,smooth_factor:.45,kick_threshold:.25,kick_boost:120},kick:true},
  {name:'Solo kick',desc:'bassa, lampeggia sui colpi',p:{min_dimmer:0,max_dimmer:80,smooth_factor:.3,kick_threshold:.3,kick_boost:200,kick_decay:.6},kick:true},
];
const AUDIO_KEYS=['min_dimmer','max_dimmer','smooth_factor','kick_threshold','kick_boost','kick_decay'];
const AR_SEL=new Set(); // rig selezionati per i preset (in memoria)
const TD_DEV='td-dmx-win';
// rig con motore audio (chase): quelli che pubblicano la soglia del kick
function audioRigs(){
  const rigs=G.dxm?.[TD_DEV]?.rigs||{},p=tdParams();
  return Object.keys(rigs).filter(k=>p[`dmx_${k}_kick_threshold`]!=null).map(k=>{
    const g=(L.groups||[]).find(x=>x.bind===`rig_${k}`||x.group===k);
    return{key:k,label:g?groupLabel(g.group):({a:'Front (rig A)',b:'Back (rig B)'}[k]||k)};
  });
}
const arVal=(k,n)=>{const v=tdParams()[`dmx_${k}_${n}`];return v==null?null:+v};
const arKickOn=k=>G.devices[TD_DEV]?.services?.[`dmx_${k}_kick_enable`]==='active';
const arAudioOn=k=>{const a=arVal(k,'min_dimmer'),b=arVal(k,'max_dimmer');return!(a!=null&&b!=null&&a>=b)};
const arSet=(k,n,v)=>setDmxParam(TD_DEV,`dmx_${k}_${n}`,String(v));
const arKick=(k,on)=>devCmd(TD_DEV,{action:on?'enable':'disable',service:`dmx_${k}_kick_enable`});
function arSetAudio(k,on){
  L.audioRestore=L.audioRestore||{};
  if(!on){
    L.audioRestore[k]={min_dimmer:arVal(k,'min_dimmer'),max_dimmer:arVal(k,'max_dimmer'),kick:arKickOn(k)};save();
    const mx=arVal(k,'max_dimmer')??255;arSet(k,'min_dimmer',mx);arKick(k,false);
  }else{
    const r=L.audioRestore[k]||{min_dimmer:30,max_dimmer:255,kick:true};
    arSet(k,'max_dimmer',r.max_dimmer??255);arSet(k,'min_dimmer',Math.min(r.min_dimmer??30,(r.max_dimmer??255)-1));arKick(k,r.kick!==false);
  }
}
function arApplyPreset(pr,keys){
  for(const k of keys){
    // max prima del min: TD non deve mai vedere min > max a meta' strada
    const order=Object.keys(pr.p).sort((a,b)=>(a==='max_dimmer'?-1:0)-(b==='max_dimmer'?-1:0));
    for(const n of order)arSet(k,n,pr.p[n]);
    if(pr.kick!=null)arKick(k,pr.kick);
  }
  showInfo(`Audio: "${pr.name}" su ${keys.length} ${keys.length>1?'gruppi':'gruppo'}.`);
}
function arSavePreset(k){
  const name=prompt('Nome del preset audio (preso da '+k+'):');if(!name)return;
  const p={};for(const n of AUDIO_KEYS){const v=arVal(k,n);if(v!=null)p[n]=v}
  L.audioPresets=[...(L.audioPresets||[]).filter(x=>x.name!==name),{name,desc:'salvato',p,kick:arKickOn(k)}];save();
}
const arPresets=()=>[...AUDIO_PRESETS,...(L.audioPresets||[]).map(x=>({...x,mine:true}))];
const arSlider=(k,n,label,min,max,step)=>{const v=arVal(k,n);return`<label class="ar-sl"><span>${label}<b>${v==null?'—':+(+v).toFixed(step<1?2:0)}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${v??min}" data-ar-p="${n}" data-ar-k="${k}"${v==null?' disabled':''}></label>`};
function paintAudioRigs(el,w,force){
  const box=el.querySelector('.ar');if(!box)return;
  if(box.contains(document.activeElement)&&document.activeElement.type==='range'&&!force)return; // non ridisegnare mentre trascini
  const rigs=audioRigs(),compact=w.h<=3,p=tdParams();
  const sig=JSON.stringify([rigs,compact,[...AR_SEL],arPresets().map(x=>x.name),rigs.map(r=>[arKickOn(r.key),AUDIO_KEYS.map(n=>p[`dmx_${r.key}_${n}`]),p[`dmx_${r.key}_audio_source`]])]);
  if(!force&&box._sig===sig)return;box._sig=sig;
  if(!rigs.length){box.innerHTML='<p class="hint">Nessun gruppo con audio da DMX Master (non collegato?).</p>';return}
  const tog=(on,act,k,label)=>`<button class="ar-tog${on?' on':''}" data-ar="${act}" data-ar-k="${k}">${label}<i>${on?'ON':'OFF'}</i></button>`;
  if(compact){box.innerHTML=`<div class="ar-mini">${rigs.map(r=>`<div class="ar-mrow"><b>${esc(r.label)}</b>${tog(arAudioOn(r.key),'audio',r.key,'♪')}${tog(arKickOn(r.key),'kick',r.key,'Kick')}</div>`).join('')}</div>`;return}
  box.innerHTML=`<div class="ar-cards">${rigs.map(r=>{const k=r.key,src=p[`dmx_${k}_audio_source`];return`<div class="ar-card${AR_SEL.has(k)?' sel':''}">
      <div class="ar-head"><button class="ar-pick" data-ar="pick" data-ar-k="${k}" title="Seleziona per i preset">${AR_SEL.has(k)?'☑':'☐'}</button><b>${esc(r.label)}</b>
        <span class="ar-src">${['a','b'].map(s=>`<button class="${src===s?'on':''}" data-ar="src" data-ar-v="${s}" data-ar-k="${k}" title="Sorgente audio ${s.toUpperCase()}">${s.toUpperCase()}</button>`).join('')}</span></div>
      <div class="ar-togs">${tog(arAudioOn(k),'audio',k,'♪ Audio')}${tog(arKickOn(k),'kick',k,'Kick')}</div>
      ${arSlider(k,'min_dimmer','Minimo',0,255,1)}${arSlider(k,'max_dimmer','Massimo',0,255,1)}
      ${arSlider(k,'kick_threshold','Soglia kick',.05,1,.01)}${arSlider(k,'smooth_factor','Morbidezza → reattività',.01,1,.01)}
      <button class="btn sm ghost" data-ar="save" data-ar-k="${k}">Salva come preset</button></div>`}).join('')}</div>
    <div class="ar-pres"><b>Preset audio</b> <span class="hint">${AR_SEL.size?`su ${AR_SEL.size} ${AR_SEL.size>1?'gruppi selezionati':'gruppo selezionato'}`:'seleziona uno o più gruppi (☐) e tocca un preset'}</span>
      <div class="pal-chips">${arPresets().map((x,i)=>`<button class="pal-chip" data-ar="preset" data-ar-v="${i}"${AR_SEL.size?'':' disabled'} title="${esc(x.desc||'')}">${esc(x.name)}${x.mine?' ★':''}</button>`).join('')}
        <button class="pal-chip" data-ar="all">Tutti i gruppi</button></div>
      <p class="hint">♪ Audio OFF = luce ferma al massimo, senza kick (riaccendendo torna come prima). Per una singola luce: in arrivo da DMX Master. Le scene catturate con "Sorgente audio" ricordano la sorgente.</p></div>`;
}
function audioRigsDown(e,el,w){
  const b=e.target.closest('[data-ar]');if(!b)return;e.preventDefault();
  const k=b.dataset.arK,a=b.dataset.ar;
  if(a==='audio')arSetAudio(k,!arAudioOn(k));
  else if(a==='kick')arKick(k,!arKickOn(k));
  else if(a==='src')arSet(k,'audio_source',b.dataset.arV);
  else if(a==='pick'){AR_SEL.has(k)?AR_SEL.delete(k):AR_SEL.add(k)}
  else if(a==='all'){const all=audioRigs().map(r=>r.key);if(AR_SEL.size===all.length)AR_SEL.clear();else all.forEach(x=>AR_SEL.add(x))}
  else if(a==='preset'){const pr=arPresets()[+b.dataset.arV];if(pr)arApplyPreset(pr,[...AR_SEL])}
  else if(a==='save'){arSavePreset(k)}
  setTimeout(()=>paintAudioRigs(el,w,true),400);paintAudioRigs(el,w,true);
}
// cursori: invio al rilascio (change), non a ogni pixel
document.addEventListener('change',e=>{const s=e.target.closest?.('[data-ar-p]');if(!s)return;
  const k=s.dataset.arK,n=s.dataset.arP;
  if(n==='min_dimmer'&&+s.value>=(arVal(k,'max_dimmer')??255))s.value=(arVal(k,'max_dimmer')??255)-1;
  if(n==='max_dimmer'&&+s.value<=(arVal(k,'min_dimmer')??0))s.value=(arVal(k,'min_dimmer')??0)+1;
  arSet(k,n,s.value);s.blur()});
document.addEventListener('input',e=>{const s=e.target.closest?.('[data-ar-p]');if(!s)return;const b=s.parentElement.querySelector('b');if(b)b.textContent=(+s.value).toFixed(+s.step<1?2:0)});
