/* ---------- Gaia: MQTT su WebSocket, stesso schema di patchdeck.html / dmx.html / mixeraudio.html ---------- */
const GKEY='plancia.gaia.v1';
// video/videoPort: Plancia Video Service (NDI->WebRTC, PoC 2026-10-16),
// gira sempre sulla stessa macchina fisica (OPS/SILVERMINI2, li' dove
// vive TouchDesigner/PatchDeck) indipendentemente dal profilo di rete
// scelto in Plancia -- per questo e' lo stesso valore in entrambi.
const NET_DEFAULT={
  casa:{name:'Casa',broker:'192.168.1.142',wsPort:9001,fallback:'100.94.220.65',nodered:'192.168.1.240',noderedPort:1881,admin:'192.168.1.142',adminPort:8765,osc:'192.168.1.142',oscPort:9008,video:'192.168.1.240',videoPort:8788},
  ops:{name:'Portatile (OPS)',broker:'192.168.1.240',wsPort:19001,fallback:'',nodered:'192.168.1.240',noderedPort:1881,admin:'192.168.1.240',adminPort:1881,osc:'192.168.1.240',oscPort:9008,video:'192.168.1.240',videoPort:8788}};
let GC=Object.assign({on:true,stanza:'studio',profile:'casa',profiles:JSON.parse(JSON.stringify(NET_DEFAULT))},store.get(GKEY)||{});
if(GC.broker){GC.profiles.casa={...GC.profiles.casa,broker:GC.broker,wsPort:GC.port||9001,fallback:GC.fallback??''};delete GC.broker;delete GC.port;delete GC.fallback}   // migrazione dal formato precedente
for(const k in NET_DEFAULT)if(!GC.profiles[k])GC.profiles[k]=JSON.parse(JSON.stringify(NET_DEFAULT[k]));
if(!GC.profiles[GC.profile])GC.profile='casa';
// avvio da URL (kiosk, tablet): ?profilo=ops  oppure  ?broker=192.168.1.240&nodered=…&admin=…&osc=…&stanza=…
(()=>{try{const q=new URLSearchParams(location.search);if(!q.toString())return;
  if(q.get('profilo')&&GC.profiles[q.get('profilo')])GC.profile=q.get('profilo');
  const n=GC.profiles[GC.profile];[['broker','broker'],['nodered','nodered'],['admin','admin'],['osc','osc'],['ws','wsPort']].forEach(([a,b])=>{if(q.get(a))n[b]=b==='wsPort'?+q.get(a):q.get(a)});
  if(q.get('stanza'))GC.stanza=q.get('stanza');store.set(GKEY,GC)}catch{}})();
