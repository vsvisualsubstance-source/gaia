/* ---------- test canali: forzare qualche canale DMX per provare una luce nuova (nota TD 71) ---------- */
// Come il channel check di una console. dmx_channel_test {port_id, values:{indirizzo:valore}, ttl}
// forza quei canali SOPRA tutto (anche il blackout) fino alla scadenza; ogni scrittura
// sostituisce il test precedente; null lo spegne. Lettura: {port_id, values, until_ms} | null.
// Serve a trovare l'ordine dei canali di una luce senza toccare il catalogo.
const CT={port:null,start:1,count:8,ttl:120,vals:{},fix:null,timer:null};
function ctPorts(){const p=G.dxm['td-dmx-win']?.patch?.ports;return Array.isArray(p)?p.filter(x=>x.kind!=='usb'||x.online==='1'):[]}
function ctState(){const s=tdParams().dmx_channel_test;return s&&typeof s==='object'&&s.values&&Object.keys(s.values).length?s:null}
const ctMax=()=>+G.dxm['td-dmx-win']?.patch?.channel_test?.ttl_max_s||600;
// luci in patch sulla porta: per riempire indirizzo e numero di canali e dare un nome ai canali
function ctFixtures(){return(tdParams().dmx_fixtures||[]).filter(f=>f.port_id===CT.port&&+f.address>0)}
function ctChannelName(addr){
  for(const f of ctFixtures()){const m=tdModels().find(x=>x.model===f.profile),n=addr-f.address;
    if(m&&n>=0&&n<(m.channels||[]).length)return`${f.name} · ${m.channels[n]}`}
  return'';
}
function ctSend(){
  clearTimeout(CT.timer);CT.timer=setTimeout(()=>{
    const values=Object.fromEntries(Object.entries(CT.vals).filter(([a])=>+a>=CT.start&&+a<CT.start+CT.count).map(([a,v])=>[a,Math.round(v)]));
    if(!CT.port){showError('Test canali: scegli la porta.');return}
    if(!devCmd('td-dmx-win',{action:'set',param:'dmx_channel_test',value:{port_id:CT.port,values,ttl:CT.ttl}}))showError('Test canali: non collegata a Gaia.');
  },100);
}
function ctOff(){CT.vals={};clearTimeout(CT.timer);devCmd('td-dmx-win',{action:'set',param:'dmx_channel_test',value:null})}
function ctStatusText(){
  const s=ctState();if(!s)return'spento: le luci seguono la patch';
  const left=Math.max(0,Math.round(((+s.until_ms||0)-Date.now())/1000)),n=Object.keys(s.values).length;
  return`▶ attivo su ${s.port_id}: ${n} canal${n===1?'e':'i'} forzat${n===1?'o':'i'}, scade tra ${left} s`;
}
function paintChannelTest(el,w,force){
  const box=el.querySelector('.ct');if(!box)return;
  const ports=ctPorts();if(!CT.port||!ports.some(p=>p.port_id===CT.port))CT.port=ports.find(p=>p.online==='1')?.port_id||ports[0]?.port_id||null;
  const st=box.querySelector('.ct-st');if(st){const t=ctStatusText();if(st.textContent!==t){st.textContent=t;st.classList.toggle('on',t.startsWith('▶'))}}
  const sig=JSON.stringify([ports.map(p=>[p.port_id,p.online]),CT.port,CT.start,CT.count,CT.ttl,ctFixtures().map(f=>[f.name,f.address,f.profile])]);
  if(!force&&box._sig===sig)return;box._sig=sig;
  if(!ports.length){box.innerHTML='<p class="hint">DMX Master non pubblica le porte di uscita (dmx_matrix.patch.ports): Gaia collegata?</p>';return}
  const fx=ctFixtures(),chans=Array.from({length:CT.count},(_,i)=>CT.start+i).filter(a=>a<=512);
  box.innerHTML=`<div class="ct-top">
      <label>Porta<select data-ct="port">${ports.map(p=>`<option value="${esc(p.port_id)}"${p.port_id===CT.port?' selected':''}>${esc(p.label||p.port_id)}${p.online==='1'?'':' (offline)'}</option>`).join('')}</select></label>
      <label>Dal canale<input data-ct="start" type="number" min="1" max="512" value="${CT.start}" inputmode="numeric"></label>
      <label>Canali<select data-ct="count">${[4,8,12,16].map(n=>`<option${n===CT.count?' selected':''}>${n}</option>`).join('')}</select></label>
      <label>Dura<select data-ct="ttl">${[60,120,300,600].filter(s=>s<=ctMax()).map(s=>`<option value="${s}"${s===CT.ttl?' selected':''}>${s<120?s+' s':s/60+' min'}</option>`).join('')}</select></label>
      ${fx.length?`<label>Luce in patch<select data-ct="fix"><option value="">—</option>${fx.map(f=>`<option value="${esc(f.uid)}"${f.uid===CT.fix?' selected':''}>${esc(f.name)} · ${f.address} · ${esc(f.profile)}</option>`).join('')}</select></label>`:''}
    </div>
    <div class="ct-act"><button class="btn sm" data-ct-act="all">Tutti 255</button><button class="btn sm" data-ct-act="zero">Tutti 0</button>
      <button class="btn sm danger" data-ct-act="off">■ Spegni test</button><span class="ct-st hint"></span></div>
    <p class="hint warn">Forza i canali sopra tutto, anche il blackout e la timeline. Non usarlo durante lo show: alla scadenza tornano da soli alla patch.</p>
    <div class="ct-faders">${chans.map(a=>{const v=CT.vals[a]??0,nm=ctChannelName(a);
      return`<div class="ct-ch"><output>${Math.round(v)}</output><input type="range" orient="vertical" min="0" max="255" step="1" value="${v}" data-ct-ch="${a}"><b>${a}</b><small title="${esc(nm)}">${esc(nm.split(' · ')[1]||'')}</small></div>`}).join('')}</div>`;
  st&&(box.querySelector('.ct-st').textContent=ctStatusText());
  box.oninput=e=>{const c=e.target;
    if(c.dataset.ctCh){const a=+c.dataset.ctCh;CT.vals[a]=+c.value;c.parentElement.querySelector('output').textContent=c.value;ctSend();return}
    if(c.dataset.ct==='start'&&e.type==='change'){CT.start=clamp(Math.round(+c.value||1),1,512);paintChannelTest(el,w,true)}};
  box.onchange=e=>{const c=e.target,k=c.dataset.ct;if(!k)return;
    if(k==='port'){CT.port=c.value;CT.vals={};CT.fix=null}else if(k==='start')CT.start=clamp(Math.round(+c.value||1),1,512);else if(k==='count')CT.count=+c.value;else if(k==='ttl')CT.ttl=+c.value;
    else if(k==='fix'){CT.fix=c.value||null;const f=ctFixtures().find(x=>x.uid===c.value),m=f&&tdModels().find(x=>x.model===f.profile);if(f){CT.start=+f.address;CT.count=[4,8,12,16].find(n=>n>=(m?.footprint||8))||16}}
    paintChannelTest(el,w,true)};
}
function channelTestDown(e,el,w){
  if(e.target.closest('input,select'))return;
  const b=e.target.closest('[data-ct-act]');if(!b)return;e.preventDefault();
  const act=b.dataset.ctAct,chans=Array.from({length:CT.count},(_,i)=>CT.start+i).filter(a=>a<=512);
  if(act==='off'){ctOff();el.querySelectorAll('[data-ct-ch]').forEach(c=>{c.value=0;c.parentElement.querySelector('output').textContent='0'});return}
  const v=act==='all'?255:0;chans.forEach(a=>CT.vals[a]=v);el.querySelectorAll('[data-ct-ch]').forEach(c=>{c.value=v;c.parentElement.querySelector('output').textContent=v});ctSend();
}
registerWidget('chtest',{size:[16,10],label:'Test canali',showsValue:false,showsAddr:false,
  inner:()=>'<div class="ct"></div>',
  onPointer:channelTestDown,
  tick:(el,w,{repaint})=>{if(repaint)paintChannelTest(el,w);const st=el.querySelector('.ct-st');if(st&&ctState()){const t=ctStatusText();if(st.textContent!==t)st.textContent=t}},
  help:()=>['Test canali','Per provare una luce nuova: scegli porta e canale di partenza (o la luce in patch) e muovi un canale alla volta guardando la luce. I canali sono forzati sopra tutto finché non premi "Spegni test" o scade il tempo.']});
// 2026-11-05: pagina "Test canali" nel gruppo Sistema (uiRev 18)
function migrateUiChannelTest(){
  if((L.uiRev||0)>=18)return;
  if(!L.pages.some(p=>p.widgets.some(w=>w.type==='chtest'))){const at=L.pages.findIndex(p=>p.name==='Palco')+1||L.pages.length;L.pages.splice(at,0,TPL.chtest.pages()[0])}
  L.uiRev=18;save();
}
