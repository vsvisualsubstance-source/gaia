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
// menu Strumenti del Palco: i comandi stanno nei pulsanti nascosti, stesso percorso di prima
async function stageTools(el){
  const btns=[...el.querySelectorAll('.seg-more button')];
  const act=await uiChoose('Strumenti del palco',btns.map(b=>({label:b.textContent,value:b.dataset.act})));
  if(act)el.querySelector(`.seg-more [data-act="${act}"]`)?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
}
async function syncAllFixtures(){
  const list=(L.fixtures||[]).filter(f=>FIX_TYPES[f.type].ch);
  if(!list.length){alert('Nessuna fixture patchabile da mandare (wall/speaker sono esclusi, TD li salta).');return}
  // prima i modelli: una fixture con un modello che TD non conosce verrebbe rifiutata
  if(tdCatalogKnown()){
    const d=projModelDiff(),miss=d.filter(x=>x.state==='missing').map(x=>x.name),unk=d.filter(x=>x.state==='unknown').map(x=>x.name);
    if(unk.length&&!await uiConfirm(`DMX Master non conosce ${unk.join(', ')} e il progetto non ne ha la definizione: quelle fixture verranno rifiutate. Mandare comunque le altre?`))return;
    if(miss.length){
      if(!await alignProjectModels({only:'missing',ask:false}))return;
    }
  }
  let sent=0;
  for(const f of list){
    // on_conflict:"reject" (nota TD 20): se l'indirizzo e' occupato NON
    // scrive, torna un errore leggibile in status.last_error col
    // suggerimento -- meglio di scrivere comunque e aggiungere un
    // altro doppione (come successo ieri, 19+ gruppi).
    const ok=devCmd(dmxId(),{action:'set',param:f._synced?'dmx_fixture_update':'dmx_fixture_add',
      value:{...fixtureTdValue(f),on_conflict:'reject'}});
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
async function resolveDuplicates(){
  if(!await uiConfirm('Chiede a DMX Master di togliere i doppioni e sistemare gli indirizzi sovrapposti, poi ricarica il palco da li\'. Continuare?'))return;
  const reqId='p-'+uid();
  const ok=devCmd(dmxId(),{action:'set',param:'dmx_patch_resolve',value:{request_id:reqId,apply:true}});
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
async function syncTypesToTD(){
  if(!await uiConfirm('Manda la tassonomia di Plancia (tipi di fixture) a DMX Master: SOSTITUISCE tutti i tipi già definiti lì. Continuare?'))return;
  const types=Object.entries(FIX_TYPES).filter(([k])=>k!=='laser').map(([type,ft])=>({
    type,label:ft.label,group:ft.group,kind:ft.kind||'none',model:ft.model
  }));
  const ok=devCmd(dmxId(),{action:'set',param:'dmx_types',value:types});
  if(!ok){alert('Non collegata a Gaia — apri ⋯ → Gaia e collegati prima.');return}
  let tries=0;
  const check=()=>{
    tries++;
    const have=tdTypes();
    if(have.length&&types.every(t=>have.some(h=>h.type===t.type))){
      alert(`Tassonomia confermata da DMX Master (${have.length} tipi).`);return;
    }
    if(tries>=10){
      const err=G.devices[dmxId()]?.last_error;
      alert('Nessuna conferma completa da DMX Master'+(err?' — '+err:' — riprova più tardi.'));return;
    }
    setTimeout(check,500);
  };
  setTimeout(check,500);
}
/* ---------- zoom e spostamento della vista (Pianta e Render) ---------- */
// Per tablet e per sessione (in _stageUI, mai nel layout salvato): ognuno guarda
// dove vuole senza muovere gli altri. Punto a schermo = punto di base * z + (x, y).
// Render: mai piu' piccolo dell'inquadratura intera (z >= 1, senza bordi vuoti).
const SV_MIN={plot:.3,render:1},SV_MAX=12;
const svKind=w=>w.view==='plot'?'plot':'render';
function stageViewOf(w){const ui=_stageUI[w.id]||(_stageUI[w.id]={});ui.views=ui.views||{};const k=svKind(w);return ui.views[k]||(ui.views[k]={z:1,x:0,y:0})}
function svClamp(v,k,W,H){v.z=clamp(v.z,SV_MIN[k],SV_MAX);if(k==='render'){v.x=clamp(v.x,W*(1-v.z),0);v.y=clamp(v.y,H*(1-v.z),0)}}
function svZoomAt(w,px,py,f,W,H){
  const k=svKind(w),v=stageViewOf(w),z2=clamp(v.z*f,SV_MIN[k],SV_MAX);
  v.x=px-(px-v.x)*z2/v.z;v.y=py-(py-v.y)*z2/v.z;v.z=z2;svClamp(v,k,W,H);
}
function svCanvas(el){const c=el.querySelector('canvas'),r=c.getBoundingClientRect();
  return{c,r,W:c.width/(c._d||1),H:c.height/(c._d||1),local:ev=>({x:(ev.clientX-r.left)*(c.width/(c._d||1))/r.width,y:(ev.clientY-r.top)*(c.height/(c._d||1))/r.height})}}
// trascinare = spostare la vista (vuoto della Pianta, qualsiasi punto del Render)
function svPanStart(e,el,w,onTap){
  const ui=_stageUI[w.id]||(_stageUI[w.id]={}),{W,H,local}=svCanvas(el),v=stageViewOf(w),p0=local(e),o={x:v.x,y:v.y};
  const start={x:e.clientX,y:e.clientY};let moved=false;
  e.preventDefault();el.setPointerCapture(e.pointerId);
  el.onpointermove=ev=>{if(ui.pinch)return;if(!moved&&Math.hypot(ev.clientX-start.x,ev.clientY-start.y)>6)moved=true;
    if(moved){const p=local(ev);v.x=o.x+p.x-p0.x;v.y=o.y+p.y-p0.y;svClamp(v,svKind(w),W,H)}};
  el.onpointerup=el.onpointercancel=()=>{el.onpointermove=null;el.onpointerup=el.onpointercancel=null;
    if(!moved&&!ui.pinchDone)onTap?.();ui.pinchDone=false};
}
// rotella e due dita: si collegano una volta sola al canvas del widget
function svBind(el,w){
  // sul widget (non sul canvas): dopo il primo tocco gli eventi del dito vanno al widget
  const c=el.querySelector('canvas');if(!c||el._svBound)return;el._svBound=true;
  c.addEventListener('wheel',e=>{e.preventDefault();const{W,H,local}=svCanvas(el),p=local(e);svZoomAt(w,p.x,p.y,Math.exp(-e.deltaY*.0015),W,H)},{passive:false});
  const ptrs=new Map();let pin=null;
  const ui=()=>_stageUI[w.id]||(_stageUI[w.id]={});
  el.addEventListener('pointerdown',e=>{if(e.target!==c)return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===2){const[a,b]=[...ptrs.values()],{local}=svCanvas(el),v=stageViewOf(w);
      pin={d:Math.hypot(a.x-b.x,a.y-b.y)||1,m:local({clientX:(a.x+b.x)/2,clientY:(a.y+b.y)/2}),v:{...v}};ui().pinch=true;ui().pinchDone=true}},true);
  el.addEventListener('pointermove',e=>{if(!ptrs.has(e.pointerId))return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(!pin||ptrs.size<2)return;const[a,b]=[...ptrs.values()],{W,H,local}=svCanvas(el),k=svKind(w),v=stageViewOf(w);
    const m=local({clientX:(a.x+b.x)/2,clientY:(a.y+b.y)/2}),z2=clamp(pin.v.z*Math.hypot(a.x-b.x,a.y-b.y)/pin.d,SV_MIN[k],SV_MAX);
    // il punto sotto le dita resta sotto le dita (zoom) e le segue (spostamento)
    v.z=z2;v.x=m.x-(pin.m.x-pin.v.x)*z2/pin.v.z;v.y=m.y-(pin.m.y-pin.v.y)*z2/pin.v.z;svClamp(v,k,W,H)},true);
  const end=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2&&pin){pin=null;ui().pinch=false}};
  el.addEventListener('pointerup',end,true);el.addEventListener('pointercancel',end,true);
}
function svButton(el,w,a){const{W,H}=svCanvas(el);if(a==='fit'){const v=stageViewOf(w);v.z=1;v.x=0;v.y=0}else svZoomAt(w,W/2,H/2,a==='in'?1.4:1/1.4,W,H)}