const net=()=>GC.profiles[GC.profile]||NET_DEFAULT.casa;
const videoGatewayUrl=()=>{const n=net();return n.video?`http://${n.video}:${n.videoPort||8788}`:null};
const bridgeCfg=()=>({type:'config',host:C.host,port:+C.port,gaiaHost:net().osc,gaiaPort:+net().oscPort,channels:C.oscChannels});
const G={client:null,ok:false,host:null,sim:false,nr:null,nrWs:null,nrOk:false,dirty:true,lastPaint:0,devices:{},pdm:{},dxm:{},dmx:{},levels:{},canvas:null,brain:null,dream:null,chat:[],chatV:0,lastSent:null,offSince:null,tdAutoSynced:false};
function tdHeadEntries(){
  const params=G.devices['td-dmx-win']?.params||{};
  const listed=Array.isArray(params.heads_list)?params.heads_list:Object.values(params.heads_list||{});
  const fixtures=Array.isArray(params.dmx_fixtures)?params.dmx_fixtures.filter(f=>
    ['heads','mh'].includes(String(f.group||'').toLowerCase())||String(f.group||'').toLowerCase().startsWith('heads_')||f.type==='mh'):[];
  const source=listed.length?listed:fixtures;
  const entries=source.map(h=>{
    const id=h.uid||(h.unit!=null?`u${h.unit}`:h.id!=null?`id:${h.id}`:h.name||h.key);
    if(id==null)return null;
    const aliases=[h.uid,h.key,h.name,h.unit,`u${h.unit}`,h.id,`id:${h.id}`].filter(x=>x!=null).map(String);
    return{id:String(id),label:String(h.name||`Testa ${h.unit??h.id??''}`),aliases};
  }).filter(Boolean);
  const matrix=G.dxm['td-dmx-win']||{},programmer=matrix.heads?.programmer||matrix.dmx_matrix?.heads?.programmer;
  const order=programmer?.order;
  if(!Array.isArray(order))return entries;
  return order.map(item=>{
    const token=String(item?.uid||item?.key||item?.name||item?.unit||item);
    return entries.find(h=>h.aliases.includes(token)||h.id===token);
  }).filter(Boolean);
}
function syncHeadSelectors(){
  const entries=tdHeadEntries();if(!entries.length)return;
  for(const w of allW()){
    if(w.type!=='scenes'||w.mode!=='head-select'||w.addr!=='/mh/select/heads')continue;
    const before=JSON.stringify([w.headValues,w.items,w.value,w.selectedHeads]);
    const selected=new Set(Array.isArray(w.selectedHeads)?w.selectedHeads:[]);
    if(!w._headsInitialized){
      if(Array.isArray(w._headSelectedIndices))entries.forEach((h,i)=>{if(w._headSelectedIndices[i])selected.add(h.id)});
      else if(!selected.size)entries.forEach(h=>selected.add(h.id));
      delete w._headSelectedIndices;w._headsInitialized=true;
    }
    w.headValues=entries.map(h=>h.id);
    w.items=entries.map(h=>h.label).join('\n');
    w.selectedHeads=w.headValues.filter(id=>selected.has(id));
    w.value=w.headValues.map(id=>selected.has(id)?1:0);
    if(before!==JSON.stringify([w.headValues,w.items,w.value,w.selectedHeads])){
      save();
      if(page().widgets.includes(w))refresh(w);
    }
  }
}
function migrateLegacyHeadSelectors(){
  let changed=false;
  for(const w of allW()){
    if(w.type!=='scenes'||w.addr!=='/mh/select'||w.mode!=='multi')continue;
    const names=items(w);
    if(names.length!==8||!names.every((name,i)=>name===`MH ${i+1}`))continue;
    w._headSelectedIndices=Array.isArray(w.value)?w.value.slice():[];
    w.mode='head-select';w.addr='/mh/select/heads';w.items='';w.headValues=[];w.selectedHeads=[];w._headsInitialized=false;
    changed=true;
  }
  if(changed)save();
}
function migrateHeadPresetWidgets(){
  let changed=false;
  for(const p of L.pages||[]){
    const widgets=p.widgets||[];
    if(widgets.some(w=>w.type==='scenes'&&w.mode==='head-presets'))continue;
    const hasHeadSelector=widgets.some(w=>w.type==='scenes'&&(w.mode==='head-select'||w.addr==='/mh/select/heads'));
    const positions=widgets.find(w=>w.type==='scenes'&&w.addr==='/mh/position');
    if(!hasHeadSelector||!positions||positions.w<4)continue;
    const presetW=Math.max(2,Math.floor(positions.w/2));
    const originalW=positions.w;
    positions.w=originalW-presetW;
    positions.cols=Math.min(4,positions.cols||4);
    widgets.push(W('scenes',positions.x+positions.w,positions.y,presetW,positions.h,{
      label:'Preset PTZ',mode:'head-presets',headPresets:[],color:SWATCH[4]
    }));
    changed=true;
  }
  if(changed)save();
}
const MOOD_INKS={neutra:[0,255,204],calm:[80,230,190],stress:[255,115,85],social:[255,195,100],curiosity:[190,135,255]};
const MOOD_ALIAS={serena:'calm',sofferente:'stress',instabile:'stress',viva:'social',stabile:'neutra',neutrale:'neutra'};
const MOOD_IT={neutra:'Neutra',calm:'Calma',stress:'Stress',social:'Sociale',curiosity:'Curiosità'};
const DIMS=[['stress','Stress',1],['calm','Calma',1],['social','Socialità',1],['curiosity','Curiosità',1],['energy','Energia',100]];
const GAIA_TYPES=new Set(['gaia','patchdeck','tddevice','gaiadmx']);
const FAM_IT={patchdeck:'PatchDeck',mixeraudio:'Controller',dmx:'DMX V8'};

