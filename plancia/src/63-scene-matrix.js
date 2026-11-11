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
// Scaletta del progetto (L.sceneSetlist: id delle scene di TD, in ordine). Le scene restano in
// comune fra i progetti: qui si sceglie solo quali usare e in che ordine. Senza scaletta valgono
// tutte tranne le nascoste; gli id di scene che in TD non ci sono piu' si ignorano.
function projSceneList(scenes,setlist,hidden){
  if(Array.isArray(setlist)){const byId=new Map(scenes.map(s=>[s.id,s]));return setlist.map(id=>byId.get(id)).filter(Boolean)}
  const h=new Set(hidden||[]);return scenes.filter(s=>!h.has(s.id));
}
// BACK di Scene GO: posizione da richiamare, -1 = niente. La scena attiva puo' essere fuori
// scaletta (timeline, altra pagina): allora la riga sopra NEXT, cioe' l'ultima mandata col GO.
function csBackPos(list,activePos,next){
  if(!list.length)return-1;
  if(activePos>=0)return activePos-1;
  const n=list.findIndex(s=>s.index===next);
  return n>0?n-1:list.length-1;
}
// Timeline luci -> timeline semplice di un Raspberry (pi/dmx): un colore per passo, quello del
// gruppo scelto. Una cue che non colora quel gruppo allunga il passo prima. {steps, palettes}
function piTimelineFrom(cues,scenes,col,{lastSeconds=10}={}){
  const byId=new Map(scenes.map(s=>[s.id,s])),list=(cues||[]).filter(c=>c&&c.scene&&Number.isFinite(+c.time)).sort((a,b)=>a.time-b.time);
  const steps=[],palettes={};
  list.forEach((c,i)=>{
    const sc=byId.get(c.scene),rgb=sc&&smCell(sc,col)?.colors?.[0],dur=list[i+1]?Math.max(.1,+list[i+1].time-+c.time):Math.max(.1,+lastSeconds||10);
    if(!rgb){if(steps.length)steps[steps.length-1].duration=+(steps[steps.length-1].duration+dur).toFixed(2);return}
    const name=`${sc.label||sc.id} · ${col.label||col.key}`.slice(0,40);
    palettes[name]=rgb.slice(0,3).map(v=>Math.max(0,Math.min(255,Math.round(+v>1?+v:+v*255))));
    steps.push({palette:name,duration:+dur.toFixed(2),fade:+Math.min(Math.max(0,+c.fade||0),dur).toFixed(2)});
  });
  return{steps,palettes};
}
// --- interfaccia ---
let SM_SHOW_ALL=false;
const smHidden=()=>Array.isArray(L.sceneHidden)?L.sceneHidden:[];
function projScenes(){return projSceneList(tdScenes(),L.sceneSetlist,smHidden())}
// una scena nuova catturata qui entra in scaletta; una rinominata resta al suo posto in tutti i progetti
function setlistOnScene(param,value,isNew){
  if(param==='show_scene_capture'&&isNew&&Array.isArray(L.sceneSetlist)&&!L.sceneSetlist.includes(value.name)){L.sceneSetlist.push(value.name);save();return}
  if(param!=='show_scene_rename')return;
  const fix=d=>{if(!Array.isArray(d?.sceneSetlist)||!d.sceneSetlist.includes(value.name))return false;d.sceneSetlist=d.sceneSetlist.map(x=>x===value.name?value.to:x);return true};
  if(fix(L))save();
  for(const p of projList()){const snap=store.get('plancia.project.'+p.id);if(fix(snap))store.set('plancia.project.'+p.id,snap)}
}
function openSceneSetlist(draft){
  const all=tdScenes(),byId=new Map(all.map(x=>[x.id,x]));
  draft=(draft||projScenes().map(x=>x.id)).filter(id=>byId.has(id));
  const rest=all.filter(x=>!draft.includes(x.id)),s=$('#scrim'),top=s.querySelector('.sl-list')?.scrollTop||0;s.hidden=false;
  const row=(sc,pos)=>`<div class="sl-row${pos<0?' off':''}" data-sl="${esc(sc.id)}">
    <label class="chk"><input type="checkbox" class="sl-on"${pos<0?'':' checked'}><span class="sl-no">${pos<0?'':pos+1}</span><b>${esc(sc.label||sc.id)}</b></label>
    <i style="background:${smLookGrad(sc)||'transparent'}"></i>
    ${pos<0?'':`<button class="btn sm ghost" data-sl-move="-1" aria-label="Sposta su"${pos?'':' disabled'}>↑</button><button class="btn sm ghost" data-sl-move="1" aria-label="Sposta giù"${pos<draft.length-1?'':' disabled'}>↓</button>`}</div>`;
  s.innerHTML=`<div class="sheet sl-sheet" role="dialog" aria-label="Scaletta delle scene">
    <div class="top"><h3>Scaletta · ${esc(L._projectName||'progetto')}</h3><button class="btn ghost" id="slCancel">Annulla</button></div>
    <p class="hint">Quali scene usa questo progetto in Scene GO e nel blocco Scene, e in che ordine. Togliere una scena da qui non la cancella da DMX Master e non cambia gli altri progetti né la timeline.</p>
    <div class="row"><button class="btn sm" id="slAll">Tutte</button><button class="btn sm" id="slRel" title="Solo le scene che toccano i gruppi di luci di questo progetto">Solo per questi gruppi</button><button class="btn sm ghost" id="slNone">Nessuna</button><span class="hint">${draft.length} di ${all.length}</span></div>
    <div class="sl-list">${draft.map((id,i)=>row(byId.get(id),i)).join('')}${rest.length&&draft.length?'<h4>Fuori scaletta</h4>':''}${rest.map(x=>row(x,-1)).join('')}</div>
    <div class="cue-editor-actions"><button class="btn primary" id="slSave">Salva scaletta</button></div>
  </div>`;
  const list=s.querySelector('.sl-list');list.scrollTop=top;
  s.querySelector('#slCancel').onclick=closeSheet;
  s.querySelector('#slAll').onclick=()=>openSceneSetlist([...draft,...rest.map(x=>x.id)]);
  s.querySelector('#slNone').onclick=()=>openSceneSetlist([]);
  s.querySelector('#slRel').onclick=()=>{const cols=smColumns(groupsOf(),L.fixtures,all);openSceneSetlist([...draft,...rest.map(x=>x.id)].filter(id=>smRelevant(byId.get(id),cols)))};
  s.querySelectorAll('[data-sl]').forEach(r=>{const id=r.dataset.sl;
    r.querySelector('.sl-on').onchange=e=>openSceneSetlist(e.target.checked?[...draft,id]:draft.filter(x=>x!==id));
    r.querySelectorAll('[data-sl-move]').forEach(b=>b.onclick=()=>{const a=[...draft],i=a.indexOf(id),j=i+ +b.dataset.slMove;[a[i],a[j]]=[a[j],a[i]];openSceneSetlist(a)});
  });
  s.querySelector('#slSave').onclick=()=>{
    L.sceneSetlist=[...draft];
    if(smHidden().length)L.sceneHidden=smHidden().filter(id=>!draft.includes(id)); // messa in scaletta = non piu' nascosta
    save();closeSheet();refreshTdSceneWidgets();showInfo(`Scaletta salvata: ${draft.length} scene.`);
  };
}
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
    else if(v==='hide'){L.sceneHidden=hid?smHidden().filter(x=>x!==sceneId):[...smHidden(),sceneId];
      if(Array.isArray(L.sceneSetlist)){const rest=L.sceneSetlist.filter(x=>x!==sceneId);L.sceneSetlist=hid?[...rest,sceneId]:rest}
      save();refreshTdSceneWidgets()}
    else if(v==='delete'){if(!await uiConfirm(`Eliminare "${sc.label||sceneId}" da DMX Master?\nLe scene sono in comune con tutti i progetti.`,{ok:'Elimina'}))return;
      await tdSceneCommand('show_scene_delete',sceneId,()=>!tdSceneById(sceneId))}
    smReopen();
  }catch(e){showError('Scena: '+e.message)}
}
function openPiExport(){
  const rooms=Object.keys(G.dmx||{}).sort(),doc=tdTimelineDoc(),scenes=tdScenes(),cols=smColumns(groupsOf(),L.fixtures,scenes).filter(c=>c.kind==='color');
  if(!rooms.length){showError('Nessun Raspberry con il servizio DMX collegato.');return}
  if(!doc?.cues?.length){showError('La timeline di DMX Master è vuota.');return}
  if(!cols.length){showError('Nessun gruppo di luci a colori in questo progetto.');return}
  const s=$('#scrim');s.hidden=false;
  let room=rooms[0],col=cols[0].key,name=(L._projectName||'Show').slice(0,30),last=10,loop=true;
  const plan=()=>piTimelineFrom(doc.cues,scenes,cols.find(c=>c.key===col),{lastSeconds:last});
  const hex3=c=>'#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');
  const preview=()=>{const p=plan(),t=p.steps.reduce((a,x)=>a+x.duration,0);
    return`<p class="hint">${p.steps.length} passi · ${formatCueTime(t)}</p><div class="px-list">${p.steps.map((x,i)=>`<div class="px-row"><i style="background:${hex3(p.palettes[x.palette])}"></i><b>${i+1}. ${esc(x.palette)}</b><span>${x.duration} s · dissolvenza ${x.fade} s</span></div>`).join('')||'<p class="hint">Nessuna cue colora questo gruppo: scegline un altro.</p>'}</div>`};
  const paint=()=>{
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Esporta su Raspberry">
      <div class="top"><h3>Esporta su Raspberry</h3><button class="btn ghost" id="pxClose">Chiudi</button></div>
      <p class="hint">La timeline diventa una sequenza semplice di colori. Sul Raspberry parte dal suo schermo e non segue lo show. Effetti, sequenze, teste e audio non passano. Inviare non accende le luci.</p>
      <div class="ac-f">Raspberry<div class="px-chips">${rooms.map(r=>`<button class="btn sm${r===room?' primary':' ghost'}" data-px-r="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
      <div class="ac-f">Colore preso dal gruppo<div class="px-chips">${cols.map(c=>`<button class="btn sm${c.key===col?' primary':' ghost'}" data-px-c="${esc(c.key)}">${esc(c.label)}</button>`).join('')}</div></div>
      <div class="two"><label>Nome sul Raspberry<input id="pxName" value="${esc(name)}" maxlength="40"></label><label>Durata ultimo passo (s)<input id="pxLast" type="number" min="0.5" step="0.5" value="${last}"></label></div>
      <label class="chk"><input type="checkbox" id="pxLoop"${loop?' checked':''}> Riparte da capo alla fine</label>
      <div id="pxPrev">${preview()}</div>
      <div class="cue-editor-actions"><button class="btn primary" id="pxSend">Invia al Raspberry</button></div></div>`;
    const q=x=>s.querySelector(x);
    q('#pxClose').onclick=closeSheet;
    q('#pxName').oninput=e=>{name=e.target.value};
    q('#pxLoop').onchange=e=>{loop=e.target.checked};
    q('#pxLast').onchange=e=>{last=Math.max(.5,+e.target.value||10);q('#pxPrev').innerHTML=preview()};
    s.querySelectorAll('[data-px-r]').forEach(b=>b.onclick=()=>{room=b.dataset.pxR;paint()});
    s.querySelectorAll('[data-px-c]').forEach(b=>b.onclick=()=>{col=b.dataset.pxC;paint()});
    q('#pxSend').onclick=async()=>{
      const n=name.trim(),p=plan(),topic=`gaia/dmx/${room}/command`;
      if(!n){showError('Scrivi il nome della timeline.');return}
      if(!p.steps.length){showError('Nessun passo da inviare: scegli un altro gruppo.');return}
      if(G.dmx[room]?.timeline_presets?.[n]&&!await uiConfirm(`"${n}" esiste già su ${room}. Sovrascriverla?`,{ok:'Sovrascrivi'}))return;
      // prima i colori: il Raspberry rifiuta una timeline con colori che non conosce
      for(const[pn,rgb]of Object.entries(p.palettes))if(!gPub(topic,{action:'palette_save',name:pn,rgb})){showError('Non collegata a Gaia: apri ⋯ → Gaia.');return}
      gPub(topic,{action:'timeline_save',name:n,steps:p.steps,loop});
      q('#pxSend').disabled=true;
      for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,400));if(G.dmx[room]?.timeline_presets?.[n]?.steps?.length===p.steps.length){closeSheet();showInfo(`"${n}" è sul Raspberry ${room}: ${p.steps.length} passi. Si avvia dal suo schermo.`);return}}
      closeSheet();showError(`"${n}" inviata a ${room}, ma il Raspberry non l'ha confermata entro 8 s.`);
    };
  };
  paint();
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
      <span style="flex:1"></span><button class="btn ghost" id="smSetlist" title="Quali scene usa questo progetto e in che ordine">☰ Scaletta</button><button class="btn ghost" id="smFull" title="Categorie, teste, strobo, scene dalle palette">Editor completo</button></div>
  </div>`;
  s.querySelector('#smClose').onclick=closeSheet;
  s.querySelector('#smFull').onclick=()=>openSceneEditor();
  s.querySelector('#smSetlist').onclick=()=>openSceneSetlist();
  s.querySelector('#smNew').onclick=()=>smNewScene(cols);
  s.querySelector('#smAll').onchange=e=>{SM_SHOW_ALL=e.target.checked;openSceneMatrix()};
  s.querySelectorAll('tr[data-sm]').forEach(tr=>{const id=tr.dataset.sm;
    tr.querySelector('[data-sm-go]').onclick=async()=>{try{await tdSceneCommand('show_scene_recall',id,()=>tdActiveScene(tdParams())?.id===id);smReopen()}catch(e){showError('Scena: '+e.message)}};
    tr.querySelector('[data-sm-menu]').onclick=()=>smRowMenu(id);
    tr.querySelectorAll('[data-sm-col]').forEach(td=>td.onclick=()=>smEditCell(id,cols[+td.dataset.smCol]));
  });
}

if(typeof module==='object'&&module.exports){
  module.exports={smKey,smPaletteParam,smColumns,smCell,smRelevant,smPlanEdit,projSceneList,csBackPos,piTimelineFrom};
}
