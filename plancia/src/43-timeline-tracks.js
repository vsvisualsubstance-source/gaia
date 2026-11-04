/* ---------- tracce della timeline dello show: un metodo solo per tutte ---------- */
// Ogni traccia si usa allo stesso modo: tocco in un punto = cosa parte da li',
// tocco su un blocco = cambialo o toglilo, trascinamento = spostalo, CUE = l'elenco.
// Le tracce che vanno a DMX Master (SEQUENZE, EFFETTI, TESTE) segnano "da mandare"
// sul pulsante unico ⇪ TD. In ogni timeline si vedono LUCI, le tracce con delle cue e
// quelle scelte con "Tracce" (w.tracks): sette tracce non stanno in un riquadro piccolo.
// Dichiarazioni function: il primo render avviene prima che i moduli siano valutati.
function tlTrackDefs(){
  return[
    {id:'chase',label:'Sequenze (chase)',html:chaseLaneHtml,count:()=>chaseDoc().cues.length,td:true,edit:openChaseCueEditor,
      list:()=>chaseDoc().cues,store:cues=>{L.chaseTimeline={cues}},name:c=>chases().find(x=>x.id===c.chase)?.name||'Fermo',
      empty:()=>chases().length?null:'Nessun chase: crea quelli pronti con "Template" nella pagina Sequenze ed effetti.',
      items:c=>[...chases().map(x=>({label:x.name,value:x.id,on:c?.chase===x.id})),{label:'■ Fermo',value:'off',on:c?.chase==='off'}],
      set:(c,v)=>({...c,chase:v})},
    {id:'fx',label:'Effetti luci',html:fxLaneHtml,count:()=>fxDoc().cues.length,td:true,edit:openFxCueEditor,multi:true,
      list:()=>fxDoc().cues,store:cues=>{L.fxTimeline={cues}},name:c=>(c.effects||[]).map(id=>lightFx().find(f=>f.id===id)?.name||'?').join(' + ')||'Nessuno',
      empty:()=>lightFx().length?null:'Nessun effetto: tocca "Template" nella pagina Sequenze ed effetti.',
      items:c=>lightFx().map(f=>({label:f.name,value:f.id,on:(c?.effects||[]).includes(f.id)})),
      set:(c,v)=>({...c,effects:v})},
    {id:'heads',label:'Teste · posizioni',html:headsLaneHtml,count:w=>timelineCues(w).filter(cueIsHeads).length,edit:w=>openCueEditor(w)},
    {id:'motion',label:'Teste · movimento',html:headMotionLaneHtml,count:()=>hmDoc().cues.length,td:true,edit:openHeadMotionCueEditor,
      list:()=>hmDoc().cues,store:cues=>{L.headTimeline={...hmDoc(),engine:hmEngine(),bpm:hmBpm(),cues}},name:c=>hmScenes().find(x=>x.id===c.scene)?.name||'Fermo',
      empty:()=>hmScenes().length?null:'Nessun movimento: tocca "Template" nella pagina Teste · movimento.',
      items:c=>[...hmScenes().map(x=>({label:x.name,value:x.id,on:c?.scene===x.id})),{label:'■ Fermo',value:'off',on:c?.scene==='off'}],
      set:(c,v)=>({...c,scene:v})},
    {id:'video',label:'Video',html:videoLaneHtml,count:()=>videoDoc().cues.length,edit:openVideoCueEditor,
      list:()=>videoDoc().cues,store:cues=>{L.videoTimeline={...videoDoc(),cues}},
      fresh:t=>({time:t,label:'Video',deck:'A',patch:null,show:null,fx:{}}),copy:c=>({...c,fx:{...(c.fx||{})}})},
    {id:'laser',label:'Laser',html:laserLaneHtml,count:()=>laserDoc().cues.length,edit:openLaserCueEditor,
      list:()=>laserDoc().cues,store:cues=>{L.laserTimeline={...laserDoc(),cues}},
      fresh:t=>({time:t,label:'Laser',cube:'all',mode:'scene',scene:laserScenes()[0]?.id||''}),copy:c=>({...c})}
  ];
}
const tlTrackDef=id=>tlTrackDefs().find(d=>d.id===id);
// visibile se ha delle cue o l'ha scelta chi usa la pagina (mai nascondere del contenuto).
// Le timeline secondarie (Show, Sequenze ed effetti) hanno w.onlyTracks: solo quelle,
// tutte le tracce restano nella pagina Timeline.
function tlTrackVisible(d,w){if(Array.isArray(w.onlyTracks))return w.onlyTracks.includes(d.id);return d.count(w)>0||(!w.readonly&&(w.tracks||[]).includes(d.id))}
function tlTracksHtml(w,D){return tlTrackDefs().filter(d=>tlTrackVisible(d,w)).map(d=>d.html(w,D)).join('')}
async function tlChooseTracks(w){
  const only=Array.isArray(w.onlyTracks);
  const v=await uiChoose('Tracce da vedere in questa timeline',tlTrackDefs().map(d=>({label:d.label,value:d.id,on:tlTrackVisible(d,w),off:!only&&d.count(w)>0})),{multi:true,done:'Fatto',hint:only?'Qui solo le tracce scelte: tutte le tracce sono nella pagina Timeline.':'Una traccia con delle cue resta sempre visibile.'});
  if(v==null)return;
  if(only)w.onlyTracks=v;else w.tracks=v;save();refresh(w);
}
function tlMarkTd(){L.tlTdDirty=true}
// tutte le timeline dello show sono la stessa: una modifica vale per ogni pagina
function syncShowWidgets(w){
  for(const p of L.pages)for(const o of p.widgets)if(o!==w&&o.type==='timeline'&&o.addr===w.addr){o.cues=w.cues;o.duration=w.duration;o.bpm=w.bpm;if(w.tdBaseRev)o.tdBaseRev=w.tdBaseRev}
}
const tlSnap=(w,t)=>Math.max(0,Math.min(timelineDuration(w)-.01,Math.round(t*2)/2));
// tocco o trascinamento su una traccia
function trackPointer(e,el,w,lane){
  e.preventDefault();
  const d=tlTrackDef(lane.dataset.trk),r=lane.getBoundingClientRect(),blk=e.target.closest('[data-ci]'),t=clamp((e.clientX-r.left)/r.width)*timelineDuration(w);
  if(!d)return;
  if(!blk){trackTap(w,d,t,-1);return}
  const ci=+blk.dataset.ci,x0=e.clientX,D=timelineDuration(w),t0=+d.list()[ci]?.time||0;let moved=false;
  try{el.setPointerCapture(e.pointerId)}catch{/* evento sintetico */}
  el.onpointermove=ev=>{if(Math.abs(ev.clientX-x0)>5)moved=true;if(moved)blk.style.left=clamp(t0+(ev.clientX-x0)/r.width*D,0,D-.01)/D*100+'%'};
  el.onpointerup=el.onpointercancel=ev=>{el.onpointermove=el.onpointerup=el.onpointercancel=null;
    if(!moved){trackTap(w,d,t,ci);return}
    const cues=d.list().map(c=>({...c})),to=tlSnap(w,t0+(ev.clientX-x0)/r.width*D);cues[ci].time=to;d.store(cues.sort((a,b)=>a.time-b.time));
    if(d.td)tlMarkTd();save();refreshShowTimelines();showInfo(`Cue spostata a ${formatCueTime(to)}.${d.td&&showClock.authority?' ⇪ TD per mandarla a DMX Master.':''}`)};
}
async function trackTap(w,d,t,ci){
  const cue=ci>=0?d.list()[ci]:null,at=tlSnap(w,t);
  // tracce con cue complesse (video, laser): il loro editor, con la cue nuova gia' al suo posto
  if(!d.items){const cues=d.list().map(d.copy);if(!cue)cues.push(d.fresh(at));d.edit(w,cues,{});return}
  const msg=d.empty();if(msg){showError(msg);return}
  const title=cue?`Cue a ${formatCueTime(cue.time)}: ${d.name(cue)}`:`Da ${formatCueTime(at)} parte…`,items=d.items(cue);
  const pick=await uiChoose(title,cue?[...items,{label:'Togli questa cue',value:'__del',cls:'danger',single:true}]:items,d.multi?{multi:true,done:'OK'}:{});
  if(pick==null)return;
  const cues=d.list().map(c=>({...c}));
  if(pick==='__del')cues.splice(ci,1);else if(cue)cues[ci]=d.set(cues[ci],pick);else cues.push(d.set({time:at,label:''},pick));
  d.store(cues.sort((a,b)=>a.time-b.time));if(d.td)tlMarkTd();save();refreshShowTimelines();
  showInfo(`${d.label}: fatto.${d.td&&showClock.authority?' ⇪ TD per mandarlo a DMX Master.':''}`);
}
// ---- TESTE · posizioni: le cue di scene "solo teste" della timeline di DMX Master
function headsLaneHtml(w,D){
  const cues=timelineCues(w),blocks=cues.map((c,i)=>{if(!cueIsHeads(c))return'';const e=cues.slice(i+1).find(cueTouchesHeads)?.t??D;
    return`<div class="tl-blk" data-k="${i}" style="left:${c.t/D*100}%;width:${(e-c.t)/D*100}%;--ic:#ffb23e"><span><i>${i+1}</i>${esc(c.name)}</span><em>${esc(c.sceneId||'')}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k" title="Dove puntano le teste: scene di sole teste di DMX Master">TESTE POS.</span>
    ${w.readonly?'':'<button class="tl-vcue" data-act="edit-cues" title="Elenco delle cue">CUE</button>'}</div>
    <div class="tl-lane tl-hlane"${w.readonly?'':' title="Tocca un punto: le teste vanno in una posizione da lì. Tocca un blocco per cambiarla"'}><div class="tl-cues">${blocks}</div><span class="tl-vst tl-hst">${blocks||w.readonly?'':'tocca qui per mettere una posizione delle teste'}</span><div class="tl-ph"></div></div></div>`;
}
async function headsLaneTap(w,t,blk){
  const all=timelineCues(w),cue=blk?all[+blk.dataset.k]:null,at=tlSnap(w,t);
  const scenes=tdScenes().filter(s=>sceneKind(s.categories)?.id==='heads');
  const items=[...scenes.map(s=>({label:s.label||s.id,value:s.id,on:cue?.sceneId===s.id})),{label:'＋ Posizione attuale delle teste (nuova scena)',value:'__new'},
    ...(cue?[{label:`Ricattura "${cue.sceneId}" dalla posizione attuale`,value:'__re'},{label:'Togli questa cue',value:'__del',cls:'danger'}]:[])];
  const pick=await uiChoose(cue?`Cue a ${formatCueTime(cue.t)}: ${cue.name}`:`Da ${formatCueTime(at)} le teste vanno in…`,items);
  if(pick==null)return;
  try{
    let id=pick;
    if(pick==='__re'){await tdSceneCommand('show_scene_capture',{name:cue.sceneId,categories:['heads']},()=>true);showInfo(`Scena "${cue.sceneId}" ricatturata.`);return}
    if(pick==='__new')id=await captureHeadsScene();
    const doc=isShowTimeline(w)&&showClock.authority?tdTimelineDoc():null;
    let list=doc?timelineFromTD(doc):parseCues(w).map(c=>({t:c.t,name:c.name,targets:cueTargets(c)}));
    const same=c=>cue&&Math.abs(c.t-cue.t)<.01;
    if(pick==='__del')list=list.filter(c=>!same(c));
    else if(cue)list=list.map(c=>same(c)?{...c,name:tdSceneById(id)?.label||id,targets:`@${id}`}:c);
    else{let tt=at;while(list.some(c=>Math.abs(c.t-tt)<.005))tt=+(tt+.01).toFixed(2);list.push({t:tt,name:tdSceneById(id)?.label||id,targets:`@${id}`})}
    w.cues=serializeCues(list.sort((a,b)=>a.t-b.t));
    if(doc){w.duration=Math.max(1,+doc.length||w.duration);if(+doc.bpm>0)w.bpm=+doc.bpm;w.tdBaseRev=doc.rev}
    syncShowWidgets(w);save();refreshShowTimelines();
    if(doc)sendTimelineToTD(w);else showInfo('Traccia TESTE cambiata.');
  }catch(e){showError('Teste: '+e.message)}
}
// 2026-11-03: ogni timeline mostra le sue tracce; una sola timeline dello show in tutte le pagine (uiRev 13)
function migrateUiTracks(){
  if((L.uiRev||0)>=13)return;
  const shows=L.pages.flatMap(p=>p.widgets.filter(w=>w.type==='timeline'&&w.addr==='/show').map(w=>({p,w})));
  const focus={Sequenze:['chase'],Effetti:['fx'],'Sequenze ed effetti':['chase','fx'],'Teste · movimento':['heads','motion'],Timeline:['chase','fx','heads','motion']};
  for(const{p,w}of shows)if(focus[p.name])w.tracks=focus[p.name];
  const master=shows.find(x=>x.p.name==='Timeline')?.w||shows[0]?.w;
  if(master){L.pagesBackup={...(L.pagesBackup||{}),timelineDrafts_20261103:shows.map(x=>({page:x.p.name,cues:x.w.cues,duration:x.w.duration}))};syncShowWidgets(master)}
  L.uiRev=13;save();
}
// 2026-11-03: Sequenze ed Effetti diventano una pagina sola, gruppi di pagine (uiRev 14)
function migrateUiPageGroups(){
  if((L.uiRev||0)>=14)return;
  const a=L.pages.find(p=>p.name==='Sequenze'),b=L.pages.find(p=>p.name==='Effetti');
  const plain=(p,type)=>!p||p.widgets.every(w=>['timeline','scenes',type].includes(w.type));
  if(a&&plain(a,'chase')&&plain(b,'lightfx')){
    const fresh=TPL.sequenze.pages()[0],old=a.widgets.find(w=>w.type==='timeline');fresh.id=a.id;
    if(old){const t=fresh.widgets.find(w=>w.type==='timeline');t.cues=old.cues;t.duration=old.duration;t.bpm=old.bpm;if(old.tdBaseRev)t.tdBaseRev=old.tdBaseRev}
    L.pagesBackup={...(L.pagesBackup||{}),sequenzeEffetti_20261103:JSON.parse(JSON.stringify([a,b].filter(Boolean)))};
    L.pages[L.pages.indexOf(a)]=fresh;if(b)L.pages.splice(L.pages.indexOf(b),1);
    pi=Math.min(pi,L.pages.length-1);
  }
  L.uiRev=14;save();
}
// 2026-11-04, scelta dell'operatore: Timeline = timeline grande + colonna scene;
// i doppioni (palette, teste, strobo) restano nelle loro pagine; GO/BACK passano
// in Show; la timeline di Sequenze ed effetti mostra solo le sue tracce.
function migrateUiTimelinePage(){
  if((L.uiRev||0)>=15)return;
  const at=(w,x,y,ww,h)=>w.x===x&&w.y===y&&w.w===ww&&w.h===h;
  const tl=L.pages.find(p=>p.name==='Timeline');
  if(tl){
    const dup=w=>(w.type==='scenes'&&['dmx-enum','head-presets','head-select'].includes(w.mode))||(w.type!=='timeline'&&['/mh/position','/mh/color','/dmx/strobe','/dmx/strobe/rate','/show/go','/show/back'].includes(w.addr));
    L.pagesBackup={...(L.pagesBackup||{}),timeline_20261104:JSON.parse(JSON.stringify(tl))};
    tl.widgets=tl.widgets.filter(w=>!dup(w));
    const t=tl.widgets.find(w=>w.type==='timeline'),sc=tl.widgets.find(w=>w.type==='scenes'&&w.addr==='/dmx/scene');
    if(t&&tl.widgets.length===(sc?2:1)){Object.assign(t,{x:0,y:0,w:sc?12:16,h:10});if(sc)Object.assign(sc,{x:12,y:0,w:4,h:10,cols:2})}
  }
  for(const p of L.pages)if(p.name!=='Timeline')for(const w of p.widgets)if(w.type==='timeline'&&w.addr==='/show'&&w.readonly&&!Array.isArray(w.onlyTracks))w.onlyTracks=['chase','fx'];
  const sh=L.pages.find(p=>p.name==='Show');
  if(sh&&!sh.widgets.some(w=>w.addr==='/show/go')){
    const st=sh.widgets.find(w=>w.type==='stage'),t=sh.widgets.find(w=>w.type==='timeline');
    if(st&&t&&at(st,0,0,11,7)&&at(t,0,7,11,3)){st.h=6;t.y=6;if(!Array.isArray(t.onlyTracks))t.onlyTracks=['chase','fx'];
      sh.widgets.push(W('button',0,9,7,1,{label:'GO',addr:'/show/go',color:SWATCH[3]}),W('button',7,9,4,1,{label:'Back',addr:'/show/back',color:SWATCH[5]}))}
  }
  const se=L.pages.find(p=>p.name==='Sequenze ed effetti')?.widgets.find(w=>w.type==='timeline');
  if(se&&!Array.isArray(se.onlyTracks))se.onlyTracks=['chase','fx'];
  pi=Math.min(pi,L.pages.length-1);L.uiRev=15;save();
}
