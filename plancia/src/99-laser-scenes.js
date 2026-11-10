/* ---------- Scene laser: template, SVG importati, timeline LASER ---------- */
// Contenuto senza sorgenti esterne: una scena e' una figura vettoriale con la
// sua animazione (formato in ops/laser/laser_scene.py), animata dal gateway in
// modalita' "Scene". Libreria nel layout condiviso, L.laserScenes, cosi' il
// bridge le manda ai cubi dalla timeline LASER (L.laserTimeline, laser-timeline.js).
// lzsAnimate e' la stessa matematica di laser_scene.animate, per le anteprime.
// Le funzioni usate dal render della timeline sono dichiarazioni function:
// il primo render avviene prima che questo modulo sia valutato.

// ---- template: figure generate (x, y in -1..1, y in alto)
// puntini (pioggia, nuvola): ogni punto e' un tratto a parte, con lo spostamento al buio prima;
// il punto e' ripetuto DOT volte per restare acceso abbastanza da vedersi. Figure pensate per
// mettere sotto sforzo gli specchi: tanti salti al buio (2026-11-09). Sempre le stesse: seme fisso.
const LZS_DOT=4;
function lzsRng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const lzsDot=(x,y)=>({pts:Array.from({length:LZS_DOT},()=>[+x.toFixed(4),+y.toFixed(4)]),closed:false});
// punti in ordine di vicinanza: meno strada al buio, piu' punti nel frame
function lzsNearest(list){const left=[...list],out=[left.shift()];while(left.length){const p=out[out.length-1];let b=0,bd=1e9;left.forEach((q,i)=>{const d=(q[0]-p[0])**2+(q[1]-p[1])**2;if(d<bd){bd=d;b=i}});out.push(left.splice(b,1)[0])}return out}
function lzsCloud(n=LZS_CLOUD_DOTS){const r=lzsRng(7),out=[];while(out.length<n){const x=r()*2-1,y=r()*2-1,d=x*x+y*y;if(d<=1&&r()<1.15-d)out.push([x,y])}return lzsNearest(out).map(([x,y])=>lzsDot(x,y))}
// pioggia: ogni goccia cade un numero intero di volte nel giro, cosi' l'animazione si chiude su se stessa
function lzsRain(frames=LZS_RAIN_FRAMES,n=LZS_RAIN_DROPS){const r=lzsRng(11),drops=Array.from({length:n},()=>({x:r()*1.9-.95,y:r(),v:1+Math.floor(r()*2)}));
  return Array.from({length:frames},(_,f)=>({strokes:lzsNearest(drops.map(d=>[d.x,1-2*((d.y+d.v*f/frames)%1)])).map(([x,y])=>lzsDot(x,y))}))}
const LZS_CLOUD_DOTS=70,LZS_RAIN_DROPS=40,LZS_RAIN_FRAMES=50;
// puntini a caso che si accendono e si spengono piano: ogni punto ha il suo momento e la sua
// durata, nel giro dell'animazione; il colore del tratto fa la dissolvenza (modo "stroke")
function lzsTwinkle(seed,n,frames,life,colors){const r=lzsRng(seed),dots=Array.from({length:n},()=>{let x,y;do{x=r()*2-1;y=r()*2-1}while(x*x+y*y>1);return{x,y,ph:Math.floor(r()*frames),lf:life+Math.floor(r()*life),c:colors[Math.floor(r()*colors.length)]}});
  return Array.from({length:frames},(_,f)=>{const on=dots.map(d=>{const t=((f+d.ph)%frames)/d.lf;return t<1?[d.x,d.y,d.c,Math.max(.25,Math.sin(Math.PI*t))]:null}).filter(Boolean);
    const list=on.length?on:[[0,0,colors[0],.25]];
    return{strokes:lzsNearest(list).map(([x,y,c,k])=>({...lzsDot(x,y),rgb:c.map(v=>+(v*k).toFixed(3))}))}})}
