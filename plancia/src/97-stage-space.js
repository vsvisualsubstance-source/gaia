/* ---------- spazio dello show: sala, schermo di proiezione, proiettore ---------- */
// Coordinate della Pianta: x da -larghezza/2 a +larghezza/2, y = 0 fondo del
// palco, cresce verso il pubblico. La SALA e' il contenitore: auto = attorno a
// palco + platea + regia con 2 m di margine, oppure misure vere (larghezza,
// profondita', altezza, spazio dietro al palco). L'ingombro dello show =
// rettangolo che contiene palco, platea e regia.
function showFootprint(st=L.stage){
  const xs=[-st.width/2,st.width/2],ys=[0,st.depth];
  for(const a of [st.audience,st.foh])if(a){xs.push(a.x-a.width/2,a.x+a.width/2);ys.push(a.y,a.y+a.depth)}
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return{minX,maxX,minY,maxY,width:maxX-minX,depth:maxY-minY};
}
// rettangolo della sala {x0,y0,width,depth,height}
function venueRect(st=L.stage){
  const v=st.venue||{auto:true};
  if(v.auto!==false){const fp=showFootprint(st),m=2;
    return{x0:fp.minX-m,y0:fp.minY-m,width:fp.width+2*m,depth:fp.depth+2*m,height:+v.height||Math.max(st.trussHeight+2,6),auto:true}}
  return{x0:-(+v.width||20)/2,y0:-(+v.back||2),width:+v.width||20,depth:+v.depth||30,height:+v.height||8,auto:false};
}
// proiettore -> schermo bersaglio, distanza e larghezza dell'immagine (rapporto di tiro)
const projectorTarget=f=>f.target?(L.fixtures||[]).find(x=>x.id===f.target&&x.type==='screen'):null;
function projectorInfo(f){
  const sc=projectorTarget(f);if(!sc)return null;
  const dist=Math.hypot(sc.x-f.x,sc.y-f.y,((sc.z||0)+(sc.h||2.8)/2)-(f.z||0));
  const img=dist/Math.max(.1,+f.throw||1.5);
  return{screen:sc,dist,img,fit:img/(sc.w||5)};
}
const screenLit=sc=>(L.fixtures||[]).some(p=>p.type==='projector'&&p.enabled!==false&&p.target===sc.id);

