/* ---------- ciclo principale ---------- */
const tc=s=>{const f=Math.floor((s%1)*25),S=Math.floor(s);return[Math.floor(S/3600),Math.floor(S/60)%60,S%60,f].map(v=>String(v).padStart(2,'0')).join(':')};
let lastT=now();
function loop(){
  const n=now(),dt=(n-lastT)/1000;lastT=n;
  const previewVisible=page().widgets.some(w=>w.type==='stage'&&w.view!=='plot');
  syncWallVideoPlayers(previewVisible?(L.fixtures||[]):[]);
  [SH.wash,SH.back,SH.bar,SH.wall].forEach(T=>stepT(T,n));SH.heads.forEach(h=>stepT(h.T,n));
  // timeline
  const seen=new Set();showPlaying=false;
  for(const w of allW()){if(w.type!=='timeline'||seen.has(w.addr))continue;seen.add(w.addr);const r=rt(w);
    if(isShowTimeline(w)&&showClock.authority){
      const sample=showClockSample(),position=showClockPosition(sample);
      if(position!=null)r.t=position;
      r.playing=!!sample&&showClockFresh(sample)&&!!sample.state.playing;
      r.loop=!!sample?.state.loop;
      const cue=sample?.source==='mqtt'?sample.state.cue?.index:sample?.state.cue;
      r.cue=Number.isFinite(+cue)&&+cue>0?Math.floor(+cue)-1:-1;
      showT=r.t;showPlaying=r.playing;showBpm=120;
      continue;
    }
    const cues=parseCues(w);
    if(r.playing){r.t+=dt;if(r.t>=w.duration){if(r.loop){r.t=0;r.cue=-1}else{r.t=w.duration;r.playing=false;fire(w.addr+'/play',[0],w.oscChannel)}}
      const i=cueAt(cues,r.t);if(i!==r.cue){r.cue=i;if(i>=0)fireCue(w,i)}
      if(n-r.sent>100){r.sent=n;fire(w.addr+'/time',[+r.t.toFixed(2)],w.oscChannel)}
      showPlaying=true;showBpm=w.bpm||120}
    if(r.playing||seen.size===1)showT=r.t}
  if(showClock.authority){
    const sample=showClockSample(),position=showClockPosition(sample);
    if(position!=null)showT=position;
    showPlaying=!!sample&&showClockFresh(sample)&&!!sample.state.playing;
  }
  const beat=(n/60000*showBpm)%1, level=showPlaying?.45+.55*Math.exp(-beat*5):.12+.05*Math.sin(n*.002);
  simTick(n);const gp=G.dirty||n-G.lastPaint>1000;if(gp){G.dirty=false;G.lastPaint=n}
  const byId=new Map(page().widgets.map(w=>[w.id,w]));
  for(const el of stage.children){const w=byId.get(el.dataset.id);if(!w)continue;
    if(GAIA_TYPES.has(w.type)){if(gp)gPaint(el,w);if(w.type==='gaia')gOrb(el,n)}
    else if(w.type==='stage'){const c=el.querySelector('canvas'),g=c.getContext('2d');if(!c._d)continue;g.setTransform(c._d,0,0,c._d,0,0);
      const W=c.width/c._d,H=c.height/c._d;if(w.view==='plot')drawPlot(g,W,H,n,w);else drawRender(g,W,H,n,level);
      const hud=w.view==='plot'?'':`${SH.blackout?'<b>BLACKOUT</b> · ':''}SC ${SH.scene+1} ${esc((tdScenes().length?tdScenes().find(s=>s.index===SH.scene)?.label:dmxOutputFresh()?'':LOOKS[SH.scene]?.n)||'')} · fade ${SH.fade.toFixed(1)}s · chase ${CHASE[SH.chase]||'Off'}${SH.strobe?' · <b>STROBO</b>':''} · ${esc(dmxOutputSummary())}`;
      const h=el.querySelector('.hud');if(h._v!==hud){h.innerHTML=hud;h._v=hud}}
    else if(w.type==='timeline'){
      const lb=el.querySelector('.tl-live');if(lb){const on=tdShowActive(),t=on===null?'—':on?'TIMELINE':'LIVE';
        if(lb.textContent!==t){lb.textContent=t;lb.classList.toggle('is-live',on===false);lb.classList.toggle('is-tl',on===true)}}
      const r=rt(w),D=timelineDuration(w),cues=timelineCues(w);
      el.querySelector('.tl-ph').style.left=r.t/D*100+'%';paintVideoLane(el,w,D,r.t);el.querySelector('.tl-tc').textContent=tc(r.t);
      const sample=isShowTimeline(w)&&showClock.authority?showClockSample():null;
      const controlled=isShowTimeline(w)&&showClock.authority,locked=controlled&&(!sample||!showClockFresh(sample));
      el.querySelector('[data-act="start"]').disabled=locked;
      el.querySelector('[data-act="play"]').disabled=locked;
      el.querySelector('[data-act="stop"]').disabled=locked;
      el.querySelector('[data-act="loop"]').disabled=controlled;
      const remoteLabel=sample?.source==='mqtt'&&sample.state.cue?.label?
        `${sample.state.cue.index?`${sample.state.cue.index} · `:''}${sample.state.cue.label}`:null;
      const b=el.querySelector('.tl-cue b'),nm=remoteLabel|| (cues[r.cue]?`${r.cue+1} · ${cues[r.cue].name}`:'—');if(b.textContent!==nm)b.textContent=nm;
      const pb=el.querySelector('[data-act="play"]');if(pb._p!==r.playing){pb._p=r.playing;pb.innerHTML=r.playing?ICON.pause:ICON.play;pb.classList.toggle('on',r.playing)}
      el.querySelector('[data-act="loop"]').classList.toggle('on',r.loop);
      el.querySelectorAll('.tl-blk').forEach(x=>x.classList.toggle('cur',+x.dataset.k===r.cue))}
    else if(w.type==='clock'){const m=el.querySelector('.clk-main'),sb=el.querySelector('.clk-sub'),d=new Date();let a,b,cl='';
      if(w.mode==='show'){
        a=tc(showT);const sample=showClock.authority?showClockSample():null,available=!!sample&&showClockFresh(sample);
        b=showClock.authority?`TD · ${available?sample.source.toUpperCase():'OFFLINE · FERMO'} · TC 25 fps`:`TC 25 fps · ${showPlaying?'PLAY':'STOP'}`;
        if(available&&sample.state.playing)cl='live';
      }
      else if(w.mode==='countdown'){const [hh,mm]=(w.target||'23:30').split(':').map(Number),e=new Date(d);e.setHours(hh||0,mm||0,0,0);
        let s=Math.round((e-d)/1000);const neg=s<0;s=Math.abs(s);a=(neg?'+':'')+[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');
        b=neg?`Oltre l'orario di fine (${w.target})`:`Fine alle ${w.target||'23:30'}`;cl=neg?'over':s<300?'warn':''}
      else{a=d.toLocaleTimeString('it-IT',{hour12:false});b=d.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}
      if(m.textContent!==a)m.textContent=a;if(sb.textContent!==b)sb.textContent=b;
      el.classList.toggle('warn',cl==='warn');el.classList.toggle('over',cl==='over');el.classList.toggle('live',cl==='live')}
    else if(w.type==='scenes'&&w.mode==='dmx-enum'){if(gp)paintTdEnum(el,w)}
    else if(w.type==='fixgrid'){if(gp)paintFixGrid(el,w)}
    else if(w.type==='cuestack'){if(gp)paintCueStack(el,w)}
    else if(w.type==='audiorigs'){if(gp)paintAudioRigs(el,w);updateAudioMeters(el)}
    else if(w.type==='scenes'&&w.addr==='/dmx/scene'){const k=SH.fade>0?clamp((n-SH.t0)/(SH.fade*1000)):1;
      el.querySelectorAll('.si').forEach((x,i)=>{const p=x.querySelector('.prog');if(p)p.style.width=(i===SH.scene&&k<1)?k*100+'%':'0'})}
  }
  requestAnimationFrame(loop);
}
