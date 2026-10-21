/* ---------- progetti: nome in barra, finestra Progetti, modifiche non salvate ---------- */
// Il layout corrente si autosalva sempre su OPS; un PROGETTO e' una copia
// con nome (snapshot) che si aggiorna con "Salva". Qui: chip col nome del
// progetto aperto e un pallino quando il layout e' diverso dallo snapshot,
// e la finestra Progetti (salva, salva come, rinomina, duplica, esporta,
// importa, nuovo da modello).
// confronto senza i valori dei controlli (fader, pulsanti) ne' i campi di servizio
const projCompareJson=x=>JSON.stringify(x,(k,v)=>k==='value'||k==='_synced'||k==='_projectId'||k==='_projectName'?undefined:v);
let _projSnapCache={id:null,json:null,ref:null};
function projDirty(){
  if(!L._projectId)return false;
  const snap=store.get('plancia.project.'+L._projectId);if(!snap)return false;
  if(_projSnapCache.id!==L._projectId||_projSnapCache.ref!==snap)_projSnapCache={id:L._projectId,ref:snap,json:projCompareJson(snap)};
  return projCompareJson(L)!==_projSnapCache.json;
}
function updateProjChip(){
  const b=$('#projBtn');if(!b)return;
  const dirty=projDirty(),name=L._projectId?(L._projectName||'(senza nome)'):'Nessun progetto';
  b.querySelector('span').textContent=name;b.classList.toggle('dirty',dirty);b.classList.toggle('none',!L._projectId);
  b.title=L._projectId?`Progetto: ${name}${dirty?' · modifiche non salvate nel progetto (il layout resta comunque autosalvato su OPS)':' · salvato'} · tocca per Progetti`:'Nessun progetto aperto: il layout è autosalvato su OPS. Tocca per salvarlo come progetto.';
}
const projMeta=snap=>snap?`${(snap.fixtures||[]).length} luci · ${(snap.pages||[]).length} pagine${Object.keys(snap.models||{}).length?` · ${Object.keys(snap.models).length} modelli`:''}`:'';
const projDate=t=>t?new Date(t).toLocaleString('it-IT',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
function projRename(id,name){
  const list=projList(),e=list.find(x=>x.id===id);if(!e)return;e.name=name;store.set(PROJKEY,list);
  const snap=store.get('plancia.project.'+id);if(snap){snap._projectName=name;store.set('plancia.project.'+id,snap)}
  if(L._projectId===id){L._projectName=name;save()}
}
function projDuplicate(id){
  const snap=store.get('plancia.project.'+id),e=projList().find(x=>x.id===id);if(!snap||!e)return null;
  const nid='proj-'+uid(),copy=JSON.parse(JSON.stringify(snap));copy._projectId=nid;copy._projectName=`${e.name} (copia)`;
  store.set('plancia.project.'+nid,copy);const list=projList();list.push({id:nid,name:copy._projectName,updated:Date.now()});store.set(PROJKEY,list);
  return nid;
}
function projExport(id){
  const snap=id?store.get('plancia.project.'+id):projSnapshot(),e=projList().find(x=>x.id===id),name=e?.name||L._projectName||'layout';
  const blob=new Blob([JSON.stringify({format:'plancia-project',version:1,name,exported:new Date().toISOString(),layout:snap},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`plancia-${name.replace(/[^\w.-]+/g,'_')}.json`;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
}
function projImportFile(done){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
  inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;
    try{const j=JSON.parse(await f.text()),lay=j.format==='plancia-project'?j.layout:j;
      if(!lay||!Array.isArray(lay.pages)||!lay.pages.length)throw new Error('non è un progetto o un layout della Plancia');
      const name=(j.name||f.name.replace(/\.json$/i,'').replace(/^plancia-/,'')).trim()||'Importato';
      const id='proj-'+uid(),copy=JSON.parse(JSON.stringify(lay));copy._projectId=id;copy._projectName=name;
      store.set('plancia.project.'+id,copy);const list=projList();list.push({id,name,updated:Date.now()});store.set(PROJKEY,list);
      showInfo(`Progetto "${name}" importato: aprilo dall'elenco.`);done&&done()}
    catch(e){showError('Importa progetto: '+e.message)}};
  inp.click();
}
function openProjects(){
  const s=$('#scrim');s.hidden=false;let ask=null; // azione in attesa di conferma (apri con modifiche non salvate)
  const paint=()=>{
    const list=projList().slice().sort((a,b)=>(b.updated||0)-(a.updated||0)),cur=list.find(p=>p.id===L._projectId),dirty=projDirty();
    s.innerHTML=`<div class="sheet pr-sheet" role="dialog" aria-label="Progetti">
      <div class="top"><h3>📁 Progetti</h3><button class="btn ghost" id="prClose">Chiudi</button></div>
      ${ask?`<div class="pr-ask"><b>${esc(ask.text)}</b><div class="row">${ask.buttons.map((b,i)=>`<button class="btn sm ${b.cls||''}" data-ask="${i}">${esc(b.label)}</button>`).join('')}</div></div>`:''}
      <section class="pr-cur">
        ${cur?`<div class="row" style="align-items:center"><input id="prName" value="${esc(cur.name)}" style="flex:1" aria-label="Nome del progetto"><button class="btn sm ghost" id="prRename">Rinomina</button></div>
          <p class="hint">${dirty?'<b class="pr-dirty">● Modifiche non salvate nel progetto</b>':'✓ Tutto salvato nel progetto'} · ultimo salvataggio ${esc(projDate(cur.updated))} · ${esc(projMeta(L))}</p>
          <div class="row"><button class="btn primary" id="prSave"${dirty?'':' disabled'}>💾 Salva</button><button class="btn" id="prSaveAsShow">Salva come…</button><button class="btn ghost" id="prExportCur">⤓ Esporta</button></div>`
        :`<p class="hint"><b>Nessun progetto aperto.</b> Stai lavorando sul layout autosalvato su OPS (${esc(projMeta(L))}). Dagli un nome per ritrovarlo.</p>`}
        <div class="row" id="prSaveAsRow"${cur?' hidden':''}><input id="prNewName" placeholder="Nome del progetto (es. BASE 31/10)" style="flex:1"><button class="btn primary" id="prSaveAs">Salva come nuovo progetto</button></div>
      </section>
      <h4>I tuoi progetti</h4>
      <div class="md-list">${list.length?list.map(p=>{const snap=store.get('plancia.project.'+p.id);return`<div class="md-row${p.id===L._projectId?' pr-on':''}">
        <b>${esc(p.name)}</b><span class="hint">${p.id===L._projectId?'<b>aperto</b> · ':''}${esc(projDate(p.updated))} · ${esc(projMeta(snap))}</span>
        <button class="btn sm" data-open="${p.id}"${p.id===L._projectId?' disabled':''}>Apri</button><button class="btn sm ghost" data-dup="${p.id}" title="Crea una copia">Duplica</button>
        <button class="btn sm ghost" data-exp="${p.id}" title="Scarica il progetto come file .json">⤓</button><button class="btn sm danger" data-del="${p.id}">Elimina</button></div>`}).join(''):'<p class="hint">Nessun progetto salvato.</p>'}</div>
      <div class="row"><button class="btn ghost" id="prImport">⤒ Importa da file…</button></div>
      <h4>Nuovo da modello</h4>
      <div class="md-list">${PROJECT_TEMPLATES.map(t=>`<div class="md-row"><b>🧩 ${esc(t.name)}</b><span class="hint"></span><button class="btn sm" data-tpl="${t.tid}">Crea</button></div>`).join('')}</div>
      <p class="hint">Il layout corrente si salva sempre da solo su OPS (non perdi niente se chiudi). Il progetto è una copia con nome: si aggiorna solo con <b>Salva</b>. ⇪/⇩ TD nel Palco scambiano la patch con DMX Master, non salvano il progetto.</p>
    </div>`;
    const q=sel=>s.querySelector(sel);
    q('#prClose').onclick=closeSheet;
    s.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>{const a=ask;ask=null;a.buttons[+b.dataset.ask].run?.();paint()});
    if(q('#prSave'))q('#prSave').onclick=()=>{projUpdate(L._projectId);showInfo(`Progetto "${L._projectName}" salvato.`);paint();updateProjChip()};
    if(q('#prSaveAsShow'))q('#prSaveAsShow').onclick=()=>{q('#prSaveAsRow').hidden=false;q('#prNewName').focus()};
    if(q('#prRename'))q('#prRename').onclick=()=>{const n=q('#prName').value.trim();if(!n)return;projRename(L._projectId,n);paint();updateProjChip()};
    if(q('#prExportCur'))q('#prExportCur').onclick=()=>{if(projDirty())projExport(null);else projExport(L._projectId)};
    q('#prSaveAs').onclick=()=>{const n=q('#prNewName').value.trim();if(!n){q('#prNewName').focus();return}projSaveAs(n);showInfo(`Progetto "${n}" creato.`);paint();updateProjChip()};
    q('#prNewName').onkeydown=e=>{if(e.key==='Enter')q('#prSaveAs').click()};
    q('#prImport').onclick=()=>projImportFile(paint);
    // apri / nuovo da modello: se il progetto aperto ha modifiche, prima chiedi
    const guard=(label,go)=>{if(!projDirty()){go();return}
      ask={text:`"${L._projectName}" ha modifiche non salvate. ${label}`,buttons:[
        {label:'Salva e continua',cls:'primary',run:()=>{projUpdate(L._projectId);go()}},
        {label:'Continua senza salvare',cls:'danger',run:go},{label:'Annulla'}]};paint()};
    s.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>guard('Aprire l\'altro progetto?',()=>{projLoad(b.dataset.open);closeSheet();updateProjChip()}));
    s.querySelectorAll('[data-tpl]').forEach(b=>b.onclick=()=>guard('Creare un progetto nuovo dal modello?',()=>{
      if(!L._projectId&&!confirm('Il layout attuale non è salvato in un progetto: verrà sostituito. Continuare?'))return;
      projLoadTemplate(b.dataset.tpl);closeSheet();updateProjChip();showInfo('Creato dal modello: dagli un nome da 📁 Progetti per salvarlo.')}));
    s.querySelectorAll('[data-dup]').forEach(b=>b.onclick=()=>{projDuplicate(b.dataset.dup);paint()});
    s.querySelectorAll('[data-exp]').forEach(b=>b.onclick=()=>projExport(b.dataset.exp));
    s.querySelectorAll('[data-del]').forEach(b=>{let armed=false;b.onclick=()=>{if(!armed){armed=true;b.textContent='Conferma';return}
      projDelete(b.dataset.del);paint();updateProjChip()}});
  };
  paint();
}
$('#projBtn').onclick=openProjects;
setInterval(updateProjChip,2000);updateProjChip();
