/* ---------- reattivita' audio dei gruppi (rig chase di DMX Master) ---------- */
// Due livelli (nota TD 44):
// - RIG: taratura del motore audio (dmx_<rig>_min/max_dimmer, kick con il
//   servizio dmx_<rig>_kick_enable e le soglie, sorgente dmx_<rig>_audio_source);
// - LUCI del gruppo: modo audio (full = come il gruppo, off = ferma, bass/
//   mid/high = una banda, kick = solo colpi) e guadagno 0..2, per tutte le
//   luci del gruppo con dmx_fixture_audio {groups:[gruppo]}. ♪ ON/OFF = full/off.
// Le scene catturate con "Look dei rig" ricordano modo e guadagno di ogni luce.
const AUDIO_PRESETS=[ // non toccano la taratura (min/max) del rig: solo modo, guadagno e kick
  {name:'Statico',desc:'luci ferme, niente audio',audio:'off'},
  {name:'Morbido',desc:'segue piano la musica',audio:'full',gain:.6,kick:false},
  {name:'Club',desc:'segue forte, colpo sul kick',audio:'full',gain:1.3,kick:true},
  {name:'Solo bassi',desc:'solo la banda dei bassi',audio:'bass',gain:1.2},
  {name:'Solo kick',desc:'ferme al minimo, salgono sui colpi',audio:'kick',gain:1.5,kick:true},
];
const AUDIO_KEYS=['min_dimmer','max_dimmer','smooth_factor','kick_threshold','kick_boost','kick_decay'];
const AR_SEL=new Set(); // rig selezionati per i preset (in memoria)
const TD_DEV='td-dmx-win';
// rig con motore audio (chase): quelli che pubblicano la soglia del kick
function audioRigs(){
  const rigs=G.dxm?.[TD_DEV]?.rigs||{},p=tdParams();
  return Object.keys(rigs).filter(k=>p[`dmx_${k}_kick_threshold`]!=null).map(k=>{
    const g=(L.groups||[]).find(x=>x.bind===`rig_${k}`||x.group===k),group=g?.group||k;
    return{key:k,group,label:g?groupLabel(g.group):({a:'Front (rig A)',b:'Back (rig B)'}[k]||k)};
  });
}
const arVal=(k,n)=>{const v=tdParams()[`dmx_${k}_${n}`];return v==null?null:+v};
const arKickOn=k=>G.devices[TD_DEV]?.services?.[`dmx_${k}_kick_enable`]==='active';
const arSet=(k,n,v)=>setDmxParam(TD_DEV,`dmx_${k}_${n}`,String(v));
const arKick=(k,on)=>devCmd(TD_DEV,{action:on?'enable':'disable',service:`dmx_${k}_kick_enable`});
// luci del gruppo nella patch di DMX Master e il loro modo/guadagno (null = diversi)
// TD chiama i gruppi a modo suo (es. rig_b): stessa conversione dell'import da DMX Master
const arFixtures=r=>(tdParams().dmx_fixtures||[]).filter(x=>x.group===r.group||normGroupName(x.group,groupsOf())===r.group);
function arGroupAudio(r){
  const fx=arFixtures(r);if(!fx.length)return{n:0,mode:null,gain:null};
  const m=new Set(fx.map(x=>normAudio(x.audio))),g=new Set(fx.map(x=>normGain(x.audio_gain)));
  return{n:fx.length,mode:m.size===1?[...m][0]:null,gain:g.size===1?[...g][0]:null};
}
async function arSetGroupAudio(rigs,fields){
  // elenco esatto delle luci (uid), non il nome del gruppo: niente ambiguita' sui nomi
  const fixtures=rigs.flatMap(r=>arFixtures(r).map(x=>x.uid||x.id));if(!fixtures.length)return 0;
  await tdSceneCommand('dmx_fixture_audio',{fixtures,...fields},()=>rigs.every(r=>arFixtures(r).every(x=>
    (fields.audio==null||normAudio(x.audio)===normAudio(fields.audio))&&(fields.audio_gain==null||Math.abs(normGain(x.audio_gain)-fields.audio_gain)<.01))));
  return fixtures.length;
}
async function arApplyPreset(pr,keys){
  const rigs=audioRigs().filter(r=>keys.includes(r.key));
  try{
    for(const r of rigs){
      if(pr.p){const order=Object.keys(pr.p).sort((a,b)=>(a==='max_dimmer'?-1:0)-(b==='max_dimmer'?-1:0)); // mai min > max a meta' strada
        for(const n of order)arSet(r.key,n,pr.p[n])}
      if(pr.kick!=null)arKick(r.key,pr.kick);
    }
    const f={};if(pr.audio)f.audio=pr.audio;if(pr.gain!=null)f.audio_gain=pr.gain;
    if(Object.keys(f).length)await arSetGroupAudio(rigs,f);
    showInfo(`Audio: "${pr.name}" su ${rigs.length} ${rigs.length>1?'gruppi':'gruppo'}.`);
  }catch(e){showError('Preset audio: '+e.message)}
}
function arSavePreset(r){
  const name=prompt(`Nome del preset audio (preso da ${r.label}):`);if(!name)return;
  const p={};for(const n of AUDIO_KEYS){const v=arVal(r.key,n);if(v!=null)p[n]=v}
  const a=arGroupAudio(r);
  L.audioPresets=[...(L.audioPresets||[]).filter(x=>x.name!==name),{name,desc:'salvato da '+r.label,p,kick:arKickOn(r.key),...(a.mode?{audio:a.mode}:{}),...(a.gain!=null?{gain:a.gain}:{})}];save();
}
const arPresets=()=>[...AUDIO_PRESETS,...(L.audioPresets||[]).map(x=>({...x,mine:true}))];
const arSlider=(k,n,label,min,max,step)=>{const v=arVal(k,n);return`<label class="ar-sl"><span>${label}<b>${v==null?'—':+(+v).toFixed(step<1?2:0)}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${v??min}" data-ar-p="${n}" data-ar-k="${k}"${v==null?' disabled':''}></label>`};
function paintAudioRigs(el,w,force){
  const box=el.querySelector('.ar');if(!box)return;
  if(box.contains(document.activeElement)&&document.activeElement.type==='range'&&!force)return; // non ridisegnare mentre trascini
  const rigs=audioRigs(),compact=w.h<=3,p=tdParams();
  const sig=JSON.stringify([rigs,compact,[...AR_SEL],arPresets().map(x=>x.name),rigs.map(r=>[arKickOn(r.key),arGroupAudio(r),AUDIO_KEYS.map(n=>p[`dmx_${r.key}_${n}`]),p[`dmx_${r.key}_audio_source`]])]);
  if(!force&&box._sig===sig)return;box._sig=sig;
  if(!rigs.length){box.innerHTML='<p class="hint">Nessun gruppo con audio da DMX Master (non collegato?).</p>';return}
  const tog=(on,act,k,label,title)=>`<button class="ar-tog${on?' on':on===null?' mix':''}" data-ar="${act}" data-ar-k="${k}" title="${esc(title||'')}">${label}<i>${on?'ON':on===null?'MISTO':'OFF'}</i></button>`;
  const audioOn=a=>!a.n?false:a.mode===null?null:a.mode!=='off';
  if(compact){box.innerHTML=`<div class="ar-mini">${rigs.map(r=>{const a=arGroupAudio(r);return`<div class="ar-mrow"><b>${esc(r.label)}</b>${tog(audioOn(a),'audio',r.key,'♪','Luci del gruppo: segue la musica / ferma')}${tog(arKickOn(r.key),'kick',r.key,'Kick')}</div>`}).join('')}</div>`;return}
  box.innerHTML=`<div class="ar-cards">${rigs.map(r=>{const k=r.key,src=p[`dmx_${k}_audio_source`],a=arGroupAudio(r);return`<div class="ar-card${AR_SEL.has(k)?' sel':''}">
      <div class="ar-head"><button class="ar-pick" data-ar="pick" data-ar-k="${k}" title="Seleziona per i preset">${AR_SEL.has(k)?'☑':'☐'}</button><b>${esc(r.label)}</b>
        <span class="ar-src">${['a','b'].map(s=>`<button class="${src===s?'on':''}" data-ar="src" data-ar-v="${s}" data-ar-k="${k}" title="Sorgente audio ${s.toUpperCase()}">${s.toUpperCase()}</button>`).join('')}</span></div>
      <div class="ar-togs">${tog(audioOn(a),'audio',k,'♪ Audio','Tutte le luci del gruppo: come il gruppo (ON) o ferme (OFF)')}${tog(arKickOn(k),'kick',k,'Kick','Colpo sui bassi del motore del gruppo')}</div>
      ${a.n?`<p class="hint">${a.n} luci · modo: <b>${esc(a.mode?AUDIO_MODE_IT[a.mode]||a.mode:'diversi')}</b>${a.gain!=null&&a.gain!==1?` · ×${a.gain.toFixed(2)}`:''}</p>${audioControlsHtml(a.mode,a.gain,`arAud-${k}`)}`:'<p class="hint">Nessuna luce di questo gruppo nella patch di DMX Master.</p>'}
      <details class="ar-cal"><summary>Taratura del gruppo</summary>
      ${arSlider(k,'min_dimmer','Minimo',0,255,1)}${arSlider(k,'max_dimmer','Massimo',0,255,1)}
      ${arSlider(k,'kick_threshold','Soglia kick',.05,1,.01)}${arSlider(k,'smooth_factor','Morbidezza → reattività',.01,1,.01)}</details>
      <button class="btn sm ghost" data-ar="save" data-ar-k="${k}">Salva come preset</button></div>`}).join('')}</div>
    <div class="ar-pres"><b>Preset audio</b> <span class="hint">${AR_SEL.size?`su ${AR_SEL.size} ${AR_SEL.size>1?'gruppi selezionati':'gruppo selezionato'}`:'seleziona uno o più gruppi (☐) e tocca un preset'}</span>
      <div class="pal-chips">${arPresets().map((x,i)=>`<button class="pal-chip" data-ar="preset" data-ar-v="${i}"${AR_SEL.size?'':' disabled'} title="${esc(x.desc||'')}">${esc(x.name)}${x.mine?' ★':''}</button>`).join('')}
        <button class="pal-chip" data-ar="all">Tutti i gruppi</button></div>
      <p class="hint">Modo e guadagno valgono per tutte le luci del gruppo; per una luce sola usa la pagina Luci o tocca la luce nella Pianta. Le scene catturate con "Look dei rig" li ricordano (le scene vecchie vanno ricatturate).</p></div>`;
  box.querySelectorAll('details.ar-cal').forEach((d,i)=>{d.open=!!paintAudioRigs._open?.[rigs[i]?.key];d.ontoggle=()=>{(paintAudioRigs._open=paintAudioRigs._open||{})[rigs[i].key]=d.open}});
}
async function audioRigsDown(e,el,w){
  if(e.target.closest('input[type=range],summary'))return;
  const b=e.target.closest('[data-ar],[data-aud]');if(!b)return;e.preventDefault();
  const rig=k=>audioRigs().find(r=>r.key===k);
  try{
    if(b.dataset.aud){const k=b.closest('[id^="arAud-"]').id.slice(6);await arSetGroupAudio([rig(k)],{audio:b.dataset.aud})}
    else{const k=b.dataset.arK,a=b.dataset.ar;
      if(a==='audio'){const r=rig(k),st=arGroupAudio(r);await arSetGroupAudio([r],{audio:st.mode==='off'?'full':'off'})}
      else if(a==='kick')arKick(k,!arKickOn(k));
      else if(a==='src')arSet(k,'audio_source',b.dataset.arV);
      else if(a==='pick'){AR_SEL.has(k)?AR_SEL.delete(k):AR_SEL.add(k)}
      else if(a==='all'){const all=audioRigs().map(r=>r.key);if(AR_SEL.size===all.length)AR_SEL.clear();else all.forEach(x=>AR_SEL.add(x))}
      else if(a==='preset'){const pr=arPresets()[+b.dataset.arV];if(pr)await arApplyPreset(pr,[...AR_SEL])}
      else if(a==='save')arSavePreset(rig(k));}
  }catch(err){showError('Audio: '+err.message)}
  setTimeout(()=>paintAudioRigs(el,w,true),400);paintAudioRigs(el,w,true);
}
// cursori: invio al rilascio (change), non a ogni pixel
document.addEventListener('change',async e=>{
  const g=e.target.closest?.('[data-aud-gain^="arAud-"]');
  if(g){const r=audioRigs().find(x=>x.key===g.dataset.audGain.slice(6));try{await arSetGroupAudio([r],{audio_gain:+g.value})}catch(err){showError('Audio: '+err.message)}g.blur();return}
  const s=e.target.closest?.('[data-ar-p]');if(!s)return;
  const k=s.dataset.arK,n=s.dataset.arP;
  if(n==='min_dimmer'&&+s.value>=(arVal(k,'max_dimmer')??255))s.value=(arVal(k,'max_dimmer')??255)-1;
  if(n==='max_dimmer'&&+s.value<=(arVal(k,'min_dimmer')??0))s.value=(arVal(k,'min_dimmer')??0)+1;
  arSet(k,n,s.value);s.blur()});
document.addEventListener('input',e=>{const s=e.target.closest?.('[data-ar-p]');if(!s)return;const b=s.parentElement.querySelector('b');if(b)b.textContent=(+s.value).toFixed(+s.step<1?2:0)});