function gLoadLib(cb){
  if(window.mqtt)return cb();
  const add=(src,ok,ko)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=ko;document.head.appendChild(s)};
  add('vendor/mqtt.min.js',cb,()=>add('https://unpkg.com/mqtt@5.16.0/dist/mqtt.min.js',cb,()=>gSim()));
}
function gStart(){gStatus();nrConnect();if(!GC.on){gSim();return}gLoadLib(()=>gConnect(net().broker));setTimeout(()=>{if(!G.ok)gSim()},4500)}
function gConnect(host){
  try{G.client&&G.client.end(true)}catch{}
  G.client=null;G.host=host;G.ok=false;gStatus();
  if(!GC.on||!window.mqtt)return;
  let c;try{c=mqtt.connect(`ws://${host}:${net().wsPort}`,{connectTimeout:4000,reconnectPeriod:3000})}catch{G.offSince=G.offSince??Date.now();return}
  G.client=c;
  c.on('connect',()=>{G.ok=true;G.offSince=null;if(G.sim)gSimOff();gStatus();
    ['gaia/device/+/status','gaia/devices/+/patchdeck_matrix','gaia/devices/+/dmx_matrix','gaia/devices/+/dmx_output','gaia/devices/+/show_timeline','gaia/device/+/audio_levels','gaia/dmx/+/status',
     'gaia/td/canvas','gaia/brain/state','gaia/brain/dream','gaia/voice/tts/+','gaia/voice/command/+',
     SHOW_CLOCK_STATE,'gaia/show/clock/pong/+'].forEach(t=>c.subscribe(t))});
  const off=()=>{if(G.client!==c)return;G.ok=false;G.offSince=G.offSince??Date.now();gStatus()};
  c.on('offline',off);c.on('error',off);c.on('close',off);
  c.on('message',(t,raw)=>{if(!raw||!raw.length)return;let p;const s=raw.toString();try{p=JSON.parse(s)}catch{p=s}gIn(t,p)});
}
// fallback LAN <-> Tailscale solo dopo 10s consecutivi scollegati (non a ogni blip), come le pagine di Gaia
setInterval(()=>{const n=net();if(!GC.on||G.ok||G.offSince==null||!n.fallback||!window.mqtt)return;
  if(Date.now()-G.offSince>10000){G.offSince=Date.now();gConnect(G.host===n.broker?n.fallback:n.broker)}},2000);
