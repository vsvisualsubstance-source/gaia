/* ---------- connessione al bridge ---------- */
function status(){
  const on=ws&&ws.readyState===1;
  $('#conn').classList.toggle('on',on);
  $('#connTxt').textContent=on?`Bridge → ${hello?.target?.host??C.host}:${hello?.target?.port??C.port}`:'Non connesso · simulazione';
}
function connect(){
  clearTimeout(retry); if(ws){ws.onclose=null;try{ws.close()}catch{}} ws=null; hello=null; status();
  if(!C.url){saveStatus('Bridge non configurato');return}
  try{ws=new WebSocket(C.url)}catch{retry=setTimeout(connect,4000);return}
  ws.onopen=()=>{status();ws.send(JSON.stringify(bridgeCfg()))};
  ws.onclose=()=>{ws=null;status();saveStatus(sharedDirty?'Offline · layout in copia locale':'Server OPS non connesso');retry=setTimeout(connect,3000)};
  ws.onerror=()=>{};
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}
    if(m.type==='hello'){
      hello=m;status();
      if(m.sharedState?.layout){
        if(!sharedDirty)acceptSharedState(m.sharedState,m.sharedRevision);
        else sendSharedState();
      }else if(sharedDirty)sendSharedState();
      else saveStatus('Server pronto',true);
      return
    }
    if(m.type==='shared_saved'){
      sharedRevision=Math.max(sharedRevision,m.revision||0);
      if(m.revision>=sharedRevision&&m.clientRevision===clientRevision){
        sharedBaseline=JSON.stringify(sharedState);sharedDirty=false;serverHasLayout=true;
        saveStatus('Layout salvato · OPS',true);
      }else if(sharedDirty)sendSharedState();
      return
    }
    if(m.type==='shared_update'){
      if(m.revision>sharedRevision)acceptSharedState(m.state,m.revision);
      return
    }
    if(m.type==='shared_error'){saveStatus('Errore salvataggio layout');showError(m.message||'Salvataggio condiviso fallito.');return}
    if(m.type==='error'){showError(m.message||'Errore nel bridge OSC.');return}
    if(m.type==='osc')receive(m);
  };
}
let toastTimer=0;
function showError(message){
  const toast=$('#toast');toast.textContent=message;toast.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true},5000);
}
function emit(msg,quiet){
  if(ws&&ws.readyState===1)ws.send(JSON.stringify(msg));
  if(quiet)return;
  log('out',msg); if(msg.type==='osc')bus(msg.address,msg.args,'local');
}
function applyWidgets(m,except){
  for(const p of L.pages)for(const w of p.widgets){
    if(w.id===except||!w.addr||w.addr!==m.address)continue;
    if(Object.hasOwn(m,'channel')&&(w.oscChannel||'default')!==m.channel)continue;
    const n=a=>clamp((+a-w.min)/((w.max-w.min)||1)), a0=m.args[0];
    if(w.type==='xy'){if(m.args.length>1){w.value=n(a0);w.valueY=n(m.args[1])}}
    else if(w.type==='button'){w.value=(+a0===w.max||+a0>(w.min+w.max)/2)?1:0}
    else if(w.type==='scenes'&&w.mode==='head-select'&&w.addr==='/mh/select/heads'){
      w.selectedHeads=m.args.map(String);w.value=(w.headValues||[]).map(id=>w.selectedHeads.includes(id)?1:0);
    }
    else if(w.type==='scenes'){w.value=w.mode==='multi'?m.args.map(x=>+x>.5?1:0):Math.round(+a0)}
    else if(w.type==='color'){if(m.args.length>2){const [h,s]=rgb2hsv(+m.args[0],+m.args[1],+m.args[2]);w.value={h,s}}}
    else if(['fader','knob','meter'].includes(w.type)&&m.args.length)w.value=n(a0);
    else continue;
    if(p===page())paint(elOf(w.id),w);
  }
}
function receive(m){
  log('in',m);
  if(dmxOutputApplyOsc(m.address,m.args)){G.dirty=true;return}
  applyWidgets(m,null);bus(m.address,m.args,'remote')
}
let dmxOscRequestAt=0;
setInterval(()=>{
  if(G.ok||!ws||ws.readyState!==1||!hello)return;
  const receivedAt=Date.now();
  if(receivedAt-dmxOscRequestAt<10000)return;
  dmxOscRequestAt=receivedAt;
  emit({type:'osc',address:'/dmx/output/osc',args:[1]},true);
},1000);
let count=0; setInterval(()=>{$('#rate').textContent=count+' msg/s';count=0},1000);
function log(dir,m){
  count++;
  const t=`${m.address}  ${m.args.map(a=>typeof a==='number'?fmt(a):a).join('  ')}`;
  const cell=dir==='out'?$('#cOut'):$('#cIn'); (dir==='out'?$('#mOut'):$('#mIn')).textContent=t;
  cell.classList.add('flash'); clearTimeout(cell._t); cell._t=setTimeout(()=>cell.classList.remove('flash'),90);
}
