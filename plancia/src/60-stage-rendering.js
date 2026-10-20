/* ---------- render del palco ---------- */
const ro=new ResizeObserver(es=>es.forEach(e=>{const c=e.target.querySelector('canvas');if(!c)return;const d=Math.min(2,devicePixelRatio||1);
  c.width=Math.max(1,e.contentRect.width*d|0);c.height=Math.max(1,e.contentRect.height*d|0);c._d=d}));
function sizeCanvas(el){ro.observe(el.querySelector('.ga-orbw')||el.querySelector('.box'))}
const GOBO=[[[0,1,1]],[[-.05,.16,.9],[-.017,.16,.9],[.017,.16,.9],[.05,.16,.9]],[[-.045,.22,.95],[.045,.22,.95],[0,1,.18]],null,
  [[-.14,.65,.75],[0,.65,.75],[.14,.65,.75]],[[-.07,.1,.85],[-.035,.1,.85],[0,.1,.85],[.035,.1,.85],[.07,.1,.85]]];
function chaseK(i,n,t,level){
  switch(SH.chase){case 1:return .3+.7*(.5+.5*Math.sin(t*.002+i*.8));case 2:return((Math.floor(t/110)+i)%Math.max(2,n)===0)?1:.1;
    case 4:return hash(i,Math.floor(t/90))>.5?1:.08;case 5:return .12+.88*level;default:return 1}}
