/* ---------- modelli del progetto (viaggiano col layout, allineati a DMX Master su richiesta) ---------- */
// L.models = {nome: definizione} dei modelli usati dalle fixture del progetto.
// Si aggiorna quando salvi il progetto (da DMX Master, che fa fede) e quando
// crei/modifichi un modello dall'editor. Su un DMX Master nuovo o rifatto,
// "Allinea" manda solo i mancanti (add) e i diversi (update), con conferma.
// Non si sincronizza tutto il catalogo: DMX Master tiene i modelli in uso.
const MODEL_FIELDS=['model','kind','channels','footprint','manufacturer','notes','beam','colors','gobos','pan_range','tilt_range','defaults'];
function modelPayload(m){
  const v={};for(const k of MODEL_FIELDS)if(m&&m[k]!=null&&m[k]!=='')v[k]=JSON.parse(JSON.stringify(m[k]));
  return v;
}
// firma per confrontare: solo cio' che cambia l'uscita DMX (note e produttore no)
const _r3=x=>Array.isArray(x)?x.map(_r3):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,_r3(x[k])])):typeof x==='number'?Math.round(x*1000)/1000:x;
function modelSig(m){
  if(!m)return'';const ch=Array.isArray(m.channels)?m.channels:null;
  return JSON.stringify(_r3({kind:m.kind||null,channels:ch,footprint:ch?ch.length:(+m.footprint||+m.channels||null),
    colors:(m.colors||[]).map(c=>[c.name,c.value]),gobos:(m.gobos||[]).map(c=>[c.name,c.value]),pan:m.pan_range||null,tilt:m.tilt_range||null}));
}
// nomi dei modelli usati dalle fixture DMX (non wall/speaker)
function projectModelNames(fixtures,defaultFor,patchable){
  const out=new Set();
  for(const f of fixtures||[]){if(patchable&&!patchable(f))continue;const n=f.model||defaultFor(f.type);if(n)out.add(n)}
  return[...out];
}
// stato di ogni modello usato: missing (TD non l'ha), different, ok,
// unknown (TD non l'ha e il progetto non ne ha la definizione)
function projectModelDiff(saved,tdList,names){
  const td=new Map((tdList||[]).map(m=>[m.model,m]));
  return names.map(name=>{
    const def=saved?.[name]||null,cur=td.get(name)||null;
    const state=!cur?(def?'missing':'unknown'):def&&modelSig(def)!==modelSig(cur)?'different':'ok';
    return{name,state,def};
  });
}

// ---- Plancia ----
const projModelNames=()=>projectModelNames(L.fixtures,typeDefaultModel,f=>!!FIX_TYPES[f.type]?.ch);
const tdCatalogKnown=()=>tdModels().length>0;
// prima di salvare il progetto: definizioni fresche da DMX Master, via i non usati
function captureProjectModels(){
  const names=projModelNames(),old=L.models||{},td=new Map(tdModels().map(m=>[m.model,m])),out={};
  for(const n of names){const m=td.get(n);if(m)out[n]=modelPayload(m);else if(old[n])out[n]=old[n]}
  L.models=out;
}
function rememberModel(v){L.models={...(L.models||{}),[v.model]:modelPayload(v)};save()}
const projModelDiff=()=>projectModelDiff(L.models,tdModels(),projModelNames());
// riquadro in testa all'editor modelli
function projectModelsBox(){
  const names=projModelNames();if(!names.length)return'';
  const saved=Object.keys(L.models||{}).filter(n=>names.includes(n)).length;
  if(!tdCatalogKnown())return`<div class="md-proj"><b>Modelli del progetto</b> <span class="hint">${names.length} usati, ${saved} salvati nel progetto · DMX Master non collegato: il confronto si fa quando torna.</span></div>`;
  const d=projModelDiff(),todo=d.filter(x=>x.state==='missing'||x.state==='different'),unk=d.filter(x=>x.state==='unknown');
  const lbl={missing:'manca in DMX Master',different:'diverso in DMX Master',unknown:'sconosciuto: né in DMX Master né nel progetto'};
  return`<div class="md-proj"><b>Modelli del progetto</b> <span class="hint">${names.length} usati${todo.length||unk.length?'':' · tutti allineati con DMX Master'}</span>
    ${[...todo,...unk].map(x=>`<div class="hint">· ${esc(x.name)} — ${lbl[x.state]}</div>`).join('')}
    ${todo.length?`<div class="row"><button class="btn sm primary" id="mdAlign">⇪ Allinea DMX Master (${todo.length})</button></div>`:''}</div>`;
}
// manda a TD i modelli mancanti (e, se only non e' 'missing', i diversi)
async function alignProjectModels({only,ask=true}={}){
  const todo=projModelDiff().filter(x=>only?x.state===only:x.state==='missing'||x.state==='different');
  if(!todo.length)return true;
  const add=todo.filter(x=>x.state==='missing').map(x=>x.name),upd=todo.filter(x=>x.state==='different').map(x=>x.name);
  if(ask&&!confirm(`Modelli del progetto verso DMX Master:${add.length?`\n• aggiungo: ${add.join(', ')}`:''}${upd.length?`\n• aggiorno: ${upd.join(', ')} (vale anche per gli altri progetti che li usano)`:''}\nContinuare?`))return false;
  const errs=[];
  for(const x of todo){
    const v=modelPayload(x.def),isAdd=x.state==='missing';
    try{await tdSceneCommand(isAdd?'dmx_model_add':'dmx_model_update',v,()=>{const m=tdModels().find(y=>y.model===x.name);return!!m&&(isAdd||modelSig(m)===modelSig(v))})}
    catch(e){errs.push(`${x.name}: ${e.message}`)}
  }
  if(errs.length){showError('Allinea modelli: '+errs.join(' · '));return false}
  showInfo(`Modelli allineati su DMX Master: ${todo.length}.`);return true;
}
// dopo aver caricato un progetto: avvisa se DMX Master non ha i suoi modelli
function checkProjectModelsSoon(){
  setTimeout(()=>{if(!tdCatalogKnown())return;const n=projModelDiff().filter(x=>x.state==='missing'||x.state==='different').length;
    if(n)showInfo(`Il progetto usa ${n} modell${n>1?'i':'o'} che DMX Master non ha o ha diversi: ▤ Modelli → Allinea.`)},1500);
}

if(typeof module==='object'&&module.exports){module.exports={modelPayload,modelSig,projectModelNames,projectModelDiff};}
