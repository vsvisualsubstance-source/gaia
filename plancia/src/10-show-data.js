/* ---------- vocabolario dello show ---------- */
const LOOKS=[
 {n:'Walk-in',   wash:[.15,.22,.55],back:[.12,.1,.45],bar:[.2,.25,.7], mh:{dim:.35,col:[.45,.55,1],pos:4,gobo:3,zoom:.3},  wall:{col:[.1,.2,.6],mode:2}},
 {n:'Intro',     wash:[.02,.05,.22],back:[0,.25,.6],  bar:[0,.12,.45], mh:{dim:.65,col:[.25,.55,1],pos:3,gobo:0,zoom:.12}, wall:{col:[0,.3,.85],mode:2}},
 {n:'Strofa',    wash:[1,.55,.22], back:[.85,.32,.05],bar:[1,.42,.1],  mh:{dim:.5,col:[1,.72,.42],pos:2,gobo:2,zoom:.35},  wall:{col:[1,.5,.15],mode:1}},
 {n:'Pre-chorus',wash:[.9,.2,.42], back:[.55,0,.65], bar:[1,.1,.55],  mh:{dim:.8,col:[1,.22,.62],pos:0,gobo:1,zoom:.22},  wall:{col:[.95,.1,.55],mode:2}},
 {n:'Ritornello',wash:[1,.92,.82], back:[1,.1,.62],  bar:[1,0,.72],   mh:{dim:1,col:[1,1,1],pos:5,gobo:0,zoom:.18},       wall:{col:[1,.2,.7],mode:1}},
 {n:'Drop',      wash:[.1,.9,1],   back:[0,.4,1],    bar:[0,1,1],     mh:{dim:1,col:[.3,1,1],pos:5,gobo:4,zoom:.1},       wall:{col:[0,.9,1],mode:3}},
 {n:'Breakdown', wash:[.1,0,.3],   back:[.32,0,.85], bar:[.42,0,1],   mh:{dim:.55,col:[.62,.22,1],pos:3,gobo:5,zoom:.4},  wall:{col:[.5,0,1],mode:2}},
 {n:'Ballata',   wash:[.9,.6,.35], back:[.12,.05,.02],bar:[0,0,0],     mh:{dim:.9,col:[1,.86,.66],pos:2,gobo:0,zoom:.1,only:1},wall:{col:[.3,.15,.05],mode:0}},
 {n:'Solo',      wash:[.6,0,0],    back:[1,.22,0],   bar:[1,.12,0],   mh:{dim:1,col:[1,.3,.05],pos:4,gobo:3,zoom:.2},     wall:{col:[1,.2,0],mode:3}},
 {n:'Finale',    wash:[1,1,1],     back:[1,.6,0],    bar:[1,1,1],     mh:{dim:1,col:[1,.9,.5],pos:1,gobo:4,zoom:.3},      wall:{col:[1,.8,.2],mode:5}},
 {n:'Applausi',  wash:[1,.85,.7],  back:[.5,.4,.9],  bar:[.8,.6,1],   mh:{dim:.7,col:[1,1,1],pos:1,gobo:0,zoom:.6},       wall:{col:[.7,.5,1],mode:5}},
 {n:'Buio',      wash:[0,0,0],     back:[0,0,0],     bar:[0,0,0],     mh:{dim:0,col:[1,1,1],pos:0,gobo:0,zoom:.2},        wall:{col:[0,0,0],mode:0}},
];
const POS=['Centro','Pubblico','Palco','Cielo','Croce','Ventaglio'];
const GOBOS=['Open','Dots','Ring','Breakup','Prisma','Star'];
const CHASE=['Off','Lento','Veloce','Rainbow','Random','Sound'];
const LEDM=['Tinta','Gradiente','Onde','Pixel','Strobo','Logo'];
const SWC=[[1,1,1],[1,.05,.05],[1,.45,0],[1,.78,.3],[.1,1,.25],[0,.85,1],[.1,.2,1],[1,0,.8],[.45,0,1]];
const TLCUES=`0:00 Walk-in > 1
0:12 Intro > 2
0:40 Strofa > 3
1:10 Pre-chorus > 4
1:24 Ritornello > 5
1:52 Drop > 6
2:20 Breakdown > 7
2:44 Ballata > 8
3:15 Solo > 9
3:45 Finale > 10
4:15 Applausi > 11
4:28 Buio > 12`;
const RIG={heads:8,uplights:6,bars:8,wall:true,speakers:true};

