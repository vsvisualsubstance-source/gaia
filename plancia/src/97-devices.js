// Controller MIDI e schede audio (17/11): una finestra sola, da Impostazioni.
// MIDI: ruolo di ogni porta in ingresso e porta in uscita, scelti qui e ricordati dal bridge
// (devices-config.js, data/devices.json). Schede: master (con riserva), cuffia separata e copia
// per le luci del motore gaia-audio, che le cambia al volo e le ricorda (<cache>/devices.json).
const DEV={midi:null,roles:{},env:{},audio:null,cur:null,open:false,lastMsg:{},asked:0};
function devicesFromBridge(m){
  if(m.type==='devices'){DEV.midi=m.midi;DEV.roles=m.roles||{};DEV.env=m.env||{}}
  else if(m.type==='audio_devices'){DEV.audio=Array.isArray(m.outputs)?m.outputs:[];DEV.cur=m.current||null}
  else if(m.type==='audio_devices_set'){DEV.cur=m.current||DEV.cur}
  if(DEV.open)renderDevices();
}
function devAsk(){emit({type:'devices_get'},true);emit({type:'audio',cmd:'out.list'},true);DEV.asked=Date.now()}
function openDevices(){
  const s=$('#scrim');s.hidden=false;DEV.open=true;
  s.innerHTML=`<div class="sheet dev-sheet" role="dialog" aria-label="Controller MIDI e schede audio">
    <div class="top"><h3>Controller MIDI e schede audio</h3><button class="btn ghost" id="devRefresh">Aggiorna</button><button class="btn ghost" id="devClose">Chiudi</button></div>
    <div id="devBody"><p class="note">Leggo porte e schede…</p></div></div>`;
  const close=()=>{DEV.open=false;s.hidden=true;s.innerHTML=''};
  $('#devClose').onclick=close;$('#devRefresh').onclick=devAsk;
  s.onpointerdown=null;s.onclick=e=>{if(e.target===s)close()};
  devAsk();renderDevices();
}
const devAgo=t=>{if(!t)return'';const s=Math.round((Date.now()-t)/1000);return s<2?'adesso':s<60?`${s} s fa`:s<3600?`${Math.round(s/60)} min fa`:''};
function devMidiIn(m){DEV.lastMsg[m.port]=Date.now();if(DEV.open){const el=document.querySelector(`[data-devlast="${CSS.escape(m.port||'')}"]`);if(el)el.textContent='messaggio '+devAgo(Date.now())}}
// "asio:X|Main (Y" -> [principale, riserva]
const devSplit=v=>{const p=String(v||'').split('|').map(x=>x.trim()).filter(Boolean);return [p[0]||'',p.slice(1).join('|')]};
// il motore sceglie per parte del nome: "Main (Traktor Kontrol Z1" vale per la scheda col nome intero
const devMatch=(list,cur)=>!cur?'':(list.find(d=>d.name===cur)||list.find(d=>d.name.toLowerCase().includes(cur.toLowerCase()))||{name:cur}).name;
function devOpts(list,cur,{none='',noneLabel='Nessuna',auto}={}){
  const names=list.map(d=>d.name);cur=devMatch(list,cur);let o=auto?`<option value="">${esc(auto)}</option>`:`<option value="${none}">${esc(noneLabel)}</option>`;
  // valore salvato che non e' tra le schede viste: resta scelto, segnato
  if(cur&&!names.some(n=>n===cur))o+=`<option value="${esc(cur)}">${esc(cur)} (non trovata ora)</option>`;
  const grp=(k,l)=>{const g=list.filter(d=>d.kind===k);return g.length?`<optgroup label="${l}">${g.map(d=>`<option value="${esc(d.name)}">${esc(d.kind==='asio'?d.name.slice(5):d.name)}${d.channels?` · ${d.channels} ch`:''}${d.rate?` · ${Math.round(d.rate/100)/10} kHz`:''}${d.default?' · predefinita':''}</option>`).join('')}</optgroup>`:''};
  return o+grp('asio','ASIO (bassa latenza)')+grp('windows','Windows');
}
function renderDevices(){
  const b=$('#devBody');if(!b)return;
  const md=DEV.midi,roleOpts=Object.entries(DEV.roles).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('');
  let h=`<section style="border:0;padding:0"><h3 style="font-size:14px">Ingressi MIDI</h3>`;
  if(!md)h+=`<p class="note">Bridge non collegato.</p>`;
  else if(!md.inputs.length)h+=`<p class="note">Nessun controller MIDI collegato a questa macchina. Le porte collegate dopo compaiono da sole.</p>`;
  else h+=`<div class="dev-list">${md.inputs.map(p=>`<div class="dev-row"><div class="dev-name"><b>${esc(p.name)}</b><small>${p.present?(p.open?'collegato':p.role==='off'?'spento':'collegato, non aperto'):'non collegato ora'}${p.role!==p.auto?` · automatico sarebbe: ${esc(DEV.roles[p.auto]||p.auto)}`:''} · <span data-devlast="${esc(p.name)}">${DEV.lastMsg[p.name]?'messaggio '+devAgo(DEV.lastMsg[p.name]):''}</span></small></div>
      <select data-devrole="${esc(p.name)}" aria-label="Ruolo di ${esc(p.name)}">${roleOpts}</select></div>`).join('')}</div>
    <p class="note">Muovi un controllo: accanto al nome compare "messaggio adesso", così capisci quale porta è. Z1 e LPD8 comandano la Console Audio; tutte le porte non spente valgono anche per Impara MIDI.${DEV.env.midiIn?` Il bridge è avviato con MIDI_IN=${esc(DEV.env.midiIn)}: apre solo quelle.`:''}</p>`;
  h+=`</section><section><h3 style="font-size:14px">Uscita MIDI</h3>`;
  if(md){
    h+=`<label>Porta in uscita (ritorno ai controller dei widget)<select id="devOut"><option value="">Automatica${md.outActive&&!md.out?` (adesso: ${esc(md.outActive)})`:''}</option><option value="none">Nessuna</option>${(md.outputs||[]).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}${md.out&&md.out!=='none'&&!(md.outputs||[]).includes(md.out)?`<option value="${esc(md.out)}">${esc(md.out)} (non collegata ora)</option>`:''}</select></label>
      <p class="note">In uso: <b>${esc(md.outActive||'nessuna')}</b>. Automatica = la prima che non è il sintetizzatore di Windows né la Z1/LPD8 della Console. I LED della Z1 vanno da soli sulla porta della Z1.${DEV.env.midiOut?` Il bridge è avviato con MIDI_OUT=${esc(DEV.env.midiOut)}, che vale più di questa scelta.`:''}</p>`;
  }
  h+=`</section><section><h3 style="font-size:14px">Schede audio · Console Audio</h3>`;
  const st=AU.lastState,outs=Array.isArray(st?.outputs)?st.outputs:[];
  if(outs.length)h+=`<div class="dev-list">${outs.map(o=>`<div class="dev-row"><div class="dev-name"><b>${esc({master:'Master',cue:'Cuffia',lights:'Luci',tap:'Luci',network:'Rete VBAN',vban:'Rete VBAN',vban_in:'Ingresso VBAN'}[o.role]||o.role||'uscita')}</b><small>${esc(o.device||'')}${o.rate?` · ${Math.round(o.rate/100)/10} kHz`:''}</small></div><span class="dev-st ${o.ok?'ok':'ko'}">${o.ok?'OK':esc(o.error||'non aperta')}</span></div>`).join('')}</div>`;
  else h+=`<p class="note">${st?'Il motore non riporta uscite.':'Motore audio non collegato.'}</p>`;
  if(DEV.audio&&DEV.cur){
    const [m1,m2]=devSplit(DEV.cur.device),list=DEV.audio;
    h+=`<div class="dev-grid">
      <label>Master<select id="devM1">${devOpts(list,m1,{auto:'Predefinita di Windows'})}</select></label>
      <label>Riserva del master <em>se la prima non c'è</em><select id="devM2">${devOpts(list,m2,{noneLabel:'Nessuna'})}</select></label>
      <label>Cuffia separata <em>con la Z1 in ASIO è sui canali 3-4, qui Nessuna va bene</em><select id="devCue">${devOpts(list.filter(d=>d.kind==='windows'),DEV.cur.cue_device||'')}</select></label>
      <label>Copia per le luci <em>cavo virtuale verso DMX Master, es. CABLE Input</em><select id="devTap">${devOpts(list.filter(d=>d.kind==='windows'),DEV.cur.tap_device||'')}</select></label>
    </div><div class="row"><button class="btn primary" id="devApply">Applica schede</button></div>
    <p class="note">Il motore chiude e riapre le uscite: il suono si ferma per un attimo, i deck restano dove sono. La scelta resta salvata nel motore.</p>`;
  }else h+=`<p class="note">${st?'Leggo le schede dal motore…':'Le schede si scelgono quando il motore audio è acceso.'}</p>`;
  h+=`</section>`;
  const keep=document.activeElement&&b.contains(document.activeElement)?document.activeElement.id:null;
  b.innerHTML=h;
  if(md)for(const p of md.inputs){const sel=b.querySelector(`[data-devrole="${CSS.escape(p.name)}"]`);if(sel)sel.value=p.role}
  const out=$('#devOut');if(out&&md)out.value=md.out||'';
  if(DEV.audio&&DEV.cur){const L=DEV.audio,W=L.filter(d=>d.kind==='windows'),[m1,m2]=devSplit(DEV.cur.device);$('#devM1').value=devMatch(L,m1);$('#devM2').value=devMatch(L,m2);$('#devCue').value=devMatch(W,DEV.cur.cue_device);$('#devTap').value=devMatch(W,DEV.cur.tap_device)}
  b.querySelectorAll('[data-devrole]').forEach(sel=>sel.onchange=()=>{const roles={...(DEV.midi?.inputs||[]).reduce((a,p)=>(a[p.name]=p.role,a),{}),[sel.dataset.devrole]:sel.value};emit({type:'devices_set',midi:{roles}})});
  if(out)out.onchange=()=>emit({type:'devices_set',midi:{out:out.value}});
  const ap=$('#devApply');if(ap)ap.onclick=async()=>{
    const m1=$('#devM1').value,m2=$('#devM2').value,device=[m1,m2].filter(Boolean).join('|')||null;
    const cue=$('#devCue').value||null,tap=$('#devTap').value||null;
    const L=DEV.audio,W=L.filter(d=>d.kind==='windows'),[c1,c2]=devSplit(DEV.cur.device),same=[device===([devMatch(L,c1),devMatch(L,c2)].filter(Boolean).join('|')||null),cue===(devMatch(W,DEV.cur.cue_device)||null),tap===(devMatch(W,DEV.cur.tap_device)||null)];
    if(same.every(Boolean)){showError('Schede già così.');return}
    if(!await uiConfirm('Cambiare le schede del motore audio? Il suono si ferma per un attimo.',{ok:'Applica'}))return;
    emit({type:'audio',cmd:'out.set',device,cue_device:cue,tap_device:tap});
    setTimeout(devAsk,2500);
  };
  if(keep&&document.getElementById(keep))document.getElementById(keep).focus();
}
