/* ---------- motore dello show (simulazione locale del rig) ---------- */
const mkT=v=>({f:v.slice(),t:v.slice(),c:v.slice(),t0:0,d:0});
function goT(T,v,d){T.f=T.c.slice();T.t=v.slice();T.t0=now();T.d=d}
function setI(T,i,v){T.f[i]=T.t[i]=T.c[i]=v}
function stepT(T,n){const k=T.d>0?clamp((n-T.t0)/(T.d*1000)):1,e=k*k*(3-2*k);for(let i=0;i<T.c.length;i++)T.c[i]=T.f[i]+(T.t[i]-T.f[i])*e}
const SH={master:1,fade:1.5,blackout:0,strobe:0,rate:8,chase:0,scene:-1,t0:0,
  g:{front:.85,back:.9,mh:1,ledbar:.8,ledwall:.9,haze:.55,blinder:0},
  led:{mode:1,bright:.9},sel:new Set([0,1,2,3,4,5,6,7]),
  wash:mkT([0,0,0]),back:mkT([0,0,0]),bar:mkT([0,0,0]),wall:mkT([0,0,0]),
  heads:Array.from({length:12},()=>({T:mkT([0,.5,1,1,1,0,.3,.7]),gobo:0,strobe:0}))};
function ensureHeadPool(n){while(SH.heads.length<n)SH.heads.push({T:mkT([0,.5,1,1,1,0,.3,.7]),gobo:0,strobe:0})}
function posOf(p,i,n){const u=n>1?i/(n-1)*2-1:0;
  switch(p){case 0:return[-u*.32,.62];case 1:return[u*.25,.98];case 2:return[-u*.12,.45];case 3:return[u*.45,-.75];case 4:return[i%2?.42:-.42,.55];case 5:return[u*.85,.5];default:return[0,.5]}}
function goScene(i,d=SH.fade){
  const l=LOOKS[i]; if(!l)return; SH.scene=i; SH.t0=now();
  goT(SH.wash,l.wash,d);goT(SH.back,l.back,d);goT(SH.bar,l.bar,d);goT(SH.wall,l.wall.col,d);SH.led.mode=l.wall.mode;
  const n=fixCounts().mh;ensureHeadPool(n);
  for(let k=0;k<n;k++){const h=SH.heads[k],[p,t]=posOf(l.mh.pos,k,n);const mid=Math.abs(k-(n-1)/2)<1;
    goT(h.T,[p,t,...l.mh.col,l.mh.only&&!mid?0:l.mh.dim,l.mh.zoom,h.T.t[7]],d);h.gobo=l.mh.gobo;h.strobe=0}
  syncLedWidgets();
}
function syncLedWidgets(){for(const w of allW())if(w.type==='scenes'&&w.addr==='/led/mode'){w.value=SH.led.mode;paint(elOf(w.id),w)}}
const selHeads=()=>{const n=fixCounts().mh;ensureHeadPool(n);return SH.heads.filter((h,k)=>SH.sel.has(k)&&k<n)};
function model(a,args){
  const v=+args[0];
  if(a.startsWith('/dmx/group/')){const g=a.slice(11);if(g in SH.g)SH.g[g]=v;return}
  switch(a){
    case '/dmx/master':SH.master=v;break;
    case '/dmx/scene':goScene(Math.round(v));break;
    case '/dmx/fade':SH.fade=v;break;
    case '/dmx/blackout':SH.blackout=v>.5;break;
    case '/dmx/strobe':SH.strobe=v>.5;break;
    case '/dmx/strobe/rate':SH.rate=v;break;
    case '/dmx/chase':SH.chase=Math.round(v);break;
    case '/mh/select':SH.sel=new Set(args.map((x,k)=>+x>.5?k:-1).filter(k=>k>=0));break;
    case '/mh/pantilt':selHeads().forEach(h=>{setI(h.T,0,+args[0]);setI(h.T,1,-(+args[1]))});break;
    case '/mh/color':selHeads().forEach(h=>[0,1,2].forEach(j=>setI(h.T,2+j,+args[j])));break;
    case '/mh/dimmer':selHeads().forEach(h=>setI(h.T,5,v));break;
    case '/mh/zoom':selHeads().forEach(h=>setI(h.T,6,v));break;
    case '/mh/focus':selHeads().forEach(h=>setI(h.T,7,v));break;
    case '/mh/gobo':selHeads().forEach(h=>h.gobo=Math.round(v));break;
    case '/mh/strobe':selHeads().forEach(h=>h.strobe=v>.5);break;
    case '/mh/position':{const n=fixCounts().mh;ensureHeadPool(n);SH.heads.forEach((h,k)=>{if(!SH.sel.has(k)||k>=n)return;const [p,t]=posOf(Math.round(v),k,n);const tt=h.T.t.slice();tt[0]=p;tt[1]=t;goT(h.T,tt,.7)});break}
    case '/mh/home':if(v>.5)selHeads().forEach(h=>{goT(h.T,[0,.5,1,1,1,1,.3,.7],.6);h.gobo=0;h.strobe=0});break;
    case '/led/color':[0,1,2].forEach(j=>setI(SH.wall,j,+args[j]));break;
    case '/led/mode':SH.led.mode=Math.round(v);break;
    case '/led/bright':SH.led.bright=v;break;
  }
}

