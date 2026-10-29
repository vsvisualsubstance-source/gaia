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
// Tipo di una scena dalle sue categorie, per raggrupparle nel menu delle cue
// e marcarle sulla traccia LUCI: le scene si sommano a strati, quindi conta
// sapere se una cue cambia il colore, le teste o lo strobo.
const SCENE_KINDS=[
  {id:'full',label:'Completa',group:'Complete (tutto il look)'},
  {id:'color',label:'Colore',group:'Colore (palette e look dei rig)'},
  {id:'heads',label:'Teste',group:'Teste mobili'},
  {id:'strobe',label:'Strobo',group:'Strobo'},
  {id:'groups',label:'Accensioni',group:'Accensioni gruppi'},
  {id:'audio',label:'Audio',group:'Sorgente audio'},
  {id:'mixed',label:'Mista',group:'Miste'}];
function sceneKind(categories){
  const c=[...new Set(categories||[])],one={rigs:'color',palette:'color',heads:'heads',strobe:'strobe',groups:'groups',audio:'audio'};
  let id='mixed';
  if(c.length>=3||(c.includes('heads')&&c.some(x=>x==='rigs'||x==='palette')))id='full';
  else if(c.length&&c.every(x=>x==='rigs'||x==='palette'))id='color';
  else if(c.length===1&&one[c[0]])id=one[c[0]];
  return SCENE_KINDS.find(k=>k.id===id);
}
// Scena "template" di una palette (Warm -> pal_warm): stesso nome per tutti i rig
function paletteSceneId(palette){
  const s=String(palette||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return('pal_'+(s||'x')).slice(0,32);
}

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
// palette dei rig pubblicate da DMX Master: [{n:'dmx_a_palette',label,options}]
const tdPaletteParams=()=>enumParams('td-dmx-win').filter(p=>/^dmx_.+_palette$/.test(p.n));
// Attesa su TD come tdSceneCommand, per piu' comandi gia' inviati
function tdWait(done,timeoutMs=8000){
  const dev=()=>G.devices['td-dmx-win']||{},err0=dev().last_error,t0=Date.now();
  return new Promise((resolve,reject)=>{
    const check=()=>{
      const err=dev().last_error;
      if(err&&err!==err0)return reject(new Error(err));
      if(done())return resolve();
      if(Date.now()-t0>timeoutMs)return reject(new Error('Nessuna conferma da DMX Master entro '+Math.round(timeoutMs/1000)+' s.'));
      setTimeout(check,300);
    };
    check();
  });
}
// Una scena "colore" per ogni palette: imposta la palette sui rig scelti,
// cattura pal_<nome>, e alla fine rimette le palette di prima. Con la
// timeline attiva (show_active) la spegne durante la composizione, come si
// fa per catturare a mano, e poi la riaccende. Le luci cambiano dal vivo.
async function buildPaletteScenes(palettes,rigParams,onStep=()=>{}){
  const set=async values=>{
    for(const[p,v]of Object.entries(values))
      if(v!=null&&tdParams()[p]!==v&&!devCmd('td-dmx-win',{action:'set',param:p,value:v}))throw new Error('Non collegata a Gaia: apri ⋯ → Gaia e collegati prima.');
    await tdWait(()=>Object.entries(values).every(([p,v])=>v==null||tdParams()[p]===v));
  };
  const before=Object.fromEntries(rigParams.map(p=>[p,tdParams()[p]]));
  const wasActive=tdShowActive()===true;
  // categoria solo palette se TD la offre, altrimenti tutto il look dei rig
  const categories=sceneCategoriesFrom(G.dxm['td-dmx-win']).some(c=>c.id==='palette')?['palette']:['rigs'];
  try{
    if(wasActive){
      if(!devCmd('td-dmx-win',{action:'disable',service:'show_active'}))throw new Error('Non collegata a Gaia.');
      await tdWait(()=>tdShowActive()===false);
    }
    for(let i=0;i<palettes.length;i++){
      const pal=palettes[i],id=paletteSceneId(pal);onStep(i,pal);
      // la cattura su una scena esistente lascia le categorie com'erano (nota
      // TD 52): una pal_* fatta con rigs va prima portata alle categorie giuste
      const old=tdSceneById(id),same=(a,b)=>JSON.stringify([...(a||[])].sort())===JSON.stringify([...b].sort());
      if(old&&!same(old.categories,categories))
        await tdSceneCommand('show_scene_update',{name:id,label:old.label||pal,categories},()=>same(tdSceneById(id)?.categories,categories));
      await set(Object.fromEntries(rigParams.map(p=>[p,pal])));
      const pub=()=>`${G.devices['td-dmx-win']?.ts}|${JSON.stringify(tdSceneById(id))}`,b=pub();
      await tdSceneCommand('show_scene_capture',{name:id,label:pal,categories},()=>!!tdSceneById(id)&&pub()!==b);
    }
  }finally{
    try{await set(before)}catch{}
    if(wasActive)devCmd('td-dmx-win',{action:'enable',service:'show_active'});
  }
  return categories;
}

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
    ${paletteScenesSection(scenes)}
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
  const spBuild=s.querySelector('#spBuild');
  if(spBuild)spBuild.onclick=async()=>{
    const pals=[...s.querySelectorAll('.sp-pal:checked')].map(x=>x.value),rigs=[...s.querySelectorAll('.sp-rig:checked')].map(x=>x.value);
    if(!pals.length){showError('Scene dalle palette: scegli almeno una palette.');return}
    if(!rigs.length){showError('Scene dalle palette: scegli almeno un rig.');return}
    if(!confirm(`Creare ${pals.length} scen${pals.length>1?'e':'a'} colore (${pals.map(paletteSceneId).join(', ')})?\nLe luci cambiano dal vivo per qualche secondo per ogni palette: non farlo durante lo show.`))return;
    const prog=s.querySelector('#spProg');spBuild.disabled=true;
    try{const cats=await buildPaletteScenes(pals,rigs,(i,p)=>{if(prog)prog.textContent=`${i+1}/${pals.length} · ${p}…`});
      reopen();showInfo(`${pals.length} scen${pals.length>1?'e':'a'} palette pronte (${sceneCategoryText(cats,SCENE_CATEGORIES)}): sceglile nelle cue, gruppo Colore.`)}
    catch(e){spBuild.disabled=false;if(prog)prog.textContent='';fail(e)}
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

// sezione "Scene dalle palette" dell'editor scene
function paletteScenesSection(scenes){
  const rigs=tdPaletteParams();if(!rigs.length)return'';
  const pals=[...new Set(rigs.flatMap(p=>p.options.map(String)))].filter(p=>!/^custom$/i.test(p));
  const have=new Set(scenes.map(x=>x.id)),onlyPalette=sceneCategoriesFrom(G.dxm['td-dmx-win']).some(c=>c.id==='palette');
  return`<div class="scn-new scn-pal">
      <h4>Scene dalle palette</h4>
      <p class="hint">Una scena <b>colore</b> per ogni palette scelta (es. Warm → <span class="mono">pal_warm</span>), da mettere nelle cue come le altre: nel menu stanno nel gruppo <b>Colore</b>. Le palette dal vivo non vanno in timeline, le scene sì. ${onlyPalette?'Salvano solo le palette dei rig.':'Per ora salvano tutto il <b>look dei rig</b> (anche dimmer, kick e audio di adesso): prepara prima quelli.'} Una ✓ = esiste già, viene ricatturata${onlyPalette?' (e portata alla sola categoria Palette se era fatta con il look dei rig)':''}.</p>
      <div class="scn-cats sp-pals">${pals.map(p=>`<label class="chk"><input type="checkbox" class="sp-pal" value="${esc(p)}"> ${esc(p)}${have.has(paletteSceneId(p))?' ✓':''}</label>`).join('')}</div>
      <p class="hint">Rig da colorare:</p>
      <div class="scn-cats">${rigs.map(p=>`<label class="chk"><input type="checkbox" class="sp-rig" value="${esc(p.n)}" checked> ${esc(p.label||p.n)}</label>`).join('')}</div>
      <div class="row"><button class="btn primary" id="spBuild">🎨 Crea scene palette</button><span class="hint" id="spProg"></span></div>
    </div>`;
}

if(typeof module==='object'&&module.exports){
  module.exports={SCENE_CATEGORIES,sceneCategoriesFrom,validateSceneName,sceneCategoryText,SCENE_KINDS,sceneKind,paletteSceneId};
}
