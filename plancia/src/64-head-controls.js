/* ---------- teste: comandi costruiti dal modello vero (ruota colori, gobo, canali) ---------- */
// La pagina Teste mobili usava nomi fissi della Plancia: "Open" (indice 0) mandava
// Gobo_1 sulla Wecam, Zoom e Focus comandavano canali che non c'erano. Ora voci e
// canali vengono dal modello delle teste (catalogo di DMX Master) e le posizioni da
// heads_positions (nota TD 31). Funzioni usate nei render: dichiarazioni function.
function headsList(){const l=tdParams().heads_list;return Array.isArray(l)?l:Object.values(l||{})}
// modello della prima testa selezionata in TD (o della prima del progetto)
function headsModel(){
  const h=headsList().find(x=>x.selected)||headsList()[0];
  if(h?.profile)return tdModels().find(m=>m.model===h.profile)||L?.models?.[h.profile]||null;
  const f=(L.fixtures||[]).find(x=>x.type==='mh');return f?tdModelFor(f):null;
}
function headWheel(){const m=headsModel();return Array.isArray(m?.colors)?m.colors.filter(c=>c&&c.name!=null):[]}
function headGobos(){const m=headsModel();return Array.isArray(m?.gobos)?m.gobos.filter(c=>c&&c.name!=null):[]}
// senza modello noto non si nasconde niente
function headHasChannel(ch){const m=headsModel();return!m||!Array.isArray(m.channels)||m.channels.includes(ch)}
function tdHeadPositions(){const p=G.dxm['td-dmx-win']?.heads?.programmer?.positions;return Array.isArray(p)&&p.length?p:null}
const headSlotName=n=>String(n).replace(/_/g,' ');
// voci di un widget scenes che vengono dalle teste vere; null = quelle scritte nel widget
function headItems(w){
  if(w.addr==='/mh/gobo'){const g=headGobos();return g.length?g.map(x=>headSlotName(x.name)):null}
  if(w.addr==='/mh/position'){const p=tdHeadPositions();return p?p.map(x=>x.label||x.position):null}
  return null;
}
// ridisegno quando arrivano o cambiano modello e posizioni (dal tick dei widget)
const HEAD_SIG=new Map();
function headSigChanged(w,sig){if(HEAD_SIG.get(w.id)===sig)return false;const first=!HEAD_SIG.has(w.id);HEAD_SIG.set(w.id,sig);return!first}
// posizione attuale delle teste selezionate come scena "teste_n" (la sola cosa che va in timeline)
async function captureHeadsScene(){
  let n=1;while(tdSceneById(`teste_${n}`))n++;const id=`teste_${n}`;
  await tdSceneCommand('show_scene_capture',{name:id,label:`Teste ${n}`,categories:['heads']},()=>!!tdSceneById(id));
  return id;
}
async function headPositionStore(){
  const list=tdHeadPositions()||[];
  const pick=await uiChoose('Salva la posizione delle teste selezionate',[...list.map((p,i)=>({label:`Sovrascrivi "${p.label||p.position}"`,value:String(i)})),{label:'＋ Nuova posizione',value:'new'}]);
  if(pick==null)return;
  let i=+pick,name=list[i]?.label||list[i]?.position;
  if(pick==='new'){name=await uiPrompt('Nome della nuova posizione',`Posizione ${list.length+1}`);if(!name)return;i=list.length}
  fire('/mh/position/store',[i,String(name)]);showInfo(`Posizione "${name}" salvata in DMX Master dalle teste selezionate.`);
}
async function headSceneFromLive(){
  try{const id=await captureHeadsScene();showInfo(`Scena "${id}" catturata: in timeline la trovi nella traccia TESTE POS.`)}catch(e){showError('Scena teste: '+e.message)}
}
// 2026-11-04: Teste · movimento = libreria dei movimenti + timeline delle teste;
// selezione, posizioni, preset, pan/tilt e dimmer restano nella pagina Teste mobili
function migrateUiHeadPages(){
  if((L.uiRev||0)>=16)return;
  const p=L.pages.find(x=>x.name==='Teste · movimento');
  if(p){
    const dup=w=>(w.type==='scenes'&&(['head-select','head-presets'].includes(w.mode)||w.addr==='/mh/position'))||(w.type==='xy'&&w.addr==='/mh/pantilt')||(w.type==='fader'&&w.addr==='/mh/dimmer');
    L.pagesBackup={...(L.pagesBackup||{}),testeMovimento_20261104:JSON.parse(JSON.stringify(p))};
    p.widgets=p.widgets.filter(w=>!dup(w));
    const t=p.widgets.find(w=>w.type==='timeline'),hm=p.widgets.find(w=>w.type==='headmotion');
    if(t&&hm&&p.widgets.length===2){Object.assign(t,{x:0,y:0,w:16,h:4,onlyTracks:['heads','motion']});Object.assign(hm,{x:0,y:4,w:16,h:6})}
  }
  L.uiRev=16;save();
}
