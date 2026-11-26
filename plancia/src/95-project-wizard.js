/* ---------- progetto guidato e analisi del palco (26/11/2026) ----------
   Nuovo progetto con poche domande (vuoto o con luci, quali e quante, palco, pagine in piu'):
   crea luci gia' patchate in fila, gruppi, pagine e timeline vuote, e lo salva col nome dato.
   Analisi del palco: cosa c'e' nel progetto aperto (luci per tipo e gruppo, patch, laser, video,
   pagine) e una Regia su misura: fader solo dei gruppi che esistono, comandi teste se ci sono teste,
   blackout laser se c'e' un laser. La Regia vecchia resta in L.pagesBackup. */

const WZ_TYPES=[   // [tipo, etichetta domanda, massimo]
  ['bar','Barre LED',48],['par','PAR / wash',48],['mh','Teste mobili',24],['blinder','Strobo / blinder',16],
  ['haze','Macchine del fumo',4],['laser','Laser (LaserCube)',4],['wall','LED wall',4],['projector','Proiettori',4],['speaker','Casse',8]];
const WZ_STAGES={small:{label:'Piccolo · 6×4 m',width:6,depth:4,trussHeight:3.5},medium:{label:'Medio · 10×6 m',width:10,depth:6,trussHeight:5},large:{label:'Grande · 14×8 m',width:14,depth:8,trussHeight:7}};

// luci in posizioni sensate e patch in fila (universo nuovo quando non ci stanno piu' nei 512 canali)
function wzFixtures(counts,st){
  const out=[],W2=st.width/2,D=st.depth;let uni=1,addr=1;
  const patch=type=>{const ch=FIX_TYPES[type].ch||0;if(!ch)return[0,0];if(addr+ch-1>512){uni++;addr=1}const a=addr;addr+=ch;return[uni,a]};
  const row=(n,i,w=st.width-1)=>n>1?-w/2+w*i/(n-1):0;
  const add=(type,prefix,n,pos,extra)=>{for(let i=0;i<n;i++){const[u,a]=patch(type),[x,y]=pos(i,n);const f=mkFix(type,n>1?`${prefix}${i+1}`:prefix,+x.toFixed(2),+y.toFixed(2),u,a);
    if(extra)Object.assign(f,typeof extra==='function'?extra(f,i):extra);f.z=Number.isFinite(f.z)?f.z:fixtureZDefault(type,st);out.push(f)}};
  add('bar','BAR',counts.bar,(i,n)=>[row(n,i),.6]);
  add('par','PAR',counts.par,(i,n)=>[row(n,i),D-.5]);
  add('mh','MH',counts.mh,(i,n)=>[row(n,i,st.width-2),D*.4],{z:st.trussHeight,mountToTruss:true});
  add('blinder','STROBO',counts.blinder,(i)=>[(i%2?1:-1)*(W2-.5),D*.5+Math.floor(i/2)*.8]);
  add('haze','FUMO',counts.haze,(i)=>[(i%2?1:-1)*(W2-.3),.3]);
  add('laser','LASER',counts.laser,(i,n)=>[row(n,i,Math.min(4,st.width-2)),1.2],{z:2.5,angle:0,spread:28});
  add('wall','LED WALL',counts.wall,(i,n)=>[row(n,i,Math.max(0,(n-1)*5.6)),.2],{w:Math.min(6,st.width*.6)});
  for(let i=0;i<counts.projector;i++){   // proiettore in sala, puntato su uno schermo in fondo al palco
    const sc=mkFix('screen',counts.projector>1?`SCHERMO ${i+1}`:'SCHERMO',row(counts.projector,i,Math.max(0,(counts.projector-1)*5.5)),.3,0,0);
    const pr=mkFix('projector',counts.projector>1?`PROIETTORE ${i+1}`:'PROIETTORE',sc.x,D+4,0,0);pr.target=sc.id;out.push(sc,pr)}
  add('speaker','CASSA',counts.speaker,(i)=>[(i%2?1:-1)*(W2+.8),D-.5-Math.floor(i/2)*1.2]);
  return out;
}
// gruppi delle luci che ci sono davvero (i nomi di DMX Master restano quelli di sempre)
function wzGroups(fixtures,extra=[]){
  const used=new Set(fixtures.filter(f=>FIX_TYPES[f.type]?.ch).map(f=>f.group));
  // i gruppi legati ai motori di TD (front = rig_a, back = rig_b, mh = teste) ci devono essere sempre
  return[...DEFAULT_GROUPS.filter(g=>used.has(g.group)||g.bind).map(g=>({...g})),...extra.filter(g=>used.has(g.group))];
}
// "Un fader per luce" (26/11): in DMX Master il livello e' del gruppo (rig), non della singola luce.
// Ogni luce del gruppo diventa un gruppo suo (nome dalla luce: PAR1 -> par1), stesso tipo; le teste
// restano un gruppo solo (un motore solo in TD). Torna i gruppi nuovi; cambia f.group delle luci.
function splitPerFixture(fixtures,groups,group){
  const parent=groups.find(g=>g.group===group)||DEFAULT_GROUPS.find(g=>g.group===group)||{kind:'chase'};
  if(parent.kind==='heads')return[];
  const taken=new Set([...groups.map(g=>g.group),...GROUP_RESERVED]),out=[];
  for(const f of fixtures.filter(x=>x.group===group&&FIX_TYPES[x.type]?.ch)){
    let base=String(f.name||f.type).toLowerCase().normalize('NFD').replace(/[^a-z0-9_]+/g,'_').replace(/^[^a-z]+/,'').replace(/_+$/,'').slice(0,14)||f.type;
    if(base.length<2)base=f.type+base;
    let n=base,k=2;while(taken.has(n))n=(base.slice(0,13)+'_'+k++).slice(0,16);
    taken.add(n);out.push({group:n,kind:parent.kind==='level'?'level':'chase',label:f.name||n});f.group=n;
  }
  return out;
}

