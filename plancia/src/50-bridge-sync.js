/* ---------- connessione al bridge ---------- */
function status(){
  const on=ws&&ws.readyState===1;
  $('#conn').classList.toggle('on',on);
  const full=on?`Bridge → ${hello?.target?.host??C.host}:${hello?.target?.port??C.port}`:'Non connesso · simulazione';
  $('#connTxt').textContent=on?'OSC':'OSC · sim';$('#conn').title='Connessione OSC: '+full;
}
function connect(){
  clearTimeout(retry); if(ws){ws.onclose=null;try{ws.close()}catch{}} ws=null; hello=null; status();
  if(!C.url){saveStatus('Bridge non configurato');return}
  try{ws=new WebSocket(C.url)}catch{retry=setTimeout(connect,4000);return}
  ws.onopen=()=>{status();ws.send(JSON.stringify(bridgeCfg()))};
  ws.onclose=()=>{ws=null;status();saveStatus(sharedDirty?'Offline · layout in copia locale':'Server OPS non connesso');retry=setTimeout(connect,3000)};
  ws.onerror=()=>{};
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}
  if(m.type==='laser'){G.laserSt=m.state||null;return} // stato della timeline laser dal bridge
  if(m.type==='video'){VIDEO_ST=m.state||null;return} // stato della timeline video dal bridge
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
  const toast=$('#toast');toast.textContent=message;toast.hidden=false;toast.classList.remove('ok');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true},5000);
}
// stesso toast, bordo verde: esito riuscito
function showInfo(message){showError(message);$('#toast').classList.add('ok')}
function emit(msg,quiet){
  if(ws&&ws.readyState===1)ws.send(JSON.stringify(msg));
  if(quiet)return;
  log('out',msg); if(msg.type==='osc')bus(msg.address,msg.args,'local');
}
// OSC in arrivo (o sparato da un altro widget) sui widget che ascoltano quell'indirizzo
function applyWidgets(m,except){
  for(const[p,w]of oscListeners(m.address)){
    if(w.id===except||w.addr!==m.address)continue;
    if(Object.hasOwn(m,'channel')&&(w.oscChannel||'default')!==m.channel)continue;
    if(widgetType(w.type).receive(w,m.args)&&p===page())paint(elOf(w.id),w);
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