/* ---------- fixture del palco (patch vero, non solo conteggi) ---------- */
// Ogni fixture: {id,type,name,group,universe,address,x,y,z,enabled}. "group"
// combacia con gli indirizzi /dmx/group/<group> del canale 3 (vedi
// plancia/README.md). x/y in metri, stesso sistema di coordinate di drawPlot
// (X(m)/Y(m)) -- 0,0 e' il centro del palco sul fondo.
// kind/model: tassonomia di partenza come da TD (nota interface 19) --
// "kind" e' il motore DMX che pilota il tipo (chase/level/heads/none),
// "model" il profilo di default. Sono solo i valori INIZIALI: appena
// DMX Master risponde con status.params.dmx_models/dmx_types, i canali
// veri si leggono da li' (vedi footprintFor), questi restano un
// fallback offline/prima-connessione.
const FIX_TYPES={
  mh:     {label:'Testa mobile', group:'mh',      ch:16, kind:'heads', model:'Generic Spot 11ch 16bit'},
  par:    {label:'PAR / Wash',   group:'front',   ch:8,  kind:'chase', model:'D+RGB 4CH'},
  bar:    {label:'Barra LED',    group:'ledbar',  ch:24, kind:'chase', model:'D+RGB 4CH'},
  wall:   {label:'LED wall',     group:'ledwall', ch:0,  kind:'none'},
  blinder:{label:'Blinder',      group:'blinder', ch:4,  kind:'level', model:'Dimmer 1CH'},
  haze:   {label:'Haze',         group:'haze',    ch:2,  kind:'level', model:'Haze 2CH'},
  laser:  {label:'Laser (solo render)',group:'',   ch:0},
  speaker:{label:'Cassa',        group:'',        ch:0,  kind:'none'}
};
const FIX_COLOR={mh:'#58a6ff',par:'#ffb23e',bar:'#3fb950',wall:'#ff6fae',blinder:'#f85149',haze:'#8a92a0',laser:'#ff365c',speaker:'#c9ced8'};
// DMX Master risolve i gruppi "live" (mh/front/back) negli ALIAS fisici
// del rig (heads/rig_a/rig_b) prima di salvarli in dmx_fixtures (nota TD
// 19/20) -- per ricostruire il "type" di Plancia da li' serve la mappa
// inversa. Gruppo non riconosciuto -> 'par' (generico), meglio di niente.
const GROUP_TO_TYPE={heads:'mh',mh:'mh',rig_a:'par',rig_b:'par',front:'par',back:'par',ledbar:'bar',blinder:'blinder',haze:'haze'};
// "p-" davanti: uid() e' 7 caratteri base36, ~1 volta su 10000 esce
// tutto cifre -- DMX Master lo leggerebbe come id numerico (i SUOI,
// non quelli creati da Plancia), confuso con una fixture sua. Trovato
// da TD (nota interface 18), non da un test qui.
// w/h/rot (metri, metri, gradi) hanno senso solo per 'wall' oggi --
// richiesto esplicitamente ("altezza lunghezza rotazione"), innocui e
// ignorati per gli altri tipi.
const STAGE_DEFAULT={width:12,depth:8,floorHeight:0,trussHeight:7,
  audience:{x:0,y:9,width:12,depth:6},foh:{x:-1,y:11.2,width:2,depth:1}};
const stageDefaults=()=>JSON.parse(JSON.stringify(STAGE_DEFAULT));
const fixtureZDefault=(type,stage=STAGE_DEFAULT)=>type==='mh'||type==='laser'?(stage?.trussHeight||STAGE_DEFAULT.trussHeight):
  type==='wall' ? 0 : type==='bar' ? 0.15 : type==='speaker' ? 0.6 : type==='haze' ? 0.8 : type==='blinder' ? 1 : 1.2;