// ---- analisi ----
function stageAnalysis(lay=L){
  const fx=(lay.fixtures||[]).filter(f=>f.enabled!==false&&!FIX_TYPES[f.type]?.struct);
  const by=t=>fx.filter(f=>f.type===t);
  const dmx=fx.filter(f=>FIX_TYPES[f.type]?.ch);
  const glist=Array.isArray(lay.groups)&&lay.groups.length?lay.groups:groupsOf();
  const groups=[...new Set(dmx.map(f=>f.group).filter(Boolean))].map(g=>({group:g,label:glist.find(x=>x.group===g)?.label||g,n:dmx.filter(f=>f.group===g).length,kind:glist.find(x=>x.group===g)?.kind||''}));
  const widgets=(lay.pages||[]).flatMap(p=>p.widgets);
  const has=t=>widgets.some(w=>w.type===t);
  const lasers=by('laser'),walls=by('wall'),prj=by('projector');
  let problems=[];try{if(lay===L)problems=dmxExportProblems(dmxExportRows())}catch{}
  return{fx,dmx,groups,heads:by('mh').length,lasers,walls,prj,screens:by('screen').length,speakers:by('speaker').length,
    universes:[...new Set(dmx.map(f=>+f.universe||1))].sort((a,b)=>a-b),problems,pages:(lay.pages||[]).map(p=>p.name),
    counts:Object.fromEntries(Object.keys(FIX_TYPES).map(t=>[t,by(t).length]).filter(([,n])=>n)),
    missing:[
      ...(dmx.length&&!has('audiorigs')?[{k:'audio',label:'Audio · reattività dei gruppi'}]:[]),
      ...(by('mh').length&&!has('headmotion')&&!(lay.pages||[]).some(p=>/teste/i.test(p.name))?[{k:'teste',label:'Teste · scene e movimento'}]:[]),
      ...(lasers.length&&!has('laser')?[{k:'laser',label:'Laser'}]:[]),
      ...(dmx.length&&!has('rigconfig')?[{k:'rigconfig',label:'Config rig'}]:[]),
      ...(!has('render3d')?[{k:'render3d',label:'Render 3D'}]:[]),
      ...(prj.length&&!has('mapping')?[{k:'mapping',label:'Mapping'}]:[]),
      ...(groups.length>7&&!(lay.pages||[]).some(p=>p.name==='Fader luci')?[{k:'fader',label:`Fader luci (tutti i ${groups.length} gruppi)`}]:[])]};
}
// Regia su misura: scene, palco, orologi, timeline; fader del master e dei gruppi presenti; comandi in fondo
function regiaFor(a){
  const fad=[['Master','/dmx/master',SWATCH[0]],...a.groups.slice(0,7).map((g,i)=>[g.label,'/dmx/group/'+g.group,SWATCH[(i+1)%SWATCH.length]])];
  // 8 colonne divise fra i fader: i primi prendono la colonna che avanza
  const base=Math.max(1,Math.floor(8/fad.length)),extra=Math.max(0,8-base*fad.length),fw=i=>base+(i<extra?1:0),fx=i=>Array.from({length:i},(_,k)=>fw(k)).reduce((s,v)=>s+v,0),heads=a.heads>0;
  const ws=[W('cuestack',0,0,4,6,{label:'Scene GO',color:SWATCH[3]}),
    W('scenes',4,0,4,6,{label:'Scene a mano',addr:'/dmx/scene',items:'',cols:2,value:-1,color:SWATCH[0]}),
    W('stage',8,0,8,4,{label:'Palco',view:'render'}),
    W('clock',8,4,4,1,{label:'Show',mode:'show',color:SWATCH[0]}),W('clock',12,4,4,1,{label:'Ora',mode:'tod',color:SWATCH[5]}),
    W('timeline',8,5,8,heads?2:3,{label:'Timeline show',addr:'/show',readonly:true,onlyTracks:['fx','laser'],duration:600,bpm:120,cues:'',color:SWATCH[0]}),
    ...fad.map(([label,addr,color],i)=>W('fader',fx(i),6,fw(i),4,{label,addr,value:1,color}))];
  if(heads)ws.push(W('button',8,7,3,1,{label:'Teste: Home',addr:'/mh/home',color:SWATCH[2]}),W('button',11,7,3,1,{label:'Teste: strobo',addr:'/mh/strobe',mode:'toggle',color:SWATCH[5]}),W('button',14,7,2,1,{label:'Rilascia',addr:'/mh/release',color:SWATCH[1]}));
  ws.push(W('button',8,8,2,2,{label:'Blackout',addr:'/dmx/blackout',mode:'toggle',color:SWATCH[2]}),
    W('button',10,8,2,2,{label:'Flash strobo',addr:'/dmx/strobe',color:SWATCH[5]}),
    W('fader',12,8,2,2,{label:'Fade scene (s)',addr:'/dmx/fade',min:0,max:10,value:.4,color:SWATCH[1]}));
  const lbo=a.lasers.length?TPL.laser.pages()[0].widgets.find(w=>w.addr==='/laser/blackout'):null;
  ws.push(lbo?{...lbo,id:uid(),x:14,y:8,w:2,h:2,label:'BLACKOUT laser'}:W('audiorigs',14,8,2,2,{label:'Audio',color:SWATCH[4]}));
  return P('Regia',ws);
}
// tutti i fader dei gruppi (quando in Regia non ci stanno): 8 per riga, larghi 2
function faderPageFor(a){
  const fad=[['Master','/dmx/master',SWATCH[0]],...a.groups.map((g,i)=>[g.label,'/dmx/group/'+g.group,SWATCH[(i+1)%SWATCH.length]])];
  const per=fad.length>16?16:8,w=16/per,rows=Math.ceil(fad.length/per),h=Math.max(3,Math.floor(10/rows));
  return P('Fader luci',fad.map(([label,addr,color],i)=>W('fader',(i%per)*w,Math.floor(i/per)*h,w,h,{label,addr,value:1,color})));
}
const WZ_PAGE={fader:a=>[faderPageFor(a)],audio:()=>TPL.audio.pages(),teste:()=>TPL.teste.pages(),laser:()=>TPL.laser.pages(),rigconfig:()=>TPL.rigconfig.pages(),
  render3d:()=>TPL.render3d.pages(),mapping:()=>TPL.mapping.pages(),consoleaudio:()=>TPL.consoleaudio.pages()};
