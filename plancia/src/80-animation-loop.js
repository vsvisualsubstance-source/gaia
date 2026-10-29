/* ---------- ciclo principale ---------- */
const tc=s=>{const f=Math.floor((s%1)*25),S=Math.floor(s);return[Math.floor(S/3600),Math.floor(S/60)%60,S%60,f].map(v=>String(v).padStart(2,'0')).join(':')};
let lastT=now();
function loop(){
  const n=now(),dt=(n-lastT)/1000;lastT=n;
  const previewVisible=stageRenderVisible();
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
    widgetType(w.type)?.tick?.(el,w,{repaint:gp,now:n,level});
  }
  requestAnimationFrame(loop);
}