function stageDown(e,el,w){
  const ui=_stageUI[w.id]; const c=el.querySelector('canvas'),r=c.getBoundingClientRect();
  if(!r.width||!ui||!ui.proj)return;
  const toLocal=ev=>({x:(ev.clientX-r.left)*(c.width/c._d)/r.width,y:(ev.clientY-r.top)*(c.height/c._d)/r.height});
  const toM=p=>({x:(p.x-ui.proj.cx)/ui.proj.s,y:(p.y-ui.proj.oy)/ui.proj.s});
  if(planPointer(e,el,toLocal,toM))return;   // planimetria: calibra o sposta
  const p0=toLocal(e);
  const hit=(ui.hits||[]).find(h=>Math.hypot(p0.x-h.x,p0.y-h.y)<=h.r);
  const tdHit=!hit&&(ui.tdHits||[]).find(h=>Math.hypot(p0.x-h.x,p0.y-h.y)<=h.r);
  if(!hit&&!tdHit){svPanStart(e,el,w,()=>openFixAdd(w,toM(p0)));return}   // vuoto: trascina = sposta la vista, tocca = aggiungi
  const start={x:e.clientX,y:e.clientY}; let moved=false; const dragF=hit&&hit.f;
  // blocco: le luci con lo stesso f.block si spostano insieme (colonne, file di barre)
  const mates=dragF?.block?(L.fixtures||[]).filter(x=>x.block===dragF.block).map(x=>({f:x,x:x.x,y:x.y})):null;
  e.preventDefault(); el.setPointerCapture(e.pointerId);
  const mv=ev=>{
    if(ui.pinch)return;   // due dita: zoom, non si sposta la luce
    if(!moved&&Math.hypot(ev.clientX-start.x,ev.clientY-start.y)>6)moved=true;
    if(dragF&&moved){const m=toM(toLocal(ev)),o=toM(p0);
      if(mates){for(const k of mates){k.f.x=clamp(k.x+m.x-o.x,-150,150);k.f.y=clamp(k.y+m.y-o.y,-150,150)}}
      else{dragF.x=clamp(m.x,-150,150);dragF.y=clamp(m.y,-150,150)}/* con la mappa del locale le luci stanno ovunque */}
  };
  const up=()=>{
    el.onpointermove=null;el.onpointerup=el.onpointercancel=null;
    if(ui.pinchDone){ui.pinchDone=false;if(dragF&&moved)save();return}
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
    if(ft.ch&&devCmd(dmxId(),{action:'set',param:'dmx_fixture_add',
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
    ${f.type==='screen'?`<div class="two"><label>Larghezza (m)<input id="feW" type="number" min="0.5" max="40" step="0.1"></label><label>Altezza (m)<input id="feH" type="number" min="0.3" max="20" step="0.1"></label></div>
    <label>Rotazione (gradi)<input id="feRot" type="number" min="-180" max="180" step="5"></label><p class="hint">Altezza dal piano = bordo inferiore dello schermo. Nel Render si illumina quando un proiettore lo punta.</p>`:''}
    ${f.type==='projector'?`<label>Schermo puntato<select id="fePrTarget"><option value="">— nessuno —</option>${(L.fixtures||[]).filter(x=>x.type==='screen').map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>
    <div class="two"><label>Rapporto di tiro <em>distanza / larghezza immagine</em><input id="fePrThrow" type="number" min="0.2" max="10" step="0.05"></label><label>Rotazione senza schermo (gradi)<input id="feRot" type="number" min="-180" max="180" step="5"></label></div><p class="hint" id="fePrInfo"></p>`:''}
    ${f.type==='wall'?`<div class="two"><label>Lunghezza (m)<input id="feW" type="number" min="1" max="20" step="0.1"></label><label>Altezza (m)<input id="feH" type="number" min="0.5" max="10" step="0.1"></label></div>
    <label>Rotazione (gradi)<input id="feRot" type="number" min="-180" max="180" step="5"></label>
    <label>Sorgente LED<select id="feSource"><option value="procedural">Procedurale</option><option value="url">URL video diretto</option><option value="ndi">NDI (via Video Service)</option><option value="file">File (Video Service futuro)</option><option value="rtsp">RTSP (Video Service futuro)</option></select></label>
    <label>Riferimento sorgente (URL o nome NDI)<input id="feSourceRef" spellcheck="false" autocapitalize="off"></label>
    <div class="row" id="feNdiPick" hidden><button class="btn sm ghost" id="feNdiSearch">Cerca sorgenti NDI</button></div>
    <p class="hint">URL diretto: HTTP(S) a un video MP4/H.264 o WebM compatibile col browser (clic sul Render se l'avvio automatico è bloccato). NDI: nome esatto della sorgente, via il Video Service (<code>ops/video-gateway</code>, NDI&rarr;WebRTC). Pagine web, RTSP e file locali non ancora supportati dal Video Service. Audio sempre disattivato.</p>
    <p id="fePreviewStatus" class="hint preview-status" role="status" aria-live="polite"></p>
    <p class="hint">L'altezza dal piano è separata dall'altezza fisica del pannello.</p>`:''}
    ${f.type==='laser'?`<label>LaserCube <em>dal laser gateway (pagina Laser)</em><select id="feCube"></select></label><p class="hint" id="feCubeSt"></p>
    <div class="row"><button class="btn sm" id="feCubeArm">Arma</button><button class="btn sm ghost" id="feCubePage">Pagina Laser</button></div>
    <div class="two"><label>Orientamento (gradi)<input id="feAngle" type="number" min="-180" max="180" step="1"></label><label>Apertura pattern (gradi)<input id="feSpread" type="number" min="1" max="120" step="1"></label></div>
    <p class="hint">Con un cubo collegato il Render mostra i raggi veri: figura e colori che il cubo sta proiettando, attraverso zona e intensità. Orientamento e apertura dicono solo come disegnarli sul palco. Senza cubo resta un disegno di prova.</p>`:''}
    ${FIX_TYPES[f.type].ch?`<label>Gruppo <em>rig di DMX Master · ▦ Gruppi nel Palco</em><select id="feGroup">${groupOptionsHtml(f.group)}</select></label>
    <label>Modello <em>profilo DMX, nota 19</em><span class="md-pick"><select id="feModel"></select><button class="btn sm ghost" id="feModelEdit" title="Canali, colore lampada, ruota colori del modello">✎ Modello</button></span></label>
    <div class="two"><label>Universo<select id="feUni"></select></label><label>Indirizzo<input id="feAddr" type="number" min="1" max="512"></label></div>
    <div class="row"><button class="btn sm ghost" id="feAuto">Primo indirizzo libero (da DMX Master)</button></div>`:''}
    ${fixtureHasPalette(f)?`<label>Unità nel gruppo <em>luci con la stessa unità fanno lo stesso (a specchio); unità diverse vanno ognuna per conto suo e il chase corre dall'una all'altra</em><input id="feUnit" type="number" min="1" max="64" placeholder="1"></label>
    <div class="row"><button class="btn sm ghost" id="feUnitsOwn" title="Unità 1, 2, 3… da sinistra a destra nella Pianta">Gruppo: ognuna per conto suo</button><button class="btn sm ghost" id="feUnitsMirror" title="Tutte unità 1">Gruppo: tutte a specchio</button></div>
    <p class="hint" id="feUnitMsg"></p>`:''}
    ${fixtureHasPalette(f)?`<label>Colore <em>palette propria: cambia solo il colore, livello e audio restano quelli del rig</em></label>${paletteChipsHtml(fixturePaletteOf(f),'fePal')}<p class="hint" id="fePalMsg"></p>
    <label>Audio <em>come segue la musica questa luce; livello e colore restano del gruppo</em></label>${audioControlsHtml(fixtureAudioOf(f),fixtureGainOf(f),'feAud')}<p class="hint" id="feAudMsg"></p>`:''}
    <label>Blocco <em>luci con lo stesso blocco si spostano insieme nella Pianta (es. COL1)</em><input id="feBlock" spellcheck="false" autocapitalize="characters"></label>
    ${f.type==='bar'?`<label class="chk"><input id="feVert" type="checkbox"> In piedi (verticale): nel Render la barra sale da "altezza" verso l'alto</label>
    <div class="two"><label>Lunghezza barra (m)<input id="feLen" type="number" min=".2" max="4" step=".05"></label><div class="row"><button class="btn sm ghost" id="feStack" title="Le barre del blocco, in piedi una sopra l'altra in questo punto, a partire dall'altezza di questa">⇕ Impila il blocco</button></div></div>`:''}
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
  if($('#feCube'))bindLaserFixtureEditor(f);
  if($('#feAud')){
    const go=async fields=>{$('#feAudMsg').textContent='Mando a DMX Master…';
      try{const r=await setFixturesAudio([f],fields);$('#feAudMsg').textContent=r.done?'Confermato da DMX Master.':'Salvato in Plancia: la luce non è ancora su DMX Master.'}
      catch(e){$('#feAudMsg').textContent='DMX Master: '+e.message}};
    $('#feAud').querySelectorAll('[data-aud]').forEach(b=>b.onclick=()=>{$('#feAud').querySelectorAll('.pal-chip').forEach(x=>x.classList.toggle('on',x===b));go({audio:b.dataset.aud})});
    const g=document.querySelector('[data-aud-gain="feAud"]');g.oninput=()=>{g.parentElement.querySelector('b').textContent=(+g.value).toFixed(2)};g.onchange=()=>go({audio_gain:+g.value});
  }
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
    // piu' porte sullo stesso universo (nodo Art-Net + Enttec USB, nota TD 53):
    // DMX Master usa quella online, quindi e' l'unica da selezionare (prima
    // restava selezionata l'ultima, l'Enttec spenta)
    const same=opts.filter(u=>u.universe===f.universe),pick=same.find(u=>u.online!==false)||same[0];
    $('#feUni').innerHTML=opts.map(u=>`<option value="${u.universe}"${u===pick?' selected':''}>${esc(u.label||('Universo '+u.universe))}${u.online===false?' · non attiva':''}</option>`).join('');
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
  if($('#feW')){val2('#feW',f.w||(f.type==='screen'?5:6));val2('#feH',f.h||(f.type==='screen'?2.8:3.5));val2('#feRot',f.rot||0)}
  // proiettore: distanza dallo schermo e immagine che ne esce col rapporto di tiro
  const prInfo=()=>{const i=projectorInfo(f);if($('#fePrInfo'))$('#fePrInfo').textContent=i?`Distanza ${i.dist.toFixed(1)} m · immagine larga ${i.img.toFixed(1)} m su schermo da ${(i.screen.w||5).toFixed(1)} m${i.fit<.9?' → più piccola dello schermo: serve un tiro più corto o avvicinarlo':i.fit>1.1?' → esce dallo schermo: serve un tiro più lungo o allontanarlo':' → ok'}`:'Scegli lo schermo che il proiettore punta (aggiungilo prima dalla Pianta).'};
  if($('#fePrTarget')){val2('#fePrTarget',f.target||'');val2('#fePrThrow',f.throw||1.5);val2('#feRot',f.rot||0);prInfo()} $('#feOn').checked=f.enabled!==false;
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
  if($('#feUnit'))val2('#feUnit',f.unit??'');
  val2('#feBlock',f.block||'');if($('#feVert')){$('#feVert').checked=!!f.vertical;val2('#feLen',f.w||(f.vertical?1:1.8))}
  let syncedSnap=f._synced?JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address,unit:f.unit??null}):null;
  const checkDirty=()=>{
    if(!syncedSnap||!$('#feSyncMsg'))return;
    const now=JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address,unit:f.unit??null});
    $('#feSyncMsg').textContent=now!==syncedSnap?'Modifiche non ancora mandate a DMX Master — premi "Aggiorna su DMX Master" per salvarle davvero, altrimenti si perdono al prossimo aggiornamento del palco.':'';
  };
  const upd=()=>{f.name=$('#feName').value.trim()||f.name;
    const z=Number($('#feZ').value);if(Number.isFinite(z))f.z=clamp(z,-5,30);
    if($('#feTruss')){f.mountToTruss=$('#feTruss').checked;$('#feZ').disabled=f.mountToTruss}
    if($('#feGroup')){f.group=$('#feGroup').value.trim();f.universe=+$('#feUni').value||0;f.address=clamp(+$('#feAddr').value||1,1,512)}
    if($('#feUnit')){const u=Math.round(+$('#feUnit').value);if(u>=1)f.unit=Math.min(64,u);else delete f.unit}
    if($('#feW')){f.w=clamp(+$('#feW').value||6,f.type==='screen'?.5:1,f.type==='screen'?40:20);f.h=clamp(+$('#feH').value||3.5,f.type==='screen'?.3:.5,f.type==='screen'?20:10);f.rot=clamp(+$('#feRot').value||0,-180,180)}
    if($('#fePrTarget')){f.target=$('#fePrTarget').value;f.throw=clamp(+$('#fePrThrow').value||1.5,.2,10);f.rot=clamp(+$('#feRot').value||0,-180,180);prInfo()}
    if($('#feSource')){
      f.sourceType=$('#feSource').value;f.sourceRef=$('#feSourceRef').value.trim();
      const hint=$('#fePreviewStatus');hint.textContent=wallPreviewMessage(f);hint.className='hint preview-status';
      $('#feNdiPick').hidden=f.sourceType!=='ndi';
    }
    if($('#feAngle')){f.angle=clamp(+$('#feAngle').value||0,-180,180);f.spread=clamp(+$('#feSpread').value||28,1,120)}
    if($('#feCube')){f.cube=$('#feCube').value||undefined;laserFixtureStatus(f)}
    {const b=$('#feBlock').value.trim().toUpperCase().slice(0,24);if(b)f.block=b;else delete f.block}
    if($('#feVert')){f.vertical=$('#feVert').checked||undefined;if(!f.vertical)delete f.vertical;const w=+$('#feLen').value;if(w>0)f.w=clamp(w,.2,4)}
    f.enabled=$('#feOn').checked; save(); checkDirty()};
  ['feName','feZ','feGroup','feAddr','feUnit','feW','feH','feRot','feSource','feSourceRef','feAngle','feSpread','feCube','fePrTarget','fePrThrow'].forEach(id=>{const n=$('#'+id);if(n){n.addEventListener('input',upd);n.addEventListener('change',upd)}});
  ['feBlock','feVert','feLen'].forEach(id=>{const n=$('#'+id);if(n){n.addEventListener('input',upd);n.addEventListener('change',upd)}});
  if($('#feStack'))$('#feStack').onclick=()=>{upd();if(!f.block){showError('Prima dai un nome al blocco.');return}
    // in ordine di indirizzo: la prima in basso
    const list=(L.fixtures||[]).filter(x=>x.block===f.block&&x.type==='bar').sort((a,b)=>(a.universe-b.universe)||(a.address-b.address));
    const z0=Number.isFinite(+f.z)?+f.z:0,len=f.w||1;
    list.forEach((x,i)=>{x.x=f.x;x.y=f.y;x.vertical=true;x.w=len;x.mountToTruss=false;x.z=+(Math.min(...list.map(y=>+y.z||0),z0)+i*len).toFixed(2)});
    save();showInfo(`${f.block}: ${list.length} barre in piedi, una sopra l'altra.`)};
  $('#feOn').addEventListener('change',upd);if($('#feTruss'))$('#feTruss').addEventListener('change',upd);
  if($('#feNdiSearch'))$('#feNdiSearch').onclick=()=>pickNdiSource(f);
  // unità di tutto il gruppo, poi a DMX Master le luci gia' mandate
  const groupUnits=async own=>{
    const list=(L.fixtures||[]).filter(x=>x.group===f.group&&fixtureHasPalette(x)).sort((a,b)=>(a.x||0)-(b.x||0)||String(a.name).localeCompare(String(b.name)));
    list.forEach((x,i)=>{x.unit=own?i+1:1});save();val2('#feUnit',f.unit);checkDirty();
    const sent=list.filter(x=>x._synced);let ok=0;for(const x of sent)if(devCmd(dmxId(),{action:'set',param:'dmx_fixture_update',value:{...fixtureTdValue(x),on_conflict:'reject'}}))ok++;
    syncedSnap=JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address,unit:f.unit??null});
    $('#feUnitMsg').textContent=`${list.length} luci del gruppo ${own?'ognuna per conto suo (1…'+list.length+')':'a specchio (unità 1)'}${sent.length?` · mandate ${ok}/${sent.length} a DMX Master`:''}.`};
  if($('#feUnitsOwn'))$('#feUnitsOwn').onclick=()=>groupUnits(true);
  if($('#feUnitsMirror'))$('#feUnitsMirror').onclick=()=>groupUnits(false);
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
    const ok=devCmd(dmxId(),{action:'set',param:f._synced?'dmx_fixture_update':'dmx_fixture_add',
      value:{...fixtureTdValue(f),on_conflict:'reject'}});
    if(!ok){$('#feSyncMsg').textContent='Non collegata a Gaia — apri ⋯ → Gaia e collegati prima.';return}
    const btn=$('#feSync'); btn.disabled=true; $('#feSyncMsg').textContent='Mandato, verifico la conferma da DMX Master…';
    let tries=0;
    const check=()=>{
      tries++;
      const list=(G.devices[dmxId()]?.params||{}).dmx_fixtures||[];
      const found=list.find(x=>x.uid===f.id);
      if(found){
        f._synced=true; f.model=found.profile||f.model; save();
        syncedSnap=JSON.stringify({group:f.group,model:f.model,universe:f.universe,address:f.address});
        const rep=((G.devices[dmxId()]?.params||{}).dmx_patch_report||[]).find(x=>x.id===found.id);
        $('#feSyncMsg').textContent='Confermato da DMX Master'+(rep&&rep.status==='conflict'?' — ATTENZIONE: indirizzo in conflitto con un\'altra fixture già patchata.':'.');
        btn.textContent='Aggiorna su DMX Master'; btn.disabled=false; return;
      }
      if(tries>=6){
        const err=G.devices[dmxId()]?.last_error;
        $('#feSyncMsg').textContent='Nessuna conferma da DMX Master'+(err?' — '+err:' — controlla gruppo/profilo/indirizzo (puoi riprovare).');
        btn.disabled=false; return;
      }
      setTimeout(check,500);
    };
    setTimeout(check,500);
  };
  $('#feDel').onclick=()=>{if(f._synced)devCmd(dmxId(),{action:'set',param:'dmx_fixture_remove',value:{id:f.id}});
    L.fixtures=L.fixtures.filter(x=>x.id!==f.id); const ui=_stageUI[w.id];if(ui&&ui.selFix===f.id)ui.selFix=null; save(); closeSheet()};
  s.onpointerdown=e=>{if(e.target===s)closeSheet()};
  $('#feClose').onclick=closeSheet;
}
function val2(sel,v){const n=$(sel);if(n)n.value=v??''}

