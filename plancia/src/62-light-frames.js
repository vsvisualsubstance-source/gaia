// 17/11: stato delle luci fotogramma per fotogramma, registrato insieme al video del Render (⏺)
// e salvato sul server (bridge: /api/light-frames, data/light-frames/). Lo usa il Render 3D
// (plancia/render3d) per accendere le fixture vere nella scansione del locale, senza leggere i
// pixel del video. Formato (v 1):
//   {app:'plancia-light-frames', v, fps, created, project, duration, stage:{width,depth,trussHeight},
//    fixtures:[{id,type,name,group,x,y,z,vertical,w,h,aim,tilt,angle,spread,cube, rot,target,throw,src,ref}],   metri, gradi
//      (rot/target/throw/src/ref solo per wall, screen, projector: rotazione, schermo puntato, rapporto di tiro, sorgente)
//    audio:[{t:ms, k:'A'|'B', track, pos:s, playing, rate, g}]   (lfAudio; solo col motore audio collegato)
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
      vertical:!!f.vertical,w:+f.w||0,h:+f.h||0,aim,tilt:+f.tilt||0,angle:+f.angle||0,spread:+f.spread||0,cube:f.cube||'',
      ...(['wall','screen','projector'].includes(f.type)?{rot:+f.rot||0,target:f.target||'',throw:+f.throw||0,src:f.sourceType||'procedural',ref:f.sourceRef||''}:{})}});
  LF={fps,t0:null,last:-1e9,cur:null,frames:[],fixtures:fx,stage:{width:+geom.width||0,depth:+geom.depth||0,trussHeight:+geom.trussHeight||0}};
  if(AU.live&&AU.lastState)lfAudio(AU.lastState,AU.liveAt);
  LF.media=lfMediaStart();
}
// inizio e fine di un fotogramma del Render: si tiene un fotogramma ogni 1/fps s
function lfBegin(t){if(!LF)return;if(LF.t0==null)LF.t0=t;if(t-LF.last<1000/LF.fps-2){LF.cur=null;return}LF.cur={t:Math.round(t-LF.t0),f:{}};LF.last=t}
function lfEnd(t,level){if(LF?.cur){lfMediaPaint(t,level);LF.frames.push(LF.cur);LF.cur=null}}
function lfSet(f,o){const c=LF?.cur;if(!c||!f)return;const r={};
  if(o.c)r.c=lfHex(o.c);if(o.k!=null)r.k=lfR(o.k);
  if(o.pan!=null)r.pan=lfR(o.pan);if(o.tl!=null)r.tilt=lfR(o.tl);if(o.z!=null)r.zoom=lfR(o.z);
  if(o.px)r.px=o.px.map(([col,k])=>[lfHex(col),lfR(k)]);
  if(o.p)r.p=o.p.slice(0,200).map(q=>[Math.round(q[0]*10)/10,Math.round(q[1]*10)/10,q[2]||'']);
  c.f[f.id]=r}
function lfGlobal(key,col,k){const c=LF?.cur;if(c)c[key]={c:lfHex(col),k:lfR(k)}}
function lfStop(){const r=LF;LF=null;const M=r?.media;if(M)try{M.mr.stop()}catch{}
  if(!r||!r.frames.length)return null;
  const audio=lfAudioOut(r);
  const doc={app:'plancia-light-frames',v:1,fps:r.fps,created:new Date().toISOString(),project:L._projectName||'',
    duration:r.frames[r.frames.length-1].t/1000,stage:r.stage,fixtures:r.fixtures,...(audio?{audio}:{}),
    ...(M?{media:{tiles:M.tiles,size:[M.cv.width,M.cv.height],offset:lfR(((r.t0??M.start)-M.start)/1000)}}:{}),frames:r.frames};
  if(M)Object.defineProperty(doc,'_media',{value:M.done});   // il video arriva dopo lo stop; non va nel JSON
  return doc}