const LZS_TW_WHITE=[[1,1,1],[.6,.8,1]],LZS_TW_COLOR=[[1,0,.3],[0,.6,1],[0,1,.4],[1,.75,0]];
const lzsScintille=()=>lzsTwinkle(21,64,60,12,LZS_TW_WHITE),lzsCoriandoli=()=>lzsTwinkle(33,48,60,16,LZS_TW_COLOR);
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
    case'nuvola':return lzsCloud();
    case'scintille':return lzsScintille()[0].strokes;
    case'coriandoli':return lzsCoriandoli()[0].strokes;
    case'pioggia':return lzsRain()[0].strokes;
    case'griglia':return[-.6,-.2,.2,.6].flatMap(v=>[{pts:[[-.8,v],[.8,v]],closed:false},{pts:[[v,-.8],[v,.8]],closed:false}]);
  }
  return lzsBeamStrokes(kind);
}
function lzsTemplates(){
  const T=(id,name,color,anim={},audio={amount:0,to:'scale'})=>({id:'tpl-'+id,name,template:true,strokes:lzsShape(id),color:{mode:'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2,...color},anim:{rotate:0,scale:.7,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0,...anim},audio});
  const B=(...a)=>({...T(...a),beam:true});
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
    {...T('pioggia','Pioggia',{rgb:[.15,.65,1]},{scale:.9}),frames:lzsRain(),frame_fps:25},
    T('nuvola','Nuvola di punti',{mode:'cycle',rate:.1},{rotate:25,scale:.85,pulse:.15,pulse_hz:.3}),
    {...T('scintille','Scintille',{mode:'stroke'},{scale:.9}),frames:lzsScintille(),frame_fps:25},
    {...T('coriandoli','Coriandoli',{mode:'stroke'},{scale:.9}),frames:lzsCoriandoli(),frame_fps:25},
    B('ventaglio','Ventaglio di fasci',{rgb:[0,1,.4]},{scale:.9,pulse:.7,pulse_hz:.25,pulse_shape:'ease'}),
    B('onda-fasci','Onda di fasci',{mode:'palette',palette:[[0,.9,1],[0,.36,.4],[0,.1,.12],[0,.1,.12]],rate:.75},{scale:.9}),
    B('stella-fasci','Stella di fasci',{mode:'cycle',rate:.1},{scale:.8,rotate:30}),
    B('foglio','Foglio di luce',{rgb:[.2,.5,1]},{scale:.9,swing:10,swing_hz:.2,swing_shape:'ease'}),
    B('cono','Cono',{rgb:[1,0,.3]},{scale:.5,pulse:.5,pulse_hz:.2,pulse_shape:'ease'}),
    B('tunnel-fasci','Tunnel aperto',{mode:'cycle',rate:.08},{scale:.55,rotate:120}),
  ];
}
function laserScenes(){return Array.isArray(L.laserScenes)?L.laserScenes:[]}
function laserDoc(){return L.laserTimeline&&Array.isArray(L.laserTimeline.cues)?L.laserTimeline:{active:false,cues:[]}}

// ---- animazione (specchio di laser_scene.animate)
function lzsHsv(h){const i=Math.floor(h*6),f=h*6-i,q=1-f,m=[[1,f,0],[q,1,0],[0,1,f],[0,q,1],[f,0,1],[1,0,q]];return m[((i%6)+6)%6]}
function lzsStrokeRgb(sc,i,t,strokes=sc.strokes){
  const c=sc.color||{};
  if(c.mode==='cycle')return lzsHsv(((t*(c.rate||0)+i*.12)%1+1)%1);
  if(c.mode==='palette'){const p=c.palette?.length?c.palette:[[1,1,1]];return p[(Math.floor(t*(c.rate||0)*p.length)+i)%p.length]}
  if(c.mode==='stroke')return strokes[i].rgb||c.rgb||[1,1,1];
  return c.rgb||[1,1,1];
}
// forme della pulsazione e dell'oscillazione (laser_scene.wave): sine = come prima
const LZS_WAVES=[['sine','Sinusoide'],['triangle','Triangolo'],['saw','Dente di sega'],['square','Quadra (a scatti)'],['ease','Morbida (accelera e frena)']];
function lzsWave(x,shape='sine'){
  const p=x-Math.floor(x);
  if(shape==='triangle')return 4*Math.abs(p-.5)-1;
  if(shape==='saw')return 2*p-1;
  if(shape==='square')return p<.5?1:-1;
  if(shape==='ease'){const u=p<.5?p*2:2-p*2,e=u<.5?2*u*u:1-(-2*u+2)**2/2;return 2*e-1}
  return Math.sin(2*Math.PI*x);
}
// scena a tempo: il tempo corre con bpm / bpm di riferimento (laser_scene.tempo_rate)
function lzsTempoRate(sc,bpm){const tp=sc?.tempo;return tp?.sync&&bpm>0?Math.max(.1,Math.min(10,bpm/(+tp.bpm||120))):1}
function lzsAnimate(sc,t,level=0,kick=0){
  const a={rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0,pulse_shape:'sine',swing:0,swing_hz:.25,swing_shape:'sine',...(sc.anim||{})},au={amount:0,to:'scale',...(sc.audio||{})};
  let s=a.scale*(1-a.pulse*.5+a.pulse*.5*lzsWave(a.pulse_hz*t,a.pulse_shape)),bright=1;
  const react=Math.min(1,level+.5*kick)*au.amount;
  if(au.to==='scale')s*=1+.6*react;else bright=(1-au.amount)+react;
  const ang=(a.rotate*t+a.swing*lzsWave(a.swing_hz*t,a.swing_shape))*Math.PI/180,ca=Math.cos(ang),sa=Math.sin(ang);
  const ox=a.orbit*.5*Math.cos(2*Math.PI*a.orbit_hz*t),oy=a.orbit*.5*Math.sin(2*Math.PI*a.orbit_hz*t);
  // animazione (ILDA): il frame del momento, a frame_fps (laser_scene.animate)
  const strokes=sc.frames?.length>1?sc.frames[Math.floor(t*(sc.frame_fps||25))%sc.frames.length].strokes:sc.strokes;
  const total=strokes.reduce((n,st)=>n+st.pts.length+(st.closed?1:0),0);
  let budget=a.draw_hz<=0?total:Math.max(2,Math.floor(total*((t*a.draw_hz)%1)));
  const out=[];
  strokes.forEach((st,i)=>{
    if(budget<=0)return;
    const [r,g,b]=lzsStrokeRgb(sc,i,t,strokes).map(v=>Math.max(0,Math.min(255,Math.floor(v*255*bright))));
    const pts=(st.closed?[...st.pts,st.pts[0]]:st.pts).slice(0,budget);budget-=pts.length;
    pts.forEach(([x,y],j)=>{const px=(x*ca-y*sa)*s+ox,py=(x*sa+y*ca)*s+oy;if(!j)out.push([px,py,0,0,0]);out.push([px,py,r,g,b])});
  });
  return out;
}
function lzsDraw(cv,sc,t,level=0){
  const g=cv.getContext('2d'),W=cv.width,H=cv.height,k=Math.min(W,H)/2*.92;
  g.fillStyle='#05070a';g.fillRect(0,0,W,H);
  if(!sc?.strokes?.length)return;
  const pts=lzsAnimate(sc,t*lzsTempoRate(sc,liveBpm()),level);g.lineWidth=Math.max(1.2,W/90);g.lineCap='round';
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
// --- calcolo puro dell'import SVG (provato in test/laser-svg.test.js) ---
// Campionare a distanza fissa salta gli spigoli veri: quadrati e griglie venivano smussati e il
// render non poteva fermarsi sullo spigolo (2026-11-09). Qui si cercano e si aggiungono.
function lzsCornerLens(len,at,n){
  const step=len/n,base=Array.from({length:n+1},(_,j)=>Math.min(len,j*step)),extra=[],d=step*.02;
  const dir=(a,b)=>{const p=at(a),q=at(b);return Math.atan2(q.y-p.y,q.x-p.x)},diff=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
  const far=(a,b)=>{const p=at(a),q=at(b);return Math.hypot(q.x-p.x,q.y-p.y)>(b-a)*1.5+1e-6};
  for(let j=1;j<n;j++){
    if(far(base[j-1],base[j])||far(base[j],base[j+1]))continue;
    const d0=dir(base[j-1],base[j-1]+d),d1=dir(base[j+1]-d,base[j+1]);
    if(diff(d0,d1)<20*Math.PI/180)continue;
    let lo=base[j-1],hi=base[j+1];
    for(let k=0;k<18;k++){const mid=(lo+hi)/2,dm=dir(mid,Math.min(len,mid+d*.01));if(diff(dm,d0)<diff(dm,d1))lo=mid;else hi=mid}
    extra.push((lo+hi)/2);
  }
  return[...base,...extra].sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>step*1e-3);
}
// via i punti allineati: restano gli spigoli (il render li riconosce e ci si ferma) e i tratti
// tornano dritti; se la linea torna al punto di partenza diventa chiusa
function lzsSimplify(pts,tol=.0006){
  if(pts.length<3)return{pts,closed:false};
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){const a=out[out.length-1],b=pts[i],c=pts[i+1],ux=c[0]-a[0],uy=c[1]-a[1],L=Math.hypot(ux,uy);
    const dist=L?Math.abs((b[0]-a[0])*uy-(b[1]-a[1])*ux)/L:Math.hypot(b[0]-a[0],b[1]-a[1]);
    const back=L&&((b[0]-a[0])*ux+(b[1]-a[1])*uy<0||(b[0]-c[0])*-ux+(b[1]-c[1])*-uy<0);
    if(dist>tol||back)out.push(b)}
  out.push(pts[pts.length-1]);
  const f=out[0],l=out[out.length-1];
  if(out.length>3&&Math.hypot(f[0]-l[0],f[1]-l[1])<tol*2){out.pop();return{pts:out,closed:true}}
  return{pts:out,closed:false};
}
// Peso di una figura: quante volte piu' veloce della velocita' "pulita" devono correre gli
// specchi per ridisegnarla 25 volte al secondo. Stessi valori di ops/laser/laser_render.py
// (108 u/s accesi, 450 al buio, soste di 0,33 ms): 1 = al limite del pulito, oltre si deforma.
const LZS_W={lit:108,blank:450,dwell:.00033,refresh:25,light:1.25,heavy:2.2};
function lzsFrameTime(strokes,scale,pps){
  let t=0,last=null,first=null;const cos45=Math.SQRT1_2;
  for(const st of strokes||[]){
    const raw=(st.pts||[]).map(([x,y])=>[x*scale,y*scale]);if(!raw.length)continue;
    const pts=st.closed?[...raw,raw[0]]:raw,a=pts[0];first=first||a;
    if(last)t+=Math.hypot(a[0]-last[0],a[1]-last[1])/LZS_W.blank;
    t+=LZS_W.dwell*2;             // sosta prima di riaccendere e a fine linea
    for(let i=1;i<pts.length;i++){const p=pts[i-1],q=pts[i],d=Math.hypot(q[0]-p[0],q[1]-p[1]);
      t+=d?d/LZS_W.lit:1/pps;     // punto ripetuto (puntini): un campione in piu'
      const n=pts[i+1];if(n&&d){const e=Math.hypot(n[0]-q[0],n[1]-q[1]);if(e&&((q[0]-p[0])*(n[0]-q[0])+(q[1]-p[1])*(n[1]-q[1]))/(d*e)<cos45)t+=LZS_W.dwell}}
    last=pts[pts.length-1];
  }
  if(last&&first)t+=Math.hypot(first[0]-last[0],first[1]-last[1])/LZS_W.blank;
  return t;
}
// {k, level:'leggera'|'media'|'pesante', scale: dimensione per stare nel pulito (null = non basta)}
function lzsWeight(sc,pps=30000){
  const frames=sc?.frames?.length?sc.frames.map(f=>f.strokes):[sc?.strokes||[]],s=+sc?.anim?.scale||1;
  const heavy=frames.reduce((b,f)=>lzsFrameTime(f,s,pps)>lzsFrameTime(b,s,pps)?f:b,frames[0]);
  const k=lzsFrameTime(heavy,s,pps)*LZS_W.refresh,half=lzsFrameTime(heavy,s/2,pps)*LZS_W.refresh,slope=(k-half)/(s/2),fixed=k-slope*s;
  const fit=slope>0&&fixed<LZS_W.light*.9?Math.min(s,(LZS_W.light-fixed)/slope):null;
  return{k:+k.toFixed(2),level:k<=LZS_W.light?'leggera':k<=LZS_W.heavy?'media':'pesante',scale:fit==null?null:Math.floor(fit*100)/100};
}
function lzsWeightText(w,sc){
  if(w.level==='leggera')return`Figura leggera (${w.k}×): il laser la disegna pulita.`;
  const tip=w.scale!=null&&w.scale<(+sc?.anim?.scale||1)-.01?`Per averla pulita porta la Dimensione a ${w.scale}, oppure togli qualche linea.`:'Togli linee o punti: la Dimensione da sola non basta.';
  return`Figura ${w.level} (${w.k}×): gli specchi devono correre ${w.k} volte oltre il pulito, spigoli e linee possono deformarsi. ${tip}`;
}
// Adatta: la Dimensione che rende pulita la figura; sotto LZS_MIN_AUTO non rimpicciolisce da
// sola e cerca le linee piu' corte da togliere (al massimo un quarto della lunghezza del disegno).
// {kind:'ok'|'scale'|'choice'|'heavy', scale, strokes?, removed?, lost? (%), small? (Dimensione che basterebbe)}
const LZS_MIN_AUTO=.5;
function lzsStrokeLen(st){const p=st.pts||[],q=st.closed&&p.length?[...p,p[0]]:p;let l=0;for(let i=1;i<q.length;i++)l+=Math.hypot(q[i][0]-q[i-1][0],q[i][1]-q[i-1][1]);return l}
function lzsPrune(strokes,scale,pps){
  const total=strokes.reduce((a,s)=>a+lzsStrokeLen(s),0)||1,order=strokes.map((s,i)=>[lzsStrokeLen(s),i]).sort((a,b)=>a[0]-b[0]),gone=new Set();
  let lost=0;
  for(const[len,i]of order){
    if((lost+len)/total>.25)return null;
    gone.add(i);lost+=len;
    const left=strokes.filter((_,k)=>!gone.has(k));
    if(lzsFrameTime(left,scale,pps)*LZS_W.refresh<=LZS_W.light)return{strokes:left,removed:gone.size,lost:Math.round(lost/total*100)};
  }
  return null;
}
function lzsAutoFit(sc,pps=30000){
  const cur=+sc?.anim?.scale||1,w=lzsWeight(sc,pps);
  if(w.level==='leggera')return{kind:'ok',scale:cur};
  if(w.scale!=null&&w.scale>=LZS_MIN_AUTO)return{kind:'scale',scale:w.scale};
  const target=Math.min(cur,LZS_MIN_AUTO),p=sc.frames?.length?null:lzsPrune(sc.strokes||[],target,pps);
  if(!p&&w.scale==null)return{kind:'heavy',scale:cur};
  return{kind:'choice',scale:target,small:w.scale,...(p||{})};
}
// figure di taratura: non stanno nella libreria, si mandano con un tocco
function lzsCalScenes(){
  const line=(a,b)=>({pts:[a,b],closed:false}),frame=r=>({pts:[[-r,-r],[r,-r],[r,r],[-r,r]],closed:true}),ring=r=>({pts:Array.from({length:96},(_,i)=>[+(r*Math.cos(i/96*Math.PI*2)).toFixed(4),+(r*Math.sin(i/96*Math.PI*2)).toFixed(4)]),closed:true});
  const S=(id,name,strokes)=>({id:'cal-'+id,name,calibration:true,strokes,color:{mode:'fixed',rgb:[0,1,.4],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},anim:{rotate:0,scale:1,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},audio:{amount:0,to:'scale'}});
  return[S('croce','Croce',[line([-.9,0],[.9,0]),line([0,-.9],[0,.9])]),S('quadrato','Quadrato',[frame(.9)]),S('cerchio','Cerchio',[ring(.9)]),
    S('angoli','Quattro angoli',[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({pts:[[x*.9,y*.9],[x*.9,y*.7],[x*.9,y*.9],[x*.7,y*.9]],closed:false}))),
    S('griglia','Griglia 3×3',[frame(.45),line([-.15,-.45],[-.15,.45]),line([.15,-.45],[.15,.45]),line([-.45,-.15],[.45,-.15]),line([-.45,.15],[.45,.15])])];
}
// effetti di fascio: figure pensate per il raggio nel fumo, non per la superficie. Pochi punti
// tenuti accesi (ventaglio, onda, stella) o linee che spazzano (foglio, cono, tunnel). Il gateway
// abbassa da solo i frame con pochi raggi fermi (laser_render._limit_spots).
function lzsBeamStrokes(kind){
  const n=8,dot=(x,y)=>({pts:Array.from({length:12},()=>[+x.toFixed(4),+y.toFixed(4)]),closed:false});
  const arc=(deg,k)=>({pts:Array.from({length:k},(_,i)=>{const a=i/(deg<360?k-1:k)*deg*Math.PI/180;return[+Math.cos(a).toFixed(4),+Math.sin(a).toFixed(4)]}),closed:deg>=360});
  switch(kind){
    case'ventaglio':case'onda-fasci':return Array.from({length:n},(_,i)=>dot(i/(n-1)*2-1,0));
    case'stella-fasci':return Array.from({length:n},(_,i)=>dot(Math.cos(i/n*Math.PI*2),Math.sin(i/n*Math.PI*2)));
    case'foglio':return[{pts:[[-1,0],[1,0]],closed:false}];
    case'cono':return[arc(360,96)];
    case'tunnel-fasci':return[arc(290,80)];
  }
  return[];
}
function lzsBeamHint(){return'Effetto di fascio: si vede nel fumo e il raggio arriva lontano. Prima di armare, con la zona di sicurezza tienilo sopra le teste delle persone.'}
// disegno a mano: da tratto del dito (x, y in -1..1) a linea leggera per il laser. Via i punti
// troppo vicini e quelli allineati (Douglas-Peucker); un tocco senza movimento diventa un puntino;
// un tratto che torna vicino a dove era partito si chiude.
function lzsInk(raw,rgb=null){
  if(!raw?.length)return null;
  const R=p=>[+p[0].toFixed(4),+p[1].toFixed(4)],pts=[R(raw[0])];
  for(const p of raw){const l=pts[pts.length-1];if(Math.hypot(p[0]-l[0],p[1]-l[1])>=.008)pts.push(R(p))}
  if(pts.length<2)return{pts:Array.from({length:4},()=>[...pts[0]]),closed:false,rgb};
  const seg=(p,a,b)=>{const ux=b[0]-a[0],uy=b[1]-a[1],L=ux*ux+uy*uy,t=L?Math.max(0,Math.min(1,((p[0]-a[0])*ux+(p[1]-a[1])*uy)/L)):0;return Math.hypot(p[0]-a[0]-t*ux,p[1]-a[1]-t*uy)};
  const keep=new Set([0,pts.length-1]),todo=[[0,pts.length-1]];
  while(todo.length){const[i,j]=todo.pop();let far=-1,fd=.005;for(let k=i+1;k<j;k++){const d=seg(pts[k],pts[i],pts[j]);if(d>fd){fd=d;far=k}}if(far>=0){keep.add(far);todo.push([i,far],[far,j])}}
  const out=pts.filter((_,i)=>keep.has(i)),f=out[0],l=out[out.length-1];
  let run=0;for(let i=1;i<out.length;i++)run+=Math.hypot(out[i][0]-out[i-1][0],out[i][1]-out[i-1][1]);
  if(out.length>3&&run>.3&&Math.hypot(f[0]-l[0],f[1]-l[1])<.05){out.pop();return{pts:out,closed:true,rgb}}
  return{pts:out,closed:false,rgb};
}
function lzsInkPoints(ink){return ink.reduce((n,s)=>n+s.pts.length,0)}
// scala 1: il foglio e' tutto il campo del cubo
function lzsInkScene(ink,name,id){return{id,name,strokes:ink,color:{mode:'stroke',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},anim:{rotate:0,scale:1,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},audio:{amount:0,to:'scale'}}}
// --- fine calcolo puro ---
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
      const n=Math.max(4,Math.round(LZS_SVG_POINTS*lens[i]/total)),m=e.getCTM(),step=lens[i]/n,at=l=>e.getPointAtLength(l),lp=lzsCornerLens(lens[i],at,n);
      const cs=getComputedStyle(e),col=[cs.stroke,cs.fill].map(lzsCssRgb).find(Boolean)||null;
      let cur=[],prev=null;
      for(const l of lp){
        const p=at(Math.min(lens[i],l)),q=m?p.matrixTransform(m):p;
        // salto tra due sotto-tracciati: si chiude la linea e se ne apre un'altra (al buio)
        if(prev&&Math.hypot(q.x-prev.x,q.y-prev.y)>step*3*(m?Math.hypot(m.a,m.b):1)){if(cur.length>1)strokes.push({pts:cur,closed:false,rgb:col});cur=[]}
        cur.push([q.x,q.y]);prev=q;
      }
      if(cur.length>1)strokes.push({pts:cur,closed:false,rgb:col});
    });
    const xs=strokes.flatMap(s=>s.pts.map(p=>p[0])),ys=strokes.flatMap(s=>s.pts.map(p=>p[1]));
    const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,half=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))/2||1;
    strokes.forEach(s=>{const r=lzsSimplify(s.pts.map(([x,y])=>[+((x-cx)/half).toFixed(4),+(-(y-cy)/half).toFixed(4)]));s.pts=r.pts;s.closed=r.closed}); // y dell'SVG va in giu'
    const name=file.name.replace(/\.svg$/i,'');
    return{id:'svg-'+uid(),name,strokes,color:{mode:strokes.some(s=>s.rgb)?'stroke':'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},
      anim:{rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},audio:{amount:0,to:'scale'}};
  }finally{host.remove()}
}
function lzsCssRgb(v){const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v||'');if(!m||m[4]==='0')return null;
  const c=[m[1],m[2],m[3]].map(x=>+(x/255).toFixed(3));return c.some(x=>x>0)?c:null}

