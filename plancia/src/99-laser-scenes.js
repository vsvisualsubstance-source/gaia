/* ---------- Scene laser: template, SVG importati, timeline LASER ---------- */
// Contenuto senza sorgenti esterne: una scena e' una figura vettoriale con la
// sua animazione (formato in ops/laser/laser_scene.py), animata dal gateway in
// modalita' "Scene". Libreria nel layout condiviso, L.laserScenes, cosi' il
// bridge le manda ai cubi dalla timeline LASER (L.laserTimeline, laser-timeline.js).
// lzsAnimate e' la stessa matematica di laser_scene.animate, per le anteprime.
// Le funzioni usate dal render della timeline sono dichiarazioni function:
// il primo render avviene prima che questo modulo sia valutato.

// ---- template: figure generate (x, y in -1..1, y in alto)
function lzsShape(kind){
  const P=(n,f,closed=false)=>({pts:Array.from({length:n},(_,i)=>f(i/(closed?n:n-1))).map(([x,y])=>[+x.toFixed(4),+y.toFixed(4)]),closed});
  const TAU=Math.PI*2,poly=(k,r=1,rot=Math.PI/2)=>P(k,u=>[r*Math.cos(rot+u*TAU),r*Math.sin(rot+u*TAU)],true);
  switch(kind){
    case'cerchio':return[P(120,u=>[Math.cos(u*TAU),Math.sin(u*TAU)],true)];
    case'quadrato':return[poly(4,1,Math.PI/4)];
    case'triangolo':return[poly(3)];
    case'stella':return[{pts:Array.from({length:10},(_,i)=>{const r=i%2?.42:1,a=Math.PI/2+i*TAU/10;return[+(r*Math.cos(a)).toFixed(4),+(r*Math.sin(a)).toFixed(4)]}),closed:true}];
    case'spirale':return[P(220,u=>{const a=u*TAU*3.5,r=.08+.92*u;return[r*Math.cos(a),r*Math.sin(a)]})];
    case'onda':return[P(120,u=>[u*2-1,.45*Math.sin(u*TAU*2)])];
    case'lissajous':return[P(260,u=>[Math.sin(3*u*TAU+Math.PI/2),Math.sin(2*u*TAU)],true)];
    case'tunnel':return[1,.66,.33].map(r=>P(Math.round(110*r)+20,u=>[r*Math.cos(u*TAU),r*Math.sin(u*TAU)],true));
    case'raggiera':return Array.from({length:8},(_,i)=>{const a=i*TAU/8;return{pts:[[+(.18*Math.cos(a)).toFixed(4),+(.18*Math.sin(a)).toFixed(4)],[+Math.cos(a).toFixed(4),+Math.sin(a).toFixed(4)]],closed:false}});
    case'cuore':return[P(160,u=>{const t=u*TAU,x=16*Math.sin(t)**3,y=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);return[x/17,y/17+.1]},true)];
    case'infinito':return[P(160,u=>{const t=u*TAU,d=1+Math.sin(t)**2;return[Math.cos(t)/d,Math.sin(t)*Math.cos(t)/d*1.4]},true)];
    case'scanner':return[{pts:[[-1,0],[1,0]],closed:false}];
    case'griglia':return[-.6,-.2,.2,.6].flatMap(v=>[{pts:[[-.8,v],[.8,v]],closed:false},{pts:[[v,-.8],[v,.8]],closed:false}]);
  }
  return[];
}
function lzsTemplates(){
  const T=(id,name,color,anim={},audio={amount:0,to:'scale'})=>({id:'tpl-'+id,name,template:true,strokes:lzsShape(id),color:{mode:'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2,...color},anim:{rotate:0,scale:.7,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0,...anim},audio});
  return[
    T('cerchio','Cerchio',{rgb:[0,1,.4]},{pulse:.3,pulse_hz:.5},{amount:.6,to:'scale'}),
    T('quadrato','Quadrato rotante',{rgb:[0,.5,1]},{rotate:45}),
    T('triangolo','Triangolo',{mode:'cycle',rate:.15},{rotate:-30,scale:.75}),
    T('stella','Stella',{rgb:[1,.75,0]},{rotate:20,pulse:.2,pulse_hz:1},{amount:.7,to:'scale'}),
    T('spirale','Spirale',{mode:'cycle',rate:.1},{rotate:90,scale:.85}),
    T('onda','Onda',{rgb:[0,.8,1]},{scale:.9,orbit:.3,orbit_hz:.25}),
    T('lissajous','Lissajous',{mode:'cycle',rate:.08},{rotate:15,scale:.75}),
    T('tunnel','Tunnel',{mode:'palette',palette:[[1,0,.3],[0,.6,1],[0,1,.4]],rate:.5},{pulse:.5,pulse_hz:.8},{amount:.8,to:'scale'}),
    T('raggiera','Raggiera',{rgb:[1,0,.2]},{rotate:60,scale:.9},{amount:.6,to:'brightness'}),
    T('cuore','Cuore',{rgb:[1,0,.15]},{pulse:.25,pulse_hz:1.2},{amount:.5,to:'scale'}),
    T('infinito','Infinito',{mode:'cycle',rate:.12},{scale:.8,draw_hz:.4}),
    T('scanner','Scanner',{rgb:[0,1,.5]},{scale:.9,orbit:.8,orbit_hz:.3}),
    T('griglia','Griglia',{rgb:[.2,.6,1]},{rotate:10,scale:.8},{amount:.5,to:'brightness'}),
  ];
}
function laserScenes(){return Array.isArray(L.laserScenes)?L.laserScenes:[]}
function laserDoc(){return L.laserTimeline&&Array.isArray(L.laserTimeline.cues)?L.laserTimeline:{active:false,cues:[]}}

// ---- animazione (specchio di laser_scene.animate)
function lzsHsv(h){const i=Math.floor(h*6),f=h*6-i,q=1-f,m=[[1,f,0],[q,1,0],[0,1,f],[0,q,1],[f,0,1],[1,0,q]];return m[((i%6)+6)%6]}
function lzsStrokeRgb(sc,i,t){
  const c=sc.color||{};
  if(c.mode==='cycle')return lzsHsv(((t*(c.rate||0)+i*.12)%1+1)%1);
  if(c.mode==='palette'){const p=c.palette?.length?c.palette:[[1,1,1]];return p[(Math.floor(t*(c.rate||0)*p.length)+i)%p.length]}
  if(c.mode==='stroke')return sc.strokes[i].rgb||c.rgb||[1,1,1];
  return c.rgb||[1,1,1];
}
function lzsAnimate(sc,t,level=0,kick=0){
  const a={rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0,...(sc.anim||{})},au={amount:0,to:'scale',...(sc.audio||{})};
  let s=a.scale*(1-a.pulse*.5+a.pulse*.5*Math.sin(2*Math.PI*a.pulse_hz*t)),bright=1;
  const react=Math.min(1,level+.5*kick)*au.amount;
  if(au.to==='scale')s*=1+.6*react;else bright=(1-au.amount)+react;
  const ang=a.rotate*t*Math.PI/180,ca=Math.cos(ang),sa=Math.sin(ang);
  const ox=a.orbit*.5*Math.cos(2*Math.PI*a.orbit_hz*t),oy=a.orbit*.5*Math.sin(2*Math.PI*a.orbit_hz*t);
  const total=sc.strokes.reduce((n,st)=>n+st.pts.length+(st.closed?1:0),0);
  let budget=a.draw_hz<=0?total:Math.max(2,Math.floor(total*((t*a.draw_hz)%1)));
  const out=[];
  sc.strokes.forEach((st,i)=>{
    if(budget<=0)return;
    const [r,g,b]=lzsStrokeRgb(sc,i,t).map(v=>Math.max(0,Math.min(255,Math.floor(v*255*bright))));
    const pts=(st.closed?[...st.pts,st.pts[0]]:st.pts).slice(0,budget);budget-=pts.length;
    pts.forEach(([x,y],j)=>{const px=(x*ca-y*sa)*s+ox,py=(x*sa+y*ca)*s+oy;if(!j)out.push([px,py,0,0,0]);out.push([px,py,r,g,b])});
  });
  return out;
}
function lzsDraw(cv,sc,t,level=0){
  const g=cv.getContext('2d'),W=cv.width,H=cv.height,k=Math.min(W,H)/2*.92;
  g.fillStyle='#05070a';g.fillRect(0,0,W,H);
  if(!sc?.strokes?.length)return;
  const pts=lzsAnimate(sc,t,level);g.lineWidth=Math.max(1.2,W/90);g.lineCap='round';
  for(let i=1;i<pts.length;i++){const p=pts[i],q=pts[i-1];if(!(p[2]||p[3]||p[4]))continue;
    g.strokeStyle=`rgb(${p[2]},${p[3]},${p[4]})`;g.beginPath();g.moveTo(W/2+q[0]*k,H/2-q[1]*k);g.lineTo(W/2+p[0]*k,H/2-p[1]*k);g.stroke()}
}
// miniature animate della pagina Laser (dal loop principale, ~20/s)
function animateLaserThumbs(el){
  const n=performance.now();if(n-(el._lzsAt||0)<50)return;el._lzsAt=n;
  const sc=laserScenes(),t=n/1000;
  el.querySelectorAll('canvas[data-lzs-cv]').forEach(cv=>{const s=sc.find(x=>x.id===cv.dataset.lzsCv);if(s)lzsDraw(cv,s,t)});
}

// ---- SVG -> scena: il browser misura ogni forma (archi, trasformazioni comprese)
const LZS_SVG_POINTS=500;
async function lzsImportSvg(file){
  const txt=await file.text(),doc=new DOMParser().parseFromString(txt,'image/svg+xml'),root=doc.querySelector('svg');
  if(!root)throw new Error('non è un file SVG');
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-9999px;top:0;width:10px;height:10px;overflow:hidden';
  const svg=document.importNode(root,true);host.appendChild(svg);document.body.appendChild(host);
  try{
    const els=[...svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')].filter(e=>typeof e.getTotalLength==='function');
    const lens=els.map(e=>{try{return e.getTotalLength()}catch{return 0}}),total=lens.reduce((a,b)=>a+b,0);
    if(!total)throw new Error('nessuna linea da disegnare (i testi vanno convertiti in tracciati)');
    const strokes=[];
    els.forEach((e,i)=>{
      if(!lens[i])return;
      const n=Math.max(4,Math.round(LZS_SVG_POINTS*lens[i]/total)),m=e.getCTM(),step=lens[i]/n;
      const cs=getComputedStyle(e),col=[cs.stroke,cs.fill].map(lzsCssRgb).find(Boolean)||null;
      let cur=[],prev=null;
      for(let j=0;j<=n;j++){
        const p=e.getPointAtLength(Math.min(lens[i],j*step)),q=m?p.matrixTransform(m):p;
        // salto tra due sotto-tracciati: si chiude la linea e se ne apre un'altra (al buio)
        if(prev&&Math.hypot(q.x-prev.x,q.y-prev.y)>step*3*(m?Math.hypot(m.a,m.b):1)){if(cur.length>1)strokes.push({pts:cur,closed:false,rgb:col});cur=[]}
        cur.push([q.x,q.y]);prev=q;
      }
      if(cur.length>1)strokes.push({pts:cur,closed:false,rgb:col});
    });
    const xs=strokes.flatMap(s=>s.pts.map(p=>p[0])),ys=strokes.flatMap(s=>s.pts.map(p=>p[1]));
    const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,half=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))/2||1;
    strokes.forEach(s=>{s.pts=s.pts.map(([x,y])=>[+((x-cx)/half).toFixed(4),+(-(y-cy)/half).toFixed(4)])}); // y dell'SVG va in giu'
    const name=file.name.replace(/\.svg$/i,'');
    return{id:'svg-'+uid(),name,strokes,color:{mode:strokes.some(s=>s.rgb)?'stroke':'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},
      anim:{rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},audio:{amount:0,to:'scale'}};
  }finally{host.remove()}
}
function lzsCssRgb(v){const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v||'');if(!m||m[4]==='0')return null;
  const c=[m[1],m[2],m[3]].map(x=>+(x/255).toFixed(3));return c.some(x=>x>0)?c:null}

// ---- pagina Laser: libreria delle scene, da mandare ai cubi scelti
let LZS_TARGET='all';
function lzsTargets(d){return['all',...(d?.laser.cubes||[]).map(c=>c.id)]}
function lzScenesHtml(d){
  const cubes=d.laser.cubes||[],running=new Map();cubes.forEach(c=>{if(c.mode==='scene'&&c.scene)running.set(c.scene.id,[...(running.get(c.scene.id)||[]),c.id])});
  if(!lzsTargets(d).includes(LZS_TARGET))LZS_TARGET='all';
  return`<div class="lzs"><div class="lzs-top"><b>Scene laser</b><span class="hint">tocca una scena per mandarla a</span>
      <span class="lzs-tg">${lzsTargets(d).map(id=>`<button class="${LZS_TARGET===id?'on':''}" data-lzs="target" data-lzs-v="${id}">${id==='all'?'Tutti':esc(id)}</button>`).join('')}</span>
      <button class="btn sm ghost" data-lzs="svg">+ Importa SVG</button><button class="btn sm ghost" data-lzs="reset" title="Rimette i template mancanti">Template</button></div>
    <div class="lzs-grid">${laserScenes().map(s=>`<div class="lzs-tile${running.has(s.id)?' on':''}"><button class="lzs-go" data-lzs="apply" data-lzs-v="${esc(s.id)}" title="Manda a ${LZS_TARGET==='all'?'tutti i cubi':LZS_TARGET} (passa in modalità Scene)">
        <canvas data-lzs-cv="${esc(s.id)}" width="120" height="120"></canvas><span>${esc(s.name)}</span>${running.has(s.id)?`<em>${running.get(s.id).join(' ')}</em>`:''}</button>
        <button class="lzs-ed" data-lzs="edit" data-lzs-v="${esc(s.id)}" title="Modifica">✎</button></div>`).join('')||'<p class="hint">Nessuna scena: tocca Template.</p>'}</div></div>`;
}
function lzsSig(){return[LZS_TARGET,laserScenes().map(s=>[s.id,s.name])]}
function lzsApply(s,target=LZS_TARGET){lzCmd({action:'scene',cube:target,scene:s},'scene')}
function lzsDown(e,el,w){
  const b=e.target.closest('[data-lzs]');if(!b)return;e.preventDefault();
  const a=b.dataset.lzs,v=b.dataset.lzsV,s=laserScenes().find(x=>x.id===v);
  if(a==='target')LZS_TARGET=v;
  else if(a==='apply'&&s){lzsApply(s);showInfo(`Laser: "${s.name}" a ${LZS_TARGET==='all'?'tutti i cubi':LZS_TARGET} (modalità Scene; armare resta manuale).`)}
  else if(a==='edit'&&s)openLaserSceneEditor(s);
  else if(a==='reset'){const have=new Set(laserScenes().map(x=>x.id)),add=lzsTemplates().filter(x=>!have.has(x.id));
    L.laserScenes=[...laserScenes(),...add];save();showInfo(add.length?`Aggiunti ${add.length} template.`:'Tutti i template ci sono già.')}
  else if(a==='svg'){const inp=document.createElement('input');inp.type='file';inp.accept='.svg,image/svg+xml';
    inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;
      try{const sc=await lzsImportSvg(f),n=sc.strokes.reduce((k,x)=>k+x.pts.length,0);L.laserScenes=[...laserScenes(),sc];save();paintLaser(el,w,true);
        showInfo(`SVG "${sc.name}": ${sc.strokes.length} linee, ${n} punti.`);openLaserSceneEditor(sc)}
      catch(err){showError('SVG: '+err.message)}};inp.click();return}
  paintLaser(el,w,true);
}
function openLaserSceneEditor(orig){
  const sc=JSON.parse(JSON.stringify(orig)),s=$('#scrim');s.hidden=false;
  const C={mode:'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2,...sc.color},A={rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0,...sc.anim},U={amount:0,to:'scale',...sc.audio};
  const hex=c=>'#'+c.map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join(''),unhex=h=>[1,3,5].map(i=>+(parseInt(h.slice(i,i+2),16)/255).toFixed(3));
  const sl=(id,label,v,min,max,step)=>`<label class="ar-sl"><span>${label}<b id="${id}V">${(+v).toFixed(step<1?2:0)}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  const n=sc.strokes.reduce((k,x)=>k+x.pts.length,0);
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Scena laser">
    <div class="top"><h3>Scena laser</h3><button class="btn ghost" id="lsClose">Chiudi</button></div>
    <div class="lzs-ed-grid"><canvas id="lsPrev" width="260" height="260"></canvas><div>
      <label>Nome<input id="lsName" value="${esc(sc.name)}"></label>
      <p class="hint">${sc.strokes.length} linee · ${n} punti${sc.template?' · template':''}. Anteprima qui accanto; il gateway applica poi zona e intensità di ogni cubo.</p>
      <label>Colore<select id="lsCm">${[['fixed','Fisso'],['cycle','Arcobaleno che scorre'],['palette','Palette a turno'],['stroke','Colori dell\'SVG']].map(([k,t])=>`<option value="${k}"${C.mode===k?' selected':''}>${t}</option>`).join('')}</select></label>
      <div class="two"><label>Colore fisso<input type="color" id="lsRgb" value="${hex(C.rgb)}"></label><label>Palette<span class="lzs-pal">${C.palette.slice(0,4).map((c,i)=>`<input type="color" data-pal="${i}" value="${hex(c)}">`).join('')}</span></label></div>
      ${sl('lsRate','Velocità colore (giri/s)',C.rate,0,2,.01)}
    </div></div>
    <div class="two">${sl('lsRot','Rotazione (gradi/s)',A.rotate,-360,360,1)}${sl('lsScale','Dimensione',A.scale,.05,1,.01)}</div>
    <div class="two">${sl('lsPulse','Pulsazione',A.pulse,0,1,.01)}${sl('lsPulseHz','Pulsazione (Hz)',A.pulse_hz,0,4,.05)}</div>
    <div class="two">${sl('lsOrbit','Orbita',A.orbit,0,1,.01)}${sl('lsOrbitHz','Orbita (Hz)',A.orbit_hz,0,2,.01)}</div>
    <div class="two">${sl('lsDraw','Scrittura progressiva (Hz, 0 = figura intera)',A.draw_hz,0,2,.01)}${sl('lsAudio','Audio dal controller',U.amount,0,1,.01)}</div>
    <label>L'audio muove<select id="lsAudioTo"><option value="scale"${U.to==='scale'?' selected':''}>la dimensione</option><option value="brightness"${U.to==='brightness'?' selected':''}>la luminosità</option></select></label>
    <p class="hint">L'audio arriva dai meter dei gruppi di DMX Master (livello e kick del controller): se DMX Master è spento la scena resta ferma sull'audio.</p>
    <div class="row"><span class="lzs-tg" id="lsTg"></span><button class="btn" id="lsTry">Prova sui cubi</button></div>
    <div class="cue-editor-actions"><button class="btn danger" id="lsDel">Elimina</button><button class="btn ghost" id="lsDup">Duplica</button><button class="btn primary" id="lsSave">Salva</button></div>
  </div>`;
  const read=()=>{
    sc.name=$('#lsName').value.trim()||'Scena';
    sc.color={...C,mode:$('#lsCm').value,rgb:unhex($('#lsRgb').value),palette:[...s.querySelectorAll('[data-pal]')].map(x=>unhex(x.value)),rate:+$('#lsRate').value};
    sc.anim={rotate:+$('#lsRot').value,scale:+$('#lsScale').value,pulse:+$('#lsPulse').value,pulse_hz:+$('#lsPulseHz').value,orbit:+$('#lsOrbit').value,orbit_hz:+$('#lsOrbitHz').value,draw_hz:+$('#lsDraw').value};
    sc.audio={amount:+$('#lsAudio').value,to:$('#lsAudioTo').value};return sc};
  s.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const b=$('#'+r.id+'V');if(b)b.textContent=(+r.value).toFixed(+r.step<1?2:0);read()});
  s.querySelectorAll('select,input[type=color],#lsName').forEach(x=>x.oninput=read);
  const d=lzDev(),tg=s.querySelector('#lsTg');let target=LZS_TARGET;
  const paintTg=()=>{tg.innerHTML=lzsTargets(d).map(id=>`<button class="${target===id?'on':''}" data-t="${id}">${id==='all'?'Tutti':esc(id)}</button>`).join('')};paintTg();
  tg.onclick=e=>{const b=e.target.closest('[data-t]');if(b){target=b.dataset.t;paintTg()}};
  const cv=$('#lsPrev'),t0=performance.now();
  const anim=()=>{if(!document.body.contains(cv))return;lzsDraw(cv,sc,(performance.now()-t0)/1000,U.amount?(.5+.5*Math.sin(performance.now()/180)):0);requestAnimationFrame(anim)};anim();
  const store=x=>{const i=laserScenes().findIndex(y=>y.id===x.id);const list=[...laserScenes()];if(i<0)list.push(x);else list[i]=x;L.laserScenes=list;save()};
  $('#lsClose').onclick=closeSheet;
  $('#lsTry').onclick=()=>{read();if(!d){showError('Laser gateway non collegato.');return}lzsApply(sc,target);showInfo(`Laser: prova di "${sc.name}" su ${target==='all'?'tutti i cubi':target} (non salvata).`)};
  $('#lsSave').onclick=()=>{read();delete sc.template;store(sc);closeSheet();showInfo(`Scena "${sc.name}" salvata nel progetto.`)};
  $('#lsDup').onclick=()=>{read();const c={...JSON.parse(JSON.stringify(sc)),id:'scn-'+uid(),name:sc.name+' (copia)'};delete c.template;store(c);openLaserSceneEditor(c)};
  $('#lsDel').onclick=()=>{const used=laserDoc().cues.filter(c=>c.scene===sc.id).length;
    if(!confirm(`Eliminare "${sc.name}"?${used?`\nÈ usata da ${used} cue della timeline laser.`:''}`))return;
    L.laserScenes=laserScenes().filter(x=>x.id!==sc.id);save();closeSheet()};
}

