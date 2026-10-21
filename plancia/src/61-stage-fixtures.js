/* ---------- interazione pianta/patch (aggiungi, sposta, modifica fixture) ---------- */
// Lavora SOLO su L.fixtures, in locale -- non richiede TD. Vedi
// plancia/GAIA_PLANCIA_INTEGRATION.md "Canale 1b" per come (in futuro)
// questi dati verranno mandati a DMX Master.
// "In base alla configurazione inviamo i dati a TD che crea gli
// oggetti" (richiesto esplicitamente) -- manda TUTTO lo show in un
// colpo invece di una fixture alla volta. Nessun polling di conferma
// per singola fixture qui (troppo lento su molte fixture): il
// riscontro resta il dmx_patch_report che si vede dopo, in TD o nella
// Pianta (tdFixtures()).
async function syncAllFixtures(){
  const list=(L.fixtures||[]).filter(f=>FIX_TYPES[f.type].ch);
  if(!list.length){alert('Nessuna fixture patchabile da mandare (wall/speaker sono esclusi, TD li salta).');return}
  // prima i modelli: una fixture con un modello che TD non conosce verrebbe rifiutata
  if(tdCatalogKnown()){
    const d=projModelDiff(),miss=d.filter(x=>x.state==='missing').map(x=>x.name),unk=d.filter(x=>x.state==='unknown').map(x=>x.name);
    if(unk.length&&!confirm(`DMX Master non conosce ${unk.join(', ')} e il progetto non ne ha la definizione: quelle fixture verranno rifiutate. Mandare comunque le altre?`))return;
    if(miss.length){
      if(!confirm(`Prima mando a DMX Master i modelli del progetto che non ha: ${miss.join(', ')}. Continuare?`))return;
      if(!await alignProjectModels({only:'missing',ask:false}))return;
    }
  }
  let sent=0;
  for(const f of list){
    // on_conflict:"reject" (nota TD 20): se l'indirizzo e' occupato NON
    // scrive, torna un errore leggibile in status.last_error col
    // suggerimento -- meglio di scrivere comunque e aggiungere un
    // altro doppione (come successo ieri, 19+ gruppi).
    const ok=devCmd('td-dmx-win',{action:'set',param:f._synced?'dmx_fixture_update':'dmx_fixture_add',
      value:{id:f.id,type:f.type,name:f.name,group:f.group,model:f.model,universe:f.universe,address:f.address,x:f.x,y:f.y,enabled:f.enabled!==false,...(f.palette!==undefined?{palette:f.palette}:{}),on_conflict:'reject'}});
    if(ok)sent++;
  }
  if(sent)list.forEach(f=>f._synced=true);
  save();
  alert(sent?`Mandate ${sent}/${list.length} fixture a DMX Master (eventuali conflitti sono stati rifiutati, non scritti — controlla con "⇩ TD" o in TD).`:'Non collegata a Gaia — apri ⋯ → Gaia e collegati prima.');
}
// Nota TD 20, "Pulizia di oggi": dmx_patch_resolve con apply:true toglie
// i doppioni (resta la fixture piu' vecchia/nativa di TD) e sposta le
// sovrapposte. Dopo, ricarica SUBITO da TD (importFromTD silenzioso):
// altrimenti Plancia terrebbe ancora in locale gli uid appena tolti e
// il prossimo "Aggiorna" fallirebbe con "fixture non trovata" (lo
// stesso avviso che TD ha scritto nella nota).
function resolveDuplicates(){
  if(!confirm('Chiede a DMX Master di togliere i doppioni e sistemare gli indirizzi sovrapposti, poi ricarica il palco da li\'. Continuare?'))return;
  const reqId='p-'+uid();
  const ok=devCmd('td-dmx-win',{action:'set',param:'dmx_patch_resolve',value:{request_id:reqId,apply:true}});
  if(!ok){alert('Non collegata a Gaia — apri ⋯ → Gaia e collegati prima.');return}
  let tries=0;
  const check=()=>{
    tries++;
    const r=tdParams().dmx_patch_resolve_result;
    if(r&&r.request_id===reqId){
      const n=(r.actions||[]).length;
      importFromTD(true);
      alert(`Risolto: ${n} azioni applicate (rimozioni/spostamenti). Palco ricaricato da DMX Master.`);
      return;
    }
    if(tries>=10){alert('Nessuna conferma da DMX Master entro qualche secondo — riprova più tardi.');return}
    setTimeout(check,500);
  };
  setTimeout(check,500);
}
// Nota 19, punto 1 ("Costruzione del palco"): manda la tassonomia vera
// di Plancia a DMX Master. dmx_types SOSTITUISCE tutta la tassonomia
// (non un merge) -- per questo e' un bottone esplicito, mai automatico
// come l'import fixture della nota 20 (li' Plancia legge soltanto,
// qui scrive sopra quello che TD ha gia').
function syncTypesToTD(){
  if(!confirm('Manda la tassonomia di Plancia (tipi di fixture) a DMX Master: SOSTITUISCE tutti i tipi già definiti lì. Continuare?'))return;
  const types=Object.entries(FIX_TYPES).filter(([k])=>k!=='laser').map(([type,ft])=>({
    type,label:ft.label,group:ft.group,kind:ft.kind||'none',model:ft.model
  }));
  const ok=devCmd('td-dmx-win',{action:'set',param:'dmx_types',value:types});
  if(!ok){alert('Non collegata a Gaia — apri ⋯ → Gaia e collegati prima.');return}
  let tries=0;
  const check=()=>{
    tries++;
    const have=tdTypes();
    if(have.length&&types.every(t=>have.some(h=>h.type===t.type))){
      alert(`Tassonomia confermata da DMX Master (${have.length} tipi).`);return;
    }
    if(tries>=10){
      const err=G.devices['td-dmx-win']?.last_error;
      alert('Nessuna conferma completa da DMX Master'+(err?' — '+err:' — riprova più tardi.'));return;
    }
    setTimeout(check,500);
  };
  setTimeout(check,500);
}
function stageDown(e,el,w){
  const ui=_stageUI[w.id]; const c=el.querySelector('canvas'),r=c.getBoundingClientRect();
  if(!r.width||!ui||!ui.proj)return;
  const toLocal=ev=>({x:(ev.clientX-r.left)*(c.width/c._d)/r.width,y:(ev.clientY-r.top)*(c.height/c._d)/r.height});
  const toM=p=>({x:(p.x-ui.proj.cx)/ui.proj.s,y:(p.y-ui.proj.oy)/ui.proj.s});
  const p0=toLocal(e);
  const hit=(ui.hits||[]).find(h=>Math.hypot(p0.x-h.x,p0.y-h.y)<=h.r);
  const tdHit=!hit&&(ui.tdHits||[]).find(h=>Math.hypot(p0.x-h.x,p0.y-h.y)<=h.r);
  const start={x:e.clientX,y:e.clientY}; let moved=false; const dragF=hit&&hit.f;
  e.preventDefault(); el.setPointerCapture(e.pointerId);
  const mv=ev=>{
    if(!moved&&Math.hypot(ev.clientX-start.x,ev.clientY-start.y)>6)moved=true;
    if(dragF&&moved){const m=toM(toLocal(ev));dragF.x=clamp(m.x,-L.stage.width/2-4,L.stage.width/2+4);dragF.y=clamp(m.y,-2,L.stage.depth+20)}
  };
  const up=()=>{
    el.onpointermove=null;el.onpointerup=el.onpointercancel=null;
    if(dragF&&moved)save();
    else if(dragF&&!moved)openFixEditor(w,dragF);
    else if(!moved&&tdHit)openTdInfo(tdHit.tf);
    else if(!moved)openFixAdd(w,toM(p0));
  };
  el.onpointermove=mv; el.onpointerup=el.onpointercancel=up;
}
function openTdInfo(tf){
  // Solo lettura -- questa fixture esiste già in TD, non è stata creata
  // da Plancia (vedi tdFixtures()). Niente editor, solo info, per non
  // far credere che si possa modificarla da qui senza saperne il
  // protocollo esatto (id numerico di TD, non il nostro uid stringa).
  const s=$('#scrim'); s.hidden=false;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Fixture TD">
    <div class="top"><h3>${esc(tf.name||'Fixture TD '+tf.id)}</h3><button class="btn ghost" id="tiClose">Chiudi</button></div>
    <p class="hint">Già patchata in DMX Master, non creata da Plancia — solo lettura da qui.</p>
    <label>Gruppo<input value="${esc(tf.group||'')}" disabled></label>
    <label>Profilo<input value="${esc(tf.profile||'')}" disabled></label>
    <div class="two"><label>Porta Art-Net<input value="${esc(tf.port_id||'')}" disabled></label><label>Indirizzo<input value="${tf.address??''}" disabled></label></div>
  </div>`;
  s.onpointerdown=e=>{if(e.target===s)closeSheet()};
  $('#tiClose').onclick=closeSheet;
}
function openFixAdd(w,pos){
  const s=$('#scrim'); s.hidden=false;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Aggiungi fixture">
    <div class="top"><h3>Aggiungi fixture</h3><button class="btn ghost" id="faClose">Chiudi</button></div>
    <div class="row" style="flex-wrap:wrap;gap:8px">${Object.entries(FIX_TYPES).map(([k,ft])=>`<button class="btn sm" data-ft="${k}">${esc(ft.label)}</button>`).join('')}</div>
    <p class="hint">Aggiunge la fixture nel punto del palco che hai toccato — potrai spostarla e modificarla dopo.</p>
  </div>`;
  s.querySelectorAll('[data-ft]').forEach(b=>b.onclick=()=>{
    const type=b.dataset.ft, ft=FIX_TYPES[type];
    const universe=type==='bar'?2:type==='wall'?3:1;
    const count=(L.fixtures||[]).filter(x=>x.type===type).length+1;
    // Indirizzo libero: preferisce il dato VERO da TD (dmx_universe_map,
    // tiene conto anche di quello gia' patchato in TD, non solo delle
    // fixture locali di Plancia -- nota 20, evita i doppioni di ieri).
    // Fallback al calcolo solo-locale se non ancora collegata/sincronizzata.
    const fp=footprintFor(type);
    const addr=ft.ch?(freeAddressTD(universe,fp)??nextAddress(type,universe)):0;
    const f=mkFix(type,ft.label.slice(0,3).toUpperCase()+count,clamp(pos.x,-L.stage.width/2-4,L.stage.width/2+4),clamp(pos.y,-2,L.stage.depth+20),universe,addr);
    f.model=typeDefaultModel(type)||f.model; // preferisce il modello che TD ha davvero per questo tipo (nota 19)
    L.fixtures.push(f); (_stageUI[w.id]||(_stageUI[w.id]={})).selFix=f.id; save(); closeSheet();
    // Manda subito con on_conflict:"auto" (nota 20, "per gli inserimenti
    // rapidi"): TD piazza davvero al primo posto libero (autorevole, non
    // la nostra stima) e noi riallineiamo appena arriva la conferma.
    if(ft.ch&&devCmd('td-dmx-win',{action:'set',param:'dmx_fixture_add',
      value:{id:f.id,type:f.type,name:f.name,group:f.group,model:f.model,universe:f.universe,address:f.address,x:f.x,y:f.y,enabled:true,on_conflict:'auto'}})){
      let tries=0;
      const check=()=>{
        tries++;
        const found=(tdParams().dmx_fixtures||[]).find(x=>x.uid===f.id);
        if(found){f._synced=true;f.universe=portIdToUniverse(found.port_id);f.address=found.address;f.model=found.profile||f.model;save();return}
        if(tries<6)setTimeout(check,500);
      };
      setTimeout(check,500);
    }
  });
  s.onpointerdown=e=>{if(e.target===s)closeSheet()};
  $('#faClose').onclick=closeSheet;
}
function openFixEditor(w,f){
  const s=$('#scrim'); s.hidden=false;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Fixture">
    <div class="top"><h3>${esc(FIX_TYPES[f.type].label)}</h3><button class="btn ghost" id="feClose">Chiudi</button></div>
    <label>Nome<input id="feName"></label>
    <label>Altezza dal piano palco (m)<input id="feZ" type="number" min="-5" max="30" step="0.1"></label>
    ${f.type==='mh'||f.type==='laser'?`<label class="chk"><input id="feTruss" type="checkbox"> Segue altezza del truss</label>`:''}
    ${f.type==='wall'?`<div class="two"><label>Lunghezza (m)<input id="feW" type="number" min="1" max="20" step="0.1"></label><label>Altezza (m)<input id="feH" type="number" min="0.5" max="10" step="0.1"></label></div>
    <label>Rotazione (gradi)<input id="feRot" type="number" min="-180" max="180" step="5"></label>
    <label>Sorgente LED<select id="feSource"><option value="procedural">Procedurale</option><option value="url">URL video diretto</option><option value="ndi">NDI (via Video Service)</option><option value="file">File (Video Service futuro)</option><option value="rtsp">RTSP (Video Service futuro)</option></select></label>
    <label>Riferimento sorgente (URL o nome NDI)<input id="feSourceRef" spellcheck="false" autocapitalize="off"></label>
    <div class="row" id="feNdiPick" hidden><button class="btn sm ghost" id="feNdiSearch">Cerca sorgenti NDI</button></div>
    <p class="hint">URL diretto: HTTP(S) a un video MP4/H.264 o WebM compatibile col browser (clic sul Render se l'avvio automatico è bloccato). NDI: nome esatto della sorgente, via il Video Service (<code>ops/video-gateway</code>, NDI&rarr;WebRTC). Pagine web, RTSP e file locali non ancora supportati dal Video Service. Audio sempre disattivato.</p>
    <p id="fePreviewStatus" class="hint preview-status" role="status" aria-live="polite"></p>
    <p class="hint">L'altezza dal piano è separata dall'altezza fisica del pannello.</p>`:''}
    ${f.type==='laser'?`<div class="two"><label>Orientamento (gradi)<input id="feAngle" type="number" min="-180" max="180" step="1"></label><label>Apertura pattern (gradi)<input id="feSpread" type="number" min="1" max="120" step="1"></label></div>
    <p class="hint">Visualizzazione locale, senza comandi OSC/DMX. Il trasporto verso TouchDesigner sarà definito separatamente.</p>`:''}
    ${FIX_TYPES[f.type].ch?`<label>Gruppo <em>rig di DMX Master · ▦ Gruppi nel Palco</em><select id="feGroup">${groupOptionsHtml(f.group)}</select></label>
    <label>Modello <em>profilo DMX, nota 19</em><span class="md-pick"><select id="feModel"></select><button class="btn sm ghost" id="feModelEdit" title="Canali, colore lampada, ruota colori del modello">✎ Modello</button></span></label>
    <div class="two"><label>Universo<select id="feUni"></select></label><label>Indirizzo<input id="feAddr" type="number" min="1" max="512"></label></div>
    <div class="row"><button class="btn sm ghost" id="feAuto">Primo indirizzo libero (da DMX Master)</button></div>`:''}
    ${fixtureHasPalette(f)?`<label>Colore <em>palette propria: cambia solo il colore, livello e audio restano quelli del rig</em></label>${paletteChipsHtml(fixturePaletteOf(f),'fePal')}<p class="hint" id="fePalMsg"></p>`:''}
    <label class="chk"><input id="feOn" type="checkbox"> Attiva</label>
    ${FIX_TYPES[f.type].ch?`<div class="row"><button class="btn" id="feSync">${f._synced?'Aggiorna su DMX Master':'Manda a DMX Master'}</button></div>
    <p class="hint" id="feSyncMsg"></p>`:'<p class="hint">Tipo non patchabile via DMX -- DMX Master lo salta (confermato da TD).</p>'}
    <div class="row"><button class="btn danger" id="feDel">Elimina</button></div>
  </div>`;
  val2('#feName',f.name);val2('#feZ',f.z);
  if($('#feTruss')){$('#feTruss').checked=!!f.mountToTruss;$('#feZ').disabled=!!f.mountToTruss}
  if($('#feSource')){
    val2('#feSource',f.sourceType||'procedural');val2('#feSourceRef',f.sourceRef||'');
    const hint=$('#fePreviewStatus');hint.dataset.wallId=f.id;hint.textContent=wallPreviewMessage(f);
    $('#feNdiPick').hidden=$('#feSource').value!=='ndi';
  }
  if($('#feAngle')){val2('#feAngle',f.angle);val2('#feSpread',f.spread)}
  if($('#fePal'))$('#fePal').querySelectorAll('[data-pal]').forEach(b=>b.onclick=async()=>{
    const name=b.dataset.pal;$('#fePal').querySelectorAll('.pal-chip').forEach(x=>x.classList.toggle('on',x===b));$('#fePalMsg').textContent='Mando a DMX Master…';
    try{const r=await setFixturesPalette([f],name);$('#fePalMsg').textContent=r.done?`Confermato da DMX Master: ${name||'segue il rig'}.`:'Salvato in Plancia: la luce non è ancora su DMX Master ("Manda a DMX Master" qui sotto).'}
    catch(e){$('#fePalMsg').textContent='DMX Master: '+e.message}});
  if($('#feGroup')){
    val2('#feGroup',normGroupName(f.group,groupsOf()));val2('#feAddr',f.address);
    // Universi reali da DMX Master (dmx_universe_map, nota 20) -- solo
    // le porte Art-Net vere. Se non ancora disponibile (offline/mai
    // sincronizzata), ripiega su un'unica opzione col valore attuale,
    // cosi' il campo resta comunque editabile come numero puro.
    const um=universeMap();
    const opts=(um&&um.universes&&um.universes.length)?um.universes:[{universe:f.universe,label:'Universo '+f.universe}];
    $('#feUni').innerHTML=opts.map(u=>`<option value="${u.universe}"${u.universe===f.universe?' selected':''}>${esc(u.label||('Universo '+u.universe))}</option>`).join('');
    if(!opts.some(u=>u.universe===f.universe))$('#feUni').insertAdjacentHTML('afterbegin',`<option value="${f.universe}" selected>Universo ${f.universe} (attuale)</option>`);
  }
  if($('#feModel')){
    // Modelli reali da DMX Master (dmx_models, nota 19), filtrati sul
    // "kind" del tipo -- se il catalogo non e' ancora arrivato (offline
    // o prima connessione) resta solo il modello attuale, editabile
    // comunque creandone uno nuovo.
    const kind=FIX_TYPES[f.type].kind;
    const models=tdModels().filter(m=>!kind||m.kind===kind);
    const current=f.model||typeDefaultModel(f.type)||'';
    let html=models.map(m=>`<option value="${esc(m.model)}"${m.model===current?' selected':''}>${esc(m.model)}${m.complete===false?' (canali da completare)':''}</option>`).join('');
    if(!models.length)html='<option value="">(nessun modello noto a DMX Master)</option>'+html;
    if(current&&!models.some(m=>m.model===current))html+=`<option value="${esc(current)}" selected>${esc(current)} (attuale)</option>`;
    $('#feModel').innerHTML=html+'<option value="__new__">+ Nuovo modello…</option>';
  }
  if($('#feW')){val2('#feW',f.w||6);val2('#feH',f.h||3.5);val2('#feRot',f.rot||0)} $('#feOn').checked=f.enabled!==false;
  // Rilevamento modifiche non mandate (bug reale trovato il 2026-10-16:
  // spostare l'universo nell'editor sembrava "non salvare" -- in realta'
  // salvava SOLO in locale, l'indirizzo restava quello vecchio (valido
  // nell'universo di prima, quasi sempre in conflitto nel nuovo), TD
  // rifiutava la scrittura (on_conflict:"reject") e il prossimo
  // auto-import da TD (fonte unica, nota 20) riportava tutto com'era
  // prima senza che fosse chiaro il perche'. Instantanea dei campi che
  // contano per TD al momento dell'apertura, confrontata ad ogni
  // modifica: se diverge e la fixture era gia' sincronizzata, avviso
  // subito -- non solo dopo aver premuto "Aggiorna" e aspettato l'esito.
  let syncedSnap=f._synced?JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address}):null;
  const checkDirty=()=>{
    if(!syncedSnap||!$('#feSyncMsg'))return;
    const now=JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address});
    $('#feSyncMsg').textContent=now!==syncedSnap?'Modifiche non ancora mandate a DMX Master — premi "Aggiorna su DMX Master" per salvarle davvero, altrimenti si perdono al prossimo aggiornamento del palco.':'';
  };
  const upd=()=>{f.name=$('#feName').value.trim()||f.name;
    const z=Number($('#feZ').value);if(Number.isFinite(z))f.z=clamp(z,-5,30);
    if($('#feTruss')){f.mountToTruss=$('#feTruss').checked;$('#feZ').disabled=f.mountToTruss}
    if($('#feGroup')){f.group=$('#feGroup').value.trim();f.universe=+$('#feUni').value||0;f.address=clamp(+$('#feAddr').value||1,1,512)}
    if($('#feW')){f.w=clamp(+$('#feW').value||6,1,20);f.h=clamp(+$('#feH').value||3.5,.5,10);f.rot=clamp(+$('#feRot').value||0,-180,180)}
    if($('#feSource')){
      f.sourceType=$('#feSource').value;f.sourceRef=$('#feSourceRef').value.trim();
      const hint=$('#fePreviewStatus');hint.textContent=wallPreviewMessage(f);hint.className='hint preview-status';
      $('#feNdiPick').hidden=f.sourceType!=='ndi';
    }
    if($('#feAngle')){f.angle=clamp(+$('#feAngle').value||0,-180,180);f.spread=clamp(+$('#feSpread').value||28,1,120)}
    f.enabled=$('#feOn').checked; save(); checkDirty()};
  ['feName','feZ','feGroup','feAddr','feW','feH','feRot','feSource','feSourceRef','feAngle','feSpread'].forEach(id=>{const n=$('#'+id);if(n){n.addEventListener('input',upd);n.addEventListener('change',upd)}});
  $('#feOn').addEventListener('change',upd);if($('#feTruss'))$('#feTruss').addEventListener('change',upd);
  if($('#feNdiSearch'))$('#feNdiSearch').onclick=()=>pickNdiSource(f);
  // Universo: cambiarlo da solo non basta, l'indirizzo scelto per
  // l'universo vecchio quasi sempre collide nel nuovo -- ricalcola
  // SUBITO il primo indirizzo libero reale (da TD) per l'universo
  // appena scelto, cosi' "Aggiorna" ha gia' una coppia universo/
  // indirizzo valida invece di uno quasi certamente da rifiutare.
  if($('#feUni'))$('#feUni').addEventListener('change',()=>{
    const u=+$('#feUni').value||f.universe;
    const a=freeAddressTD(u,footprintFor(f));
    if(a!=null)$('#feAddr').value=a;
    upd();
  });
  if($('#feAuto'))$('#feAuto').onclick=()=>{
    const a=freeAddressTD(+$('#feUni').value||f.universe,footprintFor(f));
    if(a==null){alert('Nessuno spazio libero trovato per questo universo (o DMX Master non ha ancora mandato la mappa — prova a collegarti prima).');return}
    $('#feAddr').value=a; upd();
  };
  // Modello (nota 19): "+ Nuovo modello..." crea un modello vero su DMX
  // Master (dmx_model_add) invece di lasciar scrivere un nome a caso che
  // TD non riconoscerebbe mai -- stessa conferma-per-presenza delle
  // fixture, non ancora cliccato = non ancora creato.
  if($('#feModel'))$('#feModel').addEventListener('change',e=>{
    if(e.target.value!=='__new__'){f.model=e.target.value||f.model; save(); checkDirty(); return}
    // nota 34: l'editor dei modelli al posto dei due prompt (nome, canali)
    e.target.value=f.model||'';
    openModelForm(null,{kind:FIX_TYPES[f.type].kind||'chase',back:()=>{closeSheet();openFixEditor(w,f)},onDone:name=>{f.model=name;save();closeSheet();openFixEditor(w,f)}});
  });
  if($('#feModelEdit'))$('#feModelEdit').onclick=()=>{
    const m=tdModels().find(x=>x.model===(f.model||$('#feModel').value));
    if(!m){showError('Modello non nel catalogo di DMX Master (collegati a Gaia, o scegline uno).');return}
    openModelForm(m,{back:()=>{closeSheet();openFixEditor(w,f)},onDone:()=>{closeSheet();openFixEditor(w,f)}});
  };
  // Canale 1b, confermato dal vivo da TD (GAIA_TD_INTEGRATION.md, note
  // interface 17/18): dmx_fixture_add/dmx_fixtures accettano la
  // fixture Plancia COSI' COM'E' -- id stringa (il loro uid), universe
  // tradotto in port_id, group mancante dedotto dal type. wall/speaker
  // saltati (bottone nemmeno mostrato, vedi sopra).
  // _synced si marca SOLO dopo aver visto f.id comparire come uid in
  // dmx_fixtures -- TD manda sempre 200/ok anche se il comando viene
  // rifiutato (gruppo/profilo/indirizzo invalido), quindi segnare
  // _synced sull'invio e basta faceva credere riuscito un comando
  // scartato, e il successivo "Aggiorna" falliva con "fixture non
  // trovata" (bug trovato da TD, non qui).
  if($('#feSync'))$('#feSync').onclick=()=>{
    // on_conflict:"reject" (nota 20): dall'editor, dove l'indirizzo e'
    // scelto a mano, un conflitto deve dare un errore leggibile (con
    // suggerimento) invece di scrivere comunque sopra un'altra fixture.
    const ok=devCmd('td-dmx-win',{action:'set',param:f._synced?'dmx_fixture_update':'dmx_fixture_add',
      value:{id:f.id,type:f.type,name:f.name,group:f.group,model:f.model,universe:f.universe,address:f.address,x:f.x,y:f.y,enabled:f.enabled!==false,...(f.palette!==undefined?{palette:f.palette}:{}),on_conflict:'reject'}});
    if(!ok){$('#feSyncMsg').textContent='Non collegata a Gaia — apri ⋯ → Gaia e collegati prima.';return}
    const btn=$('#feSync'); btn.disabled=true; $('#feSyncMsg').textContent='Mandato, verifico la conferma da DMX Master…';
    let tries=0;
    const check=()=>{
      tries++;
      const list=(G.devices['td-dmx-win']?.params||{}).dmx_fixtures||[];
      const found=list.find(x=>x.uid===f.id);
      if(found){
        f._synced=true; f.model=found.profile||f.model; save();
        syncedSnap=JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address});
        const rep=((G.devices['td-dmx-win']?.params||{}).dmx_patch_report||[]).find(x=>x.id===found.id);
        $('#feSyncMsg').textContent='Confermato da DMX Master'+(rep&&rep.status==='conflict'?' — ATTENZIONE: indirizzo in conflitto con un\'altra fixture già patchata.':'.');
        btn.textContent='Aggiorna su DMX Master'; btn.disabled=false; return;
      }
      if(tries>=6){
        const err=G.devices['td-dmx-win']?.last_error;
        $('#feSyncMsg').textContent='Nessuna conferma da DMX Master'+(err?' — '+err:' — controlla gruppo/profilo/indirizzo (puoi riprovare).');
        btn.disabled=false; return;
      }
      setTimeout(check,500);
    };
    setTimeout(check,500);
  };
  $('#feDel').onclick=()=>{if(f._synced)devCmd('td-dmx-win',{action:'set',param:'dmx_fixture_remove',value:{id:f.id}});
    L.fixtures=L.fixtures.filter(x=>x.id!==f.id); const ui=_stageUI[w.id];if(ui&&ui.selFix===f.id)ui.selFix=null; save(); closeSheet()};
  s.onpointerdown=e=>{if(e.target===s)closeSheet()};
  $('#feClose').onclick=closeSheet;
}
function val2(sel,v){const n=$(sel);if(n)n.value=v??''}
