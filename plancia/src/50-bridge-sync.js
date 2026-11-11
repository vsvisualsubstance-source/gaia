/* ---------- connessione al bridge ---------- */
// bridge collegato (per le modifiche che deve salvare lui, es. le playlist)
function bridgeOnline(){return!!ws&&ws.readyState===1}
function status(){
  const on=ws&&ws.readyState===1;
  $('#conn').classList.toggle('on',on);
  const full=on?`Bridge → ${hello?.targetResolved?.host??hello?.target?.host??C.host}:${hello?.target?.port??C.port}${hello?.dmxMaster?` · ${hello.dmxMaster}`:''}`:'Non connesso · simulazione';
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
  if(m.type==='chase'){G.chaseSt=m.state||null;return} // chase dal vivo nel bridge
  if(m.type==='head_motion'){G.hmSt=m.state||null;return} // stato del motore del movimento teste
  if(m.type==='video'){VIDEO_ST=m.state||null;return} // stato della timeline video dal bridge
  if(m.type==='midi_in'){midiFromBridge(m);return}     // MIDI in ingresso (eseguito dal bridge)
  if(m.type==='audio_state'){auApplyState(m);AU.lastState=m;if(renderRec?.audio)recAudioSync(renderRec.audio,m);return}  // motore audio gaia-audio (Console Audio)
  if(m.type==='audio_tl'){G.audioTlSt=m.state||null;return}  // timeline audio eseguita dal bridge
  if(m.type==='audio_auto'){G.audioAuto=m.state||null;return}  // autoplay della Console Audio (audio-auto.js nel bridge)
  if(m.type==='audio_grid'){auGridUpdate(m);return}  // griglia corretta dal motore
  if(m.type==='audio_playlists'){AU.playlists=Array.isArray(m.playlists)?m.playlists:[];return}  // playlist globali dal bridge
  if(m.type==='audio_error'){showError('Console Audio: '+(m.message||'errore del motore'));return}
  if(m.type==='midi_ports'){MIDI_PORTS=Array.isArray(m.inputs)?m.inputs:[];return}
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
// Conferma dentro la pagina, al posto di confirm() del browser: in Edge kiosk
// a schermo intero (e in alcune app per tablet) il dialogo nativo puo' non
// comparire e rispondere subito "Annulla" (show 31/10: LIVE -> TIMELINE non
// tornava). Promise<boolean>; non usa #scrim, cosi' vale anche sopra un foglio aperto.
// scelta dentro la pagina: Promise<value|null>; con multi le voci si accendono e spengono e
// "done" da' l'elenco (una voce single, es. Togli, risponde subito col suo valore)
function uiChoose(title,items,{multi=false,done='OK',hint=''}={}){
  return new Promise(resolve=>{
    const box=document.createElement('div');box.className='ui-confirm';box.setAttribute('role','dialog');const on=new Set(items.filter(x=>x.on).map(x=>x.value));
    box.innerHTML=`<div class="ui-confirm-card"><p></p><div class="ui-choose">${items.map((it,i)=>`<button class="btn${it.on?' primary':''}${it.cls?' '+it.cls:''}" data-i="${i}"${it.off?' disabled':''}></button>`).join('')}</div>${hint?'<p class="hint"></p>':''}<div class="row"><button class="btn ghost" data-x>Annulla</button>${multi?'<button class="btn primary" data-ok></button>':''}</div></div>`;
    box.querySelector('p').textContent=title;if(hint)box.querySelector('.hint').textContent=hint;if(multi)box.querySelector('[data-ok]').textContent=done;
    box.querySelectorAll('[data-i]').forEach(b=>b.textContent=items[+b.dataset.i].label);
    const end=v=>{box.remove();document.removeEventListener('keydown',key);resolve(v)},key=e=>{if(e.key==='Escape')end(null)};
    box.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-i]');
      if(b){e.preventDefault();if(b.disabled)return;const it=items[+b.dataset.i];if(!multi||it.single){end(it.value);return}
        if(on.has(it.value))on.delete(it.value);else on.add(it.value);b.classList.toggle('primary',on.has(it.value));return}
      if(e.target.closest('[data-ok]')){e.preventDefault();end(items.filter(x=>on.has(x.value)).map(x=>x.value));return}
      if(e.target.closest('[data-x]')||e.target===box){e.preventDefault();end(null)}});
    document.addEventListener('keydown',key);document.body.appendChild(box);
  });
}
// alert del browser: mai bloccante, nei kiosk puo' non comparire; diventa il messaggio della pagina
window.alert=m=>showInfo(String(m));
// testo da scrivere, dentro la pagina: Promise<stringa|null>
function uiPrompt(title,value='',{ok='OK'}={}){
  return new Promise(resolve=>{
    const box=document.createElement('div');box.className='ui-confirm';box.setAttribute('role','dialog');
    box.innerHTML=`<div class="ui-confirm-card"><p></p><input class="ui-input"><div class="row"><button class="btn ghost" data-x>Annulla</button><button class="btn primary" data-ok></button></div></div>`;
    box.querySelector('p').textContent=title;box.querySelector('[data-ok]').textContent=ok;const inp=box.querySelector('input');inp.value=value;
    const end=v=>{box.remove();resolve(v)};
    inp.onkeydown=e=>{if(e.key==='Enter')end(inp.value.trim()||null);else if(e.key==='Escape')end(null)};
    box.addEventListener('pointerdown',e=>{if(e.target.closest('[data-ok]')){e.preventDefault();end(inp.value.trim()||null)}else if(e.target.closest('[data-x]')||e.target===box){e.preventDefault();end(null)}});
    document.body.appendChild(box);inp.focus();inp.select();
  });
}
function uiConfirm(text,{ok='OK',cancel='Annulla'}={}){
  return new Promise(resolve=>{
    const box=document.createElement('div');box.className='ui-confirm';box.setAttribute('role','alertdialog');
    box.innerHTML=`<div class="ui-confirm-card"><p></p><div class="row"><button class="btn ghost" data-v="0"></button><button class="btn primary" data-v="1"></button></div></div>`;
    box.querySelector('p').textContent=text;box.querySelector('[data-v="0"]').textContent=cancel;box.querySelector('[data-v="1"]').textContent=ok;
    const done=v=>{box.remove();document.removeEventListener('keydown',key);resolve(v)};
    const key=e=>{if(e.key==='Escape')done(false);else if(e.key==='Enter')done(true)};
    box.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-v]');if(b){e.preventDefault();done(b.dataset.v==='1')}else if(e.target===box)done(false)});
    document.addEventListener('keydown',key);document.body.appendChild(box);box.querySelector('[data-v="1"]').focus();
  });
}
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