// ---- timeline LASER (terza riga della timeline dello show, la esegue il bridge)
function laserCueText(c){
  const M={'':'',off:'spento',test:'test',scene:'scena',dmx:'DMX',patchdeck:'PatchDeck',yolo:'Yolo'};
  const sc=c.scene?laserScenes().find(s=>s.id===c.scene)?.name||'(scena tolta)':'';
  return[c.cube&&c.cube!=='all'?c.cube:'tutti',M[c.mode||'']||'',sc].filter(Boolean).join(' · ');
}
function laserLaneHtml(w,D){
  const cues=[...laserDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const e=cues[i+1]?.time??D;
    return`<div class="tl-blk tl-vblk" style="left:${c.time/D*100}%;width:${Math.max(0,e-c.time)/D*100}%;--ic:${c.mode==='off'?'#5d6573':'#ff365c'}"><span>${esc(c.label||'Laser')}</span><em>${esc(laserCueText(c))}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k">LASER</span>
    <button class="tl-live tl-llive" data-act="llive"${w.readonly?' disabled':''} title="LASER · TIMELINE: il bridge sceglie sorgente e scena dei cubi secondo la timeline. LIVE: dal tablet. Armare resta sempre manuale">—</button>
    ${w.readonly?'':'<button class="tl-vcue" data-act="lcue" title="Cue laser: cubo, sorgente, scena">CUE LASER</button>'}
    </div>
    <div class="tl-vlane"><div class="tl-cues">${blocks}</div><span class="tl-vst tl-lst"></span><div class="tl-ph tl-lph"></div></div></div>`;
}
function paintLaserLane(el,w,D,t){
  const b=el.querySelector('.tl-llive');if(!b)return;
  const on=!!laserDoc().active,txt=on?'TIMELINE':'LIVE';
  if(b.textContent!==txt){b.textContent=txt;b.classList.toggle('is-tl',on);b.classList.toggle('is-live',!on)}
  const st=G.laserSt,msg=!st?'bridge: nessuno stato':!st.mqtt?'bridge senza MQTT':!st.gateway?'laser gateway assente o senza cubi':!st.clock?'nessun orologio dello show':
    on?(st.cue>=0?`cue ${st.cue+1}${st.label?' · '+st.label:''}`:'prima della prima cue'):'laser dal tablet';
  const s=el.querySelector('.tl-lst');if(s&&s.textContent!==msg)s.textContent=msg;
  const ph=el.querySelector('.tl-lph');if(ph&&D>0)ph.style.left=Math.max(0,Math.min(1,t/D))*100+'%';
}
function toggleLaserActive(){
  const doc=laserDoc(),on=!!doc.active;
  if(!on&&!confirm('Il LASER segue la timeline?\nIl bridge sceglie subito sorgente e scena di ogni cubo secondo il tempo corrente. Armare resta manuale.'))return;
  L.laserTimeline={...doc,active:!on};save();refreshShowTimelines();
  showInfo(on?'LASER LIVE: sorgenti e scene dal tablet.':'LASER TIMELINE: il bridge segue la timeline.');
}
function openLaserCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  cues=cues||laserDoc().cues.map(c=>({...c}));
  const cubeIds=['all',...new Set([...(lzDev()?.laser.cubes||[]).map(c=>c.id),'c1','c2','c3'])];
  const MODES=[['','invariata'],['scene','Scena'],['dmx','Show (DMX)'],['patchdeck','PatchDeck'],['yolo','Yolo'],['test','Test'],['off','Spento']];
  const opt=(v,cur,t)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`;
  const rows=cues.map((c,i)=>`<div class="vcue-row lcue-row" data-v="${i}">
    <label>Posizione<input class="lc-time" value="${esc(formatCueTime(+c.time||0))}" inputmode="decimal"></label>
    <label>Nome<input class="lc-label" value="${esc(c.label||'')}" placeholder="es. Ritornello laser"></label>
    <label>Cubo<select class="lc-cube">${cubeIds.map(id=>opt(id,c.cube||'all',id==='all'?'tutti':id)).join('')}</select></label>
    <label>Sorgente<select class="lc-mode">${MODES.map(([k,t])=>opt(k,c.mode,t)).join('')}</select></label>
    <label>Scena<select class="lc-scene">${opt('',c.scene,'— invariata —')}${laserScenes().map(x=>opt(x.id,c.scene,x.name)).join('')}</select></label>
    <button class="btn sm danger lc-del" title="Togli">×</button></div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline laser">
    <div class="top"><h3>Timeline laser</h3><button class="btn ghost" id="lcClose">Chiudi</button></div>
    <p class="hint">Ogni cue, all'istante indicato, sceglie per un cubo (o tutti) la <b>sorgente</b> e la <b>scena</b>. Si sommano come le scene luci: un campo "invariata" lascia com'era. Scegliendo una scena con sorgente "invariata" il cubo passa comunque in modalità Scena solo se la cue lo dice: per le scene interne metti Sorgente = Scena. <b>Armare resta manuale</b>: la timeline non accende mai un cubo disarmato.</p>
    <div class="vcue-list">${rows||'<p class="hint">Nessuna cue laser.</p>'}</div>
    <div class="row"><button class="btn" id="lcAdd">＋ Aggiungi cue laser</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="lcCancel">Annulla</button><button class="btn primary" id="lcSave">Salva</button></div>
  </div>`;
  const read=()=>[...s.querySelectorAll('.lcue-row')].map(r=>({time:parseCueTime(r.querySelector('.lc-time').value),label:r.querySelector('.lc-label').value.trim(),
    cube:r.querySelector('.lc-cube').value,mode:r.querySelector('.lc-mode').value,scene:r.querySelector('.lc-scene').value}));
  s.querySelector('#lcClose').onclick=s.querySelector('#lcCancel').onclick=closeSheet;
  s.querySelector('#lcAdd').onclick=()=>{const cur=read(),last=cur.reduce((m,c)=>Number.isFinite(c.time)?Math.max(m,c.time):m,-10);
    cur.push({time:Math.min(Math.max(0,D-1),last+10),label:`Laser ${cur.length+1}`,cube:'all',mode:'scene',scene:laserScenes()[0]?.id||''});openLaserCueEditor(w,cur,meta)};
  s.querySelectorAll('.lc-del').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.closest('.lcue-row').dataset.v,1);openLaserCueEditor(w,cur,meta)});
  s.querySelector('#lcSave').onclick=()=>{
    const cur=read(),bad=cur.find(c=>!Number.isFinite(c.time)||c.time<0||c.time>=D);
    if(bad){showError(`Cue laser "${bad.label||'?'}": posizione tra 0:00 e prima di ${formatCueTime(D)}.`);return}
    const empty=cur.find(c=>!c.mode&&!c.scene);if(empty){showError(`Cue laser "${empty.label||'?'}": scegli una sorgente o una scena.`);return}
    L.laserTimeline={...laserDoc(),cues:cur.sort((a,b)=>a.time-b.time)};
    save();refreshShowTimelines();closeSheet();showInfo(`Timeline laser salvata: ${cur.length} cue.`);
  };
}
// 2026-10-28: libreria scene laser con i template, una volta sola (uiRev 7)
function migrateUiLaserScenes(){
  if((L.uiRev||0)>=7)return;
  if(!Array.isArray(L.laserScenes))L.laserScenes=lzsTemplates();
  L.uiRev=7;save();
}
