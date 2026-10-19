/* ---------- disegno dei widget Gaia ---------- */
function gInner(w){
  switch(w.type){
    case 'gaia': return `<div class="ga"><div class="ga-l"><div class="ga-orbw"><canvas></canvas><div class="ga-mood"><b>—</b><span></span></div></div>
      <div class="ga-dims">${DIMS.map(([k,l])=>`<div class="ga-dim"><span>${l}</span><div class="ga-bar"><i data-bar="${k}"></i></div><button data-nudge="${k}" data-d="-1" aria-label="Meno ${l}">−</button><button data-nudge="${k}" data-d="1" aria-label="Più ${l}">+</button></div>`).join('')}</div></div>
      <div class="ga-r"><div class="ga-th"><span class="k">PENSIERO</span><p>—</p></div><div class="ga-chat" aria-live="polite"></div>
      <form class="ga-in"><input type="text" placeholder="Scrivi a Gaia…" aria-label="Messaggio per Gaia" autocomplete="off"><button type="submit">Invia</button></form></div></div>`;
    case 'patchdeck': return `<div class="gw"><div class="gw-h"><i class="dot"></i><b class="gw-n">${esc(w.label)}</b><span class="gw-s"></span><button class="gw-btn" data-deck>Deck</button></div><div class="pd-grid"></div></div>`;
    case 'tddevice': return `<div class="gw"><div class="gw-h"><i class="dot"></i><b class="gw-n">${esc(w.label)}</b><span class="gw-s"></span></div><div class="dv-body"></div></div>`;
    case 'gaiadmx': return `<div class="gw"><div class="gw-h"><i class="dot"></i><b class="gw-n">${esc(w.label)}</b><span class="gw-s"></span><i class="dz-out"></i></div>
      <div class="dv-body"><div class="dz-pal"></div>
        <div class="dv-p"><span>Luminosità</span><div class="dv-sl" data-dz="bright"><i></i></div><span class="dv-v"></span></div>
        <div class="dz-tl"></div>
        <div class="row" style="align-items:center"><button class="gw-btn" data-dz="audio">Audio-reattivo</button><button class="gw-btn" data-dz="blackout">Blackout</button><div class="dz-meter"><i></i></div></div></div></div>`;
  }
  return '';
}
const sliderSet=(el,frac,txt)=>{el.querySelector('i').style.width=clamp(frac)*100+'%';const v=el.parentNode.querySelector('.dv-v');if(v)v.textContent=txt};
function gPaint(el,w){
  if(w.type==='gaia'){
    const m=moodOf();el.style.setProperty('--mc',m.hex);
    el.querySelector('.ga-mood b').textContent=G.canvas||G.brain||G.nr?m.label:'—';
    el.querySelector('.ga-mood span').textContent=G.ok||G.sim?(m.s.lifeIndex!=null?`life index ${Math.round(m.s.lifeIndex)}`:(G.sim?'simulazione':'')):'non collegata';
    DIMS.forEach(([k,,mx])=>{const b=el.querySelector(`[data-bar="${k}"]`);if(b)b.style.width=clamp((+m.s[k]||0)/mx)*100+'%'});
    const th=G.canvas?.thought||G.canvas?.thoughts?.[0]?.text||G.nr?.thought||G.canvas?.lastMemory||'—',p=el.querySelector('.ga-th p');if(p.textContent!==th)p.textContent=th;
    const ch=el.querySelector('.ga-chat');
    if(ch._v!==G.chatV){ch._v=G.chatV;
      ch.innerHTML=G.chat.slice(-14).map(c=>`<div class="msg ${c.who}"><em>${c.who==='gaia'?'GAIA':c.who==='tu'?'TU':'VOCE'}${c.room?' · '+esc(c.room):''} · ${new Date(c.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</em>${esc(c.text)}</div>`).join('')||'<p class="dv-empty">Qui compaiono le frasi che dici a Gaia e quelle che lei pronuncia nelle stanze.</p>';
      ch.scrollTop=ch.scrollHeight}
    return;
  }
  if(w.type==='patchdeck'){
    const id=pickDev(w,'patchdeck'),d=G.devices[id],deck=(w.deck||'a').toLowerCase();
    el.querySelector('.dot').className='dot '+devDot(d);
    el.querySelector('.gw-s').textContent=id?`${d?.name||id}${d?.stanza?' · '+d.stanza:''}`:(G.ok||G.sim)?'nessun PatchDeck pubblicato':'Gaia non collegata';
    const svc=G.pdm[id]?.services;
    const list=svc?Object.entries(svc).filter(([,s])=>s.kind==='load_patch'&&String(s.deck).toLowerCase()===deck).map(([key,s])=>({key,patch:s.patch})).sort((a,b)=>a.patch-b.patch)
      :Array.from({length:38},(_,i)=>({key:`load_x${i+1}_${deck}`,patch:i+1}));
    const tk=svc?(Object.entries(svc).find(([,s])=>s.kind==='deck_toggle'&&String(s.deck).toLowerCase()===deck)?.[0]||'deck_'+deck):'deck_'+deck;
    const st=d?.services||{},grid=el.querySelector('.pd-grid'),sig=list.map(x=>x.key).join();
    if(grid._sig!==sig){grid._sig=sig;const n=list.length,c=clamp(Math.round(Math.sqrt(n*w.w/Math.max(1,w.h)*1.25)),1,n);
      grid.style.gridTemplateColumns=`repeat(${c},minmax(0,1fr))`;grid.innerHTML=list.map(x=>`<div class="pd-c" data-svc="${esc(x.key)}">${x.patch}</div>`).join('')}
    grid.querySelectorAll('.pd-c').forEach(c=>c.classList.toggle('on',st[c.dataset.svc]==='active'));
    const b=el.querySelector('[data-deck]'),on=st[tk]==='active';b.dataset.deck=tk;b.dataset.state=on?'1':'0';
    b.textContent=`Deck ${deck.toUpperCase()} · ${on?'ON':'OFF'}`;b.classList.toggle('on',on);
    return;
  }
  if(w.type==='tddevice'){
    const id=pickDev(w,w.fam||''),d=G.devices[id];
    el.querySelector('.dot').className='dot '+devDot(d);
    el.querySelector('.gw-s').textContent=id?`${d?.name||id} · ${FAM_IT[gFam(id,d)]||gFam(id,d)||'device'}${d?.stanza?' · '+d.stanza:''}`:'';
    const body=el.querySelector('.dv-body');
    if(!id){body._sig='';body.innerHTML=`<p class="dv-empty">${(G.ok||G.sim)?`Nessun device ${esc(FAM_IT[w.fam]||'')} ha ancora pubblicato il proprio stato.`:'Gaia non è collegata. Imposta il broker in ⋯ → Gaia.'}</p>`;return}
    const ps=devParams(id),sv=devServices(id),sig=JSON.stringify([id,sv,ps.map(p=>[p.n,p.options||null,p.labels||null])]);
    if(body._sig!==sig){body._sig=sig;
      body.innerHTML=(sv.length?`<div class="dv-svc">${sv.map(k=>`<button class="chip" data-svc="${esc(k)}">${esc(k.replace(/_/g,' '))}</button>`).join('')}</div>`:'')+
        ps.map(p=>p.options?`<div class="dv-p"><span>${esc(p.label)}</span><div class="dv-opts">${p.options.map((o,i)=>`<button class="chip" data-par="${esc(p.n)}" data-opt="${esc(o)}" data-opt-type="${typeof o}">${esc(p.labels?.[i]??o)}</button>`).join('')}</div><span></span></div>`
          :`<div class="dv-p"><span title="${esc(p.n)}">${esc(p.label)}</span><div class="dv-sl" data-par="${esc(p.n)}" data-min="${p.min}" data-max="${p.max}"><i></i></div><span class="dv-v"></span></div>`).join('')||'<p class="dv-empty">Il device non espone servizi o parametri.</p>'}
    const st=d?.services||{},pv=d?.params||{};
    body.querySelectorAll('.chip[data-svc]').forEach(c=>c.classList.toggle('on',st[c.dataset.svc]==='active'));
    body.querySelectorAll('.chip[data-opt]').forEach(c=>c.classList.toggle('on',String(pv[c.dataset.par])===c.dataset.opt));
    body.querySelectorAll('.dv-sl').forEach(s=>{if(s===el._drag)return;const v=+pv[s.dataset.par],mn=+s.dataset.min,mx=+s.dataset.max;
      sliderSet(s,isNaN(v)?0:(v-mn)/((mx-mn)||1),isNaN(v)?'—':fmt(v))});
    return;
  }
  if(w.type==='gaiadmx'){
    const room=pickRoom(w),s=G.dmx[room],fx=s?.fixtures?.[w.fixture||s?.default_fixture]||Object.values(s?.fixtures||{})[0];
    el.querySelector('.dot').className='dot '+devDot(s);
    el.querySelector('.gw-s').textContent=room?`${room}${s?.artnet_configured===false?' · Art-Net non configurato':''}`:(G.ok||G.sim)?'nessun DMX di stanza attivo':'Gaia non collegata';
    const out=(fx?.output_rgb||[0,0,0]).map(v=>v/255);el.querySelector('.dz-out').style.setProperty('--s',hex(out));
    const pal=el.querySelector('.dz-pal'),pr=s?.palettes_rgb||{},sig=Object.keys(pr).join();
    if(pal._sig!==sig){pal._sig=sig;pal.innerHTML=Object.entries(pr).map(([n,c])=>`<button class="dz-sw" data-pal="${esc(n)}" style="--s:${hex(c.map(v=>v/255))}">${esc(n)}</button>`).join('')}
    pal.querySelectorAll('.dz-sw').forEach(b=>b.classList.toggle('on',b.dataset.pal===fx?.current_palette));
    const sl=el.querySelector('[data-dz="bright"]');if(sl!==el._drag)sliderSet(sl,fx?.brightness??0,fx?Math.round(fx.brightness*100)+'%':'—');
    const tl=el.querySelector('.dz-tl'),tp=Object.keys(s?.timeline_presets||{}),tsig=tp.join();
    if(tl._sig!==tsig){tl._sig=tsig;tl.innerHTML=tp.length?`<div class="dv-svc">${tp.map(n=>`<button class="chip" data-tl="${esc(n)}">▶ ${esc(n)}</button>`).join('')}<button class="chip" data-tl="">■ Stop</button></div>`:''}
    tl.querySelectorAll('[data-tl]').forEach(c=>c.classList.toggle('on',!!c.dataset.tl&&fx?.timeline_running&&fx?.current_timeline_preset===c.dataset.tl));
    el.querySelector('[data-dz="audio"]').classList.toggle('on',!!fx?.audio_reactive);
    el.querySelector('.dz-meter i').style.width=clamp(s?.audio_level||0)*100+'%';
  }
}
function gOrb(el,t){
  const c=el.querySelector('.ga-orbw canvas');if(!c||!c._d)return;const g=c.getContext('2d');g.setTransform(c._d,0,0,c._d,0,0);
  const W=c.width/c._d,H=c.height/c._d,m=moodOf(),e=clamp((+m.s.energy||50)/100),R=Math.min(W,H)*.36,cx=W/2,cy=H*.44;
  g.clearRect(0,0,W,H);g.globalCompositeOperation='lighter';
  const sp=m.key==='stress'?.0028:m.key==='calm'?.0009:.0016,br=1+.06*Math.sin(t*sp*2);
  glow(g,cx,cy,R*2.1*br,m.rgb,.28+.25*e);
  for(let i=0;i<5;i++){const r=R*(.55+i*.16)*br,a=t*sp*(i%2?1:-1)*(1+i*.2);g.strokeStyle=rgba(m.rgb,.5-i*.08);g.lineWidth=1.2;
    g.beginPath();for(let k=0;k<=64;k++){const th=k/64*Math.PI*2,rr=r*(1+.05*Math.sin(th*(3+i)+a*3));const x=cx+Math.cos(th)*rr,y=cy+Math.sin(th)*rr;k?g.lineTo(x,y):g.moveTo(x,y)}g.stroke()}
  glow(g,cx,cy,R*.55,[1,1,1],.35);glow(g,cx,cy,R*.9,m.rgb,.7);g.globalCompositeOperation='source-over';
}

