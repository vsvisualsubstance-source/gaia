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
    const w=(sc.w||5)*p.scale*Math.max(.08,Math.abs(Math.cos(rot))),h=(sc.h||2.8)*zScale;
    const x0=p.x-w/2,y1=p.y,y0=y1-h,lit=screenLit(sc);
    g.globalCompositeOperation='source-over';g.fillStyle='#0a0c10';g.fillRect(x0-3,y0-3,w+6,h+6);
    if(lit){const gr=g.createLinearGradient(x0,y0,x0+w,y1);gr.addColorStop(0,'#9fb4cf');gr.addColorStop(.5+.2*Math.sin(t*.0004),'#e7ecf3');gr.addColorStop(1,'#7f93ad');
      g.globalAlpha=.85;g.fillStyle=gr;g.fillRect(x0,y0,w,h);g.globalAlpha=1}
    else{g.fillStyle='#2a2f38';g.fillRect(x0,y0,w,h)}
    g.fillStyle=lit?'#20262f':'#6b7480';g.font='10px JetBrains Mono, monospace';g.textAlign='center';g.fillText(sc.name||'SCHERMO',p.x,y0+12);
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
    const w=(sc.w||5)*sp.scale*Math.max(.08,Math.abs(Math.cos(rot))),h=(sc.h||2.8)*zScale,x0=sp.x-w/2,y1=sp.y,y0=y1-h;
    g.globalCompositeOperation='lighter';const gr=g.createLinearGradient(p.x,p.y,sp.x,(y0+y1)/2);
    gr.addColorStop(0,'rgba(220,235,255,.35)');gr.addColorStop(1,'rgba(220,235,255,.04)');g.fillStyle=gr;
    // fascio = inviluppo convesso di obiettivo + 4 angoli (qualunque posizione del proiettore)
    const hull=convexHull([[p.x,p.y],[x0,y0],[x0+w,y0],[x0+w,y1],[x0,y1]]);
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
    set('spVW',n=>st.venue.width=n);set('spVD',n=>st.venue.depth=n);set('spVH',n=>st.venue.height=n);set('spVB',n=>st.venue.back=n);
  };
  paint();
}

if(typeof module==='object'&&module.exports){module.exports={showFootprint,venueRect,convexHull};}
