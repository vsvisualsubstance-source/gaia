/* ---------- scene di DMX Master (note TD/Win-PD 26, 28, 37, 39) ---------- */
// Una scena e' una FOTOGRAFIA dello stato live, divisa in categorie:
// rigs (palette, dimmer, colore, kick dei rig), heads (ogni testa: posizione,
// colore, gobo, strobo), groups (accensioni gruppi, blackout), audio
// (sorgente audio dei rig), strobe (strobo generale on/off e Hz).
// Una scena tocca SOLO le sue categorie: nella timeline le scene si
// sommano a strati (cue "colore" + cue "movimento teste"). Le palette sono
// un'altra cosa: un parametro dal vivo del rig, che la scena fotografa.
const SCENE_CATEGORIES=[
  {id:'rigs',label:'Look dei rig'},{id:'heads',label:'Teste mobili'},{id:'groups',label:'Accensioni gruppi'},
  {id:'audio',label:'Sorgente audio'},{id:'strobe',label:'Strobo generale'}];
const sceneCategoriesFrom=matrix=>{const c=matrix?.show?.categories;
  return Array.isArray(c)&&c.length?c.filter(x=>x&&x.id).map(x=>({id:String(x.id),label:String(x.label||x.id)})):SCENE_CATEGORIES};
// il nome e' l'id della scena (cue, /dmx/scene, catalogo): niente
// caratteri che rompono la riga cue della Plancia ("0:10 Nome > scena")
function validateSceneName(name,existing=[],self=null){
  const n=String(name??'').trim();
  if(!n)return'serve un nome';
  if(n.length>32)return'al massimo 32 caratteri';
  if(/[>;\n\r\t]/.test(n))return'niente > ; o a capo nel nome';
  if(existing.some(s=>s!==self&&s.toLowerCase()===n.toLowerCase()))return`"${n}" esiste già`;
  return'';
}
// riassunto per la riga dell'editor: etichette delle categorie attive
const sceneCategoryText=(cats,list=SCENE_CATEGORIES)=>(cats||[]).map(id=>list.find(c=>c.id===id)?.label||id).join(' · ')||'nessuna categoria';

// Comando di scena verso TD e attesa dell'esito: done() vero sul nuovo
// stato pubblicato, oppure un last_error nuovo = rifiutato.
function tdSceneCommand(param,value,done,timeoutMs=6000){
  const dev=()=>G.devices['td-dmx-win']||{},err0=dev().last_error;
  if(!devCmd('td-dmx-win',{action:'set',param,value}))return Promise.reject(new Error('Non collegata a Gaia: apri ⋯ → Gaia e collegati prima.'));
  return new Promise((resolve,reject)=>{
    const t0=Date.now();
    const check=()=>{
      const err=dev().last_error;
      if(err&&err!==err0)return reject(new Error(err));
      if(done())return resolve();
      if(Date.now()-t0>timeoutMs)return reject(new Error('Nessuna conferma da DMX Master entro '+Math.round(timeoutMs/1000)+' s.'));
      setTimeout(check,400);
    };
    setTimeout(check,400);
  });
}
const tdSceneById=id=>tdScenes().find(s=>s.id===id)||null;

