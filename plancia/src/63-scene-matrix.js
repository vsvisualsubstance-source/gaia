/* ---------- scene come tabella: righe = scene, colonne = gruppi del progetto (2026-11-07) ---------- */
// Prima le scene si capivano solo dalle categorie ("Look dei rig · Palette"): non si
// vedeva QUALI luci tocca una scena. Qui ogni casella dice il colore che quella scena da'
// a quel gruppo, "—" se non lo tocca (resta com'era). Toccando una casella si cambia: la
// Plancia mette le palette della scena sui rig, cambia quella, ricattura (solo palette,
// solo i rig della scena: campo "only" di TD, nota 60) e rimette il dal vivo di prima.

// nome del rig in TD (scene_groups, preview, only) di un gruppo della Plancia
const smKey=g=>g.bind==='rig_a'||g.bind==='rig_b'||g.bind==='heads'?g.bind:g.group;
// parametro palette dal vivo del rig TD: rig_a -> dmx_a_palette, consolle -> dmx_consolle_palette
const smPaletteParam=key=>`dmx_${key==='rig_a'?'a':key==='rig_b'?'b':key}_palette`;

// colonne: i gruppi con luci DMX in questo progetto (colore) + teste + strobo
function smColumns(groups,fixtures,scenes=[]){
  const used=new Set((fixtures||[]).filter(f=>f.enabled!==false).map(f=>f.group));
  const cols=[];
  for(const g of groups||[]){
    if(!used.has(g.group))continue;
    if(g.kind==='chase')cols.push({key:smKey(g),group:g.group,label:g.label||g.group,kind:'color'});
    else if(g.kind==='heads')cols.push({key:'heads',group:g.group,label:g.label||'Teste',kind:'heads'});
  }
  if((scenes||[]).some(s=>(s.categories||[]).includes('strobe')))cols.push({key:'strobe',group:null,label:'Strobo',kind:'strobe'});
  return cols;
}
// cosa fa la scena a quella colonna: null = non la tocca
function smCell(scene,col){
  const cats=scene?.categories||[],only=scene?.only||[],inOnly=!only.length||only.includes(col.key);
  if(col.kind==='strobe')return cats.includes('strobe')?{text:'strobo'}:null;
  if(col.kind==='heads'){
    if(!inOnly)return null;
    const t=[cats.includes('heads')&&'posizione',cats.includes('heads_color')&&'colore'].filter(Boolean);
    return t.length?{text:t.join(' + ')}:null;
  }
  if(!inOnly||!(cats.includes('palette')||cats.includes('rigs')))return null;
  const p=scene?.preview?.[col.key];
  return p&&(p.palette||Array.isArray(p.colors))?{palette:p.palette||'',colors:Array.isArray(p.colors)?p.colors:[]}:null;
}
// la scena serve a questo progetto se tocca almeno una sua colonna
const smRelevant=(scene,cols)=>cols.some(c=>smCell(scene,c));

// Piano per cambiare la casella (scena, rig) in palette (null = "non toccare"):
// set = palette da mettere dal vivo prima della cattura, only = rig della scena dopo
function smPlanEdit(scene,key,palette,sceneGroups){
  const all=(sceneGroups||[]).filter(g=>g!=='heads');
  const pv=scene?.preview||{},base=(scene?.only||[]).length?[...scene.only]:null; // null = tutti i rig
  // aggiungere non restringe mai (una scena "su tutto" resta su tutto: anche haze, blinder...);
  // togliere un rig da una scena su tutto = tutti gli altri
  let only=base;
  if(palette){if(only&&!only.includes(key))only.push(key)}
  else only=(only||[...all,...(scene?.categories||[]).some(c=>c==='heads'||c==='heads_color')?['heads']:[]]).filter(k=>k!==key);
  const inScene=k=>!only||only.includes(k);
  const rigs=new Map(Object.keys(pv).filter(k=>k!=='heads'&&inScene(k)&&pv[k]?.palette).map(k=>[k,pv[k].palette]));
  if(palette)rigs.set(key,palette);else rigs.delete(key);
  if(!rigs.size)return{error:'la scena non colorerebbe più nessun gruppo'};
  const set={};for(const[k,p]of rigs)set[smPaletteParam(k)]=p;
  const cats=scene?.categories?.length?[...scene.categories]:['palette'];
  if(!cats.includes('palette')&&!cats.includes('rigs'))cats.push('palette');
  return{set,only:only||[],categories:cats};
}