setInterval(()=>{
  if(!G.ok||!G.client)return;
  const seq=++showClock.pingSeq,t0=now(),payload={from:showClock.id,n:seq,t0};
  showClock.pings.set(seq,{at:t0,t0});
  for(const[k,v]of showClock.pings)if(t0-v.at>30000)showClock.pings.delete(k);
  G.client.publish('gaia/show/clock/ping',JSON.stringify(payload));
},2000);
// Node-RED: WebSocket /gaia (stesso flusso della dashboard) — fonte di riserva per mood e pensieri se gaia/td/canvas tace
function nrConnect(){
  try{G.nrWs&&(G.nrWs.onclose=null,G.nrWs.close())}catch{}G.nrWs=null;G.nrOk=false;
  if(!GC.on||!net().nodered)return;const url=`ws://${net().nodered}:${net().noderedPort}/gaia`;let w;
  try{w=new WebSocket(url)}catch{return}G.nrWs=w;
  w.onopen=()=>{G.nrOk=true;G.dirty=true};
  w.onmessage=ev=>{let p;try{p=JSON.parse(ev.data)}catch{return}const d=p&&(p.payload||p);if(d&&(d.soul||d.thought)){G.nr=d;G.dirty=true}};
  w.onclose=()=>{if(G.nrWs!==w)return;G.nrOk=false;setTimeout(()=>{if(G.nrWs===w)nrConnect()},5000)};
}
function gStatus(){
  const p=$('#gconn');if(!p)return;p.classList.toggle('on',G.ok);p.classList.toggle('sim',!G.ok&&G.sim);
  const full=G.ok?`Gaia · ${net().name} · ${G.host}`:G.sim?'Gaia · simulazione':GC.on?'Gaia · offline':'Gaia · spenta';
  $('#gconnTxt').textContent=G.ok?'Gaia':full;p.title=full;
}
function gIn(t,p){
  const seg=t.split('/'),obj=p&&typeof p==='object';
  if(seg[1]==='devices'&&seg[3]==='dmx_output'){
    if(obj){
      const previousScene=dmxNumber(DMX_OUTPUT.scene?.index??DMX_OUTPUT.scene);
      if(dmxOutputApplySnapshot(p,seg[2])){
        const updates=[['/dmx/master',DMX_OUTPUT.master],['/dmx/blackout',DMX_OUTPUT.blackout?1:0],['/dmx/strobe',DMX_OUTPUT.strobe?1:0]];
        for(const [address,value]of updates)if(value!=null){
          bus(address,[value],'remote');
          applyWidgets({address,args:[value]},null);
        }
        const scene=dmxNumber(DMX_OUTPUT.scene?.index??DMX_OUTPUT.scene);
        // Solo evidenziare il pulsante: la scena e' gia' applicata in TD e
        // il Render la vede da rgb_out. bus() -> goScene() lancerebbe il
        // look LOCALE con lo stesso indice (TestScene1 -> "Walk-in", nota 33).
        if(scene!=null&&scene>=0&&scene!==previousScene){
          SH.scene=scene;
          applyWidgets({address:'/dmx/scene',args:[scene]},null);
        }
      }
    }
  }else if(seg[1]==='devices'&&seg[3]==='show_timeline'){
    // timeline di DMX Master, retained, ripubblicata a ogni rev nuova
    // (nota TD 31): piu' fresca di show_timeline nello status
    if(obj&&Array.isArray(p.cues)&&seg[2]==='td-dmx-win'){
      const old=G.tdTimeline?.rev;G.tdTimeline=p;
      if(old!==p.rev)onTdTimelineRev(p);
    }
  }else if(t===SHOW_CLOCK_STATE){
    if(obj&&p.v===1&&p.master==='td-dmx-win'&&Number.isFinite(+p.pos)&&typeof p.playing==='boolean'){
      const oldLength=showClock.state?.length;
      showClock.state={...p,pos:+p.pos,playing:p.playing};showClock.receivedAt=now();showClock.authority=true;showClock.hasMqtt=true;
      if(oldLength!==p.length)refreshShowTimelines();
    }
  }else if(seg[1]==='show'&&seg[2]==='clock'&&seg[3]==='pong'){
    if(obj&&p.from===showClock.id){
      const sent=showClock.pings.get(+p.n);
      if(sent&&p.t0===sent.t0){const rtt=Math.max(0,now()-sent.at);showClock.pings.delete(+p.n);
        showClock.rtts.push(rtt);if(showClock.rtts.length>10)showClock.rtts.shift();
        showClock.minRtt=Math.min(...showClock.rtts)}
    }
  }else if(seg[1]==='device'&&seg[3]==='status'){if(obj){const oldShowCues=JSON.stringify(G.devices[seg[2]]?.params?.show_cues),oldScenes=JSON.stringify(G.devices[seg[2]]?.params?.show_scene_catalog);p._seen=Date.now();G.devices[seg[2]]=p;
    // reimport automatico della patch di TD all'apertura, ma MAI sopra
    // fixture della Pianta non ancora mandate (palco AI, fixture nuove):
    // le cancellerebbe dal layout condiviso al primo tablet che si apre
    if(seg[2]==='td-dmx-win'&&!G.tdAutoSynced&&Array.isArray(p.params?.dmx_fixtures)){G.tdAutoSynced=true;
      const pending=(L.fixtures||[]).filter(f=>FIX_TYPES[f.type]?.ch&&!f._synced).length;
      if(pending)showInfo(`Pianta con ${pending} fixture non ancora mandate a DMX Master: non la reimporto da TD (⇩ TD per farlo a mano).`);else importFromTD(true)}
    if(seg[2]==='td-dmx-win'){
      syncHeadSelectors();
      if(oldShowCues!==JSON.stringify(p.params?.show_cues))refreshShowTimelines();
      if(oldScenes!==JSON.stringify(p.params?.show_scene_catalog))refreshTdSceneWidgets();
    }}}
  else if(t.endsWith('/patchdeck_matrix')){if(obj)G.pdm[p.device_id||seg[2]]=p}
  else if(t.endsWith('/dmx_matrix')){if(obj){G.dxm[p.device_id||seg[2]]=p;syncHeadSelectors()}}
  else if(t.endsWith('/audio_levels'))G.levels[seg[2]]=p;
  else if(seg[1]==='dmx'&&seg[3]==='status'){if(obj)G.dmx[p.stanza||seg[2]]=p}
  else if(t==='gaia/td/canvas'){if(obj)G.canvas=p}
  else if(t==='gaia/brain/state'){if(obj)G.brain=p}
  else if(t==='gaia/brain/dream')G.dream=p;
  else if(t.startsWith('gaia/voice/tts/'))gChat('gaia',typeof p==='string'?p:(p?.text||p?.message||''),seg[3]);
  else if(t.startsWith('gaia/voice/command/'))gChat('voce',typeof p==='string'?p:p?.text,(obj&&p.stanza)||seg[3]);
  G.dirty=true;
}
function gChat(who,text,room){
  text=String(text||'').trim();if(!text)return;
  const L0=G.lastSent;if(who==='voce'&&L0&&L0.text===text&&Date.now()-L0.ts<8000)return;   // eco del nostro stesso invio
  const last=G.chat[G.chat.length-1];if(last&&last.who===who&&last.text===text&&Date.now()-last.ts<4000)return;
  G.chat.push({who,text,room,ts:Date.now()});if(G.chat.length>40)G.chat.shift();G.chatV++;G.dirty=true;
}
function gPub(topic,obj){
  const body=JSON.stringify(obj);
  if(G.ok)G.client.publish(topic,body);else if(G.sim)simCmd(topic,obj);else return false;
  log('out',{address:'mqtt '+topic,args:[body.length>70?body.slice(0,70)+'…':body]});G.dirty=true;return true;
}
const devAge=d=>Date.now()-(d?.ts||d?._seen||0);
const devDot=d=>!d?'':devAge(d)<180000?'on':devAge(d)<1800000?'idle':'';
function gFam(id,d){if(d?.family)return d.family;if(G.pdm[id])return'patchdeck';if(G.dxm[id])return'dmx';if(/controller|mixer/i.test(id+' '+(d?.name||'')))return'mixeraudio';return d?.role||''}
function devIds(fam){
  const ids=new Set([...Object.keys(G.devices),...(fam==='patchdeck'?Object.keys(G.pdm):[]),...(fam==='dmx'?Object.keys(G.dxm):[])]);
  return[...ids].filter(id=>!fam||gFam(id,G.devices[id])===fam).sort((a,b)=>devAge(G.devices[a])-devAge(G.devices[b]));
}
const pickDev=(w,fam)=>(w.device&&(G.devices[w.device]||G.pdm[w.device]||G.dxm[w.device]))?w.device:(devIds(fam)[0]||null);
const pickRoom=w=>(w.stanza&&G.dmx[w.stanza])?w.stanza:(Object.keys(G.dmx).sort()[0]||null);
const devCmd=(id,o)=>id&&gPub(`gaia/device/${id}/command`,o);
function moodOf(){
  const s=G.canvas?.soul||G.brain?.soul||G.nr?.soul||G.brain||{};const raw=s.mood||'neutra';const key=MOOD_ALIAS[raw]||(MOOD_INKS[raw]?raw:'neutra');
  const m=s.mood_rgb;const rgb=m&&m.r!=null?[m.r,m.g,m.b]:MOOD_INKS[key];
  return{s,key,label:MOOD_IT[key]||raw,rgb:rgb.map(v=>v/255),hex:hex(rgb.map(v=>v/255))};
}
function nudge(dim,d){
  if(G.ok||G.sim)gPub('gaia/touchdesigner/mood/'+dim,d);   // = /gaia/td/mood/<dim> via osc_bridge sul Core
  else emit({type:'osc',address:'/gaia/td/mood/'+dim,args:[d]});   // senza broker: OSC dal bridge di Plancia verso la 9008 di Gaia
}
function gSay(text){
  text=text.trim();if(!text)return;
  const o={text,stanza:GC.stanza,ts:Date.now()};
  if(!gPub(`gaia/voice/command/${GC.stanza}`,o)){gChat('gaia','Non sono collegata: imposta il broker di Gaia in ⋯ → Gaia.');return}
  G.lastSent={text,ts:Date.now()};G.chat.push({who:'tu',text,room:GC.stanza,ts:Date.now()});G.chatV++;
}

