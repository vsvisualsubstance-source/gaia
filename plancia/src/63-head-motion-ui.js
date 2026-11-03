/* ---------- scene di movimento delle teste: libreria, editor, traccia MOVIMENTO ---------- */
// Libreria nel layout condiviso (L.headMotions), come le scene laser; la timeline
// del movimento e' L.headTimeline. Motore (nota TD 57): DMX Master (heads_motion dal
// vivo, campo motion di show_timeline in timeline), ogni testa per conto suo; oppure,
// se TD non lo offre o lo si sceglie, quello del bridge (head-motion-engine.js).
// Le funzioni usate dal render della timeline sono dichiarazioni function.
function hmScenes(){return Array.isArray(L.headMotions)?L.headMotions:[]}
function hmDoc(){return L.headTimeline&&Array.isArray(L.headTimeline.cues)?L.headTimeline:{active:false,bpm:null,cues:[]}}
// BPM della timeline dello show (DMX Master se la pubblica, altrimenti il widget)
function hmBpm(){const d=tdTimelineDoc(),w=L.pages.flatMap(p=>p.widgets).find(x=>x.type==='timeline'&&x.addr==='/show');return+d?.bpm>0?+d.bpm:+w?.bpm>0?+w.bpm:120}
function hmHeadCount(){return Math.max(1,Math.min(8,tdHeadEntries().length||4))}
function hmTdReady(){return tdParams().heads_motion_state!==undefined||!!G.dxm['td-dmx-win']?.heads?.params?.heads_motion}
// 'td' | 'ops': scelta salvata in L.headTimeline.engine, altrimenti TD se lo offre
function hmEngine(){const e=L.headTimeline?.engine;return e==='ops'||!hmTdReady()?'ops':'td'}
const hmTdScene=sc=>{const o=JSON.parse(JSON.stringify(sc));delete o.template;return o};
function hmPlay(sc){
  if(hmEngine()==='td'){emit({type:'head_motion',action:'stop'},true);devCmd('td-dmx-win',{action:'set',param:'heads_motion',value:{scene:hmTdScene(sc),bpm:liveBpm()}})}
  else emit({type:'head_motion',action:'play',scene:sc,bpm:liveBpm()},true);
}
function hmStop(){if(hmTdReady())devCmd('td-dmx-win',{action:'set',param:'heads_motion',value:null});emit({type:'head_motion',action:'stop'},true)}
// stato del motore in uso: {source, scene: {id, name}}
function hmState(){
  if(hmEngine()==='td'){const s=tdParams().heads_motion_state;return s?{source:s.source,scene:s.scene_id?{id:s.scene_id,name:s.name||s.scene_id}:null,td:true}:null}
  return G.hmSt||null;
}
const HM_COL=['#3ec5ff','#ffb23e','#7dff9a','#ff6ad5','#b18cff','#ff5d5d','#e8ff5a','#5affe4'];
// pad -1..1 (y in alto): figura percorsa e una testa per colore
function hmDraw(cv,sc,t,{heads=hmHeadCount(),bpm=hmBpm(),grid=true}={}){
  const g=cv.getContext('2d'),W=cv.width,H=cv.height,X=x=>(x+1)/2*W,Y=y=>(1-y)/2*H;
  g.clearRect(0,0,W,H);g.fillStyle='#0b0e13';g.fillRect(0,0,W,H);
  if(grid){g.strokeStyle='#ffffff14';g.lineWidth=1;for(const v of[-.5,0,.5]){g.beginPath();g.moveTo(X(v),0);g.lineTo(X(v),H);g.moveTo(0,Y(v));g.lineTo(W,Y(v));g.stroke()}}
  const c=sc.center||[0,0],s=sc.size||[.4,.3],pts=sc.path?.pts||[];
  if(pts.length>1){g.strokeStyle='#ffffff40';g.lineWidth=Math.max(1,W/130);g.beginPath();
    pts.forEach(([x,y],i)=>{const px=X(c[0]+s[0]*x),py=Y(c[1]+s[1]*y);i?g.lineTo(px,py):g.moveTo(px,py)});if(sc.path.closed)g.closePath();g.stroke()}
  const n=(sc.spread?.mode||'same')==='same'?1:heads;
  for(let k=n-1;k>=0;k--){const[x,y]=hmPoint(sc,t,k,bpm);g.fillStyle=HM_COL[k%HM_COL.length];g.beginPath();g.arc(X(x),Y(y),Math.max(3,W/30),0,Math.PI*2);g.fill()}
}
function hmAnimateThumbs(el){
  const t=performance.now()/1000;
  // miniature: la figura ingrandita (centro in mezzo, ampiezza piena), per riconoscerla
  el.querySelectorAll('canvas[data-hm-cv]').forEach(cv=>{const sc=hmScenes().find(x=>x.id===cv.dataset.hmCv);if(!sc)return;
    const s=sc.size||[.4,.3],m=Math.max(s[0],s[1])||1;hmDraw(cv,{...sc,center:[0,0],size:[s[0]/m*.8,s[1]/m*.8]},t,{grid:false})});
}
function hmStatusText(){
  const st=hmState();if(!st)return hmEngine()==='td'?'DMX Master: nessuno stato del movimento':'motore OPS: nessuno stato dal bridge';
  if(st.td)return st.source==='live'?`▶ ${st.scene?.name||''} · dal vivo (DMX Master)`:st.source==='timeline'?`▶ ${st.scene?.name||''} · timeline (DMX Master)`:'fermo · motore DMX Master';
  if(st.source==='live')return`▶ ${st.scene?.name||''} · prova dal vivo`;
  if(st.source==='timeline'&&st.scene)return`▶ ${st.scene.name} · timeline`;
  return st.active?(st.clock?'timeline: nessun movimento ora':'timeline: nessun orologio dello show'):'fermo';
}
// ---- widget: la libreria delle scene di movimento
function hmLibHtml(w){
  const run=hmState()?.scene?.id,eng=hmEngine();
  return`<div class="hm"><div class="hm-top"><span class="hint hm-st">${esc(hmStatusText())}</span>
      <button class="btn sm ghost" data-hm="engine" title="DMX Master: ogni testa per conto suo, sincrono col DMX. OPS: il bridge manda /mh/pantilt, tutte le teste uguali">Motore: ${eng==='td'?'DMX Master':'OPS'}</button>
      <button class="btn sm" data-hm="stop">■ Stop</button><button class="btn sm ghost" data-hm="new">+ Nuova</button>
      <button class="btn sm ghost" data-hm="svg">SVG</button><button class="btn sm ghost" data-hm="reset" title="Rimette i template mancanti">Template</button></div>
    <div class="hm-grid">${hmScenes().map(s=>`<div class="lzs-tile${run===s.id?' on':''}"><button class="lzs-go" data-hm="play" data-hm-v="${esc(s.id)}" title="Prova dal vivo (il motore su OPS muove le teste)">
      <canvas data-hm-cv="${esc(s.id)}" width="120" height="120"></canvas><span>${esc(s.name)}</span></button>
      <button class="lzs-ed" data-hm="edit" data-hm-v="${esc(s.id)}" title="Modifica">✎</button></div>`).join('')||'<p class="hint">Nessuna scena: tocca Template.</p>'}</div>
    <p class="hint">Tocca una scena per provarla sulle teste. Con il motore DMX Master ogni testa va per conto suo (onda, specchio, ventaglio); con il motore OPS fanno tutte lo stesso movimento. In timeline: traccia TESTE MOV.</p></div>`;
}
function hmDown(e,el,w){
  const b=e.target.closest('[data-hm]');if(!b)return;e.preventDefault();
  const a=b.dataset.hm,s=hmScenes().find(x=>x.id===b.dataset.hmV);
  if(a==='play'&&s){hmPlay(s);showInfo(`Movimento "${s.name}" in prova sulle teste.`)}
  else if(a==='stop'){hmStop();showInfo('Movimento fermato: le teste restano dove sono.')}
  else if(a==='engine'){if(!hmTdReady()&&hmEngine()==='ops'){showError('DMX Master non offre ancora il motore di movimento (heads_motion).');return}
    hmStop();const to=hmEngine()==='td'?'ops':'td';L.headTimeline={...hmDoc(),engine:to};save();
    showInfo(to==='td'?'Motore DMX Master: la traccia MOVIMENTO va nella timeline di TD al prossimo invio.':'Motore OPS: il bridge muove le teste (tutte uguali); la traccia MOVIMENTO la esegue il bridge.')}
  else if(a==='edit'&&s)openHeadMotionEditor(s);
  else if(a==='new')openHeadMotionEditor({...hmTemplates()[0],id:'mov-'+uid(),name:'Nuovo movimento',template:false});
  else if(a==='reset'){const have=new Set(hmScenes().map(x=>x.id)),add=hmTemplates().filter(x=>!have.has(x.id));
    L.headMotions=[...hmScenes(),...add];save();showInfo(add.length?`Aggiunti ${add.length} template.`:'Tutti i template ci sono già.')}
  else if(a==='svg'){const inp=document.createElement('input');inp.type='file';inp.accept='.svg,image/svg+xml';
    inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;
      try{const lz=await lzsImportSvg(f),pts=lz.strokes.flatMap(x=>x.pts);if(pts.length<2)throw new Error('nessuna linea');
        openHeadMotionEditor({...hmTemplates()[0],id:'mov-'+uid(),name:lz.name,template:false,path:{pts:hmThin(pts),closed:lz.strokes.length===1&&!!lz.strokes[0].closed}})}
      catch(err){showError('SVG: '+err.message)}};inp.click();return}
  refresh(w);
}
// al massimo n punti, distribuiti lungo il percorso
function hmThin(pts,n=160){if(pts.length<=n)return pts;const out=[];for(let i=0;i<n;i++)out.push(pts[Math.round(i*(pts.length-1)/(n-1))]);return out}
// punti assoluti del pad -> figura normalizzata + centro e ampiezza
function hmFit(abs){
  const xs=abs.map(p=>p[0]),ys=abs.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const hx=(Math.max(...xs)-Math.min(...xs))/2,hy=(Math.max(...ys)-Math.min(...ys))/2;
  return{center:[+cx.toFixed(3),+cy.toFixed(3)],size:[+hx.toFixed(3),+hy.toFixed(3)],
    pts:hmThin(abs).map(([x,y])=>[+(hx?(x-cx)/hx:0).toFixed(4),+(hy?(y-cy)/hy:0).toFixed(4)])};
}
// pad pan/tilt della pagina (/mh/pantilt) in unita' -1..1
function hmPadNow(){
  const w=L.pages.flatMap(p=>p.widgets).find(x=>x.type==='xy'&&x.addr==='/mh/pantilt');if(!w)return null;
  const mn=w.min??-1,mx=w.max??1;return[mn+(+w.value||0)*(mx-mn),mn+(+w.valueY||0)*(mx-mn)];
}
function openHeadMotionEditor(orig){
  const sc=JSON.parse(JSON.stringify(orig)),s=$('#scrim');s.hidden=false;
  sc.center=sc.center||[0,0];sc.size=sc.size||[.4,.3];sc.period={value:8,unit:'beats',...sc.period};sc.spread={mode:'same',phase:0,...sc.spread};
  let drawing=null,follow=false;const bpm=hmBpm();
  const sl=(id,label,v,min,max,step)=>`<label class="ar-sl"><span>${label}<b id="${id}V">${(+v).toFixed(2)}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  const opt=(list,cur)=>list.map(([k,t])=>`<option value="${k}"${k===cur?' selected':''}>${esc(t)}</option>`).join('');
  const shapes=[['','— figura attuale —'],['cerchio','Cerchio'],['otto','Otto'],['scanner','Linea orizzontale'],['annuisci','Linea verticale'],['apri','Mezza linea (ventaglio)'],['onda','Onda'],['quadrato','Quadrato'],['triangolo','Triangolo'],['balletto','Lissajous'],['vagare','Vagare']];
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Movimento teste">
    <div class="top"><h3>Movimento teste</h3><button class="btn ghost" id="hmClose">Chiudi</button></div>
    <div class="lzs-ed-grid"><div><canvas id="hmPrev" width="280" height="280" class="hm-pad"></canvas>
        <div class="row"><button class="btn sm" id="hmDraw" title="Disegna la figura col dito sul riquadro">✎ Disegna</button><button class="btn sm" id="hmRec" title="Registra il movimento che fai sul riquadro, con i suoi tempi">● REC</button>
        <label class="chk"><input id="hmFollow" type="checkbox"> le teste seguono il dito</label></div>
        <p class="hint" id="hmPadHint">Pad pan/tilt: destra = pan +, alto = tilt su. Un pallino per testa.</p></div><div>
      <label>Nome<input id="hmName" value="${esc(sc.name)}"></label>
      <label>Figura<select id="hmShape">${opt(shapes,'')}</select></label>
      <div class="two">${sl('hmCx','Centro pan',sc.center[0],-1,1,.01)}${sl('hmCy','Centro tilt',sc.center[1],-1,1,.01)}</div>
      <div class="row"><button class="btn sm ghost" id="hmFromPad" title="Il centro diventa la posizione attuale del pad Pan / Tilt">Centro dal pad</button></div>
      <div class="two">${sl('hmSx','Ampiezza pan',sc.size[0],0,1,.01)}${sl('hmSy','Ampiezza tilt',sc.size[1],0,1,.01)}</div>
    </div></div>
    <div class="two"><label>Un giro dura<span class="row"><input id="hmPer" type="number" min="0.25" step="0.25" value="${sc.period.value}" style="flex:1"><select id="hmUnit">${opt([['beats',`battiti (${bpm} BPM)`],['s','secondi']],sc.period.unit)}</select></span></label>
      <label>Andamento<select id="hmEase">${opt(HM_EASINGS,sc.easing||'linear')}</select></label></div>
    <div class="row"><label class="chk"><input id="hmPing" type="checkbox"${sc.pingpong?' checked':''}> Avanti e indietro</label><label class="chk"><input id="hmRev" type="checkbox"${sc.reverse?' checked':''}> Verso opposto</label></div>
    <div class="two"><label>Più teste<select id="hmSpread">${opt(HM_SPREADS,sc.spread.mode)}</select></label>${sl('hmPhase','Sfasamento tra teste (giri)',sc.spread.phase,0,.5,.01)}</div>
    <div class="two"><label class="chk"><input id="hmMotorOn" type="checkbox"${sc.motor!=null?' checked':''}> Imposta la velocità dei motori</label>${sl('hmMotor','Velocità motori (heads_speed)',sc.motor??1,0,1,.01)}</div>
    <p class="hint">La velocità del movimento è la durata di un giro; la velocità dei motori è quanto in fretta la testa insegue (bassa = più morbido, alta = segue le figure veloci). Con il motore su OPS tutte le teste fanno lo stesso movimento.</p>
    <div class="row"><button class="btn" id="hmTry">▶ Prova sulle teste</button><button class="btn" id="hmStopB">■ Stop</button></div>
    <div class="cue-editor-actions"><button class="btn danger" id="hmDel">Elimina</button><button class="btn ghost" id="hmDup">Duplica</button><button class="btn primary" id="hmSave">Salva</button></div>
  </div>`;
  const q=x=>s.querySelector(x);
  const read=()=>{
    sc.name=q('#hmName').value.trim()||'Movimento';sc.center=[+q('#hmCx').value,+q('#hmCy').value];sc.size=[+q('#hmSx').value,+q('#hmSy').value];
    sc.period={value:Math.max(.25,+q('#hmPer').value||8),unit:q('#hmUnit').value};sc.easing=q('#hmEase').value;
    sc.pingpong=q('#hmPing').checked;sc.reverse=q('#hmRev').checked;sc.spread={mode:q('#hmSpread').value,phase:+q('#hmPhase').value};
    sc.motor=q('#hmMotorOn').checked?+q('#hmMotor').value:null;return sc};
  const setSl=(id,v)=>{q('#'+id).value=v;q('#'+id+'V').textContent=(+v).toFixed(2)};
  s.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{q('#'+r.id+'V').textContent=(+r.value).toFixed(2);read()});
  s.querySelectorAll('select,input[type=checkbox],input[type=number],#hmName').forEach(x=>x.addEventListener('input',read));
  q('#hmShape').onchange=e=>{if(e.target.value){sc.path=hmShape(e.target.value);read()}};
  q('#hmFromPad').onclick=()=>{const p=hmPadNow();if(!p){showError('Nessun pad Pan / Tilt (/mh/pantilt) nelle pagine.');return}setSl('hmCx',p[0].toFixed(2));setSl('hmCy',p[1].toFixed(2));read()};
  q('#hmFollow').onchange=e=>{follow=e.target.checked};
  // disegno e REC sul riquadro: punti assoluti del pad, poi figura + centro + ampiezza
  const cv=q('#hmPrev'),padAt=ev=>{const r=cv.getBoundingClientRect();return[clamp((ev.clientX-r.left)/r.width)*2-1,1-clamp((ev.clientY-r.top)/r.height)*2]};
  let lastFollow=0;
  const arm=mode=>{drawing={mode,armed:true,pts:[],t0:0};q('#hmPadHint').textContent=mode==='rec'?'REC: muovi il dito sul riquadro; quando alzi il dito il movimento diventa la figura, con la sua durata.':'Disegna la figura col dito sul riquadro.';
    q('#hmRec').classList.toggle('on',mode==='rec');q('#hmDraw').classList.toggle('on',mode==='draw')};
  q('#hmDraw').onclick=()=>arm('draw');q('#hmRec').onclick=()=>arm('rec');
  cv.onpointerdown=ev=>{if(!drawing)return;ev.preventDefault();try{cv.setPointerCapture(ev.pointerId)}catch{/* evento sintetico */}drawing.t0=performance.now();drawing.pts=[padAt(ev)];
    cv.onpointermove=e2=>{const p=padAt(e2);drawing.pts.push(p);const n=performance.now();if(follow&&n-lastFollow>40){lastFollow=n;fire('/mh/pantilt',p)}};
    cv.onpointerup=cv.onpointercancel=()=>{cv.onpointermove=cv.onpointerup=cv.onpointercancel=null;const d=drawing;drawing=null;q('#hmRec').classList.remove('on');q('#hmDraw').classList.remove('on');
      if(d.pts.length<3){q('#hmPadHint').textContent='Troppo pochi punti: riprova.';return}
      const fit=hmFit(d.pts);sc.path={pts:fit.pts,closed:d.mode==='rec'};
      setSl('hmCx',fit.center[0]);setSl('hmCy',fit.center[1]);setSl('hmSx',Math.min(1,fit.size[0]));setSl('hmSy',Math.min(1,fit.size[1]));
      if(d.mode==='rec'){const sec=(performance.now()-d.t0)/1000;q('#hmUnit').value='s';q('#hmPer').value=Math.max(.25,+sec.toFixed(2));q('#hmEase').value='linear';q('#hmPing').checked=false}
      read();q('#hmPadHint').textContent=d.mode==='rec'?`Registrato: ${d.pts.length} punti in ${(+q('#hmPer').value).toFixed(1)} s, si ripete in giro.`:`Figura disegnata: ${d.pts.length} punti.`}};
  const t0=performance.now();
  const anim=()=>{if(!document.body.contains(cv))return;if(!drawing||!drawing.pts.length)hmDraw(cv,sc,(performance.now()-t0)/1000,{bpm});
    else{const g=cv.getContext('2d');hmDraw(cv,{...sc,path:{pts:[]}},0,{bpm,heads:0});g.strokeStyle='#ffb23e';g.lineWidth=3;g.beginPath();
      drawing.pts.forEach(([x,y],i)=>{const px=(x+1)/2*cv.width,py=(1-y)/2*cv.height;i?g.lineTo(px,py):g.moveTo(px,py)});g.stroke()}
    requestAnimationFrame(anim)};anim();
  const store=x=>{const list=[...hmScenes()],i=list.findIndex(y=>y.id===x.id);if(i<0)list.push(x);else list[i]=x;L.headMotions=list;if(hmDoc().cues.some(c=>c.scene===x.id))tlMarkTd();save()};
  q('#hmClose').onclick=closeSheet;
  q('#hmTry').onclick=()=>{read();hmPlay(sc);showInfo(`Prova di "${sc.name}" sulle teste (non salvata).`)};
  q('#hmStopB').onclick=()=>{hmStop();showInfo('Movimento fermato.')};
  // un template modificato diventa una scena nuova: il template resta com'era
  q('#hmSave').onclick=()=>{read();if(sc.template){sc.id='mov-'+uid();if(sc.name===orig.name)sc.name+=' (mio)'}delete sc.template;store(sc);closeSheet();showInfo(`Movimento "${sc.name}" salvato nel progetto.`)};
  q('#hmDup').onclick=()=>{read();const c={...JSON.parse(JSON.stringify(sc)),id:'mov-'+uid(),name:sc.name+' (copia)'};delete c.template;store(c);openHeadMotionEditor(c)};
  q('#hmDel').onclick=()=>{const used=hmDoc().cues.filter(c=>c.scene===sc.id).length;
    if(!confirm(`Eliminare "${sc.name}"?${used?`\nÈ usato da ${used} cue della traccia MOVIMENTO.`:''}`))return;
    L.headMotions=hmScenes().filter(x=>x.id!==sc.id);save();closeSheet()};
}
registerWidget('headmotion',{size:[8,6],label:'Movimento teste',showsValue:false,showsAddr:false,
  inner:()=>'<div class="hm-box"></div>',
  onPointer:hmDown,
  tick:(el,w)=>{
    const box=el.querySelector('.hm-box'),sig=JSON.stringify([hmScenes().map(s=>[s.id,s.name]),hmState()?.scene?.id||null,hmEngine()]);
    if(box&&box._sig!==sig){box._sig=sig;box.innerHTML=hmLibHtml(w)}
    const st=el.querySelector('.hm-st'),txt=hmStatusText();if(st&&st.textContent!==txt)st.textContent=txt;hmAnimateThumbs(el)},
  help:()=>['Movimento teste','Scene di movimento delle teste, come le scene laser: tocca una scena per provarla, ✎ per modificarla (figura da template, disegnata, registrata con REC o da SVG; centro, ampiezza, durata di un giro in battiti o secondi, andamento, velocità dei motori). Le esegue il motore della Plancia su OPS, anche a tablet chiuso; in timeline vanno nella traccia MOVIMENTO.']});