function ensureStageData(layout){
  const current=layout.stage||{};
  const defaults=stageDefaults();
  layout.stage={...defaults,...current,
    audience:{...defaults.audience,...current.audience},
    foh:{...defaults.foh,...current.foh}};
  for(const key of ['width','depth','floorHeight','trussHeight']){
    const fallback=defaults[key];
    if(!Number.isFinite(+layout.stage[key]))layout.stage[key]=fallback;
    else layout.stage[key]=+layout.stage[key];
  }
  layout.stage.width=clamp(layout.stage.width,2,60);
  layout.stage.depth=clamp(layout.stage.depth,2,60);
  layout.stage.floorHeight=clamp(layout.stage.floorHeight,0,20);
  layout.stage.trussHeight=clamp(layout.stage.trussHeight,1,30);
  for(const [area,defaultArea,bounds] of [
    [layout.stage.audience,defaults.audience,{x:100,y:200,width:200,depth:200}],
    [layout.stage.foh,defaults.foh,{x:100,y:200,width:50,depth:50}]
  ]){
    for(const key of ['x','y','width','depth']){
      if(!Number.isFinite(+area[key]))area[key]=defaultArea[key];
      else area[key]=+area[key];
      area[key]=clamp(area[key],(key==='width'||key==='depth') ? 0.5 : -bounds[key],bounds[key]);
    }
  }
  for(const f of layout.fixtures||[]){
    if(!Number.isFinite(+f.x))f.x=0;else f.x=+f.x;
    if(!Number.isFinite(+f.y))f.y=0;else f.y=+f.y;
    if(!Number.isFinite(+f.z))f.z=fixtureZDefault(f.type,layout.stage);
    else f.z=+f.z;
    if(typeof f.mountToTruss!=='boolean')f.mountToTruss=f.type==='mh';
    if(f.type==='wall'){
      f.sourceType=f.sourceType||'procedural';
      f.sourceRef=f.sourceRef||'';
    }
    if(f.type==='laser'){
      if(!Number.isFinite(+f.angle))f.angle=0;
      if(!Number.isFinite(+f.spread))f.spread=28;
    }
  }
}
const mkFix=(type,name,x,y,universe,address)=>({id:'p-'+uid(),type,name,group:FIX_TYPES[type].group,model:FIX_TYPES[type].model,universe,address,x,y,
  z:fixtureZDefault(type),w:type==='wall'?6:undefined,h:type==='wall'?3.5:undefined,rot:type==='wall'?0:undefined,
  sourceType:type==='wall'?'procedural':undefined,sourceRef:type==='wall'?'':undefined,
  angle:type==='laser'?0:undefined,spread:type==='laser'?28:undefined,mountToTruss:type==='mh',enabled:true});
function defaultFixtures(rig){
  // Migrazione dal vecchio modello a sole quantita' (RIG, 2026-10):
  // stessa disposizione automatica di prima, cosi' un layout salvato
  // prima di questa modifica continua a mostrare lo stesso rig invece
  // di partire vuoto. Riusata anche dai template di progetto (sotto)
  // passando un rig diverso invece del default globale.
  const R=rig||RIG, out=[]; let a=1;
  for(let i=0;i<R.heads;i++){out.push(mkFix('mh','MH'+(i+1),-5+10*(R.heads>1?i/(R.heads-1):.5),2,1,a));a+=FIX_TYPES.mh.ch}
  for(let i=0;i<R.uplights;i++){out.push(mkFix('par','UP'+(i+1),-5.2+10.4*(R.uplights>1?i/(R.uplights-1):.5),1.05,1,a));a+=FIX_TYPES.par.ch}
  let b=1;
  for(let i=0;i<R.bars;i++){out.push(mkFix('bar','BAR'+(i+1),-5.2+(10.4/R.bars)*(i+.5),7.6,2,b));b+=FIX_TYPES.bar.ch}
  const walls=Number.isFinite(+R.walls)?clamp(Math.floor(+R.walls),0,8):R.wall?1:0;
  for(let i=0;i<walls;i++){
    const f=mkFix('wall',walls>1?`LED WALL ${i+1}`:'LED WALL',walls>1?(i-(walls-1)/2)*5.6:0,.4,3,i+1);
    if(walls>1)f.w=5;
    out.push(f);
  }
  if(R.speakers){out.push(mkFix('speaker','L ARRAY',-7.2,6.1,0,0));out.push(mkFix('speaker','R ARRAY',7.2,6.1,0,0))}
  return out;
}
function fixCounts(){ // conteggi per tipo, usati da drawRender/legenda invece dei vecchi R.heads ecc.
  const c={mh:0,par:0,bar:0,wall:0,blinder:0,haze:0,speaker:0};
  for(const f of (L.fixtures||[])) if(f.enabled!==false) c[f.type]=(c[f.type]||0)+1;
  return c;
}