// all'import: la Dimensione giusta se basta quella; le linee non si toccano senza chiedere
function lzsFitOnImport(sc){
  const r=lzsAutoFit(sc);
  if(r.kind==='ok')return'';
  if(r.kind==='scale'&&sc.anim){sc.anim.scale=r.scale;return` Dimensione ${r.scale} per averla pulita.`}
  return' Figura pesante: guarda Adatta nella scena.';
}
let LZS_FIT_UNDO=null; // ultimo taglio di linee, per tornare indietro
// ---- pagina Laser: libreria delle scene, da mandare ai cubi scelti
let LZS_TARGET='all',LZS_FLASH=false;   // FLASH: la scena solo finche' la tieni premuta
function lzsTargets(d){return['all',...(d?.laser.cubes||[]).map(c=>c.id)]}
function lzScenesHtml(d){
  const cubes=d.laser.cubes||[],running=new Map();cubes.forEach(c=>{if(c.mode==='scene'&&c.scene)running.set(c.scene.id,[...(running.get(c.scene.id)||[]),c.id])});
  if(!lzsTargets(d).includes(LZS_TARGET))LZS_TARGET='all';
  return`<div class="lzs"><div class="lzs-top"><b>Scene laser</b><span class="hint">tocca una scena per mandarla a</span>
      <span class="lzs-tg">${lzsTargets(d).map(id=>`<button class="${LZS_TARGET===id?'on':''}" data-lzs="target" data-lzs-v="${id}">${id==='all'?'Tutti':esc(id)}</button>`).join('')}</span>
      <button class="btn sm${LZS_FLASH?' on':''}" data-lzs="flash" title="FLASH: tieni premuta una scena per proiettarla sopra quella attiva, si toglie quando la lasci (su tutti i cubi in modalità Scene)">FLASH</button>
      <button class="btn sm ghost" data-lzs="svg">+ Importa SVG</button><button class="btn sm ghost" data-lzs="ilda" title="File ILDA (.ild), anche animati">+ ILDA</button><button class="btn sm ghost" data-lzs="text">+ Testo</button><button class="btn sm ghost" data-lzs="draw" title="Disegna con il dito: ogni tratto è una linea del laser">+ Disegna</button><button class="btn sm ghost" data-lzs="reset" title="Rimette i template mancanti">Template</button></div>
    <div class="lzs-cal"><span class="hint">Taratura</span>${lzsCalScenes().map(c=>`<button class="btn sm ghost" data-lzs="cal" data-lzs-v="${c.id}" title="Manda ${esc(c.name)} a ${LZS_TARGET==='all'?'tutti i cubi':LZS_TARGET}: armare resta manuale. Leggi spigoli e bordi per regolare posizione, scala e trapezio.">${esc(c.name)}</button>`).join('')}</div>
    <div class="lzs-grid">${laserScenes().map(s=>`<div class="lzs-tile${running.has(s.id)?' on':''}">${(w=>w.level==='leggera'?'':`<i class="lzs-w ${w.level}" title="${esc(lzsWeightText(w,s))}">${w.k}×</i>`)(lzsWeight(s))}${s.beam?`<i class="lzs-b" title="${esc(lzsBeamHint())}">fumo</i>`:''}<button class="lzs-go" data-lzs="apply" data-lzs-v="${esc(s.id)}" title="Manda a ${LZS_TARGET==='all'?'tutti i cubi':LZS_TARGET} (passa in modalità Scene)">
        <canvas data-lzs-cv="${esc(s.id)}" width="120" height="120"></canvas><span>${esc(s.name)}</span>${running.has(s.id)?`<em>${running.get(s.id).join(' ')}</em>`:''}</button>
        <button class="lzs-ed" data-lzs="edit" data-lzs-v="${esc(s.id)}" title="Modifica">✎</button></div>`).join('')||'<p class="hint">Nessuna scena: tocca Template.</p>'}</div></div>`;
}
function lzsSig(){return[LZS_TARGET,LZS_FLASH,laserScenes().map(s=>[s.id,s.name,s.anim?.scale])]}
function lzsApply(s,target=LZS_TARGET){lzCmd({action:'scene',cube:target,scene:s},'scene')}
function lzsDown(e,el,w){
  const b=e.target.closest('[data-lzs]');if(!b)return;e.preventDefault();
  const a=b.dataset.lzs,v=b.dataset.lzsV,s=laserScenes().find(x=>x.id===v);
  if(a==='target')LZS_TARGET=v;
  else if(a==='flash')LZS_FLASH=!LZS_FLASH;
  else if(a==='apply'&&s&&LZS_FLASH){lzCmd({action:'flash',on:true,scene:s},'flash');b.classList.add('press');
    const up=()=>{b.removeEventListener('pointerup',up);b.removeEventListener('pointercancel',up);b.removeEventListener('pointerleave',up);b.classList.remove('press');lzCmd({action:'flash',on:false},'flash')};
    b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('pointerleave',up);return}
  else if(a==='apply'&&s){lzsApply(s);showInfo(`Laser: "${s.name}" a ${LZS_TARGET==='all'?'tutti i cubi':LZS_TARGET} (modalità Scene; armare resta manuale).`)}
  else if(a==='cal'){const c=lzsCalScenes().find(x=>x.id===v);if(c){lzsApply(c);showInfo(`Laser: taratura "${c.name}" a ${LZS_TARGET==='all'?'tutti i cubi':LZS_TARGET} (modalità Scene; armare resta manuale).`)}}
  else if(a==='edit'&&s)openLaserSceneEditor(s);
  else if(a==='draw'){openLaserDraw(el,w);return}
  else if(a==='reset'){const have=new Set(laserScenes().map(x=>x.id)),add=lzsTemplates().filter(x=>!have.has(x.id));
    L.laserScenes=[...laserScenes(),...add];save();showInfo(add.length?`Aggiunti ${add.length} template.`:'Tutti i template ci sono già.')}
  else if(a==='text'){uiPrompt('Testo da proiettare (meglio corto: poche parole):','GAIA').then(t=>{if(!t)return;
    try{const sc=lzsTextScene(t);L.laserScenes=[...laserScenes(),sc];save();paintLaser(el,w,true);openLaserSceneEditor(sc)}catch(err){showError('Testo: '+err.message)}});return}
  else if(a==='ilda'){const inp=document.createElement('input');inp.type='file';inp.accept='.ild,.ilda';
    inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;
      try{const sc=lzsParseIlda(await f.arrayBuffer(),f.name.replace(/\.ilda?$/i,'')),n=(sc.frames||[sc]).reduce((k,fr)=>k+fr.strokes.reduce((a,s)=>a+s.pts.length,0),0),fit=lzsFitOnImport(sc);
        L.laserScenes=[...laserScenes(),sc];save();paintLaser(el,w,true);showInfo(`ILDA "${sc.name}": ${sc.frames?sc.frames.length+' frame':'1 frame'}, ${n} punti.${fit}`);openLaserSceneEditor(sc)}
      catch(err){showError('ILDA: '+err.message)}};inp.click();return}
  else if(a==='svg'){const inp=document.createElement('input');inp.type='file';inp.accept='.svg,image/svg+xml';
    inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;
      try{const sc=await lzsImportSvg(f),n=sc.strokes.reduce((k,x)=>k+x.pts.length,0),fit=lzsFitOnImport(sc);L.laserScenes=[...laserScenes(),sc];save();paintLaser(el,w,true);
        showInfo(`SVG "${sc.name}": ${sc.strokes.length} linee, ${n} punti.${fit}`);openLaserSceneEditor(sc)}
      catch(err){showError('SVG: '+err.message)}};inp.click();return}
  paintLaser(el,w,true);
}
// foglio da disegno: il riquadro e' tutto il campo del cubo, zona e maschere restano del gateway
function openLaserDraw(el,w){
  const s=$('#scrim'),MAX=1800,ink=[],id='drw-'+uid();let cur=null,target=LZS_TARGET;s.hidden=false;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Disegno laser">
    <div class="top"><h3>Disegno a mano</h3><button class="btn ghost" id="ldClose">Chiudi</button></div>
    <div class="lzs-dr-grid"><canvas id="ldCv" width="640" height="640"></canvas><div>
      <label>Nome<input id="ldName" value="Disegno"></label>
      <label>Colore del tratto<input type="color" id="ldCol" value="#00ff66"></label>
      <div class="row"><button class="btn sm ghost" id="ldUndo">Togli ultimo</button><button class="btn sm ghost" id="ldClear">Cancella tutto</button></div>
      <p class="hint" id="ldN"></p><p class="hint lzs-wtxt" id="ldW"></p>
      <p class="hint">Il riquadro è tutto il campo del cubo. Meglio poche linee: ogni tratto in più pesa sugli specchi.</p>
      <label class="chk"><input id="ldLive" type="checkbox"> In diretta sui cubi, a ogni tratto (armare resta manuale)</label>
      <div class="row"><span class="lzs-tg" id="ldTg"></span><button class="btn" id="ldTry">Prova sui cubi</button></div>
    </div></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="ldCancel">Annulla</button><button class="btn primary" id="ldSave">Salva</button></div>
  </div>`;
  const cv=$('#ldCv'),g=cv.getContext('2d'),W=cv.width,X=v=>(v+1)/2*W,Y=v=>(1-v)/2*W;
  const hex=c=>'#'+c.map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join(''),unhex=h=>[1,3,5].map(i=>+(parseInt(h.slice(i,i+2),16)/255).toFixed(3));
  const trace=(pts,closed,col)=>{g.strokeStyle=col;g.fillStyle=col;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(X(p[0]),Y(p[1])):g.moveTo(X(p[0]),Y(p[1])));if(closed)g.closePath();g.stroke();if(pts.every(p=>p[0]===pts[0][0]&&p[1]===pts[0][1])){g.beginPath();g.arc(X(pts[0][0]),Y(pts[0][1]),5,0,7);g.fill()}};
  const paint=()=>{g.fillStyle='#05070a';g.fillRect(0,0,W,W);g.strokeStyle='#ffffff1c';g.lineWidth=1;g.beginPath();g.moveTo(W/2,0);g.lineTo(W/2,W);g.moveTo(0,W/2);g.lineTo(W,W/2);g.stroke();
    g.lineWidth=4;g.lineCap=g.lineJoin='round';ink.forEach(st=>trace(st.pts,st.closed,hex(st.rgb)));if(cur)trace(cur,false,$('#ldCol').value)};
  const scene=()=>lzsInkScene(ink,$('#ldName').value.trim()||'Disegno',id);
  const info=()=>{const n=lzsInkPoints(ink),box=$('#ldW');$('#ldN').textContent=`${ink.length} linee · ${n} punti`;if(ink.length){const r=lzsWeight(scene());box.textContent=lzsWeightText(r,scene());box.className='hint lzs-wtxt '+r.level}else{box.textContent='';box.className='hint lzs-wtxt'}};
  const send=()=>{if(!ink.length)return;if(!lzDev()){showError('Laser gateway non collegato.');return}lzsApply(scene(),target)};
  const at=e=>{const r=cv.getBoundingClientRect(),c=v=>Math.max(-1,Math.min(1,v));return[c((e.clientX-r.left)/r.width*2-1),c(1-(e.clientY-r.top)/r.height*2)]};
  cv.onpointerdown=e=>{e.preventDefault();cv.setPointerCapture(e.pointerId);cur=[at(e)];paint()};
  cv.onpointermove=e=>{if(!cur)return;cur.push(at(e));paint()};
  const end=()=>{if(!cur)return;const st=lzsInk(cur,unhex($('#ldCol').value));cur=null;
    if(st&&lzsInkPoints(ink)+st.pts.length>MAX)showError('Disegno pieno: togli qualche tratto.');
    else if(st){ink.push(st);info();if($('#ldLive').checked)send()}
    paint()};
  cv.onpointerup=cv.onpointercancel=end;
  const tg=$('#ldTg'),d=lzDev(),paintTg=()=>{tg.innerHTML=lzsTargets(d).map(t=>`<button class="${target===t?'on':''}" data-t="${esc(t)}">${t==='all'?'Tutti':esc(t)}</button>`).join('')};paintTg();
  tg.onclick=e=>{const b=e.target.closest('[data-t]');if(b){target=b.dataset.t;paintTg()}};
  $('#ldUndo').onclick=()=>{ink.pop();info();paint();if(ink.length&&$('#ldLive').checked)send()};
  $('#ldClear').onclick=()=>{ink.length=0;info();paint()};
  $('#ldTry').onclick=()=>{if(!ink.length){showError('Disegna almeno un tratto.');return}send();showInfo(`Laser: prova del disegno su ${target==='all'?'tutti i cubi':target} (non salvata).`)};
  $('#ldClose').onclick=$('#ldCancel').onclick=closeSheet;
  $('#ldSave').onclick=()=>{if(!ink.length){showError('Disegna almeno un tratto.');return}const sc=scene();L.laserScenes=[...laserScenes(),sc];save();paintLaser(el,w,true);openLaserSceneEditor(sc)};
  info();paint();
}
function openLaserSceneEditor(orig){
  const sc=JSON.parse(JSON.stringify(orig)),s=$('#scrim');s.hidden=false;
  const C={mode:'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2,...sc.color},A={rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0,pulse_shape:'sine',swing:0,swing_hz:.25,swing_shape:'sine',...sc.anim},U={amount:0,to:'scale',...sc.audio};
  const TP={sync:false,bpm:liveBpm(),...sc.tempo},wv=(id,cur)=>`<select id="${id}">${LZS_WAVES.map(([k,t])=>`<option value="${k}"${k===cur?' selected':''}>${t}</option>`).join('')}</select>`;
  const hex=c=>'#'+c.map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join(''),unhex=h=>[1,3,5].map(i=>+(parseInt(h.slice(i,i+2),16)/255).toFixed(3));
  const sl=(id,label,v,min,max,step)=>`<label class="ar-sl"><span>${label}<b id="${id}V">${(+v).toFixed(step<1?2:0)}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  const n=sc.strokes.reduce((k,x)=>k+x.pts.length,0),nf=sc.frames?.length||0;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Scena laser">
    <div class="top"><h3>Scena laser</h3><button class="btn ghost" id="lsClose">Chiudi</button></div>
    <div class="lzs-ed-grid"><canvas id="lsPrev" width="260" height="260"></canvas><div>
      <label>Nome<input id="lsName" value="${esc(sc.name)}"></label>
      <p class="hint">${sc.strokes.length} linee · ${n} punti${nf?` · animazione di ${nf} frame a ${sc.frame_fps||25} fps`:''}${sc.template?' · template':''}. Anteprima qui accanto; il gateway applica poi zona e intensità di ogni cubo.</p>
      <p class="hint lzs-wtxt" id="lsWeight"></p><div class="row"><button class="btn sm" id="lsFit" title="Trova la Dimensione che rende pulita la figura">Adatta</button><button class="btn sm ghost" id="lsFitUndo"${LZS_FIT_UNDO?.id===sc.id?'':' hidden'}>Rimetti le linee</button></div>${sc.beam?`<p class="hint lzs-bhint">${esc(lzsBeamHint())}</p>`:''}
      <label>Colore<select id="lsCm">${[['fixed','Fisso'],['cycle','Arcobaleno che scorre'],['palette','Palette a turno'],['stroke','Colori dell\'SVG']].map(([k,t])=>`<option value="${k}"${C.mode===k?' selected':''}>${t}</option>`).join('')}</select></label>
      <div class="two"><label>Colore fisso<input type="color" id="lsRgb" value="${hex(C.rgb)}"></label><label>Palette<span class="lzs-pal">${C.palette.slice(0,4).map((c,i)=>`<input type="color" data-pal="${i}" value="${hex(c)}">`).join('')}</span></label></div>
      ${sl('lsRate','Velocità colore (giri/s)',C.rate,0,2,.01)}
    </div></div>
    <div class="two">${sl('lsRot','Rotazione (gradi/s)',A.rotate,-360,360,1)}${sl('lsScale','Dimensione',A.scale,.05,1,.01)}</div>
    <div class="two">${sl('lsPulse','Pulsazione',A.pulse,0,1,.01)}${sl('lsPulseHz','Pulsazione (Hz)',A.pulse_hz,0,4,.05)}</div>
    <label>Forma della pulsazione${wv('lsPulseSh',A.pulse_shape)}</label>
    <div class="two">${sl('lsSwing','Oscillazione della rotazione (gradi, 0 = gira e basta)',A.swing,0,180,1)}${sl('lsSwingHz','Oscillazione (Hz)',A.swing_hz,0,4,.05)}</div>
    <label>Forma dell'oscillazione${wv('lsSwingSh',A.swing_shape)}</label>
    <label class="chk"><input id="lsTempo" type="checkbox"${TP.sync?' checked':''}> A tempo: le velocità seguono il BPM dello show (riferimento <b id="lsTempoRef">${TP.bpm}</b> BPM: a quel BPM vanno come impostate qui)</label>
    <div class="two">${sl('lsOrbit','Orbita',A.orbit,0,1,.01)}${sl('lsOrbitHz','Orbita (Hz)',A.orbit_hz,0,2,.01)}</div>
    <div class="two">${sl('lsDraw','Scrittura progressiva (Hz, 0 = figura intera)',A.draw_hz,0,2,.01)}${sl('lsAudio','Audio dal controller',U.amount,0,1,.01)}</div>
    <label>L'audio muove<select id="lsAudioTo"><option value="scale"${U.to==='scale'?' selected':''}>la dimensione</option><option value="brightness"${U.to==='brightness'?' selected':''}>la luminosità</option></select></label>
    <p class="hint">L'audio arriva dai meter dei gruppi di DMX Master (livello e kick del controller): se DMX Master è spento la scena resta ferma sull'audio.</p>
    <div class="row"><span class="lzs-tg" id="lsTg"></span><button class="btn" id="lsTry">Prova sui cubi</button></div>
    <div class="cue-editor-actions"><button class="btn danger" id="lsDel">Elimina</button><button class="btn ghost" id="lsDup">Duplica</button><button class="btn primary" id="lsSave">Salva</button></div>
  </div>`;
  const paintWeight=()=>{const box=$('#lsWeight');if(!box)return;const w=lzsWeight(sc);box.textContent=lzsWeightText(w,sc);box.className='hint lzs-wtxt '+w.level;$('#lsFit').hidden=w.level==='leggera'};
  const read=()=>{
    sc.name=$('#lsName').value.trim()||'Scena';
    sc.color={...C,mode:$('#lsCm').value,rgb:unhex($('#lsRgb').value),palette:[...s.querySelectorAll('[data-pal]')].map(x=>unhex(x.value)),rate:+$('#lsRate').value};
    sc.anim={rotate:+$('#lsRot').value,scale:+$('#lsScale').value,pulse:+$('#lsPulse').value,pulse_hz:+$('#lsPulseHz').value,orbit:+$('#lsOrbit').value,orbit_hz:+$('#lsOrbitHz').value,draw_hz:+$('#lsDraw').value,
      pulse_shape:$('#lsPulseSh').value,swing:+$('#lsSwing').value,swing_hz:+$('#lsSwingHz').value,swing_shape:$('#lsSwingSh').value};
    // a tempo: il riferimento e' il BPM del momento in cui lo si accende
    const on=$('#lsTempo').checked;if(on&&!sc.tempo?.sync){TP.bpm=liveBpm();$('#lsTempoRef').textContent=TP.bpm}sc.tempo={sync:on,bpm:TP.bpm};
    sc.audio={amount:+$('#lsAudio').value,to:$('#lsAudioTo').value};paintWeight();return sc};
  s.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const b=$('#'+r.id+'V');if(b)b.textContent=(+r.value).toFixed(+r.step<1?2:0);read()});
  s.querySelectorAll('select,input[type=color],#lsName,#lsTempo').forEach(x=>x.oninput=read);
  paintWeight();
  const d=lzDev(),tg=s.querySelector('#lsTg');let target=LZS_TARGET;
  const paintTg=()=>{tg.innerHTML=lzsTargets(d).map(id=>`<button class="${target===id?'on':''}" data-t="${id}">${id==='all'?'Tutti':esc(id)}</button>`).join('')};paintTg();
  tg.onclick=e=>{const b=e.target.closest('[data-t]');if(b){target=b.dataset.t;paintTg()}};
  const cv=$('#lsPrev'),t0=performance.now();
  const anim=()=>{if(!document.body.contains(cv))return;lzsDraw(cv,sc,(performance.now()-t0)/1000,U.amount?(.5+.5*Math.sin(performance.now()/180)):0);requestAnimationFrame(anim)};anim();
  const store=x=>{const i=laserScenes().findIndex(y=>y.id===x.id);const list=[...laserScenes()];if(i<0)list.push(x);else list[i]=x;L.laserScenes=list;save()};
  $('#lsClose').onclick=closeSheet;
  const setScale=v=>{const x=$('#lsScale');x.value=v;x.oninput()};
  $('#lsFit').onclick=async()=>{read();const r=lzsAutoFit(sc);
    if(r.kind==='ok')return;
    if(r.kind==='scale'){setScale(r.scale);showInfo(`Dimensione ${r.scale}: la figura è pulita.`);return}
    if(r.kind==='heavy'){showInfo('Troppi punti o linee anche con la Dimensione al minimo: serve un disegno più semplice.');return}
    const v=await uiChoose('Figura troppo carica per restare grande',[
      ...(r.strokes?[{label:`Togli ${r.removed} linee piccole (${r.lost}% del disegno), Dimensione ${r.scale}`,value:'prune'}]:[]),
      ...(r.small!=null?[{label:`Non togliere nulla, Dimensione ${r.small} (più piccola)`,value:'small'}]:[]),
      {label:'Lascia com\'è',value:'none'}]);
    if(v==='small')setScale(r.small);
    else if(v==='prune'){LZS_FIT_UNDO={id:sc.id,strokes:sc.strokes,scale:sc.anim.scale};sc.strokes=r.strokes;sc.anim.scale=r.scale;openLaserSceneEditor(sc)}};
  $('#lsFitUndo').onclick=()=>{read();const u=LZS_FIT_UNDO;LZS_FIT_UNDO=null;sc.strokes=u.strokes;sc.anim.scale=u.scale;openLaserSceneEditor(sc)};
  $('#lsTry').onclick=()=>{read();if(!d){showError('Laser gateway non collegato.');return}lzsApply(sc,target);showInfo(`Laser: prova di "${sc.name}" su ${target==='all'?'tutti i cubi':target} (non salvata).`)};
  $('#lsSave').onclick=()=>{read();delete sc.template;store(sc);closeSheet();showInfo(`Scena "${sc.name}" salvata nel progetto.`)};
  $('#lsDup').onclick=()=>{read();const c={...JSON.parse(JSON.stringify(sc)),id:'scn-'+uid(),name:sc.name+' (copia)'};delete c.template;store(c);openLaserSceneEditor(c)};
  $('#lsDel').onclick=async()=>{const used=laserDoc().cues.filter(c=>c.scene===sc.id).length;
    if(used&&!await uiConfirm(`"${sc.name}" è usata da ${used} cue della traccia LASER. Eliminarla?`,{ok:'Elimina'}))return;
    L.laserScenes=laserScenes().filter(x=>x.id!==sc.id);save();closeSheet()};
}

// ---- timeline LASER (terza riga della timeline dello show, la esegue il bridge)
function laserCueText(c){
  const M={'':'',off:'spento',test:'test',scene:'scena',patchdeck:'PatchDeck',yolo:'Yolo'};
  const sc=c.scene?laserScenes().find(s=>s.id===c.scene)?.name||'(scena tolta)':'';
  return[c.cube&&c.cube!=='all'?c.cube:'tutti',M[c.mode||'']||'',sc].filter(Boolean).join(' · ');
}
function laserLaneHtml(w,D){
  const cues=[...laserDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const e=cues[i+1]?.time??D;
    return`<div class="tl-blk tl-vblk" data-ci="${laserDoc().cues.indexOf(c)}" style="left:${c.time/D*100}%;width:${Math.max(0,e-c.time)/D*100}%;--ic:${c.mode==='off'?'#5d6573':'#ff365c'}"><span>${esc(c.label||'Laser')}</span><em>${esc(laserCueText(c))}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k">LASER</span>
    <button class="tl-live tl-llive" data-act="llive"${w.readonly?' disabled':''} title="LASER · TIMELINE: il bridge sceglie sorgente e scena dei cubi secondo la timeline. LIVE: dal tablet. Armare resta sempre manuale">—</button>
    ${w.readonly?'':'<button class="tl-vcue" data-act="lcue" title="Elenco delle cue laser">CUE</button>'}
    </div>
    <div class="tl-vlane tl-tlane" data-trk="laser"${w.readonly?'':' title="Tocca un punto o un blocco per le cue laser, trascina un blocco per spostarlo"'}><div class="tl-cues">${blocks}</div><span class="tl-vst tl-lst"></span><div class="tl-ph tl-lph"></div></div></div>`;
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
async function toggleLaserActive(){
  const doc=laserDoc(),on=!!doc.active;
  if(!on&&!await uiConfirm('Il LASER segue la timeline?\nIl bridge sceglie subito sorgente e scena di ogni cubo secondo il tempo corrente. Armare resta manuale.',{ok:'TIMELINE'}))return;
  L.laserTimeline={...doc,active:!on};save();refreshShowTimelines();
  showInfo(on?'LASER LIVE: sorgenti e scene dal tablet.':'LASER TIMELINE: il bridge segue la timeline.');
}
function openLaserCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  cues=cues||laserDoc().cues.map(c=>({...c}));
  const cubeIds=['all',...new Set([...(lzDev()?.laser.cubes||[]).map(c=>c.id),'c1','c2','c3'])];
  const MODES=[['','invariata'],['scene','Scena'],['patchdeck','PatchDeck'],['yolo','Yolo'],['test','Test'],['off','Spento']];
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
// 2026-11-03: riga di effetti dal vivo sotto il widget laser (uiRev 11)
function migrateUiLaserFx(){
  if((L.uiRev||0)>=11)return;
  const pg=L.pages.find(p=>p.name==='Laser'),lw=pg?.widgets.find(w=>w.type==='laser');
  if(pg&&lw&&!pg.widgets.some(w=>String(w.addr||'').startsWith('/laser/'))&&lw.y===0&&lw.h>=10){lw.h=7;pg.widgets.push(...laserFxWidgets(7))}
  L.uiRev=11;save();
}
// 2026-11-10: la Tinta del laser da fader a ruota colore (uiRev 20)
function migrateUiLaserTint(){
  if((L.uiRev||0)>=20)return;
  for(const p of L.pages)p.widgets.forEach((w,i)=>{if(w.type==='fader'&&w.addr==='/laser/fx/hue'){
    const{id,x,y,w:wd,h,label,color,oscChannel}=w;p.widgets[i]={...W('color',x,y,wd,h,{label,color,addr:'/laser/fx/tint',value:{h:0,s:0}}),id,...(oscChannel!=null?{oscChannel}:{})}}});
  L.uiRev=20;save();
}
function migrateUiLaserScenes(){
  if((L.uiRev||0)>=7)return;
  if(!Array.isArray(L.laserScenes))L.laserScenes=lzsTemplates();
  L.uiRev=7;save();
}