// timeline di preparazione senza le cue di esempio
function wzTimelinePage(){const p=TPL.timeline.pages()[0];for(const w of p.widgets)if(w.type==='timeline'){w.cues='';w.duration=600;w.bpm=120}return p}

function openStageAnalysis(){
  const a=stageAnalysis(),s=$('#scrim');s.hidden=false;
  const li=(t,n)=>`<li><b>${n}</b> ${esc(t)}</li>`;
  const lab=t=>FIX_TYPES[t]?.label||t;
  s.innerHTML=`<div class="sheet sa-sheet" role="dialog" aria-label="Analisi del palco">
    <div class="top"><h3>🔍 Analisi del palco · ${esc(L._projectName||'layout')}</h3><button class="btn ghost" id="saClose">Chiudi</button></div>
    ${a.fx.length?`<h4>Cosa c'è</h4><ul class="sa-list">${Object.entries(a.counts).map(([t,n])=>li(lab(t),n)).join('')}</ul>
    <p class="hint">${a.dmx.length} luci DMX${a.universes.length?` in ${a.universes.length>1?'universi':'universo'} ${a.universes.join(', ')}`:''}.${a.problems.length?` <b class="pr-dirty">Patch: ${a.problems.length} problemi</b> (${esc(a.problems.slice(0,3).join('; '))}${a.problems.length>3?'…':''}).`:' Patch senza sovrapposizioni.'}</p>
    ${a.groups.length?`<h4>Gruppi (un fader ciascuno in Regia)</h4><div class="sa-groups">${a.groups.map(g=>`<div class="wz-row"><span><b>${g.n}</b> ${esc(g.label)}</span>${g.kind!=='heads'&&g.n>1?`<button class="btn sm ghost" data-sa-split="${esc(g.group)}" title="Ogni luce del gruppo diventa un gruppo suo, con il suo fader in Regia">Un fader per luce</button>`:''}</div>`).join('')}</div>
    <p class="hint">In DMX Master il livello è del gruppo: per avere un fader per ogni luce, ogni luce diventa un gruppo suo (colore e audio restano separabili come sempre).</p>`:''}
    ${a.lasers.length?`<p class="hint">Laser: ${a.lasers.length}, ${a.lasers.filter(f=>f.cube).length} collegati a un LaserCube.${a.lasers.some(f=>!f.cube)?' Collega gli altri dalla Pianta (tocca il laser → LaserCube).':''}</p>`:''}
    ${a.walls.length||a.prj.length?`<p class="hint">Video: ${a.walls.length} LED wall, ${a.prj.length} proiettori (${a.prj.filter(f=>f.target).length} su schermo, ${a.prj.filter(f=>!f.target).length} mapping sul 3D).</p>`:''}`
    :'<p class="hint"><b>Il palco è vuoto.</b> Aggiungi le luci dalla Pianta (pagina Palco) o crea un progetto guidato.</p>'}
    <h4>Pagine</h4><p class="hint">${esc(a.pages.join(' · ')||'nessuna')}</p>
    ${a.missing.length?`<p class="hint">Suggerite per questo palco:</p><div class="sa-chips">${a.missing.map(m=>`<label class="chk"><input type="checkbox" data-sa-add="${m.k}" checked> ${esc(m.label)}</label>`).join('')}</div>`:''}
    <h4>Regia su misura</h4>
    <p class="hint">Scene GO e scene a mano, palco, orologi e timeline; fader Master${a.groups.length?' + '+esc(a.groups.slice(0,7).map(g=>g.label).join(', ')):''}${a.heads?'; comandi teste':''}; blackout, flash, fade${a.lasers.length?', blackout laser':''}. ${a.pages.includes('Regia')?'La Regia di adesso resta salvata nel progetto (copia di sicurezza).':''}</p>
    <div class="cue-editor-actions"><button class="btn" id="saPages"${a.missing.length?'':' disabled'}>＋ Aggiungi le pagine spuntate</button><button class="btn primary" id="saRegia">${a.pages.includes('Regia')?'Rifai la Regia':'Crea la Regia'}</button></div>
  </div>`;
  const q=x=>s.querySelector(x);
  q('#saClose').onclick=closeSheet;
  q('#saPages').onclick=()=>{const ks=[...s.querySelectorAll('[data-sa-add]:checked')].map(i=>i.dataset.saAdd);if(!ks.length)return;
    const ps=ks.flatMap(k=>WZ_PAGE[k](a));L.pages.push(...ps);save();render();initShow();closeSheet();showInfo(`Aggiunte ${ps.length} pagine: ${ps.map(p=>p.name).join(', ')}.`)};
  q('#saRegia').onclick=()=>{rebuildRegia();closeSheet();showInfo('Regia su misura pronta. Salva il progetto da 📁 per tenerla.')};
  s.querySelectorAll('[data-sa-split]').forEach(b=>b.onclick=()=>saSplit(b.dataset.saSplit));
}
// Regia su misura al posto di quella che c'e' (copia in L.pagesBackup); con piu' di 7 gruppi anche "Fader luci"
function rebuildRegia(){
  const a=stageAnalysis(),i=L.pages.findIndex(p=>p.name==='Regia'),fresh=regiaFor(a);
  if(i>=0){L.pagesBackup={...(L.pagesBackup||{}),['regia_'+new Date().toISOString().slice(0,16)]:JSON.parse(JSON.stringify(L.pages[i]))};fresh.id=L.pages[i].id;L.pages[i]=fresh;pi=i}
  else{L.pages.unshift(fresh);pi=0}
  const fp=L.pages.findIndex(p=>p.name==='Fader luci');
  if(a.groups.length>7){const pg=faderPageFor(a);if(fp>=0){pg.id=L.pages[fp].id;L.pages[fp]=pg}else L.pages.splice(L.pages.indexOf(fresh)+1,0,pg)}
  const tl=L.pages.flatMap(p=>p.widgets).find(w=>w.type==='timeline'&&w.addr==='/show'&&!w.readonly);if(tl)syncShowWidgets(tl);
  selId=null;save();render();initShow();
}
// un fader per luce: gruppi nuovi nel progetto, Regia rifatta; se DMX Master c'e', gruppi e luci gia' in TD aggiornati
async function saSplit(group){
  const gl=(Array.isArray(L.groups)&&L.groups.length?L.groups:groupsOf()).map(g=>({...g}));
  for(const d of DEFAULT_GROUPS)if(d.bind&&!gl.some(g=>g.bind===d.bind))gl.push({...d});   // progetti guidati di prima: front/back mancanti
  const n=L.fixtures.filter(f=>f.group===group).length;
  if(!await uiConfirm(`Le ${n} luci di "${groupLabel(group)}" diventano gruppi separati, ognuno col suo fader in Regia.${G.ok&&tdParams().dmx_groups?' I gruppi nuovi vanno anche a DMX Master.':''}`,{ok:'Un fader per luce'}))return;
  const nw=splitPerFixture(L.fixtures,gl,group);if(!nw.length)return;
  L.groups=[...gl,...nw];save();rebuildRegia();closeSheet();
  showInfo(`${nw.length} gruppi nuovi: ${nw.map(g=>g.label).join(', ')}. Regia rifatta.`);
  if(!(G.ok&&Array.isArray(tdParams().dmx_groups)))return;
  sendGroupsToTD();
  const inTd=L.fixtures.filter(f=>nw.some(g=>g.group===f.group)&&tdFixtureByUid(f.id));
  for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,500));const have=new Set((tdParams().dmx_groups||[]).map(x=>x.group));
    if(nw.every(g=>have.has(g.group))){for(const f of inTd)devCmd(dmxId(),{action:'set',param:'dmx_fixture_update',value:{...fixtureTdValue(f),on_conflict:'reject'}});return}}
  showError('DMX Master non ha confermato i gruppi nuovi: le luci in TD restano nel gruppo di prima (riprova da Gruppi DMX).');
}