// ---- traccia MOVIMENTO della timeline dello show (la esegue il bridge)
function headMotionLaneHtml(w,D){
  const cues=[...hmDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const e=cues[i+1]?.time??D,sc=hmScenes().find(s=>s.id===c.scene);
    return`<div class="tl-blk tl-vblk" data-ci="${hmDoc().cues.indexOf(c)}" style="left:${c.time/D*100}%;width:${Math.max(0,e-c.time)/D*100}%;--ic:${c.scene==='off'||!sc?'#5d6573':'#3ec5ff'}"><span>${esc(c.label||sc?.name||'Fermo')}</span><em>${esc(c.scene==='off'?'fermo':sc?sc.name:'(scena tolta)')}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k" title="Figure che le teste percorrono: cerchio, otto, ventaglio...">TESTE MOV.</span>
    ${hmEngine()==='td'?'<span class="tl-mtd" title="Motore DMX Master: la traccia va con la timeline di TD e segue il suo LIVE/TIMELINE">TD</span>':`<button class="tl-live tl-mlive" data-act="mlive"${w.readonly?' disabled':''} title="MOVIMENTO · TIMELINE: il motore su OPS muove le teste secondo la timeline. LIVE: solo prove dal tablet">—</button>`}
    ${w.readonly?'':'<button class="tl-vcue" data-act="mcue" title="Elenco delle cue di movimento">CUE</button>'}
    </div><div class="tl-vlane tl-tlane" data-trk="motion"${w.readonly?'':' title="Tocca un punto: un movimento parte da lì. Tocca un blocco per cambiarlo, trascinalo per spostarlo"'}><div class="tl-cues">${blocks}</div><span class="tl-vst tl-mst"></span><div class="tl-ph tl-mph"></div></div></div>`;
}
function paintHeadMotionLane(el,w,D,t){
  const b=el.querySelector('.tl-mlive');
  if(b){const on=!!hmDoc().active,txt=on?'TIMELINE':'LIVE';if(b.textContent!==txt){b.textContent=txt;b.classList.toggle('is-tl',on);b.classList.toggle('is-live',!on)}}
  const s=el.querySelector('.tl-mst');if(!s)return;
  const msg=hmDoc().cues.length?(hmEngine()==='td'&&L.tlTdDirty?'da mandare: ⇪ TD':hmStatusText()):w.readonly?'':'tocca qui per far partire un movimento';if(s.textContent!==msg)s.textContent=msg;
  const ph=el.querySelector('.tl-mph');if(ph&&D>0)ph.style.left=Math.max(0,Math.min(1,t/D))*100+'%';
}
async function toggleHeadMotionActive(){
  const doc=hmDoc(),on=!!doc.active;
  if(!on&&!await uiConfirm('Il MOVIMENTO delle teste segue la timeline?\nIl motore su OPS muove subito le teste secondo il tempo corrente.',{ok:'TIMELINE'}))return;
  L.headTimeline={...doc,engine:'ops',active:!on,bpm:hmBpm()};save();refreshShowTimelines();
  showInfo(on?'MOVIMENTO LIVE: solo prove dal tablet.':'MOVIMENTO TIMELINE: il motore su OPS segue la timeline.');
}
function openHeadMotionCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  cues=cues||hmDoc().cues.map(c=>({...c}));
  const opt=(v,cur,t)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`;
  const rows=cues.map((c,i)=>`<div class="vcue-row mcue-row" data-v="${i}">
    <label>Posizione<input class="mc-time" value="${esc(formatCueTime(+c.time||0))}" inputmode="decimal"></label>
    <label>Nome<input class="mc-label" value="${esc(c.label||'')}" placeholder="es. Ritornello cerchi"></label>
    <label>Movimento<select class="mc-scene">${opt('off',c.scene,'■ Fermo')}${hmScenes().map(x=>opt(x.id,c.scene,x.name)).join('')}</select></label>
    <button class="btn sm danger mc-del" title="Togli">×</button></div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline movimento">
    <div class="top"><h3>Timeline movimento teste</h3><button class="btn ghost" id="mcClose">Chiudi</button></div>
    <p class="hint">Ogni cue fa partire un <b>movimento</b> (o lo ferma) all'istante indicato, fino alla cue successiva. Il movimento parte dal centro della sua scena: posizioni, colori e gobo restano quelli delle scene di DMX Master (traccia TESTE). I giri a battiti seguono il BPM della timeline (${hmBpm()}).</p>
    <div class="vcue-list">${rows||'<p class="hint">Nessuna cue di movimento.</p>'}</div>
    <div class="row"><button class="btn" id="mcAdd">＋ Aggiungi cue</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="mcCancel">Annulla</button><button class="btn primary" id="mcSave">Salva</button></div>
  </div>`;
  const read=()=>[...s.querySelectorAll('.mcue-row')].map(r=>({time:parseCueTime(r.querySelector('.mc-time').value),label:r.querySelector('.mc-label').value.trim(),scene:r.querySelector('.mc-scene').value}));
  s.querySelector('#mcClose').onclick=s.querySelector('#mcCancel').onclick=closeSheet;
  s.querySelector('#mcAdd').onclick=()=>{const cur=read(),last=cur.reduce((m,c)=>Number.isFinite(c.time)?Math.max(m,c.time):m,-10);
    cur.push({time:Math.min(Math.max(0,D-1),last+10),label:'',scene:hmScenes()[0]?.id||'off'});openHeadMotionCueEditor(w,cur,meta)};
  s.querySelectorAll('.mc-del').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.closest('.mcue-row').dataset.v,1);openHeadMotionCueEditor(w,cur,meta)});
  s.querySelector('#mcSave').onclick=()=>{
    const cur=read(),bad=cur.find(c=>!Number.isFinite(c.time)||c.time<0||c.time>=D);
    if(bad){showError(`Cue di movimento "${bad.label||'?'}": posizione tra 0:00 e prima di ${formatCueTime(D)}.`);return}
    L.headTimeline={...hmDoc(),engine:hmEngine(),bpm:hmBpm(),cues:cur.sort((a,b)=>a.time-b.time)};
    save();refreshShowTimelines();closeSheet();showInfo(`Timeline movimento salvata: ${cur.length} cue.`);
    // motore DMX Master: la traccia va con la timeline (campo motion di show_timeline)
    if(hmEngine()==='td'&&isShowTimeline(w)&&showClock.authority){const doc=tdTimelineDoc();if(doc){w.cues=serializeCues(timelineFromTD(doc));w.duration=Math.max(1,+doc.length||w.duration);if(+doc.bpm>0)w.bpm=+doc.bpm;w.tdBaseRev=doc.rev}sendTimelineToTD(w)}
  };
}
// campo motion di show_timeline (nota TD 57): scene usate + cue; null = traccia tolta
function hmTimelineMotion(){
  if(hmEngine()!=='td')return hmTdReady()?null:undefined;
  const cues=hmDoc().cues.filter(c=>Number.isFinite(+c.time)),used=new Set(cues.map(c=>c.scene).filter(x=>x&&x!=='off'));
  if(!cues.length)return null;
  return{scenes:hmScenes().filter(s=>used.has(s.id)).map(hmTdScene),cues:cues.map(c=>({time:+c.time,scene:used.has(c.scene)&&hmScenes().some(s=>s.id===c.scene)?c.scene:'off',label:c.label||''}))};
}
// 2026-11-03: libreria dei movimenti con i template e pagina "Teste · movimento"
// rifatta attorno alla libreria (uiRev 9; la prima versione, uiRev 8, generava cue)
function migrateUiHeadMotion(){
  if((L.uiRev||0)>=9)return;
  if(!Array.isArray(L.headMotions))L.headMotions=hmTemplates();
  const fresh=TPL.teste.pages()[0],i=L.pages.findIndex(p=>p.name===fresh.name);
  if(i>=0){fresh.id=L.pages[i].id;L.pages[i]=fresh}
  else{const at=L.pages.findIndex(p=>p.name==='Teste mobili')+1||L.pages.length;L.pages.splice(at,0,fresh)}
  L.uiRev=9;save();
}