/* ---------- progetti salvati (più show, da ricaricare) ---------- */
// Richiesto esplicitamente: poter salvare più progetti (pagine+fixture
// insieme) e ricaricarli, più 2-3 template di partenza. KEY (il layout
// "di lavoro" corrente, autosalvato come sempre) resta separato: un
// progetto e' uno SNAPSHOT esplicito, non il continuo autosave.
const PROJKEY='plancia.projects.v1';
const PROJECT_TEMPLATES=[
  {tid:'tpl-small',name:'Palco piccolo (4 teste)',rig:{heads:4,uplights:2,bars:2,wall:false,speakers:true}},
  {tid:'tpl-standard',name:'Palco standard (8 teste + LED wall)',rig:{heads:8,uplights:6,bars:8,wall:true,speakers:true}},
  {tid:'tpl-large',name:'Palco grande (12 teste + 2 LED wall)',rig:{heads:12,uplights:8,bars:12,walls:2,speakers:true}}
];
const projList=()=>store.get(PROJKEY)||[];
const projSnapshot=()=>JSON.parse(JSON.stringify(L));
function projSaveAs(name){
  const id='proj-'+uid();
  L._projectId=id;L._projectName=name;save(); // PRIMA di fare lo snapshot, altrimenti lo snapshot porta dentro di se' l'id/nome del progetto vecchio (se ce n'era uno caricato)
  store.set('plancia.project.'+id,projSnapshot());
  const list=projList();list.push({id,name,updated:Date.now()});store.set(PROJKEY,list);
  return id;
}
function projUpdate(id){
  store.set('plancia.project.'+id,projSnapshot());
  const list=projList();const e=list.find(x=>x.id===id);if(e){e.updated=Date.now();store.set(PROJKEY,list)}
}
function projLoad(id){
  const data=store.get('plancia.project.'+id);if(!data)return false;
  L=data;if(!L.fixtures)L.fixtures=defaultFixtures(L.rig);
  ensureStageData(L);
  L._projectId=id;const e=projList().find(x=>x.id===id);L._projectName=e?e.name:'';
  pi=0;selId=null;save();render();initShow();
  return true;
}
function projDelete(id){
  try{localStorage.removeItem('plancia.project.'+id)}catch{}
  store.set(PROJKEY,projList().filter(x=>x.id!==id));
  if(L._projectId===id){delete L._projectId;delete L._projectName;save()}
}
function projLoadTemplate(tid){
  const t=PROJECT_TEMPLATES.find(x=>x.tid===tid);if(!t)return;
  L={pages:TPL.full.pages(),fixtures:defaultFixtures(t.rig),stage:stageDefaults()};
  delete L._projectId;delete L._projectName;
  pi=0;selId=null;save();render();initShow();
}
function nextAddress(type,universe){ // primo indirizzo libero per quel tipo+universo, mai sovrapposto a una fixture esistente
  const ch=footprintFor(type)||1, used=(L.fixtures||[]).filter(f=>f.universe===universe).map(f=>[f.address,f.address+(footprintFor(f)||1)-1]);
  let a=1;
  for(;;){const end=a+ch-1;if(end>512)return 1;if(!used.some(([s,e])=>a<=e&&end>=s))return a;a=Math.max(...used.filter(([s,e])=>a<=e&&end>=s).map(([,e])=>e))+1}
}
// Fixture già patchate in TD (DMX Master), NON create da Plancia --
// trovato da TD (nota interface 18, "Doppioni"): Plancia non leggeva
// mai la patch reale, quindi i default dell'editor si aggiungevano
// alle fixture già a mano in TD invece di mostrarle. Solo lettura qui
// (niente drag/edit): id numerico di TD, non il nostro uid stringa.
function tdFixtures(){
  const list=(G.devices['td-dmx-win']?.params||{}).dmx_fixtures;
  if(!Array.isArray(list))return[];
  const mine=new Set((L.fixtures||[]).map(f=>f.id));
  return list.filter(x=>!x.uid||!mine.has(x.uid));
}