/* parametri di un device: matrice reale se c'è (fx_params PatchDeck, dmx_matrix piatta o multi-rig), altrimenti i valori in status */
function devParams(id){
  const d=G.devices[id]||{},out=[],seen=new Set();
  const fx=G.pdm[id]?.fx_params||{};
  for(const[n,m]of Object.entries(fx)){seen.add(n);out.push({n,label:m.label||n.replace(/_/g,' '),min:typeof m.min==='number'?m.min:0,max:typeof m.max==='number'?m.max:1})}
  const dm=G.dxm[id];
  // Quick patch del rig (nota TD 38): scriverli RISCRIVE l'intero gruppo
  // come blocco consecutivo e puo' sovrapporlo ad altre fixture. Con la
  // patch per fixture (Pianta) non vanno mai offerti come controlli.
  for(const[rig]of Object.entries(dm?.rigs||{}))for(const q of DMX_QUICK_PATCH)seen.add(`dmx_${rig}_${q}`);
  // anche le teste: heads_start_address / heads_output_port / heads_profile
  for(const n of Object.keys(d.params||{}))if(/^(dmx_.+|heads)_(fixture_count|start_address|output_port|fixture_profile|profile)$/.test(n))seen.add(n);
  const addDx=(params,rig)=>{for(const[n0,m]of Object.entries(params||{})){const n=rig?n0.replace(/^dmx_/,`dmx_${rig}_`):n0;if(seen.has(n))continue;seen.add(n);
    const lab=(rig?rig.toUpperCase()+' · ':'')+n0.replace(/^dmx_/,'').replace(/_/g,' ');
    if(Array.isArray(m.options))out.push({n,label:lab,options:m.options});
    else if(m.type==='bool'||m.type==='toggle')out.push({n,label:lab,options:[0,1],labels:['off','on']});
    else{const r=m.range||[m.min??0,m.max??1];out.push({n,label:lab,min:+r[0],max:+r[1]})}}};
  if(dm?.rigs)for(const[rig,r]of Object.entries(dm.rigs))addDx(r.params,rig);else if(dm)addDx(dm.params,null);
  for(const[n,v]of Object.entries(d.params||{}))if(!seen.has(n)&&typeof v==='number'){seen.add(n);out.push({n,label:n.replace(/_/g,' '),min:0,max:Math.max(1,Math.abs(v)>1?Math.ceil(Math.abs(v)):1)})}
  return out;
}
function devServices(id){
  const d=G.devices[id]||{},pm=G.pdm[id]?.services||{},dm=G.dxm[id];
  let keys=Object.keys(d.services||{});
  if(dm?.rigs)for(const[rig,r]of Object.entries(dm.rigs))for(const k of Object.keys(r.services||{}))keys.push(k.replace(/^dmx_/,`dmx_${rig}_`));
  else if(dm?.services)keys.push(...Object.keys(dm.services));
  // apply_fixture_profile = quick patch del rig (riscrive il profilo di
  // tutto il gruppo, nota TD 38): non offerto come pulsante
  return[...new Set(keys)].filter(k=>!['load_patch','deck_toggle'].includes(pm[k]?.kind)&&!/^dmx_.+_apply_fixture_profile$/.test(k)).sort();
}
const enumParams=id=>devParams(id).filter(p=>Array.isArray(p.options));
function tdEnumInfo(w){
  const devices=w.device?[w.device]:devIds('dmx');
  const id=devices.find(device=>!w.param||enumParams(device).some(p=>p.n===w.param))||devices[0]||null;
  const params=enumParams(id);
  const meta=w.param?params.find(p=>p.n===w.param):params.find(p=>/palette/i.test(p.n));
  return{id,meta,missing:!!w.param&&!meta,noPalette:!w.param&&!meta,value:meta?(G.devices[id]?.params||{})[meta.n]:undefined};
}
function paintTdEnum(el,w){
  const sc=el.querySelector('.sc'),info=tdEnumInfo(w);
  const opts=info.meta?.options||[],labels=info.meta?.labels||[];
  const sig=JSON.stringify([info.id,info.meta?.n,opts,labels]);
  if(sc._sig!==sig){
    sc._sig=sig;
    if(!info.meta||!opts.length)sc.innerHTML=`<p class="dv-empty">${info.missing?'Il parametro DMX V8 configurato non è più pubblicato.':info.meta?'Il parametro DMX V8 non pubblica opzioni.':info.noPalette?'DMX V8 non pubblica un parametro enum palette. Seleziona un parametro dall’ispettore.':'In attesa di un parametro enum DMX V8.'}</p>`;
    else{
      sc.style.gridTemplateColumns=`repeat(${colsOf(w,opts.length)},minmax(0,1fr))`;
      sc.innerHTML=opts.map((o,i)=>`<div class="si" data-i="${i}" data-opt="${esc(o)}" data-opt-type="${typeof o}" title="${esc(labels[i]??o)}"><span class="no">${String(i+1).padStart(2,'0')}</span><span class="nm">${esc(labels[i]??o)}</span><i class="chip"></i><i class="pal"></i></div>`).join('');
    }
  }
  // Colori veri (nota TD 37): la striscia in basso mostra i colori della
  // palette come li fa girare il rig (dmx_matrix ... dmx_palette.colors,
  // a scatti se "stepped"); "Custom" i 5 custom_color del rig, che
  // cambiano dal vivo. La palette attiva prende anche la tinta che il rig
  // sta emettendo adesso (dmx_output, media degli rgb_out del gruppo).
  const pp=String(info.meta?.n||''),params=G.devices[info.id]?.params||{};
  const pal=dmxPaletteColors(G.dxm[info.id],pp);
  const custom=[1,2,3,4,5].map(k=>params[pp.replace(/_palette$/,`_custom_color${k}`)]).filter(Array.isArray);
  const group=dmxPaletteGroup(pp),live=group&&dmxOutputFresh()?dmxGroupColor(group,tdGroupOf):null;
  sc.querySelectorAll('.si').forEach((n,i)=>{
    const o=String(opts[i]),on=String(info.value)===o;n.classList.toggle('on',on);
    const cols=o==='Custom'?custom:pal?.colors?.[o]||null;
    const grad=cols?.length?dmxGradient([[cols,o==='Custom'||pal?.stepped.has(o)]]):'';
    const strip=n.querySelector('.pal');if(strip&&strip._g!==grad){strip._g=grad;strip.style.background=grad}
    const col=on&&live?live:cols?.[0]||null;
    const hx=col?hex(col):'';if(n._ic!==hx){n._ic=hx;hx?n.style.setProperty('--ic',hx):n.style.removeProperty('--ic')}
  });
  const addr=el.querySelector('.addr');if(addr)addr.textContent=info.meta?`${info.id} · ${info.meta.n}`:'DMX V8 · parametro non disponibile';
}