// striscia sotto la scena (Scene GO, menu Scene, timeline): un pezzo per gruppo a colori del
// progetto, grigio scuro se la scena non lo tocca; '' se il progetto non ha gruppi a colori
function smLookGrad(scene){
  const cols=smColumns(groupsOf(),L.fixtures).filter(c=>c.kind==='color');if(!cols.length||!scene)return'';
  return dmxGradient(cols.map(c=>{const x=smCell(scene,c);return x?.colors?.length?[x.colors,false]:[[[.17,.18,.21]],true]}));
}
// --- interfaccia ---
let SM_SHOW_ALL=false;
const smHidden=()=>Array.isArray(L.sceneHidden)?L.sceneHidden:[];
function smChip(cell){
  if(!cell)return'<span class="smx-none">—</span>';
  if(cell.text)return`<span class="smx-txt">${esc(cell.text)}</span>`;
  const grad=cell.colors.length?dmxGradient([[cell.colors,false]]):'';
  return`<span class="smx-chip" style="${grad?`background:${grad}`:''}"></span><span class="smx-pal">${esc(cell.palette||'colore')}</span>`;
}
// palette dal vivo con i rig temporaneamente impostati, cattura, poi si rimette tutto
async function smCaptureWith(set,cmd){
  const p0=tdParams(),before=Object.fromEntries(Object.keys(set).map(k=>[k,p0[k]]));
  const apply=async values=>{
    for(const[p,v]of Object.entries(values))
      if(v!=null&&tdParams()[p]!==v&&!devCmd(dmxId(),{action:'set',param:p,value:v}))throw new Error('Non collegata a Gaia: apri ⋯ → Gaia e collegati prima.');
    await tdWait(()=>Object.entries(values).every(([p,v])=>v==null||tdParams()[p]===v));
  };
  const wasActive=tdShowActive()===true;
  try{
    if(wasActive){if(!devCmd(dmxId(),{action:'disable',service:'show_active'}))throw new Error('Non collegata a Gaia.');await tdWait(()=>tdShowActive()===false)}
    await apply(set);
    await cmd();
  }finally{
    try{await apply(before)}catch{}
    if(wasActive)devCmd(dmxId(),{action:'enable',service:'show_active'});
  }
}
async function smEditCell(sceneId,col){
  const sc=tdSceneById(sceneId);if(!sc)return;
  if(col.kind!=='color'){showInfo(col.kind==='heads'?'Le teste si catturano dalla pagina Teste: "Editor completo" → Nuova scena, categoria Teste mobili.':'Lo strobo si cattura dall\'Editor completo (categoria Strobo generale).');return}
  const pp=tdPaletteParams().find(p=>p.n===smPaletteParam(col.key));
  if(!pp){showError(`DMX Master non pubblica la palette del rig ${col.label}.`);return}
  const cur=smCell(sc,col)?.palette;
  const items=[{label:'— non toccare (resta com\'era)',value:'\u0000',on:!cur},...pp.options.map(String).map(o=>({label:o,value:o,on:o===cur}))];
  const v=await uiChoose(`${sc.label||sc.id} · ${col.label}: che colore?`,items,{hint:'La scena viene ricatturata solo per le palette: le luci cambiano dal vivo per un attimo e poi tornano come prima.'});
  if(v==null)return;
  const plan=smPlanEdit(sc,col.key,v==='\u0000'?null:v,G.dxm[dmxId()]?.show?.scene_groups||[]);
  if(plan.error){showError('Scena: '+plan.error);return}
  const pub=()=>JSON.stringify(tdSceneById(sceneId)),b=pub();
  try{
    await smCaptureWith(plan.set,async()=>{
      const same=(a,c)=>JSON.stringify([...(a||[])].sort())===JSON.stringify([...(c||[])].sort());
      if(!same(sc.categories,plan.categories)||!same(sc.only,plan.only))
        await tdSceneCommand('show_scene_update',{name:sceneId,label:sc.label||sceneId,categories:plan.categories,only:plan.only},()=>{const x=tdSceneById(sceneId);return!!x&&same(x.categories,plan.categories)&&same(x.only,plan.only)});
      await tdSceneCommand('show_scene_capture',{name:sceneId,categories:plan.categories,only:plan.only},()=>pub()!==b);
    });
    SCENE_THUMBS.delete(sceneId);smReopen();showInfo(`${sc.label||sceneId}: ${col.label} ${v==='\u0000'?'non viene più toccato':'→ '+v}.`);
  }catch(e){showError('Scena: '+e.message)}
}
async function smNewScene(cols){
  const ids=tdScenes().map(x=>x.id);let n=ids.length+1;while(ids.includes('look_'+n))n++;
  const name=String(await uiPrompt('Nome della scena nuova (parte coi colori di adesso, poi li cambi nelle caselle)','look_'+n)||'').trim();
  if(!name)return;
  const bad=validateSceneName(name,ids);if(bad){showError('Scena: '+bad);return}
  const keys=cols.filter(c=>c.kind==='color').map(c=>c.key);
  if(!keys.length){showError('Scena: questo progetto non ha gruppi di luci a colori.');return}
  try{await tdSceneCommand('show_scene_capture',{name,label:name,categories:['palette'],only:keys},()=>!!tdSceneById(name));
    smReopen();showInfo(`Scena "${name}" creata coi colori di adesso: tocca le caselle per cambiarli.`)}
  catch(e){showError('Scena: '+e.message)}
}
async function smRowMenu(sceneId){
  const sc=tdSceneById(sceneId);if(!sc)return;
  const hid=smHidden().includes(sceneId),used=(sc.cues||[]).length;
  const v=await uiChoose(sc.label||sc.id,[
    {label:'▶ Richiama adesso (dal vivo)',value:'recall'},
    {label:'✎ Rinomina',value:'rename'},
    {label:hid?'👁 Mostra in questo progetto':'🙈 Nascondi in questo progetto',value:'hide'},
    {label:used?`× Elimina (usata in ${used} cue)`:'× Elimina da DMX Master',value:'delete',off:!!used}]);
  if(!v)return;
  try{
    if(v==='recall')await tdSceneCommand('show_scene_recall',sceneId,()=>tdActiveScene(tdParams())?.id===sceneId);
    else if(v==='rename'){const label=String(await uiPrompt('Nome da mostrare',sc.label||sc.id)||'').trim();if(!label)return;
      await tdSceneCommand('show_scene_update',{name:sceneId,label,categories:sc.categories||[],...((sc.only||[]).length?{only:sc.only}:{})},()=>(tdSceneById(sceneId)?.label||'')===label)}
    else if(v==='hide'){L.sceneHidden=hid?smHidden().filter(x=>x!==sceneId):[...smHidden(),sceneId];save()}
    else if(v==='delete'){if(!await uiConfirm(`Eliminare "${sc.label||sceneId}" da DMX Master?\nLe scene sono in comune con tutti i progetti.`,{ok:'Elimina'}))return;
      await tdSceneCommand('show_scene_delete',sceneId,()=>!tdSceneById(sceneId))}
    smReopen();
  }catch(e){showError('Scena: '+e.message)}
}
const smReopen=()=>{if(!$('#scrim').hidden&&document.querySelector('.smx'))openSceneMatrix()};
function openSceneMatrix(){
  const scenes=tdScenes(),cols=smColumns(groupsOf(),L.fixtures,scenes),hidden=new Set(smHidden()),active=tdActiveScene(tdParams())?.id;
  const shown=scenes.filter(s=>SM_SHOW_ALL||(!hidden.has(s.id)&&smRelevant(s,cols)));
  const off=scenes.length-shown.length;
  const s=$('#scrim');s.hidden=false;
  s.innerHTML=`<div class="sheet smx-sheet" role="dialog" aria-label="Scene">
    <div class="top"><h3>Scene · ${esc(L._projectName||'progetto')}</h3><button class="btn ghost" id="smClose">Chiudi</button></div>
    <p class="hint">Ogni riga è una scena, ogni colonna un gruppo di luci di questo progetto. La casella dice il colore che la scena dà a quel gruppo; <b>—</b> = la scena non lo tocca, resta com'era. <b>Tocca una casella</b> per cambiarla. Le scene vanno nella timeline LUCI e in Scene GO.</p>
    ${cols.length?'':'<p class="hint">Nessun gruppo di luci con fixture in questo progetto.</p>'}
    <div class="smx-wrap"><table class="smx"><thead><tr><th>Scena</th>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${shown.map(sc=>`<tr class="${sc.id===active?'on':''}${hidden.has(sc.id)?' hid':''}" data-sm="${esc(sc.id)}">
      <td class="smx-name"><button class="btn sm ghost" data-sm-go title="Richiama adesso">▶</button><b>${esc(sc.label||sc.id)}</b>${(sc.cues||[]).length?`<span class="hint"> · ${sc.cues.length} cue</span>`:''}</td>
      ${cols.map((c,i)=>`<td class="smx-cell${c.kind==='color'?' ed':''}" data-sm-col="${i}">${smChip(smCell(sc,c))}</td>`).join('')}
      <td><button class="btn sm ghost" data-sm-menu title="Altro">⋯</button></td></tr>`).join('')||`<tr><td colspan="${cols.length+2}" class="hint">Nessuna scena per questi gruppi: crea la prima.</td></tr>`}
    </tbody></table></div>
    <div class="row smx-foot"><button class="btn primary" id="smNew">+ Nuova scena</button>
      <label class="chk"><input type="checkbox" id="smAll"${SM_SHOW_ALL?' checked':''}> mostra tutte${off&&!SM_SHOW_ALL?` (${off} nascoste: altri gruppi o nascoste qui)`:''}</label>
      <span style="flex:1"></span><button class="btn ghost" id="smFull" title="Categorie, teste, strobo, scene dalle palette">Editor completo</button></div>
  </div>`;
  s.querySelector('#smClose').onclick=closeSheet;
  s.querySelector('#smFull').onclick=()=>openSceneEditor();
  s.querySelector('#smNew').onclick=()=>smNewScene(cols);
  s.querySelector('#smAll').onchange=e=>{SM_SHOW_ALL=e.target.checked;openSceneMatrix()};
  s.querySelectorAll('tr[data-sm]').forEach(tr=>{const id=tr.dataset.sm;
    tr.querySelector('[data-sm-go]').onclick=async()=>{try{await tdSceneCommand('show_scene_recall',id,()=>tdActiveScene(tdParams())?.id===id);smReopen()}catch(e){showError('Scena: '+e.message)}};
    tr.querySelector('[data-sm-menu]').onclick=()=>smRowMenu(id);
    tr.querySelectorAll('[data-sm-col]').forEach(td=>td.onclick=()=>smEditCell(id,cols[+td.dataset.smCol]));
  });
}

if(typeof module==='object'&&module.exports){
  module.exports={smKey,smPaletteParam,smColumns,smCell,smRelevant,smPlanEdit};
}