// 20/11: contenuto di LED wall e proiettori (video NDI/URL o procedurale) in un video a parte, a
// tasselli (uno per elemento, sempre lo stesso rettangolo): il Render 3D lo usa come immagine del
// muro e del proiettore. media = {file, tiles:{<id>:[x,y,w,h]}, size:[W,H], offset:s}: il tempo
// del video e' t del fotogramma + offset. Ogni tassello ha dentro tutto l'elemento (le proporzioni
// le rimette il Render 3D).
function lfMediaStart(){
  const els=(L.fixtures||[]).filter(f=>f.enabled!==false&&(f.type==='wall'||f.type==='projector'));
  const MR=window.MediaRecorder;if(!els.length||!MR?.isTypeSupported)return null;
  const type=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'].find(t=>MR.isTypeSupported(t));if(!type)return null;
  const n=els.length,cols=Math.ceil(Math.sqrt(n)),rows=Math.ceil(n/cols),[tw,th]=n>4?[480,270]:[640,360];
  const cv=document.createElement('canvas');cv.width=cols*tw;cv.height=rows*th;
  const g=cv.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);
  const tiles={};els.forEach((f,i)=>tiles[f.id]=[(i%cols)*tw,Math.floor(i/cols)*th,tw,th]);
  let mr;try{mr=new MR(cv.captureStream(30),{mimeType:type,videoBitsPerSecond:n>4?10e6:6e6})}catch{return null}
  const chunks=[];mr.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
  const done=new Promise(res=>{mr.onstop=()=>res(chunks.length?new Blob(chunks,{type:type.split(';')[0]}):null);mr.onerror=()=>res(null)});
  mr.start(1000);
  return{cv,g,els,tiles,mr,done,start:now()};
}
// video ritagliato con le proporzioni dell'elemento e steso su tutto il tassello
function lfCover(g,video,x,y,w,h,aspect,alpha){
  if(!video||video.readyState<2||!video.videoWidth)return false;
  // video di un altro sito (non passato dal bridge): disegnarlo bloccherebbe la registrazione di tutta la tela
  if(video.currentSrc&&!video.currentSrc.startsWith(location.origin+'/')&&!video.currentSrc.startsWith('blob:'))return false;
  const va=video.videoWidth/video.videoHeight;let sx=0,sy=0,sw=video.videoWidth,sh=video.videoHeight;
  if(va>aspect){sw=sh*aspect;sx=(video.videoWidth-sw)/2}else{sh=sw/aspect;sy=(video.videoHeight-sh)/2}
  g.globalAlpha=clamp(alpha);g.drawImage(video,sx,sy,sw,sh,x,y,w,h);g.globalAlpha=1;return true;
}
function lfMediaPaint(t,level){
  const M=LF?.media;if(!M)return;const g=M.g;
  for(const f of M.els){
    const [x,y,w,h]=M.tiles[f.id],src=f.sourceType||'procedural',wall=f.type==='wall',aspect=wall?(f.w||6)/(f.h||3.5):16/9;
    g.globalCompositeOperation='source-over';g.fillStyle='#000';g.fillRect(x,y,w,h);
    if(src==='url'||src==='ndi'){lfCover(g,wallVideoPlayers.get(f.id)?.video,x,y,w,h,aspect,wall?ledParams(f).b:1);continue}
    if(src!=='procedural')continue;
    g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.globalCompositeOperation='lighter';
    if(wall){const {live,b,c}=ledParams(f),cols=36;drawLedProcedural(g,x,y,w,h,cols,Math.max(8,Math.round(cols/aspect)),c,b,live,t,level,w/cols*.12)}
    else drawTestCard(g,x,y,w,h,f.name)
    g.restore();
  }
}
// 20/11: la musica della registrazione. Dal motore audio (audio_state, ~5 Hz) si tiene lo stato
// dei deck A/B solo quando cambia: brano, posizione, play, tempo, guadagno (gain x fader x
// crossfader, come recAudioGain). Il Render 3D ci rifa' il mix coi file della libreria.
function lfAudio(s,at=now()){if(!LF||!s?.decks)return;LF.au??=[];LF.auLast??={};
  for(const k of['A','B']){const sd=s.decks[k];if(!sd)continue;
    const d={at,k,track:sd.track||null,pos:+sd.pos||0,playing:!!(sd.track&&sd.playing),rate:+sd.rate||1,g:recAudioGain(s,k)},p=LF.auLast[k];
    // deck fermo: conta solo che sia fermo (volume e posizione tornano con il play)
    const same=!d.playing?(!p||!p.playing):p&&p.playing&&p.track===d.track&&Math.abs(p.rate-d.rate)<1e-3&&Math.abs(p.g-d.g)<.01
      &&Math.abs(p.pos+(at-p.at)/1000*p.rate-d.pos)<REC_AUDIO_TOL;
    if(same)continue;LF.auLast[k]=d;LF.au.push(d)}}
// tempi dal primo fotogramma; lo stato preso prima dell'inizio parte da 0 alla posizione giusta
function lfAudioOut(r){const t0=r.t0??0,out=[];
  for(const d of r.au||[]){let t=d.at-t0,pos=d.pos;if(t<0){if(d.playing)pos+=-t/1000*d.rate;t=0}
    out.push({t:Math.round(t),k:d.k,track:d.track,pos:lfR(pos),playing:d.playing,rate:lfR(d.rate),g:lfR(d.g)})}
  return out.some(d=>d.track)?out:null}
// sul server, accanto alla Plancia; name = nome del video senza estensione
async function lfUpload(doc,name){
  // prima il video del contenuto (LED wall e proiettori), poi il JSON che lo nomina
  if(doc.media){const blob=await doc._media;let file=null;
    if(blob)try{const r=await fetch('/api/light-frames/media?name='+encodeURIComponent(name)+'&ext='+(blob.type.includes('mp4')?'mp4':'webm'),{method:'POST',headers:{'content-type':blob.type},body:blob});
      const j=await r.json().catch(()=>({}));if(r.ok&&j.ok)file=j.file}catch{}
    if(file)doc.media.file=file;else delete doc.media}
  const r=await fetch('/api/light-frames?name='+encodeURIComponent(name),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(doc)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));return j.file;
}