function openSceneEditor(){
  const cats=sceneCategoriesFrom(G.dxm['td-dmx-win']),scenes=tdScenes(),active=tdActiveScene(tdParams())?.index;
  const s=$('#scrim');s.hidden=false;
  const checks=(sel,cls)=>cats.map(c=>`<label class="chk"><input type="checkbox" class="${cls}" value="${esc(c.id)}"${sel.includes(c.id)?' checked':''}> ${esc(c.label)}</label>`).join('');
  const rows=scenes.map(sc=>{const look=tdSceneLook(sc),used=(sc.cues||[]).length;
    return`<div class="scn-row${sc.index===active?' on':''}" data-scene="${esc(sc.id)}">
      <div class="scn-head"><span class="scn-sw" style="${look.grad?`background:${look.grad}`:''}"></span>
        <b>${String(sc.index+1).padStart(2,'0')} · ${esc(sc.label||sc.id)}</b>${sc.label&&sc.label!==sc.id?` <span class="mono hint">${esc(sc.id)}</span>`:''}
        <span class="hint">${esc(sceneCategoryText(sc.categories,cats))}${used?` · in ${used} cue`:''}</span></div>
      <div class="row scn-act">
        <button class="btn sm" data-sa="recall" title="Applica ora la scena (dal vivo)">▶ Richiama</button>
        <button class="btn sm" data-sa="recapture" title="Sovrascrive la scena con i valori dal vivo di adesso, solo per le sue categorie">⟳ Ricattura</button>
        <button class="btn sm ghost" data-sa="edit" title="Nome, etichetta e categorie">✎ Modifica</button>
        <button class="btn sm danger" data-sa="delete"${used?` disabled title="Usata da ${used} cue: toglila prima dalla timeline"`:' title="Elimina la scena"'}>×</button>
      </div>
      <div class="scn-edit" hidden>
        <div class="two"><label>Nome (id)<input class="se-name" value="${esc(sc.id)}"></label><label>Etichetta<input class="se-label" value="${esc(sc.label||'')}"></label></div>
        <div class="scn-cats">${checks(sc.categories||[],'se-cat')}</div>
        <div class="row"><button class="btn sm primary" data-sa="save">Salva modifiche</button></div>
      </div>
    </div>`}).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Scene di DMX Master">
    <div class="top"><h3>Scene · DMX Master</h3><button class="btn ghost" id="scnClose">Chiudi</button></div>
    <p class="hint">Una scena è una <b>fotografia</b> dello stato dal vivo, per categorie. Prepara il look con i controlli della Plancia (palette, fader, teste, strobo), poi catturalo. Una scena tocca solo le sue categorie: nella timeline una cue "colore" (Look dei rig) e una cue "teste" (Teste mobili) si sommano. Il movimento delle teste si fa con cue in sequenza e fade lunghi fra scene "solo teste" in posizioni diverse.</p>
    <div class="scn-list">${rows||'<p class="hint">Nessuna scena in DMX Master.</p>'}</div>
    <div class="scn-new">
      <h4>Nuova scena dai valori dal vivo</h4>
      <div class="two"><label>Nome (id)<input id="snName" placeholder="es. rosso_caldo"></label><label>Etichetta<input id="snLabel" placeholder="es. Rosso caldo"></label></div>
      <div class="scn-cats">${checks(cats.map(c=>c.id),'sn-cat')}</div>
      <div class="row"><button class="btn primary" id="snCapture">📷 Cattura scena</button></div>
    </div>
  </div>`;
  const ids=scenes.map(x=>x.id);
  const fail=e=>showError('Scene: '+e.message);
  const reopen=()=>{if(!$('#scrim').hidden&&document.querySelector('.scn-list'))openSceneEditor()};
  s.querySelector('#scnClose').onclick=closeSheet;
  s.querySelector('#snCapture').onclick=async()=>{
    const name=s.querySelector('#snName').value.trim(),label=s.querySelector('#snLabel').value.trim();
    const categories=[...s.querySelectorAll('.sn-cat:checked')].map(x=>x.value);
    const bad=validateSceneName(name,ids);if(bad){showError('Nuova scena: '+bad);return}
    if(!categories.length){showError('Nuova scena: scegli almeno una categoria.');return}
    try{await tdSceneCommand('show_scene_capture',{name,...(label?{label}:{}),categories},()=>!!tdSceneById(name));
      reopen();showInfo(`Scena "${name}" catturata (${sceneCategoryText(categories,cats)}).`)}catch(e){fail(e)}
  };
  s.querySelectorAll('.scn-row').forEach(row=>{
    const id=row.dataset.scene,sc=tdSceneById(id);
    row.querySelector('[data-sa="recall"]').onclick=async()=>{
      try{await tdSceneCommand('show_scene_recall',id,()=>tdActiveScene(tdParams())?.id===id);reopen()}catch(e){fail(e)}};
    row.querySelector('[data-sa="recapture"]').onclick=async()=>{
      if(!confirm(`Sovrascrivere "${id}" con i valori dal vivo di adesso?\nCambiano solo le sue categorie: ${sceneCategoryText(sc?.categories,cats)}.`))return;
      // conferma = TD ha ripubblicato status/matrix dopo il comando
      const pub=()=>`${G.devices['td-dmx-win']?.ts}|${G.dxm['td-dmx-win']?.ts}`,before=pub();
      try{await tdSceneCommand('show_scene_capture',{name:id,categories:sc?.categories||cats.map(c=>c.id)},()=>pub()!==before);
        reopen();showInfo(`Scena "${id}" ricatturata.`)}catch(e){fail(e)}
    };
    row.querySelector('[data-sa="edit"]').onclick=()=>{const ed=row.querySelector('.scn-edit');ed.hidden=!ed.hidden};
    row.querySelector('[data-sa="save"]').onclick=async()=>{
      const to=row.querySelector('.se-name').value.trim(),label=row.querySelector('.se-label').value.trim();
      const categories=[...row.querySelectorAll('.se-cat:checked')].map(x=>x.value);
      const bad=validateSceneName(to,ids,id);if(bad){showError('Scena: '+bad);return}
      if(!categories.length){showError('Scena: almeno una categoria.');return}
      try{
        if(to!==id)await tdSceneCommand('show_scene_rename',{name:id,to,...(label?{label}:{})},()=>!!tdSceneById(to)&&!tdSceneById(id));
        await tdSceneCommand('show_scene_update',{name:to,label:label||to,categories},()=>{const x=tdSceneById(to);
          return!!x&&(x.label||x.id)===(label||to)&&JSON.stringify([...(x.categories||[])].sort())===JSON.stringify([...categories].sort())});
        reopen();showInfo(`Scena "${to}" aggiornata.`)}catch(e){fail(e)}
    };
    row.querySelector('[data-sa="delete"]').onclick=async()=>{
      if(!confirm(`Eliminare la scena "${id}" da DMX Master?`))return;
      try{await tdSceneCommand('show_scene_delete',id,()=>!tdSceneById(id));reopen()}catch(e){fail(e)}
    };
  });
}

if(typeof module==='object'&&module.exports){
  module.exports={SCENE_CATEGORIES,sceneCategoriesFrom,validateSceneName,sceneCategoryText};
}
