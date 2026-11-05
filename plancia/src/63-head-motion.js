/* ---------- scene di movimento delle teste: formato, matematica, template ---------- */
// Come le scene laser: una figura (template, disegno, REC o SVG) e come
// percorrerla. La esegue un motore fuori dal tablet: oggi quello della Plancia
// su OPS (head-motion-engine.js, /mh/pantilt uguale per tutte le teste
// selezionate), poi DMX Master con la stessa scena e ogni testa per conto suo
// (ventaglio, onda, specchio). Idee di Copilot (99-motion-scenes.js, 2/11):
// curve di accelerazione e avanti/indietro. Questo file e' anche un modulo
// Node: il motore del bridge usa le stesse funzioni.
//
// Scena (L.headMotions[]):
//   {id, name, template?, path: {pts: [[x, y]...], closed},  x, y in -1..1, y in alto
//    center: [pan, tilt] | null, size: [pan, tilt]   unita' di /mh/pantilt: -1..1 = escursione intera
//      center null = ogni testa gira intorno a dove si trova all'avvio (motore DMX Master, nota TD 55);
//      il motore OPS non conosce le posizioni e gira intorno al centro [0, 0]
//    period: {value, unit: 'beats'|'s'}          durata di un giro
//    easing: 'linear'|'easeIn'|'easeOut'|'easeInOut'|'sine', pingpong, reverse
//    spread: {mode: 'same'|'phase'|'mirror'|'phase_mirror', phase}   testa k: +k*phase di giro, dispari a specchio
//    motor: null | 0..1}                         velocita' dei motori (heads_speed), null = invariata
const HM_EASINGS=[['linear','Costante'],['easeInOut','Morbido (accelera e frena)'],['easeIn','Accelera'],['easeOut','Frena'],['sine','Sinusoidale']];
const HM_SPREADS=[['same','Tutte uguali'],['phase','Onda (sfasate)'],['mirror','A specchio'],['phase_mirror','Ventaglio (sfasate e a specchio)']];
function hmEase(x,mode){
  switch(mode){
    case'easeIn':return x*x;
    case'easeOut':return 1-(1-x)*(1-x);
    case'easeInOut':return x<.5?2*x*x:1-(-2*x+2)**2/2;
    case'sine':return(1-Math.cos(Math.PI*x))/2;
    default:return x;
  }
}
// punto a frazione u (0..1) della lunghezza del percorso: velocita' costante lungo la figura
const HM_LEN=new WeakMap();
function hmPathAt(path,u){
  const pts=path?.pts||[];if(!pts.length)return[0,0];if(pts.length===1)return pts[0];
  let c=HM_LEN.get(pts);
  if(!c){const seq=path.closed?[...pts,pts[0]]:pts,acc=[0];
    for(let i=1;i<seq.length;i++)acc.push(acc[i-1]+Math.hypot(seq[i][0]-seq[i-1][0],seq[i][1]-seq[i-1][1]));
    c={seq,acc};HM_LEN.set(pts,c)}
  const total=c.acc[c.acc.length-1];if(!(total>0))return pts[0];
  const d=Math.max(0,Math.min(1,u))*total;let i=1;while(i<c.acc.length-1&&c.acc[i]<d)i++;
  const a=c.seq[i-1],b=c.seq[i],f=(d-c.acc[i-1])/((c.acc[i]-c.acc[i-1])||1);
  return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
const hmPeriod=(sc,bpm)=>{const v=+sc?.period?.value||4;return Math.max(.05,sc?.period?.unit==='s'?v:v*60/(bpm>0?bpm:120))};
// pan/tilt (-1..1) della testa k al tempo t (secondi)
function hmPoint(sc,t,k=0,bpm=120){
  const sp=sc.spread||{},mode=sp.mode||'same';
  let u=t/hmPeriod(sc,bpm)+(mode==='phase'||mode==='phase_mirror'?k*(+sp.phase||0):0);
  u-=Math.floor(u);
  if(sc.pingpong)u=u<.5?u*2:2-u*2;
  if(sc.reverse)u=1-u;
  let[x,y]=hmPathAt(sc.path,hmEase(u,sc.easing));
  if((mode==='mirror'||mode==='phase_mirror')&&k%2)x=-x;
  const c=sc.center||[0,0],s=sc.size||[.4,.3],cl=v=>Math.max(-1,Math.min(1,v));
  return[+cl(c[0]+s[0]*x).toFixed(4),+cl(c[1]+s[1]*y).toFixed(4)];
}
// ---- template: figure (x, y in -1..1, y in alto)
function hmShape(kind){
  const P=(n,f,closed)=>({pts:Array.from({length:n},(_,i)=>f(i/(closed?n:n-1))).map(([x,y])=>[+x.toFixed(4),+y.toFixed(4)]),closed:!!closed});
  const TAU=Math.PI*2;
  switch(kind){
    case'cerchio':return P(72,u=>[Math.cos(u*TAU),Math.sin(u*TAU)],true);
    case'otto':return P(96,u=>{const t=u*TAU,d=1+Math.sin(t)**2;return[Math.cos(t)/d,Math.sin(t)*Math.cos(t)/d*1.6]},true);
    case'onda':return P(80,u=>[u*2-1,Math.sin(u*TAU*2)*.6]);
    case'scanner':return{pts:[[-1,0],[1,0]],closed:false};
    case'annuisci':return{pts:[[0,-1],[0,1]],closed:false};
    case'apri':return{pts:[[0,0],[1,0]],closed:false};
    case'quadrato':return{pts:[[-1,-1],[1,-1],[1,1],[-1,1]],closed:true};
    case'triangolo':return{pts:[0,1,2].map(i=>[+Math.cos(Math.PI/2+i*TAU/3).toFixed(4),+Math.sin(Math.PI/2+i*TAU/3).toFixed(4)]),closed:true};
    case'balletto':return P(120,u=>[Math.sin(3*u*TAU+Math.PI/2),Math.sin(2*u*TAU)],true);
    case'vagare':return P(120,u=>{const t=u*TAU;return[(Math.sin(t)+.45*Math.sin(3*t+1)+.25*Math.sin(5*t+2))/1.5,(Math.cos(2*t)+.4*Math.sin(4*t+.5))/1.3]},true);
  }
  return{pts:[[0,0]],closed:false};
}
function hmTemplates(){
  const T=(id,name,o={})=>({id:'hm-'+id,name,template:true,path:hmShape(id),center:[0,0],size:[.35,.25],period:{value:8,unit:'beats'},
    easing:'linear',pingpong:false,reverse:false,spread:{mode:'same',phase:0},motor:null,...o});
  return[
    T('cerchio','Cerchio'),
    T('otto','Otto',{size:[.4,.25],period:{value:16,unit:'beats'}}),
    T('scanner','Scanner (pan)',{size:[.45,0],pingpong:true,easing:'sine'}),
    T('annuisci','Sì (tilt)',{size:[0,.3],pingpong:true,easing:'sine',period:{value:4,unit:'beats'}}),
    T('onda','Onda',{size:[.45,.2],pingpong:true,easing:'easeInOut'}),
    T('apri','Ventaglio',{size:[.4,0],pingpong:true,easing:'sine',spread:{mode:'mirror',phase:0}}),
    T('cerchio','Onda di cerchi',{id:'hm-onda-cerchi',spread:{mode:'phase',phase:.15}}),
    T('balletto','Balletto',{size:[.35,.25],period:{value:16,unit:'beats'},spread:{mode:'phase_mirror',phase:.25}}),
    T('quadrato','Quadrato',{easing:'easeInOut'}),
    T('triangolo','Triangolo',{easing:'easeInOut'}),
    T('vagare','Vagare (lento)',{size:[.4,.25],period:{value:30,unit:'s'},easing:'linear'})
  ];
}
if(typeof module==='object'&&module.exports){module.exports={hmEase,hmPathAt,hmPeriod,hmPoint,hmShape,hmTemplates,HM_EASINGS,HM_SPREADS}}