// c'e' un Render del palco visibile nella pagina? (le anteprime video dei LED wall girano solo allora)
function stageRenderVisible(){return page().widgets.some(w=>w.type==='stage'&&w.view!=='plot')}

/* ---------- tipo di widget: stage (Palco: Render e Pianta, con la barra degli strumenti) ---------- */
registerWidget('stage',{oscAddress:false,
  inspector:{html:w=>`<label>Vista<select id="fView"><option value="render">Render</option><option value="plot">Pianta e patch</option></select></label>
      <h4>Dimensioni reali (m)</h4><div class="two">
        <label>Larghezza palco<input id="stWidth" type="number" min="2" max="60" step="0.1"></label>
        <label>Profondità palco<input id="stDepth" type="number" min="2" max="60" step="0.1"></label>
        <label>Quota piano palco<input id="stFloor" type="number" min="0" max="20" step="0.1"></label>
        <label>Altezza truss<input id="stTruss" type="number" min="1" max="30" step="0.1"></label></div>
      <details><summary>Aree: platea e FOH</summary><div class="two">
        <label>Platea X (centro)<input id="audX" type="number" step="0.1"></label>
        <label>Platea Y (inizio)<input id="audY" type="number" step="0.1"></label>
        <label>Platea larghezza<input id="audW" type="number" min="1" step="0.1"></label>
        <label>Platea profondità<input id="audD" type="number" min="1" step="0.1"></label>
        <label>FOH X (centro)<input id="fohX" type="number" step="0.1"></label>
        <label>FOH Y<input id="fohY" type="number" step="0.1"></label>
        <label>FOH larghezza<input id="fohW" type="number" min="0.5" step="0.1"></label>
        <label>FOH profondità<input id="fohD" type="number" min="0.5" step="0.1"></label></div></details>
      <p class="hint">La Pianta si modifica fuori da “Modifica griglia”: trascina una fixture per spostarla, toccala per le proprietà, tocca uno spazio vuoto per aggiungerne una. Geometria e sorgente LED si salvano automaticamente su OPS. “⇪ TD” è un invio separato e riguarda solo le fixture DMX; LED wall, casse e laser restano gestiti da Plancia.</p>`,
    bind:(w,{on,val})=>{
    val('#fView',w.view);on('#fView',v=>w.view=v,'change');
    const st=L.stage;
    const stageFields=[
      ['#stWidth',st,'width',2,60],['#stDepth',st,'depth',2,60],['#stFloor',st,'floorHeight',0,20],['#stTruss',st,'trussHeight',1,30],
      ['#audX',st.audience,'x',-100,100],['#audY',st.audience,'y',-100,200],['#audW',st.audience,'width',1,200],['#audD',st.audience,'depth',1,200],
      ['#fohX',st.foh,'x',-100,100],['#fohY',st.foh,'y',-100,200],['#fohW',st.foh,'width',.5,50],['#fohD',st.foh,'depth',.5,50]];
    for(const [selector,target,key,min,max] of stageFields){
      val(selector,target[key]);
      $(selector).addEventListener('change',e=>{
        const n=Number(e.target.value);
        if(!Number.isFinite(n)){e.target.value=target[key];return}
        target[key]=clamp(n,min,max);e.target.value=target[key];save();
      });
    }
  }},
  size:[8,6],label:'Palco',showsValue:false,showsAddr:false,
  inner:w=>`<canvas></canvas><div class="seg"><button data-v="render" aria-pressed="${w.view!=='plot'}">Render</button><button data-v="plot" aria-pressed="${w.view==='plot'}">Pianta</button><button data-act="syncall" title="Invia a DMX Master solo le fixture patchabili DMX. È un invio separato dall'autosalvataggio del layout; LED wall escluse.">⇪ TD</button><button data-act="importtd" title="Importa da DMX Master la patch delle sole fixture DMX; le fixture non-DMX restano in Plancia.">⇩ TD</button><button data-act="more" title="Scene, modelli, gruppi, lampade, spazio, AI e pulizia">☰ Strumenti</button><span class="seg-more" hidden><button data-act="replacepatch">⇪ Sostituisci tutta la patch</button><button data-act="resolve" title="Pulisce i doppioni DMX in TD e reimporta la patch; le fixture non-DMX restano in Plancia.">🧹 TD</button><button data-act="scenes" title="Scene di DMX Master: cattura dal vivo con categorie, richiama, ricattura, rinomina, elimina">▣ Scene</button><button data-act="stage-ai" title="Palco da descrizione: lo descrivi a parole, Ollama prepara le fixture nella Pianta">✨ AI</button><button data-act="space" title="Misure di palco, platea, regia e sala: ingombro totale dello show">📐 Spazio</button><button data-act="lamps" title="Lampade a scarica delle teste (iSpot...): accendi e spegni da DMX Master">💡 Lampade</button><button data-act="models" title="Modelli di fixture di DMX Master: canali, colore lampada, ruota colori e gobo delle teste">▤ Modelli</button><button data-act="groups" title="Gruppi DMX (rig di DMX Master): front, back, teste, LED bar, haze, blinder e rig nuovi">▦ Gruppi</button><button data-act="types" title="Invia la tassonomia dei tipi di Plancia a DMX Master (sostituisce quella attuale).">📋 TD</button></span></div><div class="sv-zoom"><button data-zoom="out" title="Allontana (anche rotella o due dita)">−</button><button data-zoom="in" title="Avvicina (anche rotella o due dita)">+</button><button data-zoom="fit" title="Vista intera">⤢</button></div><div class="hud"></div>`,
  mounted:(el,w)=>{sizeCanvas(el);svBind(el,w)},
  // barra in alto: vista e strumenti; nella Pianta trascina e tocca le fixture;
  // nel Render un tocco riprova le anteprime video bloccate dei LED wall
  onPointer(e,el,w){svBind(el,w);const zb=e.target.closest('[data-zoom]');if(zb){svButton(el,w,zb.dataset.zoom);return}
      const b=e.target.closest('[data-v]');if(b){w.view=b.dataset.v;el.querySelectorAll('.seg button').forEach(x=>x.setAttribute('aria-pressed',x===b));save()}
      else if(e.target.closest('[data-act="more"]'))stageTools(el);
      else if(e.target.closest('[data-act="replacepatch"]'))replacePatchInTD();
      else if(e.target.closest('[data-act="syncall"]'))syncAllFixtures();
      else if(e.target.closest('[data-act="importtd"]'))importFromTD();
      else if(e.target.closest('[data-act="resolve"]'))resolveDuplicates();
      else if(e.target.closest('[data-act="types"]'))syncTypesToTD();
      else if(e.target.closest('[data-act="groups"]'))openGroupEditor();
      else if(e.target.closest('[data-act="scenes"]'))openSceneEditor();
      else if(e.target.closest('[data-act="models"]'))openModelEditor();
      else if(e.target.closest('[data-act="lamps"]'))openLampPanel();
      else if(e.target.closest('[data-act="space"]'))openSpaceEditor();
      else if(e.target.closest('[data-act="stage-ai"]'))openStageAI();
      else if(w.view==='plot')stageDown(e,el,w);
      else if(e.target.closest('canvas'))svPanStart(e,el,w,()=>(L.fixtures||[]).forEach(f=>{
        const state=wallVideoPlayers.get(f.id);
        if(f.type==='wall'&&state&&['blocked','error'].includes(state.status))retryWallVideo(f);
      }));
},
  // ogni fotogramma: Render (luci, a tempo con level) o Pianta, e la riga di stato
  tick(el,w,{now,level}){const c=el.querySelector('canvas'),g=c.getContext('2d');if(!c._d)return;g.setTransform(c._d,0,0,c._d,0,0);
      const W=c.width/c._d,H=c.height/c._d;if(w.view==='plot')drawPlot(g,W,H,now,w);
      else{const v=stageViewOf(w);svClamp(v,'render',W,H);g.setTransform(c._d*v.z,0,0,c._d*v.z,c._d*v.x,c._d*v.y);drawRender(g,W,H,now,level);g.setTransform(c._d,0,0,c._d,0,0)}
      const hud=w.view==='plot'?'':`${SH.blackout?'<b>BLACKOUT</b> · ':''}SC ${SH.scene+1} ${esc((tdScenes().length?tdScenes().find(s=>s.index===SH.scene)?.label:dmxOutputFresh()?'':LOOKS[SH.scene]?.n)||'')} · fade ${SH.fade.toFixed(1)}s · chase ${CHASE[SH.chase]||'Off'}${SH.strobe?' · <b>STROBO</b>':''} · ${esc(dmxOutputSummary())}`;
      const h=el.querySelector('.hud');if(h._v!==hud){h.innerHTML=hud;h._v=hud}},
  help:w=>['Palco','Render: come escono le luci (colori reali da DMX Master). Pianta: posizioni e patch, tocca una luce per nome, indirizzo, modello e colore. In alto: 📐 Spazio = misure di palco, platea, regia e sala; ⇪/⇩ TD scambiano la patch, ▣ Scene, ▤ Modelli (libreria), ▦ Gruppi, 💡 Lampade, ✨ AI.']});
