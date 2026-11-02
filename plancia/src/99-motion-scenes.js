/* ---------- Motion scene helpers ---------- */
const MOTION_EASINGS=['linear','easeIn','easeOut','easeInOut','sine','bounce'];
function motionDefaults(overrides={}){
  return Object.assign({
    kind:'linear',
    duration:2200,
    speed:1,
    easing:'easeInOut',
    loop:false,
    pingpong:false,
    curve:[0,.2,.8,1]
  }, overrides);
}
function clamp01(v){return Math.min(1,Math.max(0,v));}
function motionEase(v, mode='linear'){
  const x=clamp01(v);
  switch(mode){
    case 'easeIn': return x*x;
    case 'easeOut': return 1-Math.pow(1-x,2);
    case 'easeInOut': return x<.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2;
    case 'sine': return 1-Math.cos((x*Math.PI)/2);
    case 'bounce': {
      const n=7.5625,d=2.75;
      if(x<1/d){return n*x*x;}
      if(x<2/d){x-=1.5/d;return n*x*x+.75;}
      if(x<2.5/d){x-=2.25/d;return n*x*x+.9375;}
      x-=2.625/d;return n*x*x+.984375;
    }
    case 'linear':
    default: return x;
  }
}
function motionPhase(t, sceneMotion={}){
  const motion=motionDefaults(sceneMotion);
  const duration=Math.max(100, Number(motion.duration)||2200);
  const speed=Number(motion.speed)||1;
  const sec=duration/1000;
  const base=t*speed/sec;
  if(!motion.loop && !motion.pingpong){return clamp01(base);}
  const wrap=(base%1+1)%1;
  if(motion.pingpong){
    const p=wrap*2;
    return p>1 ? 2-p : p;
  }
  return wrap;
}
function motionMetaString(m){
  if(!m)return 'motion: linear';
  return `motion: ${m.kind||'linear'} · ${m.duration||2200}ms · ${m.easing||'easeInOut'} · ${m.speed||1}x`;
}
function motionBlend(a,b,ratio){return a+(b-a)*ratio;}
function motionSamplePath(path, progress){
  if(!Array.isArray(path)||!path.length)return {x:0,y:0};
  const p=clamp01(progress);
  const idx=Math.min(path.length-1, Math.max(0, Math.floor(p*(path.length-1))));
  const next=Math.min(path.length-1, idx+1);
  const r=(p*(path.length-1))-idx;
  return {
    x: motionBlend(path[idx][0], path[next][0], r),
    y: motionBlend(path[idx][1], path[next][1], r)
  };
}