// ---- Planimetria del locale (sfondo della Pianta) ----
// L.stage.plan = {src:'/plans/<hash>.jpg', pw, ph (pixel), mpp (metri per pixel),
// cx, cy (centro, metri della Pianta), rot (0/90/180/270), op (0..1), on, invert}.
// L'immagine sta nel bridge (POST /api/plan-image), nello stato solo l'indirizzo.
// Il palco resta fermo (x 0 al centro, y 0 al fondo): si sposta la mappa sotto.
const planImgs=new Map();
function planImage(src){
  let im=planImgs.get(src);
  if(!im){im=new Image();im.src=src;planImgs.set(src,im)}
  return im.complete&&im.naturalWidth?im:null;
}
// rettangolo occupato (metri), tenendo conto della rotazione
function planBounds(p=L.stage?.plan){
  if(!p?.src||p.on===false)return null;
  const side=(p.rot||0)%180!==0,w=(side?p.ph:p.pw)*p.mpp,h=(side?p.pw:p.ph)*p.mpp;
  return{x0:p.cx-w/2,y0:p.cy-h/2,w,h};
}
function drawPlanPlot(g,X,Y,s){
  const p=L.stage?.plan;if(!p?.src||p.on===false)return;
  const im=planImage(p.src);if(!im)return;
  g.save();g.globalAlpha=p.op??.55;g.translate(X(p.cx),Y(p.cy));g.rotate((p.rot||0)*Math.PI/180);
  const w=p.pw*p.mpp*s,h=p.ph*p.mpp*s;
  // le piante sono nero su bianco: invertite per stare sul fondo scuro (i colori restano)
  if(p.invert!==false)g.filter='invert(1) hue-rotate(180deg)';
  g.drawImage(im,-w/2,-h/2,w,h);g.restore();
}
// modo di modifica attivo sulla Pianta: null | {mode:'cal', pts:[{x,y}]} | {mode:'move'}
let planEdit=null;
function drawPlanEdit(g,X,Y,W,txt){
  if(!planEdit)return;
  const msg=planEdit.mode==='cal'?(planEdit.pts.length?'CALIBRA: tocca il secondo capo della misura':'CALIBRA: tocca il primo capo di una misura nota (es. la quota 1336 = 13,36 m)')
    :'SPOSTA PLANIMETRIA: trascina la mappa sotto il palco · un tocco senza trascinare = fine';
  g.fillStyle='#00ffccdd';g.fillRect(0,0,W,22);txt(msg,8,15,'#06110e','left',11);
  if(planEdit.mode==='cal'){
    const pts=planEdit.pts.map(p=>[X(p.x),Y(p.y)]);
    g.strokeStyle='#00ffcc';g.fillStyle='#00ffcc';g.lineWidth=2;
    if(pts.length===2){g.beginPath();g.moveTo(...pts[0]);g.lineTo(...pts[1]);g.stroke()}
    for(const [x,y] of pts){g.beginPath();g.arc(x,y,5,0,Math.PI*2);g.fill()}
  }
}
// tocco sulla Pianta in modo planimetria: true = gestito qui
function planPointer(e,el,toLocal,toM){
  if(!planEdit)return false;
  const plan=L.stage.plan;if(!plan){planEdit=null;return false}
  const p0=toM(toLocal(e)),start={x:e.clientX,y:e.clientY},c0={cx:plan.cx,cy:plan.cy};let moved=false;
  e.preventDefault();el.setPointerCapture(e.pointerId);
  el.onpointermove=ev=>{
    if(!moved&&Math.hypot(ev.clientX-start.x,ev.clientY-start.y)>6)moved=true;
    if(planEdit?.mode==='move'&&moved){const m=toM(toLocal(ev));plan.cx=c0.cx+(m.x-p0.x);plan.cy=c0.cy+(m.y-p0.y)}
  };
  el.onpointerup=el.onpointercancel=async()=>{
    el.onpointermove=null;el.onpointerup=el.onpointercancel=null;
    if(planEdit?.mode==='move'){if(moved)save();else{planEdit=null;showInfo('Planimetria al suo posto.')}return}
    if(planEdit?.mode!=='cal'||moved)return;
    planEdit.pts.push(p0);if(planEdit.pts.length<2)return;
    const [a,b]=planEdit.pts,d=Math.hypot(b.x-a.x,b.y-a.y);
    const v=await uiPrompt(`Misura vera tra i due punti: in metri (13.36) o come sulla pianta in cm (1336). Ora sulla mappa: ${d.toFixed(2)} m`,'');
    planEdit=null;
    const real=parsePlanLength(v);
    if(!real||d<1e-6){if(v)showError('Misura non valida.');return}
    const k=real/d;plan.mpp*=k;plan.cx=a.x+(plan.cx-a.x)*k;plan.cy=a.y+(plan.cy-a.y)*k;save();
    showInfo(`Scala impostata (${real.toFixed(2)} m). Ora 📐 Spazio → ✥ Sposta, per mettere la mappa sotto il palco.`);
  };
  return true;
}
// "13,36" o "13.36m" -> 13.36; "1336cm" o "1336" (numero grande senza unita', come le quote in cm) -> 13.36
function parsePlanLength(v){
  const t=String(v||'').trim().toLowerCase().replace(',','.'),m=/^(\d+(?:\.\d+)?)\s*(cm|mm|m)?$/.exec(t);if(!m)return 0;
  let n=+m[1];const u=m[2]||(n>=100?'cm':'m');n=u==='cm'?n/100:u==='mm'?n/1000:n;
  return n>0&&n<1000?n:0;
}
// immagine scelta -> ridotta (lato lungo max 3000 px) -> bridge -> L.stage.plan
async function uploadPlanImage(file){
  if(!/^image\//.test(file.type))throw new Error('Serve un\'immagine (JPG, PNG). Un PDF va prima esportato come immagine.');
  const url=URL.createObjectURL(file);
  try{
    const im=await new Promise((ok,ko)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ko(new Error('immagine non leggibile'));i.src=url});
    const k=Math.min(1,3000/Math.max(im.naturalWidth,im.naturalHeight)),pw=Math.round(im.naturalWidth*k),ph=Math.round(im.naturalHeight*k);
    const cv=document.createElement('canvas');cv.width=pw;cv.height=ph;const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,pw,ph);g.drawImage(im,0,0,pw,ph);
    const blob=await new Promise(ok=>cv.toBlob(ok,'image/jpeg',.9));
    const r=await fetch('/api/plan-image',{method:'POST',headers:{'content-type':'image/jpeg'},body:blob});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||('HTTP '+r.status));
    // prima posizione: larga quanto la sala, centrata sul palco; poi si calibra
    const st=L.stage,v=venueRect(st),old=st.plan;
    st.plan={src:d.src,pw,ph,mpp:Math.max(v.width,20)/pw,cx:0,cy:st.depth/2,rot:0,op:old?.op??.55,on:true,invert:old?.invert??true,name:file.name};
    save();return st.plan;
  }finally{URL.revokeObjectURL(url)}
}