const chaseCol=(c,i,n,t)=>SH.chase===3?hsv2rgb((t*.00018+i/Math.max(1,n))%1,1,Math.max(...c,.6)):c;
function beam(g,x,y,ang,len,wd,col,a){
  const dx=Math.sin(ang),dy=Math.cos(ang),ex=x+dx*len,ey=y+dy*len,px=-dy,py=dx;
  const gr=g.createLinearGradient(x,y,ex,ey);gr.addColorStop(0,rgba(col,a));gr.addColorStop(.55,rgba(col,a*.32));gr.addColorStop(1,rgba(col,0));
  g.fillStyle=gr;g.beginPath();g.moveTo(x+px*1.5,y+py*1.5);g.lineTo(x-px*1.5,y-py*1.5);g.lineTo(ex-px*wd,ey-py*wd);g.lineTo(ex+px*wd,ey+py*wd);g.closePath();g.fill();
}
function glow(g,x,y,r,col,a){const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,rgba(col,a));gr.addColorStop(1,rgba(col,0));g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2)}
const wallVideoPlayers=new Map();
function wallPreviewMessage(f,state=wallVideoPlayers.get(f.id)){
  if(f.sourceType==='procedural'||!f.sourceType)return'Contenuto LED procedurale.';
  if(f.sourceType!=='url'&&f.sourceType!=='ndi')return`${f.sourceType.toUpperCase()}: preview in attesa del Video Service.`;
  if(f.sourceType==='url'&&!f.sourceRef?.trim())return'Inserisci un URL diretto HTTP(S) a un video MP4/WebM.';
  if(f.sourceType==='ndi'&&!f.sourceRef?.trim())return'Inserisci il nome esatto della sorgente NDI (vedi "Cerca sorgenti NDI").';
  if(!state)return'Preview disponibile nella vista Render.';
  return state.message;
}
function setWallPreviewState(f,state,status,message){
  if(wallVideoPlayers.get(f.id)!==state)return;
  state.status=status;state.message=message;
  const hint=$('#fePreviewStatus');
  if(hint?.dataset.wallId===f.id){
    hint.textContent=message;
    hint.className=`hint preview-status ${status}`;
  }
}
function disposeWallVideo(state){
  if(state.pc){try{state.pc.close()}catch{}}
  if(state.previewId&&state.gatewayUrl)fetch(`${state.gatewayUrl}/api/previews/${state.previewId}`,{method:'DELETE'}).catch(()=>{});
  if(!state.video)return;
  state.video.pause();state.video.srcObject=null;state.video.removeAttribute('src');state.video.load();
}
function createWallVideoState(f){
  return f.sourceType==='ndi'?createWallNdiState(f):createWallUrlState(f);
}
function createWallUrlState(f){
  const raw=f.sourceRef.trim(),state={raw,status:'loading',message:'Avvio preview…',video:null};
  let url;
  try{url=new URL(raw,location.href)}catch{
    state.status='invalid';state.message='URL non valido. Inserisci un indirizzo HTTP(S) diretto a un video MP4/WebM.';
    return state;
  }
  if(url.protocol!=='http:'&&url.protocol!=='https:'){
    state.status='invalid';state.message='Protocollo non supportato: usa un URL HTTP(S) diretto a un video MP4/WebM.';
    return state;
  }
  const video=document.createElement('video');
  state.video=video;video.muted=true;video.loop=true;video.autoplay=true;video.playsInline=true;
  video.preload='auto';video.disablePictureInPicture=true;
  video.addEventListener('loadeddata',()=>setWallPreviewState(f,state,'ready','Video caricato; connessione in avvio…'));
  video.addEventListener('playing',()=>setWallPreviewState(f,state,'live','Preview attiva · audio disattivato.'));
  video.addEventListener('waiting',()=>setWallPreviewState(f,state,'buffering','La preview sta attendendo dati video…'));
  video.addEventListener('error',()=>{
    const unsupported=video.error?.code===4;
    setWallPreviewState(f,state,unsupported?'unsupported':'error',unsupported?
      'Formato o codec non supportato dal browser. Usa un MP4/H.264 o un WebM compatibile.':
      'Preview non disponibile: verifica URL e connessione.');
  });
  video.src=url.href;video.load();
  video.play().catch(error=>{
    if(error?.name==='NotAllowedError')setWallPreviewState(f,state,'blocked','Avvio automatico bloccato; fai clic sul pannello Render per avviare la preview.');
    else if(error?.name==='NotSupportedError')setWallPreviewState(f,state,'unsupported','Formato o codec non supportato dal browser. Usa un MP4/H.264 o un WebM compatibile.');
    else setWallPreviewState(f,state,'error','Avvio preview non riuscito: verifica URL e connessione.');
  });
  return state;
}
// Plancia Video Service (PoC 2026-10-16, ops/video-gateway): NDI->WebRTC
// via aiortc, API di segnalazione {GET /api/sources, POST /api/previews,
// DELETE /api/previews/:id} -- stessa forma della proposta in TD4PatchDeck
// (docs/architecture/plancia-video-service.md), implementazione diversa
// (Python/aiortc invece di GStreamer+webrtcbin). Il video arriva come
// MediaStream su un <video> nascosto, drawVideoCover() lo disegna esattamente
// come un video URL -- stesso percorso di rendering, nessuna duplicazione.
function createWallNdiState(f){
  const raw=f.sourceRef.trim(),gatewayUrl=videoGatewayUrl();
  const state={raw,status:'loading',message:'Connessione al Video Service…',video:null,pc:null,previewId:null,gatewayUrl};
  if(!gatewayUrl){state.status='error';state.message='Nessun Video Service configurato per questo profilo di rete.';return state}
  (async()=>{
    try{
      const pc=new RTCPeerConnection();state.pc=pc;
      const video=document.createElement('video');
      video.muted=true;video.autoplay=true;video.playsInline=true;video.disablePictureInPicture=true;
      state.video=video;
      pc.ontrack=e=>{video.srcObject=e.streams[0];video.play().catch(()=>{});};
      pc.onconnectionstatechange=()=>{
        if(wallVideoPlayers.get(f.id)!==state)return;
        if(pc.connectionState==='connected')setWallPreviewState(f,state,'live','Preview NDI attiva · audio disattivato.');
        else if(pc.connectionState==='connecting')setWallPreviewState(f,state,'buffering','Negoziazione WebRTC in corso…');
        else if(pc.connectionState==='failed'||pc.connectionState==='disconnected')setWallPreviewState(f,state,'error','Connessione al Video Service persa.');
      };
      pc.addTransceiver('video',{direction:'recvonly'});
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      const r=await fetch(`${gatewayUrl}/api/previews`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({source:raw,offer:{sdp:offer.sdp,type:offer.type}})});
      const j=await r.json();
      if(wallVideoPlayers.get(f.id)!==state)return; // la fixture e' cambiata/sparita mentre aspettavamo
      if(j.error){state.status='error';state.message=`Video Service: ${j.error}`;setWallPreviewState(f,state,'error',state.message);return}
      state.previewId=j.id;
      await pc.setRemoteDescription(new RTCSessionDescription(j.answer));
    }catch(err){
      if(wallVideoPlayers.get(f.id)!==state)return;
      state.status='error';state.message=`Video Service non raggiungibile: ${err.message}`;
      setWallPreviewState(f,state,'error',state.message);
    }
  })();
  return state;
}
async function pickNdiSource(f){
  const gatewayUrl=videoGatewayUrl();
  if(!gatewayUrl){alert('Nessun Video Service configurato per questo profilo di rete.');return}
  try{
    const r=await fetch(`${gatewayUrl}/api/sources`);const j=await r.json();
    if(!j.sources?.length){alert('Nessuna sorgente NDI trovata sulla rete al momento.');return}
    const pick=j.sources.length===1?j.sources[0]:prompt(`Sorgenti NDI trovate:\n${j.sources.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\nScrivi il nome esatto (copia/incolla da sopra):`,j.sources[0]);
    if(pick&&j.sources.includes(pick)){val2('#feSourceRef',pick);$('#feSourceRef').dispatchEvent(new Event('input'))}
    else if(pick)alert('Nome non riconosciuto fra le sorgenti trovate — copialo esattamente.');
  }catch(err){alert('Video Service non raggiungibile: '+err.message)}
}
function syncWallVideoPlayers(fixtures){
  const wanted=new Map(fixtures.filter(f=>f.type==='wall'&&f.enabled!==false&&(f.sourceType==='url'||f.sourceType==='ndi')&&f.sourceRef?.trim()).map(f=>[f.id,f]));
  for(const [id,state] of wallVideoPlayers){
    const f=wanted.get(id);
    if(f&&state.raw===f.sourceRef.trim()&&(f.sourceType==='ndi')===!!state.pc)continue;
    disposeWallVideo(state);wallVideoPlayers.delete(id);
  }
  for(const f of wanted.values()){
    if(wallVideoPlayers.has(f.id))continue;
    const state=createWallVideoState(f);wallVideoPlayers.set(f.id,state);
  }
}
function retryWallVideo(f){
  const old=wallVideoPlayers.get(f.id);if(old){disposeWallVideo(old);wallVideoPlayers.delete(f.id)}
  if(f.enabled!==false&&(f.sourceType==='url'||f.sourceType==='ndi')&&f.sourceRef?.trim()){
    const state=createWallVideoState(f);wallVideoPlayers.set(f.id,state);
  }
}
function drawVideoCover(g,video,x,y,w,h,alpha){
  if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight)return false;
  const sourceAspect=video.videoWidth/video.videoHeight,targetAspect=w/h;
  let sx=0,sy=0,sw=video.videoWidth,sh=video.videoHeight;
  if(sourceAspect>targetAspect){sw=sh*targetAspect;sx=(video.videoWidth-sw)/2}
  else{sh=sw/targetAspect;sy=(video.videoHeight-sh)/2}
  g.save();g.globalCompositeOperation='source-over';g.globalAlpha=alpha;
  g.drawImage(video,sx,sy,sw,sh,x,y,w,h);g.restore();
  return true;
}
function drawRender(g,W,H,t,level){
  const fixtures=(L.fixtures||[]).filter(f=>f.enabled!==false);
  const fixturesOf=type=>fixtures.filter(f=>f.type===type);
  const hasDmxFeedback=dmxOutputFresh(),feedbackFor=f=>hasDmxFeedback?dmxOutputForFixture(f):null;
  const outputColor=feedback=>feedback?.rgbOut&&Math.max(...feedback.rgbOut)>0?
    feedback.rgbOut.map(value=>value/Math.max(...feedback.rgbOut)):[1,1,1];
  const outputLevel=feedback=>feedback?.sent?
    feedback.rgbOut?Math.max(...feedback.rgbOut):feedback.intensity||0:0;
  const wallFixtures=fixturesOf('wall'), uplights=fixturesOf('par'), bars=fixturesOf('bar');
  const headsF=fixturesOf('mh'), blinderF=fixturesOf('blinder'), speakers=fixturesOf('speaker'), lasers=fixturesOf('laser');
  const geom=L.stage, depth=Math.max(1,geom.depth), halfStage=Math.max(1,geom.width/2);
  // nebbia: con il feedback, l'uscita reale della macchina haze (nota 33)
  const hazeOut=fixturesOf('haze').map(feedbackFor).find(fb=>fb?.sent&&fb.intensity!=null);
  const gate=SH.strobe?(((t/1000*SH.rate)%1)<.22?1:0):1, M=(SH.blackout?0:SH.master)*gate, hz=.3+.9*(hazeOut?hazeOut.intensity:SH.g.haze);
  g.globalCompositeOperation='source-over';
  const bg=g.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#04050a');bg.addColorStop(1,'#090b10');g.fillStyle=bg;g.fillRect(0,0,W,H);
  const fb=H*.66,ff=H*.86,zScale=H*.48/Math.max(1,geom.trussHeight);
  const project=(x,y,z=0)=>{
    const d=clamp(y/depth,-.2,1.8),halfWidth=W*(.34+.13*d);
    return{x:W/2+x/halfStage*halfWidth,y:fb+(ff-fb)*d-z*zScale,groundY:fb+(ff-fb)*d,scale:halfWidth/halfStage};
  };
  const fixtureZ=f=>f.mountToTruss?geom.trussHeight:f.z;
  g.globalCompositeOperation='lighter';
  glow(g,W/2,H*.35,W*.6,SH.back.c,.12*hz*M*SH.g.back);
  for(const wallF of wallFixtures){
    const wp=project(wallF.x,wallF.y,wallF.z),rot=(wallF.rot||0)*Math.PI/180;
    const wallWidth=(wallF.w||6)*wp.scale*Math.max(.08,Math.abs(Math.cos(rot)));
    const wallHeight=(wallF.h||3.5)*zScale;
    const wx0=wp.x-wallWidth/2,wx1=wp.x+wallWidth/2,wy1=wp.y,wy0=wy1-wallHeight;
    g.globalCompositeOperation='source-over';g.fillStyle='#07080b';g.fillRect(wx0-4,wy0-4,wx1-wx0+8,wy1-wy0+8);
    const cols=36,rows=Math.max(8,Math.round(cols*(wy1-wy0)/(wx1-wx0))),pw=(wx1-wx0)/cols,ph=(wy1-wy0)/rows;
    const feedback=feedbackFor(wallF),b=feedback?outputLevel(feedback):SH.led.bright*SH.g.ledwall*(SH.blackout?0:SH.master);
    const c=feedback?outputColor(feedback):SH.wall.c;
    let avg=0;
    if(wallF.sourceType==='url'||wallF.sourceType==='ndi'){
      const preview=wallVideoPlayers.get(wallF.id);
      g.fillStyle='#101319';g.fillRect(wx0,wy0,wx1-wx0,wy1-wy0);
      if(!drawVideoCover(g,preview?.video,wx0,wy0,wx1-wx0,wy1-wy0,clamp(b))){
        const message=preview?.message||wallPreviewMessage(wallF);
        g.fillStyle='#c9ced8';g.font='10px JetBrains Mono, monospace';g.textAlign='center';
        g.fillText(message.slice(0,64),wp.x,(wy0+wy1)/2);
      }
    }else if(wallF.sourceType&&wallF.sourceType!=='procedural'){
      g.fillStyle='#101319';g.fillRect(wx0,wy0,wx1-wx0,wy1-wy0);
      g.fillStyle='#c9ced8';g.font='10px JetBrains Mono, monospace';g.textAlign='center';
      g.fillText(wallPreviewMessage(wallF).slice(0,64),wp.x,(wy0+wy1)/2);
    }else{
      g.globalCompositeOperation='lighter';
      const hsv=rgb2hsv(...c), hue=hsv[0],sat=hsv[1],val=Math.max(...c),timeHue=Math.sin(t*.0006)*.05;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        let col=c,k=1;
        if(feedback)k=b;
        else switch(SH.led.mode){
          case 1:col=hsv2rgb((hue+x/cols*.18+timeHue+1)%1,sat,val);k=.55+.45*Math.sin(x*.18+t*.0015);break;
          case 2:k=Math.pow(.5+.5*Math.sin(x*.32+y*.22-t*.003),1.6);break;
          case 3:k=hash(x*7+y,Math.floor(t/120))>.82?1:.06;break;
          case 4:k=(Math.floor(t/80)%2)?1:0;break;
          case 5:{const dx=(x-cols/2+.5)/(rows/2),dy=(y-rows/2+.5)/(rows/2),d=Math.hypot(dx,dy),an=Math.atan2(dy,dx);
            k=Math.exp(-Math.pow((d-.62)*7,2))*(.6+.4*Math.sin(an*3+t*.002))+(d<.18?.9:0);k*=.85+.15*level;break}
        }
        k*=b;avg+=k;if(k<.02)continue;
        g.fillStyle=rgba(col,1,k);g.fillRect(wx0+x*pw+.5,wy0+y*ph+.5,Math.max(1,pw-1.2),Math.max(1,ph-1.2));
      }
      avg/=cols*rows;glow(g,wp.x,wp.y,W*.42,c,.35*avg*hz);
    }
    g.globalCompositeOperation='lighter';
  }
  // pavimento
  g.globalCompositeOperation='source-over';
  const fl=g.createLinearGradient(0,fb,0,ff);fl.addColorStop(0,'#0c0d11');fl.addColorStop(1,'#15171d');g.fillStyle=fl;
  const rearL=project(-halfStage,0),rearR=project(halfStage,0),frontL=project(-halfStage,depth),frontR=project(halfStage,depth);
  g.beginPath();g.moveTo(frontL.x,frontL.y);g.lineTo(frontR.x,frontR.y);g.lineTo(rearR.x,rearR.y);g.lineTo(rearL.x,rearL.y);g.closePath();g.fill();
  g.fillStyle='#050608';g.beginPath();g.moveTo(frontL.x,frontL.y);g.lineTo(frontR.x,frontR.y);g.lineTo(frontR.x,frontR.y+H*.025);g.lineTo(frontL.x,frontL.y+H*.025);g.closePath();g.fill();
  const fascia=Math.min(H*.08,Math.max(0,geom.floorHeight)*zScale*.35);
  if(fascia>0){g.fillStyle='#090a0d';g.beginPath();g.moveTo(frontL.x,frontL.y);g.lineTo(frontR.x,frontR.y);g.lineTo(frontR.x,frontR.y+fascia);g.lineTo(frontL.x,frontL.y+fascia);g.closePath();g.fill()}
  g.strokeStyle='#2a2e37';g.lineWidth=1;g.beginPath();g.moveTo(frontL.x,frontL.y+.5);g.lineTo(frontR.x,frontR.y+.5);g.stroke();
  g.globalCompositeOperation='lighter';
  // front wash
  const fw=SH.wash.c,fk=SH.g.front*M*(SH.chase===5?.4+.6*level:1);
  if(fk>.01){g.save();g.beginPath();g.moveTo(frontL.x,frontL.y);g.lineTo(frontR.x,frontR.y);g.lineTo(rearR.x,rearR.y);g.lineTo(rearL.x,rearL.y);g.closePath();g.clip();
    const pg=g.createRadialGradient(W/2,(fb+ff)/2,0,W/2,(fb+ff)/2,W*.42);pg.addColorStop(0,rgba(fw,.55*fk));pg.addColorStop(1,rgba(fw,0));g.fillStyle=pg;g.fillRect(0,fb,W,ff-fb);g.restore()}
  // uplight
  for(let i=0;i<uplights.length;i++){
    const f=uplights[i],group=f.group==='back'||f.group==='rig_b'?'back':'front',p=project(f.x,f.y,f.z);
    const feedback=feedbackFor(f),col=feedback?outputColor(feedback):chaseCol(group==='back'?SH.back.c:SH.wash.c,i,uplights.length,t);
    const k=feedback?outputLevel(feedback):SH.g[group]*M*chaseK(i,uplights.length,t,level);
    if(k<.01)continue;
    beam(g,p.x,p.y,Math.PI+(p.x<W/2?-.08:.08),H*.48,H*.07,col,.22*k*hz);glow(g,p.x,p.y,10,col,.9*k);
  }
  // truss
  g.globalCompositeOperation='source-over';g.strokeStyle='#30353f';g.lineWidth=1.5;
  const trussL=project(-halfStage*.92,0,geom.trussHeight),trussR=project(halfStage*.92,0,geom.trussHeight);
  g.beginPath();g.moveTo(trussL.x,trussL.y);g.lineTo(trussR.x,trussR.y);
  g.moveTo(trussL.x,trussL.y+8);g.lineTo(trussR.x,trussR.y+8);
  for(let x=trussL.x;x<trussR.x;x+=12){g.moveTo(x,trussL.y);g.lineTo(x+6,trussL.y+8);g.lineTo(x+12,trussL.y)}g.stroke();
  // teste mobili
  const n=headsF.length;ensureHeadPool(n);const heads=[];
  for(let i=0;i<n;i++){const f=headsF[i],h=SH.heads[i],p=h.T.c,pos=project(f.x,f.y,fixtureZ(f)),x=pos.x,y=pos.y,size=clamp(pos.scale*.7,8,18);heads.push([x,y,h,p,size,feedbackFor(f),f]);
    g.fillStyle='#1c2027';g.strokeStyle='#3a404c';g.lineWidth=1;
    g.beginPath();g.roundRect(x-size,y-size*.35,size*2,size*.7,2);g.fill();g.stroke();
    g.save();g.translate(x,y);g.rotate(-p[0]*.9);g.beginPath();g.roundRect(-size*.45,-size*.4,size*.9,size*.9,3);g.fill();g.stroke();g.restore()}
  g.globalCompositeOperation='lighter';
  for(const [x,y,h,p,size,feedback,f] of heads){
    const k=feedback?outputLevel(feedback):p[5]*SH.g.mh*M*(h.strobe?(((t/1000*13)%1)<.3?1:0):1);
    // con il feedback: colore e livello da rgb_out, posizione da pan/tilt
    // reali in gradi (nota 33); gobo/zoom non sono nel feedback: fascio
    // aperto e zoom locale
    const real=feedback?dmxHeadAngles(feedback,tdModelFor(f)):null;
    const col=feedback?outputColor(feedback):[p[2],p[3],p[4]],pan=real?real[0]:p[0],tl=real?real[1]:p[1],z=p[6],soft=1-p[7]*.5;
    if(k>.01){
      if(feedback&&!real)glow(g,x,y,size,col,.95*k);
      else{
        let ang,len; if(tl>=0){ang=pan*1.15;len=H*(.42+.45*tl)}else{ang=Math.PI-pan*1.15;len=H*(.3+.4*-tl)}
        const gobo=feedback?0:h.gobo,wd=len*(.035+z*.22), subs=gobo===3?[0,1,2].map(j=>[Math.sin(t*.0012+j*2.1)*.06,.35+.2*j,.7]):GOBO[gobo]||GOBO[0];
        for(const [o,wf,a] of subs)beam(g,x,y,ang+o*(.6+z*2.2),len,wd*wf*(.8+soft*.4),col,.42*k*hz*a);
        glow(g,x,y,size,col,.95*k);
        const ex=x+Math.sin(ang)*len,ey=y+Math.cos(ang)*len;
        if(tl>=0&&ey>fb&&ey<ff+H*.05){g.save();g.translate(ex,ey);g.scale(1,.32);glow(g,0,0,wd*1.1,col,.5*k);g.restore()}
      }
    }
    if(feedback){
      const values=[feedback.sent?'OUT':'OFF',feedback.intensity==null?null:`${Math.round(feedback.intensity*100)}%`,
        feedback.pan==null?null:`P ${Math.round(feedback.pan)}°`,feedback.tilt==null?null:`T ${Math.round(feedback.tilt)}°`,
        // ruota colori con slot senza colore nel catalogo: TD manda bianco (nota 34)
        feedback.colorSource==='unknown'?'colore ?':null].filter(Boolean);
      g.save();g.globalCompositeOperation='source-over';g.font='8px JetBrains Mono, monospace';
      g.fillStyle='#dce4f2';g.shadowColor='#000';g.shadowBlur=2;g.fillText(values.join(' · '),x-size,y+size+11);g.restore();
    }
  }
  // casse
  g.globalCompositeOperation='source-over';
  for(const f of speakers){
    const p=project(f.x,f.y,f.z),sx=clamp(p.x,W*.025,W*.975),sy=p.y,sw=clamp(W*.07*p.scale,.025*W,.085*W),sh=H*.07;
    g.fillStyle='#101216';g.strokeStyle='#2c313b';g.lineWidth=1;g.beginPath();g.roundRect(sx-sw/2,sy-sh/2,sw,sh,3);g.fill();g.stroke();
    g.strokeStyle='#1d2128';for(let i=1;i<4;i++){g.beginPath();g.moveTo(sx-sw*.4,sy-sh*.5+sh*i/4);g.lineTo(sx+sw*.4,sy-sh*.5+sh*i/4);g.stroke()}
    const rr=sh*.34;g.strokeStyle='#3a404c';g.lineWidth=2;g.beginPath();g.arc(sx,sy,rr,0,Math.PI*2);g.stroke();
    g.fillStyle='#181b21';g.beginPath();g.arc(sx,sy,rr*.35,0,Math.PI*2);g.fill();
  }
  const foh=geom.foh,fohP=project(foh.x,foh.y+foh.depth/2,.8),fohW=foh.width*fohP.scale,fohH=Math.max(6,H*.014);
  g.fillStyle='#111318';g.strokeStyle='#ffb23e';g.lineWidth=1.2;
  g.fillRect(fohP.x-fohW/2,fohP.y-fohH/2,fohW,fohH);g.strokeRect(fohP.x-fohW/2,fohP.y-fohH/2,fohW,fohH);
  for(const f of lasers){
    const origin=project(f.x,f.y,fixtureZ(f)),spread=(f.spread||28)*Math.PI/180,base=(f.angle||0)*Math.PI/180;
    g.strokeStyle='rgba(255,54,92,.72)';g.lineWidth=1.2;g.shadowColor='#ff365c';g.shadowBlur=8;
    for(let ray=-2;ray<=2;ray++){
      const angle=base+ray*spread/4,distance=depth*1.8;
      const target=project(f.x+Math.sin(angle)*distance,f.y+Math.cos(angle)*distance,0);
      g.beginPath();g.moveTo(origin.x,origin.y);g.lineTo(target.x,target.y);g.stroke();
    }
    g.shadowBlur=0;g.fillStyle='#ff365c';g.beginPath();g.arc(origin.x,origin.y,3,0,Math.PI*2);g.fill();
  }
  // barre LED
  g.globalCompositeOperation='lighter';
  if(bars.length){const px=8;
    for(let i=0;i<bars.length;i++){const f=bars[i];
      const feedback=feedbackFor(f),col=feedback?outputColor(feedback):null,fixtureLevel=feedback?outputLevel(feedback):0;
      for(let j=0;j<px;j++){const idx=i*px+j,color=col||chaseCol(SH.bar.c,idx,bars.length*px,t),k=feedback?fixtureLevel:SH.g.ledbar*M*chaseK(SH.chase===2?idx:i,SH.chase===2?bars.length*px:bars.length,t,level);
        const span=f.w||1.8,p=project(f.x+(j+.5-px/2)*span/px,f.y,f.z),x=p.x,y=p.y;
        g.fillStyle=k>.02?rgba(color,1,k):'#15171c';g.fillRect(x-p.scale*span/px/2+.5,y-2,Math.max(1,p.scale*span/px-1),4);
        if(k>.02)glow(g,x,y,10,color,.5*k)}}
  }
  // pubblico e blinder
  const bl=SH.g.blinder*(SH.blackout?0:1);
  if(bl>.01||blinderF.some(f=>feedbackFor(f)?.sent)){
    for(const f of blinderF){const feedback=feedbackFor(f),actual=feedback?outputLevel(feedback):bl;
      if(actual<=.01)continue;
      const p=project(f.x,f.y,f.z);glow(g,p.x,p.y,Math.max(12,p.scale*1.5),feedback?outputColor(feedback):[1,.85,.6],.55*actual)}
    if(!blinderF.length)glow(g,W/2,H*1.05,W*.7,[1,.85,.6],.55*bl);
  }
  g.globalCompositeOperation='source-over';
  const audience=geom.audience,seatCols=12,seatRows=4;
  for(let row=0;row<seatRows;row++)for(let col=0;col<seatCols;col++){
    const xw=audience.x-audience.width/2+(col+.5)*audience.width/seatCols;
    const yw=audience.y+(row+.5)*audience.depth/seatRows,p=project(xw,yw,0),x=p.x,y=p.y,r=clamp(H*.003,1,3),idx=row*seatCols+col;
    g.fillStyle='#020203';g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.beginPath();g.ellipse(x,y+r*2.4,r*2,r*1.6,0,0,Math.PI*2);g.fill();
    if(showPlaying&&level>.75&&hash(idx,Math.floor(t/400))>.8){g.strokeStyle='#020203';g.lineWidth=4;g.beginPath();g.moveTo(x+r,y+r);g.lineTo(x+r*2,y-r*2.5);g.stroke()}
    g.strokeStyle=rgba(bl>.05?[1,.9,.75]:fw,bl>.05?.6*bl:.3*fk);g.lineWidth=1.2;g.beginPath();g.arc(x,y,r,Math.PI*1.1,Math.PI*1.9);g.stroke();
  }
}
// Stato di interazione della Pianta per widget id -- MAI dentro l'oggetto
// w stesso: w vive in L (salvato via JSON.stringify), hits/proj/selFix sono
// usa-e-getta (ricalcolati ogni frame, legati solo a questa sessione).
const _stageUI={};
function plotProjection(W,H,stage,fixtures){
  const xs=[-stage.width/2-2,stage.width/2+2],ys=[-1,stage.depth+1];
  for(const area of [stage.audience,stage.foh]){
    xs.push(area.x-area.width/2-1,area.x+area.width/2+1);
    ys.push(area.y-1,area.y+area.depth+1);
  }
  for(const f of fixtures){xs.push(f.x-1,f.x+1);ys.push(f.y-1,f.y+1)}
  for(const f of tdFixtures())if(Number.isFinite(f.x)&&Number.isFinite(f.y)){xs.push(f.x-1,f.x+1);ys.push(f.y-1,f.y+1)}
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const s=Math.max(.1,Math.min((W-28)/(maxX-minX),(H-48)/(maxY-minY)));
  return{s,cx:W/2,oy:24-minY*s,minX,maxX,minY,maxY};
}
function drawPlot(g,W,H,t,w){
  g.globalCompositeOperation='source-over';g.fillStyle='#0b0d11';g.fillRect(0,0,W,H);
  const geom=L.stage;
  const sproj=plotProjection(W,H,geom,L.fixtures||[]),{s,cx,oy}=sproj;
  const ui=w&&(_stageUI[w.id]||(_stageUI[w.id]={}));
  if(ui)ui.proj=sproj;
  g.strokeStyle='#161a20';g.lineWidth=1;
  const gx=((cx%s)+s)%s,gy=((oy%s)+s)%s;
  for(let x=gx;x<W;x+=s){g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke()}
  for(let y=gy;y<H;y+=s){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke()}
  const X=m=>cx+m*s,Y=m=>oy+m*s;
  const txt=(t,x,y,c='#868e9b',al='center',sz=10)=>{g.fillStyle=c;g.font=`${sz*(W>700?1.1:1)}px JetBrains Mono, monospace`;g.textAlign=al;g.fillText(t,x,y)};
  const stageX=-geom.width/2,stageY=0,stageW=geom.width,stageD=geom.depth;
  const drawArea=(area,label,color)=>{
    const left=X(area.x-area.width/2),top=Y(area.y);
    g.fillStyle=color+'18';g.strokeStyle=color;g.lineWidth=1.2;g.setLineDash([4,3]);
    g.fillRect(left,top,area.width*s,area.depth*s);g.strokeRect(left,top,area.width*s,area.depth*s);g.setLineDash([]);
    txt(label,left+5,top+13,color,'left',9);
  };
  drawArea(geom.audience,'PLATEA','#7b8493');
  drawArea(geom.foh,'FOH','#ffb23e');
  g.fillStyle='#12151a';g.strokeStyle='#4a515e';g.lineWidth=1.5;
  g.fillRect(X(stageX),Y(stageY),stageW*s,stageD*s);g.strokeRect(X(stageX),Y(stageY),stageW*s,stageD*s);
  txt(`PALCO ${stageW.toFixed(1)} × ${stageD.toFixed(1)} m · quota ${geom.floorHeight.toFixed(1)} m`,X(stageX)+5,Y(stageY)+14,'#5d6573','left');
  g.strokeStyle='#5d6573';g.lineWidth=1;g.beginPath();g.moveTo(X(stageX),Y(stageD+.35));g.lineTo(X(-stageX),Y(stageD+.35));g.stroke();
  txt(`${stageW.toFixed(2)} m`,cx,Y(stageD+.35)-4,'#868e9b');
  const trussY=stageD*.25;
  g.setLineDash([5,4]);g.strokeStyle='#6b7280';g.beginPath();g.moveTo(X(stageX*.92),Y(trussY));g.lineTo(X(-stageX*.92),Y(trussY));g.stroke();g.setLineDash([]);
  txt(`TRUSS +${geom.trussHeight.toFixed(1)} m`,X(-stageX*.92),Y(trussY)-3,'#5d6573','left',9);
  // Fixture già in TD, non create da Plancia -- SOLO LETTURA (tratteggio
  // grigio, nessun drag/edit): evita di ricrearle per sbaglio (vedi
  // tdFixtures()). Posizione reale (x/y pubblicati da TD).
  const tdHits=[];
  for(const tf of tdFixtures()){
    if(typeof tf.x!=='number'||typeof tf.y!=='number')continue;
    const x=X(tf.x),y=Y(tf.y),r=s*.24;
    g.globalAlpha=.55;g.setLineDash([3,3]);g.strokeStyle='#5d6573';g.lineWidth=1.3;
    g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.stroke();g.setLineDash([]);g.globalAlpha=1;
    txt((tf.name||'TD '+tf.id)+' (TD)',x,y-r-6,'#5d6573',undefined,9);
    tdHits.push({tf,x,y,r:Math.max(r,s*.35)});
  }
  if(ui)ui.tdHits=tdHits;
  // fixture vere (patch editabile) -- ogni fixture ha una posizione propria
  // in L.fixtures, non piu' un conteggio con disposizione automatica.
  const hits=[],sel=ui&&ui.selFix;
  for(const f of (L.fixtures||[])){
    const x=X(f.x),y=Y(f.y),col=FIX_COLOR[f.type]||'#c9ced8',r=s*.26,on=f.enabled!==false;
    g.globalAlpha=on?1:.35;
    if(f.type==='wall'){
      // lunghezza vera (f.w, metri) + rotazione in pianta; l'altezza
      // (f.h) non ha una dimensione visiva in una pianta vista dall'alto
      // -- mostrata solo nell'etichetta, conta per il Render.
      const ww=(f.w||6)*s,hh=.3*s;
      g.save();g.translate(x,y);g.rotate((f.rot||0)*Math.PI/180);
      g.fillStyle=col+'40';g.fillRect(-ww/2,-hh/2,ww,hh);g.strokeStyle=col;g.lineWidth=f.id===sel?2.4:1.3;g.strokeRect(-ww/2,-hh/2,ww,hh);
      g.restore();
    }
    else if(f.type==='bar'){g.fillStyle=col;g.fillRect(x-.9*s,y-.08*s,1.8*s,.16*s)}
    else if(f.type==='speaker'){g.fillStyle='#1b1f26';g.strokeStyle=col;g.lineWidth=1.2;g.fillRect(x-s*.32,y-s*.4,s*.64,s*.8);g.strokeRect(x-s*.32,y-s*.4,s*.64,s*.8)}
    else{g.fillStyle='#1c2027';g.strokeStyle=col;g.lineWidth=f.id===sel?2.6:1.3;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.stroke();
      g.fillStyle=col;g.beginPath();g.arc(x,y,r*.4,0,Math.PI*2);g.fill()}
    if(f.id===sel&&f.type!=='wall'){g.strokeStyle='#00ffcc';g.lineWidth=1.5;g.beginPath();g.arc(x,y,r+5,0,Math.PI*2);g.stroke()}
    g.globalAlpha=1;
    const labelR=f.type==='wall'?.18*s:r;
    txt(f.type==='wall'?`${f.name} · ${(f.w||6)}×${(f.h||3.5)}m`:f.name,x,y-labelR-6,'#e9ebef');
    if(FIX_TYPES[f.type].ch)txt(f.universe+'.'+String(f.address).padStart(3,'0'),x,y+r+12,'#5d6573');
    hits.push({f,x,y,r:f.type==='wall'?Math.max((f.w||6)*s/2,s*.4):Math.max(r,s*.4)});
  }
  if(ui)ui.hits=hits;
  // legenda patch (conteggi reali, non piu' da L.rig)
  const cnt=fixCounts();
  const lg=Object.entries(FIX_TYPES).filter(([k,ft])=>cnt[k]&&ft.ch).map(([k,ft])=>[`${ft.label} ×${cnt[k]}`,footprintFor(k)+' ch']);
  const lx=10,ly=H-10-Math.max(1,lg.length)*14;
  // Testo corto apposta: visto dal vivo (screenshot Playwright) che la
  // versione lunga di prima si sovrapponeva al marcatore FOH, disegnato
  // su questa stessa fascia verticale del palco.
  txt('Trascina=sposta · tocca fixture=proprietà · vuoto=aggiungi · autosalvataggio layout',lx,ly-8,'#e9ebef','left',9);
  lg.forEach((r,i)=>{txt(r[0],lx,ly+10+i*14,'#c9ced8','left');txt(r[1],lx+s*3.4,ly+10+i*14,'#868e9b','left')});
}
