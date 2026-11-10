/* ---------- scene laser da file ILDA e da testo ---------- */
// ILDA (.ild): il formato standard dei contenuti laser (anche quelli che
// Liberation e libera-lab leggono). Sezioni da 32 byte "ILDA" + record: formati
// 0/1 (3D/2D a colore indicizzato), 2 (palette), 4/5 (3D/2D a colore pieno).
// Ogni sezione di punti e' un frame; piu' frame = animazione (frames + frame_fps,
// la riproduce il gateway). Punto: bit 6 dello stato = spento, bit 7 = ultimo.
// Scritto da zero sulla specifica ILDA (niente codice delle app GPL).
const ILDA_MAX_FRAMES=120,ILDA_MAX_POINTS=12000;   // come laser_scene.MAX_FRAMES / MAX_FRAME_POINTS
// palette di ripiego (64 colori) per i file indicizzati senza palette: giro di tinte + bianco
function ildaDefaultPalette(){
  const p=[];for(let i=0;i<56;i++){const h=i/56,f=k=>Math.max(0,Math.min(1,Math.abs((h*6+k)%6-3)-1));p.push([f(0),f(4),f(2)])}
  while(p.length<64)p.push([1,1,1]);return p;
}
// punti di un frame -> tratti: un tratto finisce a un punto spento o a un cambio di colore
function ildaStrokes(points){
  const strokes=[];let cur=null,prev=null;
  for(const p of points){
    if(p.lit){
      const rgb=p.rgb.map(v=>+v.toFixed(3));
      if(!cur||cur.rgb.join()!==rgb.join()){cur={pts:prev?[prev]:[],closed:false,rgb,n:0};strokes.push(cur)}
      cur.n++;
      const last=cur.pts[cur.pts.length-1];if(!last||last[0]!==p.x||last[1]!==p.y)cur.pts.push([p.x,p.y]);
    }else cur=null;
    prev=[p.x,p.y];
  }
  // punto acceso fermo per piu' campioni = fascio o puntino: si tiene ripetuto, come i template di fascio
  return strokes.filter(s=>s.pts.length>1||s.n>1).map(({n,...s})=>s.pts.length>1?s:{...s,pts:Array.from({length:n},()=>[...s.pts[0]])});
}
function lzsParseIlda(buf,name='ILDA'){
  const dv=new DataView(buf),frames=[];let off=0,palette=ildaDefaultPalette(),total=0;
  while(off+32<=dv.byteLength&&frames.length<ILDA_MAX_FRAMES){
    // file rovinato a meta': si tengono i frame buoni letti fin li'
    if(String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3))!=='ILDA'){if(frames.length)break;throw new Error('non è un file ILDA (manca l\'intestazione "ILDA")')}
    const fmt=dv.getUint8(off+7),n=dv.getUint16(off+24);off+=32;
    if(!n)break;                                         // sezione vuota = fine del file
    const size={0:8,1:6,2:3,4:10,5:8}[fmt];if(!size)throw new Error(`formato ILDA ${fmt} non supportato`);
    if(off+n*size>dv.byteLength){if(frames.length)break;throw new Error('file ILDA troncato')}
    if(fmt===2){palette=[];for(let i=0;i<n;i++)palette.push([0,1,2].map(k=>dv.getUint8(off+i*3+k)/255));off+=n*size;continue}
    const pts=[],is3d=fmt===0||fmt===4,st=is3d?6:4;
    for(let i=0;i<n;i++){const o=off+i*size,status=dv.getUint8(o+st),blank=!!(status&0x40);
      const x=Math.max(-1,Math.min(1,dv.getInt16(o)/32767)),y=Math.max(-1,Math.min(1,dv.getInt16(o+2)/32767));
      const rgb=fmt<=1?(palette[dv.getUint8(o+st+1)]||[1,1,1]):[dv.getUint8(o+st+3)/255,dv.getUint8(o+st+2)/255,dv.getUint8(o+st+1)/255]; // a colore pieno: B G R
      pts.push({x:+x.toFixed(4),y:+y.toFixed(4),lit:!blank&&rgb.some(v=>v>0),rgb})}
    off+=n*size;
    const strokes=ildaStrokes(pts),k=strokes.reduce((a,s)=>a+s.pts.length,0);
    if(!strokes.length)continue;
    if(total+k>ILDA_MAX_POINTS)break;
    total+=k;frames.push({strokes});
  }
  if(!frames.length)throw new Error('nessun frame disegnabile nel file');
  const beam=frames.every(f=>f.strokes.every(s=>s.pts.every(p=>p[0]===s.pts[0][0]&&p[1]===s.pts[0][1])));  // solo punti fermi: effetto di fascio
  return{id:'ilda-'+uid(),name,strokes:frames[0].strokes,...(frames.length>1?{frames,frame_fps:25}:{}),...(beam?{beam:true}:{}),
    color:{mode:'stroke',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},
    anim:{rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},audio:{amount:0,to:'scale'}};
}
// ---- testo: contorni delle lettere (marching squares sul testo disegnato in un canvas)
function lzsTextScene(text,{font='700 96px sans-serif'}={}){
  const cv=document.createElement('canvas'),g=cv.getContext('2d');g.font=font;
  const W=Math.ceil(g.measureText(text).width)+16,H=130;cv.width=W;cv.height=H;
  g.font=font;g.fillStyle='#fff';g.textBaseline='middle';g.fillText(text,8,H/2);
  const a=g.getImageData(0,0,W,H).data,on=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&a[(y*W+x)*4+3]>127;
  // per ogni pixel acceso un lato verso ogni vicino spento, sempre in senso orario
  // attorno al pixel: i lati si uniscono in anelli chiusi (contorni e buchi)
  const edges=new Map(),key=(x,y)=>x+','+y,add=(x0,y0,x1,y1)=>{const k=key(x0,y0);edges.set(k,[...(edges.get(k)||[]),[x1,y1]])};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!on(x,y))continue;
    if(!on(x,y-1))add(x,y,x+1,y);if(!on(x+1,y))add(x+1,y,x+1,y+1);
    if(!on(x,y+1))add(x+1,y+1,x,y+1);if(!on(x-1,y))add(x,y+1,x,y)}
  const loops=[];
  for(const start of [...edges.keys()]){
    while(edges.get(start)?.length){
      const loop=[start.split(',').map(Number)];let at=start;
      for(let guard=0;guard<20000;guard++){const out=edges.get(at);if(!out?.length)break;const to=out.pop();at=key(...to);if(at===start)break;loop.push(to)}
      if(loop.length>8)loops.push(loop);
    }
  }
  // semplificazione (Ramer-Douglas-Peucker, 1.2 px) e normalizzazione a -1..1, proporzioni tenute
  const rdp=(p,e)=>{if(p.length<3)return p;let m=0,i0=0;const[a,b]=[p[0],p[p.length-1]],L=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    for(let i=1;i<p.length-1;i++){const d=Math.abs((b[0]-a[0])*(a[1]-p[i][1])-(a[0]-p[i][0])*(b[1]-a[1]))/L;if(d>m){m=d;i0=i}}
    return m>e?[...rdp(p.slice(0,i0+1),e).slice(0,-1),...rdp(p.slice(i0),e)]:[a,b]};
  const all=loops.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);if(!all.length)throw new Error('testo vuoto');
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,half=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))/2||1;
  // anello chiuso: diviso al punto piu' lontano dall'inizio, se no RDP lo riduce a un punto
  const ring=l=>{let k=0,m=-1;l.forEach((p,i)=>{const d=Math.hypot(p[0]-l[0][0],p[1]-l[0][1]);if(d>m){m=d;k=i}});
    return[...rdp(l.slice(0,k+1),1.2).slice(0,-1),...rdp([...l.slice(k),l[0]],1.2).slice(0,-1)]};
  const strokes=loops.map(l=>({pts:ring(l).map(([x,y])=>[+((x-cx)/half).toFixed(4),+(-(y-cy)/half).toFixed(4)]),closed:true})).filter(s=>s.pts.length>2);
  return{id:'txt-'+uid(),name:text.slice(0,24),strokes,color:{mode:'fixed',rgb:[1,1,1],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},
    anim:{rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},audio:{amount:0,to:'scale'}};
}
if(typeof module==='object'&&module.exports){module.exports={lzsParseIlda,ildaStrokes}}