/* verifica raggiungibilità: MQTT con una connessione di prova, HTTP con fetch no-cors (risponde = raggiungibile) */
async function netTest(n){
  const out=$('#gTestOut');out.hidden=false;
  const row=(k,st,txt)=>`<div class="nt ${st}"><i></i><b>${k}</b><span>${esc(txt)}</span></div>`;
  const res={mqtt:['…','prova in corso'],fb:null,nr:['…','prova in corso'],nrws:['…','prova in corso'],ad:['…','prova in corso']};
  const draw=()=>{out.innerHTML=row('Broker MQTT',...res.mqtt)+(res.fb?row('Fallback',...res.fb):'')+row('Node-RED HTTP',...res.nr)+row('Node-RED WS /gaia',...res.nrws)+row('Gaia Admin',...res.ad)+
    row('OSC → Gaia',ws&&ws.readyState===1?'ok':'warn',ws&&ws.readyState===1?`il bridge di Plancia invia a ${n.osc}:${n.oscPort} (UDP, senza conferma)`:`serve il bridge di Plancia per mandare OSC a ${n.osc}:${n.oscPort}`)};
  draw();
  if(location.protocol==='https:'){const m='da una pagina https il browser blocca ws:// e http:// verso la LAN: apri Plancia dal bridge';res.mqtt=res.nr=res.nrws=res.ad=['ko',m];draw();return}
  const http=(h,p)=>new Promise(r=>{if(!h)return r(['warn','non impostato']);const c=new AbortController(),t=setTimeout(()=>{c.abort();r(['ko',`${h}:${p} non risponde`])},3500);
    fetch(`http://${h}:${p}/`,{mode:'no-cors',signal:c.signal}).then(()=>{clearTimeout(t);r(['ok',`${h}:${p} raggiungibile`])},()=>{clearTimeout(t);r(['ko',`${h}:${p} non raggiungibile`])})});
  const wsT=(url)=>new Promise(r=>{let w;try{w=new WebSocket(url)}catch{return r(['ko','indirizzo non valido'])}const t=setTimeout(()=>{try{w.close()}catch{}r(['ko','nessuna risposta'])},3500);
    w.onopen=()=>{clearTimeout(t);w.close();r(['ok',url+' aperto'])};w.onerror=()=>{clearTimeout(t);r(['ko',url+' rifiutato'])}});
  const mq=h=>new Promise(r=>{if(!h)return r(null);if(!window.mqtt)return r(['warn','libreria MQTT non caricata']);
    let c;try{c=mqtt.connect(`ws://${h}:${n.wsPort}`,{connectTimeout:3500,reconnectPeriod:0})}catch{return r(['ko','indirizzo non valido'])}
    const done=v=>{try{c.end(true)}catch{}r(v)};c.on('connect',()=>done(['ok',`${h}:${n.wsPort} connesso`]));c.on('error',()=>done(['ko',`${h}:${n.wsPort} rifiutato`]));setTimeout(()=>done(['ko',`${h}:${n.wsPort} nessuna risposta`]),4000)});
  [res.mqtt,res.fb,res.nr,res.nrws,res.ad]=await Promise.all([mq(n.broker),mq(n.fallback),http(n.nodered,n.noderedPort),n.nodered?wsT(`ws://${n.nodered}:${n.noderedPort}/gaia`):Promise.resolve(['warn','non impostato']),http(n.admin,n.adminPort)]);
  draw();
}