function openProjectWizard(){
  const s=$('#scrim');s.hidden=false;
  const st={name:'',mode:'lights',stage:'medium',counts:Object.fromEntries(WZ_TYPES.map(([t])=>[t,0])),extra:{consoleaudio:false,render3d:true},indep:true};
  Object.assign(st.counts,{bar:4,par:4});
  const paint=()=>{
    const tot=Object.values(st.counts).reduce((x,y)=>x+y,0);
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Nuovo progetto guidato">
      <div class="top"><h3>✨ Nuovo progetto guidato</h3><button class="btn ghost" id="wzClose">Chiudi</button></div>
      <label>1 · Come si chiama?<input id="wzName" value="${esc(st.name)}" placeholder="es. Club Genova 29/11" maxlength="60"></label>
      <div class="ac-f">2 · Da dove parti?<div class="px-chips"><button class="btn sm${st.mode==='empty'?' primary':' ghost'}" data-wz-m="empty">Vuoto</button><button class="btn sm${st.mode==='lights'?' primary':' ghost'}" data-wz-m="lights">Con luci</button></div></div>
      ${st.mode==='lights'?`
      <div class="ac-f">3 · Quanto è grande il palco?<div class="px-chips">${Object.entries(WZ_STAGES).map(([k,v])=>`<button class="btn sm${st.stage===k?' primary':' ghost'}" data-wz-s="${k}">${esc(v.label)}</button>`).join('')}</div></div>
      <div class="ac-f">4 · Che luci e quante?</div>
      <div class="wz-grid">${WZ_TYPES.map(([t,l,max])=>`<div class="wz-row"><span>${esc(l)}</span><button class="btn sm ghost" data-wz-d="${t}" data-v="-1"${st.counts[t]?'':' disabled'}>−</button><b>${st.counts[t]}</b><button class="btn sm ghost" data-wz-d="${t}" data-v="1"${st.counts[t]<max?'':' disabled'}>＋</button></div>`).join('')}</div>
      <label class="chk"><input type="checkbox" id="wzIndep"${st.indep?' checked':''}> Un fader per ogni luce <em>(ogni luce in un gruppo suo; le teste restano insieme)</em></label>
      <p class="hint">Le luci vanno in posizioni di partenza (barre in fondo, PAR davanti, teste sul truss, strobo ai lati) con la patch in fila dal canale 1. Poi le sposti nella Pianta e correggi indirizzi e modelli.</p>`:'<p class="hint">Progetto senza luci e con tutte le timeline vuote: Regia e Palco. Le luci si aggiungono dalla Pianta.</p>'}
      <div class="ac-f">${st.mode==='lights'?'5':'3'} · Pagine in più<div class="px-chips">
        <label class="chk"><input type="checkbox" id="wzCa"${st.extra.consoleaudio?' checked':''}> Console Audio</label>
        <label class="chk"><input type="checkbox" id="wzR3"${st.extra.render3d?' checked':''}> Render 3D</label></div></div>
      <div class="cue-editor-actions"><button class="btn ghost" id="wzCancel">Annulla</button><button class="btn primary" id="wzGo">Crea il progetto${st.mode==='lights'&&tot?` (${tot} elementi)`:''}</button></div></div>`;
    const q=x=>s.querySelector(x);
    q('#wzClose').onclick=q('#wzCancel').onclick=closeSheet;
    q('#wzName').oninput=e=>{st.name=e.target.value};
    if(q('#wzIndep'))q('#wzIndep').onchange=e=>{st.indep=e.target.checked};
    q('#wzCa').onchange=e=>{st.extra.consoleaudio=e.target.checked};q('#wzR3').onchange=e=>{st.extra.render3d=e.target.checked};
    s.querySelectorAll('[data-wz-m]').forEach(b=>b.onclick=()=>{st.mode=b.dataset.wzM;paint()});
    s.querySelectorAll('[data-wz-s]').forEach(b=>b.onclick=()=>{st.stage=b.dataset.wzS;paint()});
    s.querySelectorAll('[data-wz-d]').forEach(b=>b.onclick=()=>{const t=b.dataset.wzD,max=WZ_TYPES.find(x=>x[0]===t)[2];st.counts[t]=clamp(st.counts[t]+ +b.dataset.v,0,max);paint()});
    q('#wzGo').onclick=async()=>{
      const name=st.name.trim();if(!name){showError('Scrivi il nome del progetto.');q('#wzName').focus();return}
      if(projList().some(p=>p.name===name)){showError(`Esiste già un progetto "${name}".`);return}
      if(L._projectId&&projDirty()&&!await uiConfirm(`"${L._projectName}" ha modifiche non salvate.\nCreare il nuovo progetto senza salvarle?`,{ok:'Crea comunque'}))return;
      wzCreate(name,st);closeSheet();updateProjChip();
      showInfo(`Progetto "${name}" creato e salvato: ${L.fixtures.length} elementi, ${L.pages.length} pagine.`);
    };
  };
  paint();
}
function wzCreate(name,st){
  const lights=st.mode==='lights',S=lights?WZ_STAGES[st.stage]:null;
  const stage={...stageDefaults(),...(S?{width:S.width,depth:S.depth,trussHeight:S.trussHeight,audience:{x:0,y:S.depth+1,width:S.width+4,depth:Math.max(4,S.depth)},foh:{x:-1,y:S.depth+4,width:2,depth:1}}:{})};
  const fixtures=lights?wzFixtures(st.counts,stage):[];
  const base=lights?{}:emptyProjectLayout();
  let extra=[];
  if(lights&&st.indep)for(const g of [...new Set(fixtures.filter(f=>FIX_TYPES[f.type]?.ch&&f.type!=='mh').map(f=>f.group))])
    extra.push(...splitPerFixture(fixtures,[...DEFAULT_GROUPS,...extra],g));
  const lay={...base,fixtures,stage,uiRev:23,...(lights?{groups:wzGroups(fixtures,extra)}:{}),
    fxTimeline:{cues:[]},chaseTimeline:{cues:[]},laserTimeline:{active:false,cues:[]},audioTimeline:{active:false,cues:[]},videoTimeline:{active:false,cues:[]},headTimeline:{cues:[]}};
  if(lights){
    const a=stageAnalysis(lay);
    lay.pages=[regiaFor(a),wzTimelinePage(),...TPL.palco.pages(),...a.missing.filter(m=>m.k!=='render3d'&&m.k!=='mapping').flatMap(m=>WZ_PAGE[m.k](a)),
      ...(a.prj.length?WZ_PAGE.mapping():[])];
  }
  if(st.extra.consoleaudio)lay.pages.push(...WZ_PAGE.consoleaudio());
  if(st.extra.render3d&&!lay.pages.some(p=>p.widgets.some(w=>w.type==='render3d')))lay.pages.push(...WZ_PAGE.render3d());
  L=lay;ensureStageData(L);
  const tl=L.pages.flatMap(p=>p.widgets).find(w=>w.type==='timeline'&&w.addr==='/show'&&!w.readonly);if(tl)syncShowWidgets(tl);
  pi=0;selId=null;projSaveAs(name);render();initShow();
}