// ---- Pianta ----
function drawVenuePlot(g,X,Y,s,txt){
  const v=venueRect();
  g.save();g.strokeStyle='#3a4250';g.lineWidth=1.5;g.setLineDash([10,5]);
  g.strokeRect(X(v.x0),Y(v.y0),v.width*s,v.depth*s);g.setLineDash([]);g.restore();
  const fp=showFootprint();
  txt(`SALA ${v.width.toFixed(1)} × ${v.depth.toFixed(1)} m · h ${v.height.toFixed(1)} m${v.auto?' (auto)':''} · show ${fp.width.toFixed(1)} × ${fp.depth.toFixed(1)} m`,X(v.x0)+6,Y(v.y0)+13,'#6b7480','left',9);
}
function drawScreenPlot(g,f,x,y,s,col,selected){
  const ww=(f.w||5)*s,hh=.12*s;
  g.save();g.translate(x,y);g.rotate((f.rot||0)*Math.PI/180);
  g.fillStyle=screenLit(f)?'#dfe6f0':'#3a404b';g.fillRect(-ww/2,-hh/2,ww,hh);
  g.strokeStyle=selected?'#00ffcc':col;g.lineWidth=selected?2.4:1.2;g.strokeRect(-ww/2,-hh/2,ww,hh);g.restore();
}
function drawProjectorPlot(g,f,x,y,s,col,selected,X,Y){
  const info=projectorInfo(f);
  if(info){ // cono verso i bordi dello schermo
    const sc=info.screen,a=(sc.rot||0)*Math.PI/180,hw=(sc.w||5)/2;
    const e1={x:sc.x-Math.cos(a)*hw,y:sc.y-Math.sin(a)*hw},e2={x:sc.x+Math.cos(a)*hw,y:sc.y+Math.sin(a)*hw};
    g.save();g.globalAlpha=f.enabled!==false?.22:.08;g.fillStyle=col;g.beginPath();g.moveTo(x,y);g.lineTo(X(e1.x),Y(e1.y));g.lineTo(X(e2.x),Y(e2.y));g.closePath();g.fill();
    g.globalAlpha=.6;g.setLineDash([4,4]);g.strokeStyle=col;g.lineWidth=1;g.stroke();g.restore();
  }
  const ang=info?Math.atan2(info.screen.y-f.y,info.screen.x-f.x):((f.rot||0)-90)*Math.PI/180;
  g.save();g.translate(x,y);g.rotate(ang);
  g.fillStyle='#1c2027';g.strokeStyle=selected?'#00ffcc':col;g.lineWidth=selected?2.4:1.3;
  g.fillRect(-s*.35,-s*.22,s*.55,s*.44);g.strokeRect(-s*.35,-s*.22,s*.55,s*.44);
  g.fillStyle=col;g.beginPath();g.arc(s*.24,0,s*.1,0,Math.PI*2);g.fill();g.restore();
}
// ---- Render (prospettiva del palco) ----
function drawScreensRender(g,project,zScale,t){
  for(const sc of (L.fixtures||[]).filter(f=>f.type==='screen'&&f.enabled!==false)){
    const p=project(sc.x,sc.y,sc.z||0),rot=(sc.rot||0)*Math.PI/180;
    // in 3D lo schermo e' un pannello in prospettiva (panelTransform), dal pubblico come sempre
    let w,h,x0,y0,y1,cx=p.x;const lit=screenLit(sc),panel=!!project.cam3d;
    if(panel){g.save();const P=panelTransform(g,project,sc,sc.z||0,sc.w||5,sc.h||2.8);w=P.Wl;h=P.Hl;x0=0;y0=0;y1=h;cx=w/2}
    else{w=(sc.w||5)*p.scale*Math.max(.08,Math.abs(Math.cos(rot)));h=(sc.h||2.8)*(p.zs??zScale);x0=p.x-w/2;y1=p.y;y0=y1-h}
    g.globalCompositeOperation='source-over';g.fillStyle='#0a0c10';g.fillRect(x0-3,y0-3,w+6,h+6);
    if(lit){const gr=g.createLinearGradient(x0,y0,x0+w,y1);gr.addColorStop(0,'#9fb4cf');gr.addColorStop(.5+.2*Math.sin(t*.0004),'#e7ecf3');gr.addColorStop(1,'#7f93ad');
      g.globalAlpha=.85;g.fillStyle=gr;g.fillRect(x0,y0,w,h);g.globalAlpha=1}
    else{g.fillStyle='#2a2f38';g.fillRect(x0,y0,w,h)}
    g.fillStyle=lit?'#20262f':'#6b7480';g.font='10px JetBrains Mono, monospace';g.textAlign='center';g.fillText(sc.name||'SCHERMO',cx,y0+12);
    if(panel)g.restore();
  }
}
// inviluppo convesso (monotone chain) di pochi punti [x,y]
function convexHull(pts){
  const P=[...pts].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];
  for(const p of P){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
  for(const p of P.reverse()){while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
  return lo.slice(0,-1).concat(up.slice(0,-1));
}
function drawProjectorsRender(g,project,zScale){
  for(const f of (L.fixtures||[]).filter(f=>f.type==='projector'&&f.enabled!==false)){
    const info=projectorInfo(f),p=project(f.x,f.y,f.z||3);
    g.globalCompositeOperation='source-over';g.fillStyle='#1c2027';g.strokeStyle='#9fe0ff';g.lineWidth=1;g.fillRect(p.x-7,p.y-5,14,10);g.strokeRect(p.x-7,p.y-5,14,10);
    if(!info)continue;
    const sc=info.screen,sp=project(sc.x,sc.y,sc.z||0),rot=(sc.rot||0)*Math.PI/180;
    // quattro angoli dello schermo: veri nello spazio in 3D, come sempre dal pubblico
    let corners;
    if(project.cam3d){const sw=sc.w||5,sh=sc.h||2.8,ax=Math.cos(rot)*sw/2,ay=Math.sin(rot)*sw/2,z0=sc.z||0;
      corners=[[-1,0],[1,0],[1,sh],[-1,sh]].map(([s,dz])=>{const q=project(sc.x+s*ax,sc.y+s*ay,z0+dz);return[q.x,q.y]})}
    else{const w=(sc.w||5)*sp.scale*Math.max(.08,Math.abs(Math.cos(rot))),h=(sc.h||2.8)*(sp.zs??zScale),x0=sp.x-w/2,y1=sp.y,y0=y1-h;
      corners=[[x0,y0],[x0+w,y0],[x0+w,y1],[x0,y1]]}
    const mid=corners.reduce((a,c)=>[a[0]+c[0]/4,a[1]+c[1]/4],[0,0]);
    g.globalCompositeOperation='lighter';const gr=g.createLinearGradient(p.x,p.y,mid[0],mid[1]);
    gr.addColorStop(0,'rgba(220,235,255,.35)');gr.addColorStop(1,'rgba(220,235,255,.04)');g.fillStyle=gr;
    // fascio = inviluppo convesso di obiettivo + 4 angoli (qualunque posizione del proiettore)
    const hull=convexHull([[p.x,p.y],...corners]);
    g.beginPath();hull.forEach(([hx,hy],i)=>i?g.lineTo(hx,hy):g.moveTo(hx,hy));g.closePath();g.fill();
    g.globalCompositeOperation='source-over';
  }
}

// ---- 📐 Spazio: palco, platea, regia, sala ----
function openSpaceEditor(){
  const s=$('#scrim');s.hidden=false;
  const num=(id,label,v,min,max,step=.1)=>`<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${+(+v).toFixed(2)}"></label>`;
  const paint=()=>{
    const st=L.stage;st.venue=st.venue||{auto:true};
    const fp=showFootprint(),v=venueRect(),aud=st.audience,gap=aud.y-st.depth,area=aud.width*aud.depth;
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Spazio dello show">
      <div class="top"><h3>📐 Spazio dello show</h3><button class="btn ghost" id="spClose">Chiudi</button></div>
      <div class="sp-tot"><div><b>${fp.width.toFixed(1)} × ${fp.depth.toFixed(1)} m</b><span>ingombro show (palco + platea + regia)</span></div>
        <div><b>${v.width.toFixed(1)} × ${v.depth.toFixed(1)} × ${v.height.toFixed(1)} m</b><span>sala${v.auto?' (calcolata)':''}</span></div>
        <div><b>${area.toFixed(0)} m²</b><span>platea · ≈ ${Math.round(area*2)} persone in piedi, ${Math.round(area/.6)} sedute strette</span></div></div>
      <h4>Palco</h4><div class="two">${num('spW','Larghezza (m)',st.width,2,60)}${num('spD','Profondità (m)',st.depth,2,60)}</div>
      <div class="two">${num('spFl','Altezza del piano (m)',st.floorHeight,0,20)}${num('spTr','Altezza americana (m)',st.trussHeight,1,30)}</div>
      <h4>Platea</h4><div class="two">${num('spAW','Larghezza (m)',aud.width,1,200)}${num('spAD','Profondità (m)',aud.depth,1,200)}</div>
      <div class="two">${num('spAG','Distanza dal bordo palco (m)',gap,0,100)}${num('spAX','Spostamento laterale (m)',aud.x,-100,100)}</div>
      <h4>Regia (FOH)</h4><div class="two">${num('spFY','Distanza dal bordo palco (m)',st.foh.y-st.depth,0,150)}${num('spFX','Spostamento laterale (m)',st.foh.x,-100,100)}</div>
      <div class="two">${num('spFW','Larghezza (m)',st.foh.width,.5,50)}${num('spFD','Profondità (m)',st.foh.depth,.5,50)}</div>
      <h4>Sala</h4><label class="chk"><input id="spAuto" type="checkbox"${st.venue.auto!==false?' checked':''}> Calcolata da palco, platea e regia (+2 m attorno)</label>
      <div class="two">${num('spVW','Larghezza (m)',v.width,2,300)}${num('spVD','Profondità (m)',v.depth,2,300)}</div>
      <div class="two">${num('spVH','Altezza (m)',v.height,2,40)}${num('spVB','Spazio dietro al palco (m)',-v.y0,0,50)}</div>
      <h4>Planimetria del locale</h4>
      ${st.plan?.src?`<p class="hint">${esc(st.plan.name||'immagine')} · ${(st.plan.pw*st.plan.mpp).toFixed(1)} × ${(st.plan.ph*st.plan.mpp).toFixed(1)} m</p>
      <div class="row sp-plan"><button class="btn" id="spPlCal" title="Tocca i due capi di una quota nota e scrivi la misura vera">📏 Calibra scala</button><button class="btn" id="spPlMove" title="Trascina la mappa nella Pianta finché il palco è al suo posto">✥ Sposta</button><button class="btn" id="spPlRot">⟳ 90°</button><button class="btn ghost" id="spPlDel">Togli</button></div>
      <div class="two"><label>Trasparenza<input id="spPlOp" type="range" min=".1" max="1" step=".05" value="${st.plan.op??.55}"></label>
        <div><label class="chk"><input id="spPlOn" type="checkbox"${st.plan.on!==false?' checked':''}> Visibile</label><label class="chk"><input id="spPlInv" type="checkbox"${st.plan.invert!==false?' checked':''}> Linee chiare (inverti)</label></div></div>`:''}
      <div class="row"><label class="btn" style="cursor:pointer">🗺 ${st.plan?.src?'Cambia':'Carica'} planimetria<input id="spPlFile" type="file" accept="image/*" hidden></label><span class="hint" id="spPlSt"></span></div>
      <p class="hint">Pianta del locale (JPG o PNG) come sfondo della Pianta. Poi 📏 Calibra su una quota nota e ✥ Sposta per portare il palco nel punto giusto; le luci si trascinano sulla mappa.</p>
      <p class="hint">Le misure si vedono nella Pianta (rettangolo tratteggiato della sala) e servono al Render. Schermo di proiezione, proiettore, casse e LED wall si aggiungono toccando un punto vuoto della Pianta.</p>
    </div>`;
    const q=id=>s.querySelector('#'+id);
    q('spClose').onclick=closeSheet;
    for(const id of ['spVW','spVD','spVB'])q(id).disabled=st.venue.auto!==false;
    const set=(id,fn)=>{q(id).onchange=e=>{const n=Number(e.target.value);if(!Number.isFinite(n))return;fn(n);ensureStageData(L);save();paint()}};
    set('spW',n=>st.width=n);set('spD',n=>{const g=st.audience.y-st.depth,fg=st.foh.y-st.depth;st.depth=n;st.audience.y=n+g;st.foh.y=n+fg});
    set('spFl',n=>st.floorHeight=n);set('spTr',n=>st.trussHeight=n);
    set('spAW',n=>aud.width=n);set('spAD',n=>aud.depth=n);set('spAG',n=>aud.y=st.depth+n);set('spAX',n=>aud.x=n);
    set('spFY',n=>st.foh.y=st.depth+n);set('spFX',n=>st.foh.x=n);set('spFW',n=>st.foh.width=n);set('spFD',n=>st.foh.depth=n);
    q('spAuto').onchange=e=>{const v=venueRect();st.venue=e.target.checked?{auto:true,height:v.height}:{auto:false,width:+v.width.toFixed(1),depth:+v.depth.toFixed(1),height:+v.height.toFixed(1),back:+(-v.y0).toFixed(1)};save();paint()};
    q('spPlFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;q('spPlSt').textContent='Carico…';
      try{await uploadPlanImage(file);showInfo('Planimetria caricata: ora 📏 Calibra scala.');paint()}catch(err){q('spPlSt').textContent='';showError('Planimetria: '+err.message)}};
    if(st.plan?.src){
      const pick=mode=>{planEdit=mode==='cal'?{mode,pts:[]}:{mode};closeSheet();
        let changed=false;for(const w of page().widgets||[])if(w.type==='stage'&&w.view!=='plot'){w.view='plot';changed=true}
        if(changed){save();render()}
        showInfo(mode==='cal'?'Tocca nella Pianta i due capi di una quota nota.':'Trascina la mappa; un tocco senza trascinare per finire.')};
      q('spPlCal').onclick=()=>pick('cal');q('spPlMove').onclick=()=>pick('move');
      q('spPlRot').onclick=()=>{st.plan.rot=((st.plan.rot||0)+90)%360;save();paint()};
      q('spPlDel').onclick=async()=>{if(!await uiConfirm('Togliere la planimetria dalla Pianta?'))return;delete st.plan;save();paint()};
      q('spPlOp').oninput=e=>{st.plan.op=+e.target.value;save()};
      q('spPlOn').onchange=e=>{st.plan.on=e.target.checked;save()};
      q('spPlInv').onchange=e=>{st.plan.invert=e.target.checked;save()};
    }
    set('spVW',n=>st.venue.width=n);set('spVD',n=>st.venue.depth=n);set('spVH',n=>st.venue.height=n);set('spVB',n=>st.venue.back=n);
  };
  paint();
}

/* ---------- strutture di scena: americane, pedane, pilastri, quinte ---------- */
// Oggetti senza DMX (FIX_TYPES[...].struct). Misure in metri: w = lunghezza/larghezza
// (pilastro: diametro), d = profondita' (pedana), h = altezza (pedana, pilastro, quinta),
// z = quota (americana: altezza dal piano), rot = gradi in pianta come LED wall e schermi.
// Una luce APPESA (f.mount = id dell'americana) sta sulla sua linea alla sua quota e la
// segue quando l'americana si sposta o ruota. Con almeno un'americana nel progetto
// l'americana fissa di sempre (stage.trussHeight) non si disegna piu'.
const STRUCT_DEFAULT={truss:{w:6,rot:0},riser:{w:2,d:1,h:.4,rot:0},column:{w:.4,h:3},flat:{w:2,h:3,rot:0}};
const isStruct=f=>!!FIX_TYPES[f?.type]?.struct;
function structDefaults(type,st=L.stage){const d={...(STRUCT_DEFAULT[type]||{})};if(type==='truss')d.z=+(st?.trussHeight||5);return d}
const trusses=()=>(L.fixtures||[]).filter(f=>f.type==='truss');
// estremi dell'americana in pianta
function trussEnds(t){const r=(t.rot||0)*Math.PI/180,ax=Math.cos(r)*(t.w||6)/2,ay=Math.sin(r)*(t.w||6)/2;return[[t.x-ax,t.y-ay],[t.x+ax,t.y+ay]]}
// luce sulla linea dell'americana (punto piu' vicino), alla sua quota
function snapToTruss(f,t){
  const [[x0,y0],[x1,y1]]=trussEnds(t),dx=x1-x0,dy=y1-y0,L2=dx*dx+dy*dy||1;
  const k=clamp(((f.x-x0)*dx+(f.y-y0)*dy)/L2,0,1);
  f.x=+(x0+dx*k).toFixed(2);f.y=+(y0+dy*k).toFixed(2);f.z=+(+t.z||0).toFixed(2);f.mount=t.id;f.mountToTruss=false;
}
// dopo aver cambiato misure, quota o rotazione dell'americana: le luci appese la seguono
function resnapMounted(t){for(const f of L.fixtures||[])if(f.mount===t.id)snapToTruss(f,t)}
const mountedOn=t=>(L.fixtures||[]).filter(f=>f.mount===t.id);

// ---- Pianta ----
function drawStructPlot(g,f,x,y,s,col,selected){
  const r=(f.rot||0)*Math.PI/180;g.save();g.translate(x,y);g.rotate(r);
  g.strokeStyle=selected?'#00ffcc':col;g.fillStyle=col+'30';g.lineWidth=selected?2.2:1.3;
  if(f.type==='truss'){const w=(f.w||6)*s,hh=Math.max(4,.3*s);g.strokeRect(-w/2,-hh/2,w,hh);g.beginPath();
    for(let k=0,n=Math.max(2,Math.round(w/(hh*1.2)));k<n;k++){const a=-w/2+k*w/n,b=-w/2+(k+1)*w/n;g.moveTo(a,-hh/2);g.lineTo((a+b)/2,hh/2);g.lineTo(b,-hh/2)}g.stroke()}
  else if(f.type==='riser'){const w=(f.w||2)*s,d=(f.d||1)*s;g.fillRect(-w/2,-d/2,w,d);g.strokeRect(-w/2,-d/2,w,d)}
  else if(f.type==='column'){g.beginPath();g.arc(0,0,Math.max(4,(f.w||.4)*s/2),0,Math.PI*2);g.fill();g.stroke()}
  else if(f.type==='flat'){const w=(f.w||2)*s;g.fillStyle=col;g.fillRect(-w/2,-Math.max(2,.08*s),w,Math.max(4,.16*s));g.strokeRect(-w/2,-Math.max(2,.08*s),w,Math.max(4,.16*s))}
  g.restore();
}
function structLabel(f){
  if(f.type==='truss')return`${f.name} · ${(+f.w||6).toFixed(1)} m +${(+f.z||0).toFixed(1)}`;
  if(f.type==='riser')return`${f.name} · ${(+f.w||2).toFixed(1)}×${(+f.d||1).toFixed(1)} h${(+f.h||.4).toFixed(1)}`;
  if(f.type==='column')return`${f.name} · h${(+f.h||3).toFixed(1)}`;
  return`${f.name} · ${(+f.w||2).toFixed(1)}×${(+f.h||3).toFixed(1)}`;
}

// ---- Render (proiezione qualsiasi: vista dal pubblico o telecamera 3D) ----
function drawStructuresRender(g,project){
  const list=(L.fixtures||[]).filter(f=>isStruct(f)&&f.enabled!==false);if(!list.length)return;
  const P=(x,y,z)=>project(x,y,z),poly=(pts,fill,stroke)=>{g.beginPath();pts.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();if(fill){g.fillStyle=fill;g.fill()}if(stroke){g.strokeStyle=stroke;g.stroke()}};
  g.save();g.globalCompositeOperation='source-over';g.lineWidth=1;
  // le piu' lontane prima (y piccola = fondo palco)
  for(const f of [...list].sort((a,b)=>(a.y||0)-(b.y||0))){
    const r=(f.rot||0)*Math.PI/180,c=Math.cos(r),sn=Math.sin(r);
    if(f.type==='riser'){const w=(f.w||2)/2,d=(f.d||1)/2,h=+f.h||.4;
      const pt=(u,v,z)=>P(f.x+c*u-sn*v,f.y+sn*u+c*v,z),B=[pt(-w,-d,0),pt(w,-d,0),pt(w,d,0),pt(-w,d,0)],T=[pt(-w,-d,h),pt(w,-d,h),pt(w,d,h),pt(-w,d,h)];
      for(let i=0;i<4;i++){const j=(i+1)%4;poly([B[i],B[j],T[j],T[i]],'#101217','#2a2f39')}
      poly(T,'#1b1f27','#3a414d')}
    else if(f.type==='column'){const rr=(f.w||.4)/2,h=+f.h||3,b=P(f.x,f.y,0),t=P(f.x,f.y,h),wb=Math.max(2,rr*b.scale),wt=Math.max(2,rr*t.scale);
      const gr=g.createLinearGradient(b.x-wb,0,b.x+wb,0);gr.addColorStop(0,'#14171d');gr.addColorStop(.45,'#2c323d');gr.addColorStop(1,'#0e1014');
      poly([{x:b.x-wb,y:b.y},{x:b.x+wb,y:b.y},{x:t.x+wt,y:t.y},{x:t.x-wt,y:t.y}],gr,'#3a414d')}
    else if(f.type==='flat'){const w=(f.w||2)/2,h=+f.h||3,pt=(u,z)=>P(f.x+c*u,f.y+sn*u,z);
      poly([pt(-w,0),pt(w,0),pt(w,h),pt(-w,h)],'#15181e','#3a414d')}
    else if(f.type==='truss'){const [[x0,y0],[x1,y1]]=trussEnds(f),z=+f.z||0,n=Math.max(4,Math.round((f.w||6)*2.5));
      const top=[P(x0,y0,z),P(x1,y1,z)],bot=[P(x0,y0,z-.3),P(x1,y1,z-.3)];
      g.strokeStyle='#4a515e';g.lineWidth=1.4;g.beginPath();g.moveTo(top[0].x,top[0].y);g.lineTo(top[1].x,top[1].y);g.moveTo(bot[0].x,bot[0].y);g.lineTo(bot[1].x,bot[1].y);
      for(let k=0;k<n;k++){const a=k/n,b=(k+.5)/n,e=(k+1)/n,L0=(p,q,t)=>({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});
        const A=L0(top[0],top[1],a),Bm=L0(bot[0],bot[1],b),E=L0(top[0],top[1],e);g.moveTo(A.x,A.y);g.lineTo(Bm.x,Bm.y);g.lineTo(E.x,E.y)}
      g.stroke()}
  }
  g.restore();
}

if(typeof module==='object'&&module.exports){module.exports={showFootprint,venueRect,convexHull,parsePlanLength,planBounds,snapToTruss,trussEnds,structDefaults,STRUCT_DEFAULT};}
