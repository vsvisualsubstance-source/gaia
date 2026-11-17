// 17/11: stato delle luci fotogramma per fotogramma, registrato insieme al video del Render (⏺)
// e salvato sul server (bridge: /api/light-frames, data/light-frames/). Lo usa il Render 3D
// (plancia/render3d) per accendere le fixture vere nella scansione del locale, senza leggere i
// pixel del video. Formato (v 1):
//   {app:'plancia-light-frames', v, fps, created, project, duration, stage:{width,depth,trussHeight},
//    fixtures:[{id,type,name,group,x,y,z,vertical,w,h,aim,tilt,angle,spread,cube}],   metri, gradi
//    frames:[{t:ms, wash:{c,k}, f:{<id>:{c:'rrggbb', k, pan, tilt, zoom, px:[['rrggbb',k],..], p:[[x,y,'rrggbb'],..]}}}]}
//   c/k = colore e livello (0..1) della luce; px = pixel delle barre LED (dal basso o da sinistra);
//   pan/tilt/zoom delle teste come li usa il Render (tilt -1..1, >=0 verso il palco);
//   p = punti del laser (-100..100, '' = spento). Una fixture che manca nel fotogramma e' spenta.
let LF=null;
const lfHex=c=>Array.isArray(c)?c.slice(0,3).map(v=>Math.round(clamp(+v||0)*255).toString(16).padStart(2,'0')).join(''):'000000';
const lfR=v=>Math.round((+v||0)*1000)/1000;
function lfStart(fps=30){
  const geom=L.stage||{};
  const fx=(L.fixtures||[]).filter(f=>f.enabled!==false).map(f=>{let aim=null;try{aim=fixtureAim(f)?.aim??null}catch{}
    return{id:f.id,type:f.type,name:f.name||f.label||'',group:f.group||'',x:+f.x||0,y:+f.y||0,z:+(f.mountToTruss?geom.trussHeight:f.z)||0,
      vertical:!!f.vertical,w:+f.w||0,h:+f.h||0,aim,tilt:+f.tilt||0,angle:+f.angle||0,spread:+f.spread||0,cube:f.cube||''}});
  LF={fps,t0:null,last:-1e9,cur:null,frames:[],fixtures:fx,stage:{width:+geom.width||0,depth:+geom.depth||0,trussHeight:+geom.trussHeight||0}};
}
// inizio e fine di un fotogramma del Render: si tiene un fotogramma ogni 1/fps s
function lfBegin(t){if(!LF)return;if(LF.t0==null)LF.t0=t;if(t-LF.last<1000/LF.fps-2){LF.cur=null;return}LF.cur={t:Math.round(t-LF.t0),f:{}};LF.last=t}
function lfEnd(){if(LF?.cur){LF.frames.push(LF.cur);LF.cur=null}}
function lfSet(f,o){const c=LF?.cur;if(!c||!f)return;const r={};
  if(o.c)r.c=lfHex(o.c);if(o.k!=null)r.k=lfR(o.k);
  if(o.pan!=null)r.pan=lfR(o.pan);if(o.tl!=null)r.tilt=lfR(o.tl);if(o.z!=null)r.zoom=lfR(o.z);
  if(o.px)r.px=o.px.map(([col,k])=>[lfHex(col),lfR(k)]);
  if(o.p)r.p=o.p.slice(0,200).map(q=>[Math.round(q[0]*10)/10,Math.round(q[1]*10)/10,q[2]||'']);
  c.f[f.id]=r}
function lfGlobal(key,col,k){const c=LF?.cur;if(c)c[key]={c:lfHex(col),k:lfR(k)}}
function lfStop(){const r=LF;LF=null;if(!r||!r.frames.length)return null;
  return{app:'plancia-light-frames',v:1,fps:r.fps,created:new Date().toISOString(),project:L._projectName||'',
    duration:r.frames[r.frames.length-1].t/1000,stage:r.stage,fixtures:r.fixtures,frames:r.frames}}
// sul server, accanto alla Plancia; name = nome del video senza estensione
async function lfUpload(doc,name){
  const r=await fetch('/api/light-frames?name='+encodeURIComponent(name),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(doc)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));return j.file;
}
