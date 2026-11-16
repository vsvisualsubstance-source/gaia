const COLS=16, ROWS=10;
const SWATCH=['#ffb23e','#3ec9ff','#ff5fa2','#9be15d','#b18cff','#e9ebef'];
// dimensioni di default e nome di ogni tipo di widget: li riempie registerWidget (05-widget-registry.js)
const DEF={}, NAMES={};
const KEY='plancia.layout.v3', CKEY='plancia.conn.v1';
const $=s=>document.querySelector(s);
const uid=()=>Math.random().toString(36).slice(2,9);
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const bootstrap=window.__PLANCIA_SHARED__||{state:{layout:null,projects:[],projectData:{}},revision:0};
let sharedState=bootstrap.state||{layout:null,projects:[],projectData:{}},sharedRevision=bootstrap.revision||0;
let serverHasLayout=!!sharedState.layout,applyingSharedState=false,sharedSaveTimer=0,clientRevision=0,sharedDirty=false;
let sharedBaseline=JSON.stringify(sharedState);
function saveStatus(text,ok=false){
  const button=$('#saveStatus');
  if(!button)return;
  button.classList.toggle('on',ok);$('#saveStatusTxt').textContent=ok?'Auto ✓':text;button.title='Salvataggio automatico del layout su OPS: '+text;
}
function localGet(key){try{return JSON.parse(localStorage.getItem(key))}catch{return null}}
function importLocalProjects(){
  const projects=localGet('plancia.projects.v1');
  if(Array.isArray(projects))sharedState.projects=projects;
  sharedState.projectData={};
  for(const project of sharedState.projects){
    if(!project||typeof project.id!=='string')continue;
    const snapshot=localGet(`plancia.project.${project.id}`);
    if(snapshot)sharedState.projectData[project.id]=snapshot;
  }
}
function sharedStateChanged(){
  const current=JSON.stringify(sharedState);
  if(current===sharedBaseline)return;
  sharedDirty=true;clientRevision++;
  saveStatus(ws&&ws.readyState===1?'Salvataggio layout…':'Layout in attesa del server');
  clearTimeout(sharedSaveTimer);
  sharedSaveTimer=setTimeout(sendSharedState,200);
}
function sendSharedState(){
  if(!sharedDirty)return;
  if(!ws||ws.readyState!==1){saveStatus('Offline · layout in copia locale');return}
  clearTimeout(sharedSaveTimer);
  ws.send(JSON.stringify({type:'shared_state',state:sharedState,clientRevision}));
  saveStatus('Salvataggio layout…');
}
// Copia nel browser dello stato del server (serve solo offline). Il browser tiene ~5 MB e lo
// stato puo' essere piu' grande (16/11: due progetti con scene ILDA da 1,7 MB l'uno, 7,7 MB in
// tutto): prima il layout aperto e l'elenco, poi i progetti dal piu' leggero, quelli che non ci
// stanno restano solo sul server, senza errore. Errore solo se non entra nemmeno il layout.
function cacheSharedLocally(){
  const PK='plancia.project.',data=sharedState.projectData||{};
  const projectKeys=()=>Object.keys(localStorage).filter(k=>k.startsWith(PK));
  for(const k of projectKeys())if(!(k.slice(PK.length) in data))localStorage.removeItem(k);
  const head=()=>{localStorage.setItem(KEY,JSON.stringify(sharedState.layout));localStorage.setItem('plancia.projects.v1',JSON.stringify(sharedState.projects||[]))};
  try{head()}catch{for(const k of projectKeys())localStorage.removeItem(k);head()}
  let left=0;
  for(const [id,s] of Object.entries(data).map(([id,p])=>[id,JSON.stringify(p)]).sort((a,b)=>a[1].length-b[1].length)){
    try{localStorage.setItem(PK+id,s)}catch{localStorage.removeItem(PK+id);left++}
  }
  if(left)console.info(`Plancia: ${left} progetti solo sul server (copia nel browser piena)`);
}
function acceptSharedState(state,revision){
  if(!state||!state.layout)return false;
  sharedState=JSON.parse(JSON.stringify(state));
  sharedRevision=revision;serverHasLayout=true;sharedDirty=false;
  clearTimeout(sharedSaveTimer);
  sharedBaseline=JSON.stringify(sharedState);
  applyingSharedState=true;
  try{cacheSharedLocally()}
  catch(error){showError(`Cache locale non aggiornata: ${error.message}`)}
  finally{applyingSharedState=false}
  L=sharedState.layout;pi=Math.min(pi,L.pages.length-1);selId=null;
  render();initShow();
  if($('#pList'))renderProjList();
  saveStatus('Layout salvato · OPS',true);
  return true;
}
const store={
  get(key){
    if(serverHasLayout){
      if(key===KEY)return sharedState.layout;
      if(key==='plancia.projects.v1')return sharedState.projects;
      if(key.startsWith('plancia.project.'))return sharedState.projectData[key.slice('plancia.project.'.length)]??null;
    }
    return localGet(key);
  },
  set(key,value){
    try{localStorage.setItem(key,JSON.stringify(value))}catch{}
    const projectKey='plancia.project.';
    if(key===KEY){
      if(!serverHasLayout)importLocalProjects();
      sharedState.layout=value;
    }else if(key==='plancia.projects.v1'){
      if(!serverHasLayout)importLocalProjects();
      sharedState.projects=value;
      const projectIds=new Set(value.map(project=>project?.id).filter(id=>typeof id==='string'));
      for(const id of Object.keys(sharedState.projectData))if(!projectIds.has(id))delete sharedState.projectData[id];
    }else if(key.startsWith(projectKey)){
      if(!serverHasLayout)importLocalProjects();
      sharedState.projectData[key.slice(projectKey.length)]=value;
    }else return;
    if(!applyingSharedState)sharedStateChanged();
  }
};
const hsv2rgb=(h,s,v=1)=>{const f=n=>{const k=(n+h*6)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1))};return[f(5),f(3),f(1)]};
const rgb2hsv=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;if(h<0)h+=1}return[h,mx?d/mx:0,mx]};
const hex=c=>'#'+c.map(v=>Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join('');
const rgba=(c,a=1,k=1)=>`rgba(${Math.min(255,c[0]*k*255)|0},${Math.min(255,c[1]*k*255)|0},${Math.min(255,c[2]*k*255)|0},${clamp(a)})`;
const hash=(a,b)=>{const x=Math.sin(a*127.1+b*311.7)*43758.5453;return x-Math.floor(x)};
const now=()=>performance.now();