/* ---------- runtime timeline (condiviso per indirizzo) ---------- */
const RT={}; const cueCache=new Map();
const rt=w=>RT[w.addr]||(RT[w.addr]={t:0,playing:false,loop:false,cue:-1,last:0,sent:0});
function parseCues(w){
  const k=w.cues||''; if(cueCache.has(k))return cueCache.get(k);
  const r=k.split('\n').map(s=>s.match(/^\s*(\d+):(\d{1,2}(?:\.\d+)?)\s+(.*?)(?:\s*>\s*(.+))?\s*$/)).filter(Boolean)
    .map(m=>{
      const targets=(m[4]||'').split(';').map(s=>s.trim()).filter(Boolean),sceneTarget=targets.find(s=>/^[1-9]\d*$/.test(s));
      return{t:+m[1]*60+ +m[2],name:m[3]||'Cue',scene:sceneTarget!=null?+sceneTarget-1:null,
        params:targets.filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return{param:s.slice(0,i).trim(),value:s.slice(i+1).trim()}}),
        invalid:targets.filter(s=>!s.includes('=')&&!/^\d+$/.test(s))};
    }).sort((a,b)=>a.t-b.t);
  cueCache.set(k,r); return r;
}
const cueTargets=c=>[c.scene!=null?String(c.scene+1):'',...c.params.map(p=>`${p.param}=${p.value}`),...c.invalid].filter(Boolean).join('; ');
function formatCueTime(value){
  const total=Math.round(value*100),minutes=Math.floor(total/6000),seconds=(total%6000)/100;
  const whole=Math.floor(seconds),fraction=String(seconds.toFixed(2)).split('.')[1]?.replace(/0+$/,'')||'';
  return`${minutes}:${String(whole).padStart(2,'0')}${fraction?'.'+fraction:''}`;
}
function parseCueTime(value){
  const text=String(value||'').trim(),clock=text.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if(clock){const seconds=+clock[2];return seconds<60?+clock[1]*60+seconds:NaN}
  return/^\d+(?:\.\d+)?$/.test(text)?+text:NaN;
}
function serializeCues(cues){
  return[...cues].sort((a,b)=>a.t-b.t).map(c=>`${formatCueTime(c.t)} ${c.name.trim()||'Cue'}${c.targets.trim()?` > ${c.targets.trim()}`:''}`).join('\n');
}
function renderCueEditor(w,cues){
  const s=$('#scrim');s.hidden=false;
  const rows=cues.map((c,i)=>`<div class="cue-edit-row" data-cue-row="${i}">
    <label>Posizione (M:SS)<input class="cue-time" value="${esc(formatCueTime(c.t))}" inputmode="decimal" aria-label="Posizione cue ${i+1}"></label>
    <label>Nome<input class="cue-name" value="${esc(c.name)}" aria-label="Nome cue ${i+1}"></label>
    <label>Richiami<input class="cue-editor-target cue-targets" value="${esc(c.targets)}" placeholder="2; dmx_a_palette=Warm" aria-label="Richiami cue ${i+1}"></label>
    <div class="row"><button class="btn sm" data-cue-move="-1" aria-label="Sposta cue ${i+1} su"${i===0?' disabled':''}>↑</button><button class="btn sm" data-cue-move="1" aria-label="Sposta cue ${i+1} giù"${i===cues.length-1?' disabled':''}>↓</button><button class="btn sm danger" data-cue-delete="${i}" aria-label="Elimina cue ${i+1}">×</button></div>
  </div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Editor timeline">
    <div class="top"><h3>Timeline · ${esc(w.label)}</h3><button class="btn ghost" id="cueClose">Chiudi</button></div>
    <p class="hint">Le cue si riordinano per posizione. Trascina un blocco nella timeline oppure modifica qui orario e richiamo; le modifiche vengono salvate nel layout condiviso OPS.</p>
    <div class="cue-edit-list">${rows||'<p class="hint">Nessuna cue. Aggiungine una per iniziare.</p>'}</div>
    <div class="row"><button class="btn" id="cueAdd">＋ Aggiungi cue</button></div>
    <p class="hint">Richiamo opzionale: indice scena OSC 1-based, parametro DMX V8 nel formato <code>dmx_a_palette=Warm</code>, o più valori separati da <code>;</code>. Esempio: <code>2; dmx_b_palette=Cool</code>.</p>
    <div class="cue-editor-actions"><button class="btn ghost" id="cueCancel">Annulla</button><button class="btn primary" id="cueSave">Salva timeline</button></div>
  </div>`;
  const readRows=()=>[...s.querySelectorAll('.cue-edit-row')].map(row=>({
    t:parseCueTime(row.querySelector('.cue-time').value),
    name:row.querySelector('.cue-name').value.trim()||'Cue',
    targets:row.querySelector('.cue-targets').value.trim()
  }));
  const redraw=()=>renderCueEditor(w,readRows());
  s.querySelector('#cueClose').onclick=s.querySelector('#cueCancel').onclick=closeSheet;
  s.querySelector('#cueAdd').onclick=()=>{
    const current=readRows(),last=current.reduce((max,c)=>Number.isFinite(c.t)?Math.max(max,c.t):max,0);
    current.push({t:Math.min(w.duration,Math.max(0,last+10)),name:`Cue ${current.length+1}`,targets:''});
    redraw();
    s.querySelector('.cue-edit-row:last-child .cue-name')?.focus();
  };
  s.querySelectorAll('[data-cue-move]').forEach(button=>button.onclick=()=>{
    const current=readRows(),i=+button.closest('[data-cue-row]').dataset.cueRow,j=i+ +button.dataset.cueMove;
    if(j<0||j>=current.length)return;
    [current[i].t,current[j].t]=[current[j].t,current[i].t];
    renderCueEditor(w,current.sort((a,b)=>a.t-b.t));
  });
  s.querySelectorAll('[data-cue-delete]').forEach(button=>button.onclick=()=>{
    const current=readRows();current.splice(+button.dataset.cueDelete,1);redraw();
  });
  s.querySelector('#cueSave').onclick=()=>{
    const current=readRows();
    const invalid=current.find(c=>!Number.isFinite(c.t)||c.t<0||c.t>w.duration);
    if(invalid){showError(`Timeline: inserisci un orario tra 0 e ${formatCueTime(w.duration)}.`);return}
    if(current.some(c=>c.name.includes('>'))){showError('Il nome della cue non può contenere il separatore ">".');return}
    w.cues=serializeCues(current);
    save();refresh(w);closeSheet();
  };
}
function openCueEditor(w){
  const cues=parseCues(w).map(c=>({t:c.t,name:c.name,targets:cueTargets(c)}));
  renderCueEditor(w,cues);
}
function headControlWidgets(){
  return page().widgets.filter(w=>w.addr?.startsWith('/mh/')&&
    !['/mh/select','/mh/select/heads','/mh/home','/mh/follow','/mh/release','/mh/position','/mh/preset/recall'].includes(w.addr));
}
function captureHeadControlValues(){
  return headControlWidgets().map(w=>({id:w.id,value:JSON.parse(JSON.stringify(w.value)),valueY:w.valueY}));
}
function saveHeadPresets(w,presets){
  w.headPresets=presets;save();refresh(w);
}
function recallHeadPreset(w,index){
  const preset=w.headPresets?.[index];if(!preset)return;
  let recalled=0;
  for(const saved of preset.values||[]){
    const control=page().widgets.find(item=>item.id===saved.id&&item.addr?.startsWith('/mh/'));
    if(!control)continue;
    control.value=JSON.parse(JSON.stringify(saved.value));
    if(Number.isFinite(saved.valueY))control.valueY=saved.valueY;
    paint(elOf(control.id),control);fire(control.addr,argsOf(control),control.oscChannel);recalled++;
  }
  if(!recalled){showError(`Preset "${preset.name}" non contiene controlli PTZ presenti in questa pagina.`);return}
  save();closeSheet();
}
function renderHeadPresetEditor(w,presets){
  const s=$('#scrim');s.hidden=false;
  const rows=presets.map((p,i)=>`<div class="preset-edit-row" data-preset-row="${i}">
    <input data-preset-name="${i}" value="${esc(p.name)}" aria-label="Nome preset ${i+1}">
    <div class="row">
      <button class="btn sm" data-preset-action="recall" data-preset-index="${i}">Richiama</button>
      <button class="btn sm" data-preset-action="update" data-preset-index="${i}">Aggiorna</button>
      <button class="btn sm" data-preset-action="up" data-preset-index="${i}" aria-label="Sposta preset su"${i===0?' disabled':''}>↑</button>
      <button class="btn sm" data-preset-action="down" data-preset-index="${i}" aria-label="Sposta preset giù"${i===presets.length-1?' disabled':''}>↓</button>
      <button class="btn sm danger" data-preset-action="delete" data-preset-index="${i}" aria-label="Elimina preset">×</button>
    </div>
  </div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Preset teste mobili">
    <div class="top"><h3>Preset PTZ · ${esc(w.label)}</h3><button class="btn ghost" id="presetClose">Chiudi</button></div>
    <p class="hint">I preset salvati qui sono snapshot dei controlli PTZ di questa pagina, condivisi nel layout OPS. Il richiamo invia gli stessi controlli OSC alle teste attualmente selezionate; non salva un preset interno a TD.</p>
    <div class="preset-edit-list">${rows||'<p class="hint">Nessun preset salvato.</p>'}</div>
    <div class="row"><label style="flex:1">Nuovo preset<input id="presetNewName" placeholder="Es. Controluce alto"></label><button class="btn primary" id="presetAdd" style="align-self:flex-end">Salva preset corrente</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="presetDone">Fine</button></div>
  </div>`;
  const capture=()=>captureHeadControlValues();
  s.querySelector('#presetClose').onclick=s.querySelector('#presetDone').onclick=closeSheet;
  s.querySelector('#presetAdd').onclick=()=>{
    const name=s.querySelector('#presetNewName').value.trim(),values=capture();
    if(!name){showError('Inserisci un nome per il preset PTZ.');return}
    if(presets.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){showError(`Esiste già un preset chiamato "${name}".`);return}
    if(!values.length){showError('Questa pagina non contiene controlli PTZ da salvare.');return}
    presets.push({name,values});saveHeadPresets(w,presets);renderHeadPresetEditor(w,presets);
  };
  s.querySelectorAll('[data-preset-name]').forEach(input=>input.onchange=()=>{
    const i=+input.dataset.presetName,name=input.value.trim();
    if(!name||presets.some((p,k)=>k!==i&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){
      showError('Il nome del preset deve essere presente e univoco.');input.value=presets[i].name;return;
    }
    presets[i].name=name;saveHeadPresets(w,presets);
  });
  s.querySelectorAll('[data-preset-action]').forEach(button=>button.onclick=()=>{
    const i=+button.dataset.presetIndex,action=button.dataset.presetAction;
    if(action==='recall'){w.headPresets=presets;recallHeadPreset(w,i);return}
    if(action==='update'){
      const values=capture();if(!values.length){showError('Questa pagina non contiene controlli PTZ da salvare.');return}
      presets[i].values=values;
    }else if(action==='delete')presets.splice(i,1);
    else if(action==='up'&&i>0)[presets[i-1],presets[i]]=[presets[i],presets[i-1]];
    else if(action==='down'&&i<presets.length-1)[presets[i+1],presets[i]]=[presets[i],presets[i+1]];
    saveHeadPresets(w,presets);renderHeadPresetEditor(w,presets);
  });
}
function openHeadPresetEditor(w){
  renderHeadPresetEditor(w,JSON.parse(JSON.stringify(w.headPresets||[])));
}
const cueAt=(cues,t)=>{let i=-1;cues.forEach((c,k)=>{if(c.t<=t+1e-6)i=k});return i};
function setDmxParam(device,param,raw){
  const meta=devParams(device).find(p=>p.n===param);
  if(!meta){showError(`DMX V8: parametro "${param}" non pubblicato dal device ${device||'selezionato'}.`);return false}
  const status=G.devices[device],seen=status?._seen??status?.ts;
  if(!status||!Number.isFinite(seen)||Date.now()-seen>1800000){showError(`DMX V8: device ${device} offline o senza status recente; comando non inviato.`);return false}
  let value;
  if(meta.options){
    const option=meta.options.find(o=>String(o)===raw);
    if(option===undefined){showError(`DMX V8: valore "${raw}" non disponibile per ${param}.`);return false}
    value=option;
  }else{
    if(!Number.isFinite(meta.min)||!Number.isFinite(meta.max)||meta.min>meta.max){showError(`DMX V8: range non valido per ${param}.`);return false}
    if(raw===''){showError(`DMX V8: valore mancante per ${param}.`);return false}
    value=Number(raw);
    if(!Number.isFinite(value)||value<meta.min||value>meta.max){showError(`DMX V8: valore non valido per ${param} (${meta.min}–${meta.max}).`);return false}
  }
  if(!devCmd(device,{action:'set',param,value})){showError('DMX V8 non collegato: comando non inviato.');return false}
  return true;
}
function fireCue(w,i){
  const c=parseCues(w)[i];if(!c)return;
  if(c.invalid.length)showError(`Cue "${c.name}": destinazione non riconosciuta (${c.invalid.join(', ')}).`);
  fire(w.addr+'/cue',[i+1],w.oscChannel);
  if(c.scene!=null)fire('/dmx/scene',[c.scene],w.oscChannel);
  if(c.params.length){
    c.params.forEach(p=>{
      const device=w.dmxDevice||devIds('dmx').find(id=>devParams(id).some(meta=>meta.n===p.param));
      if(!device){showError(`Timeline: nessun device DMX V8 pubblica il parametro "${p.param}".`);return}
      setDmxParam(device,p.param,p.value);
    });
  }
}
const SHOW_CLOCK_STATE='gaia/show/clock/state',SHOW_CLOCK_COMMAND='gaia/show/clock/command';
const showClock={id:`plancia-${Math.random().toString(36).slice(2)}`,state:null,receivedAt:0,
  osc:null,authority:false,hasMqtt:false,minRtt:null,rtts:[],pings:new Map(),pingSeq:0};
const showClockAge=sample=>sample?Math.max(0,now()-sample.receivedAt):Infinity;
const showClockFresh=sample=>!!sample&&((sample.source==='osc'&&!sample.state.playing&&!showClock.hasMqtt)||showClockAge(sample)<=3500);
function showClockSample(){
  const candidates=[];
  if(showClock.state)candidates.push({source:'mqtt',state:showClock.state,receivedAt:showClock.receivedAt});
  if(showClock.osc)candidates.push({source:'osc',state:showClock.osc,receivedAt:showClock.osc.receivedAt});
  const fresh=candidates.find(showClockFresh);
  if(fresh)return fresh;
  return candidates.sort((a,b)=>b.receivedAt-a.receivedAt)[0]||null;
}
function showClockPosition(sample=showClockSample()){
  if(!sample)return null;
  const s=sample.state,elapsed=Math.min(showClockAge(sample),3500);
  const compensation=sample.source==='mqtt'?(showClock.minRtt||0)/2:0;
  const rate=Number.isFinite(+s.rate)?+s.rate:1;
  return clamp((+s.pos||0)+(s.playing?(elapsed+compensation)/1000*rate:0),0,
    Number.isFinite(+s.length)&&+s.length>0?+s.length:Infinity);
}
function showClockCues(){
  const raw=G.devices['td-dmx-win']?.params?.show_cues;
  const list=Array.isArray(raw)?raw:Array.isArray(raw?.cues)?raw.cues:null;
  if(!list)return null;
  return list.map((item,i)=>{
    const c=typeof item==='string'?{}:item||{};
    const match=typeof item==='string'?item.match(/^\s*(\d+:\d{1,2}(?:\.\d+)?)\s+(.+)$/):null;
    const position=c.t??c.pos??c.position??c.seconds??c.time_s??c.time??match?.[1];
    const t=typeof position==='string'?parseCueTime(position):+position;
    const name=c.label||c.name||match?.[2]||`Cue ${i+1}`;
    return Number.isFinite(t)?{t,name:String(name),index:Number.isFinite(+c.index)&&+c.index>0?+c.index:i+1,scene:null,params:[],invalid:[]}:null;
  }).filter(Boolean);
}
function showClockCommand(w,action,value){
  const sample=showClockSample();
  if(!sample||!showClockFresh(sample)){showError('Orologio TD non raggiungibile: comando non inviato.');return false}
  if(sample.source==='mqtt'){
    if(!G.ok){showError('Broker Gaia non collegato: comando clock non inviato.');return false}
    const command={action};if(value!==undefined)command.value=value;
    return gPub(SHOW_CLOCK_COMMAND,command);
  }
  const osc=(address,args)=>emit({type:'osc',address,args,channel:w.oscChannel||'default'});
  if(action==='play'||action==='pause')osc('/show/play',[action==='play'?1:0]);
  else if(action==='toggle')osc('/show/play',[sample.state.playing?0:1]);
  else if(action==='stop'){osc('/show/play',[0]);osc('/show/time',[0])}
  else if(action==='seek')osc('/show/time',[+value]);
  else if(action==='go')osc('/show/go',[1]);
  else if(action==='back')osc('/show/back',[1]);
  else if(action==='cue')osc('/show/cue',[+value]);
  else{showError(`Comando clock "${action}" non supportato.`);return false}
  return true;
}
function showClockRemoteOSC(address,args){
  const sample=showClock.osc||(showClock.osc={pos:0,playing:false,receivedAt:now()});
  if(address==='/show/time'&&Number.isFinite(+args[0]))sample.pos=Math.max(0,+args[0]);
  else if(address==='/show/play')sample.playing=+args[0]>.5;
  else if(address==='/show/cue')sample.cue=+args[0];
  else return;
  sample.receivedAt=now();showClock.authority=true;
}
function isShowTimeline(w){return w.addr==='/show'}
function timelineDuration(w){
  const sample=isShowTimeline(w)&&showClock.authority?showClockSample():null;
  return sample&&Number.isFinite(+sample.state.length)&&+sample.state.length>0?+sample.state.length:(w.duration||1);
}
function timelineCues(w){
  if(isShowTimeline(w)&&showClock.authority)return showClockCues()||[];
  return parseCues(w);
}
function refreshShowTimelines(){
  for(const w of page().widgets)if(w.type==='timeline'&&isShowTimeline(w))refresh(w);
}
function seek(w,t,quietCue){if(isShowTimeline(w)&&showClock.authority){showClockCommand(w,'seek',clamp(t,0,timelineDuration(w)));return}
  const r=rt(w),cues=parseCues(w);r.t=clamp(t,0,w.duration);const i=cueAt(cues,r.t);
  if(i!==r.cue){r.cue=i;if(!quietCue&&i>=0)fireCue(w,i)} fire(w.addr+'/time',[+r.t.toFixed(2)],w.oscChannel)}
function tlAct(w,act){const r=rt(w),cues=parseCues(w);
  if(isShowTimeline(w)&&showClock.authority){
    const sample=showClockSample();
    if(act==='edit-cues'){showError('Le cue dello show si modificano in DMX Master.');return}
    if(act==='loop'){showError('Il clock TD non espone ancora un comando loop.');return}
    if(act==='play')showClockCommand(w,sample?.state.playing?'pause':'play');
    else if(act==='stop')showClockCommand(w,'stop');
    else if(act==='start')showClockCommand(w,'seek',0);
    else if(act==='go'||act==='back')showClockCommand(w,act);
    return;
  }
  if(act==='play'){r.playing=!r.playing;r.last=now();fire(w.addr+'/play',[r.playing?1:0],w.oscChannel);if(r.playing&&r.cue<0&&cues[0]&&cues[0].t<=r.t){r.cue=0;fireCue(w,0)}}
  else if(act==='stop'){r.playing=false;r.t=0;r.cue=-1;fire(w.addr+'/play',[0],w.oscChannel);fire(w.addr+'/time',[0],w.oscChannel)}
  else if(act==='start'){seek(w,0)}
  else if(act==='loop'){r.loop=!r.loop}
  else if(act==='go'){const i=Math.min(cues.length-1,r.cue+1);if(i>=0){r.t=cues[i].t;r.cue=i;fireCue(w,i)}}
  else if(act==='back'){const i=Math.max(0,r.cue-1);if(cues[i]){r.t=cues[i].t;r.cue=i;fireCue(w,i)}}
}
function timelineBus(a,args,src){
  if(src==='remote'&&a.startsWith('/show/'))showClockRemoteOSC(a,args);
  const seen=new Set();
  for(const w of allW()){if(w.type!=='timeline'||seen.has(w.addr)||!a.startsWith(w.addr+'/'))continue;seen.add(w.addr);
    const s=a.slice(w.addr.length+1),v=+args[0];
    if((s==='go'||s==='back')&&v>.5&&!(src==='remote'&&isShowTimeline(w)))tlAct(w,s);
    else if(src==='remote'&&s==='play'){const r=rt(w);r.playing=v>.5;r.last=now()}
    else if(src==='remote'&&s==='time'){rt(w).t=clamp(v,0,w.duration)}
  }
}
let showT=0, showPlaying=false, showBpm=120;