/* ---------- universi/indirizzi reali, patch TD come fonte unica (nota 19/20) ---------- */
const tdParams=()=>(G.devices['td-dmx-win']||{}).params||{};
const universeMap=()=>tdParams().dmx_universe_map||null;
// Catalogo condiviso (nota 19): modelli/tipi che DMX Master conosce
// davvero, letti da status.params -- sostituisce i canali fissi di
// FIX_TYPES.ch ovunque conta il numero vero di indirizzi occupati.
const tdModels=()=>tdParams().dmx_models||[];
const tdTypes=()=>tdParams().dmx_types||[];
function modelFootprint(name){
  const m=tdModels().find(x=>x.model===name);
  if(!m)return null;
  if(Number.isFinite(+m.footprint))return+m.footprint;
  if(Array.isArray(m.channels))return m.channels.length;
  if(Number.isFinite(+m.channels))return+m.channels;
  return null;
}
// Modello di default di un tipo: quello che DMX Master ha assegnato al
// tipo (se la tassonomia e' stata mandata/confermata), altrimenti il
// valore di partenza di FIX_TYPES.
function typeDefaultModel(type){
  const t=tdTypes().find(x=>x.type===type);
  return(t&&t.model)||(FIX_TYPES[type]&&FIX_TYPES[type].model)||null;
}
// Canali veri di una fixture (footprint del suo modello, nota 19) --
// f puo' essere una fixture {type,model} o solo il type come stringa.
// Fallback a FIX_TYPES.ch se il catalogo non e' ancora arrivato
// (offline, o prima connessione) o il modello non e' ancora noto a TD.
function footprintFor(f){
  const type=typeof f==='string'?f:f.type;
  const modelName=(f&&typeof f==='object'&&f.model)||typeDefaultModel(type);
  const fp=modelName&&modelFootprint(modelName);
  return fp||(FIX_TYPES[type]&&FIX_TYPES[type].ch)||0;
}
function portIdToUniverse(port_id){
  const u=(universeMap()?.universes||[]).find(x=>x.port_id===port_id);
  return u?u.universe:1;
}
// Primo spazio libero vero (letto da TD), non piu' calcolato solo sulle
// fixture locali di Plancia -- evita conflitti con cio' che e' gia'
// patchato in TD (bug di fondo dietro i doppioni della nota 20).
function freeAddressTD(universe,ch){
  const u=(universeMap()?.universes||[]).find(x=>x.universe===universe);
  if(!u)return null;
  for(const [a,b] of (u.free||[]))if(b-a+1>=ch)return a;
  return null;
}
// Fonte unica per il palco (richiesto esplicitamente da TD, nota 20,
// "Una fonte sola per il palco"): ricostruisce L.fixtures da
// status.params.dmx_fixtures invece che dalla copia locale -- cosi'
// due dispositivi con Plancia aperta vedono lo stesso palco e non
// generano piu' doppioni (ognuno aveva il proprio uid locale). Importa
// SOLO le fixture con uid "p-..." (create da Plancia, qualunque
// dispositivo); quelle native di TD restano in sola lettura via
// tdFixtures().
function importFromTD(silent){
  const list=tdParams().dmx_fixtures;
  if(!Array.isArray(list)){if(!silent)alert('Nessun dato da DMX Master ancora (non collegata, o TD non ha ancora risposto).');return false}
  const mine=list.filter(x=>x.uid&&x.uid.startsWith('p-'));
  if(!mine.length){if(!silent)alert('DMX Master non ha ancora fixture create da Plancia — nulla da importare.');return false}
  if(!silent&&!confirm(`Sostituisce le ${(L.fixtures||[]).length} fixture locali con le ${mine.length} trovate su DMX Master. Continuare?`))return false;
  const localOnly=(L.fixtures||[]).filter(f=>!FIX_TYPES[f.type]?.ch);
  L.fixtures=[...mine.map(x=>({
    id:x.uid,type:GROUP_TO_TYPE[x.group]||'par',name:x.name||x.uid,
    group:x.group,model:x.profile||undefined,universe:portIdToUniverse(x.port_id),address:x.address,
    x:typeof x.x==='number'?x.x:0,y:typeof x.y==='number'?x.y:0,
    enabled:x.enabled!==0&&x.enabled!==false,_synced:true
  })),...localOnly];
  ensureStageData(L); // altezza/truss/sorgente LED di default -- import non li aveva mai riempiti
  save();
  if(!silent)alert(`Importate ${mine.length} fixture da DMX Master.`);
  return true;
}
