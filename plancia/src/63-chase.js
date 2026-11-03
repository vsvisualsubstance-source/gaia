/* ---------- tempo (TAP) e chase a step: formato e calcolo ---------- */
// Chase = sequenza di scene di DMX Master, ognuna tenuta per un tempo e
// raggiunta con un fade (come Daslight "scene a step"). DMX Master sa gia'
// richiamare una scena con un fade e compone le scene a strati, quindi non
// serve niente di nuovo in TD:
//   dal vivo  il motore della Plancia su OPS (chase-engine.js) manda
//             /dmx/fade s + /dmx/scene i a ogni step;
//   timeline  il blocco di chase diventa cue normali quando la timeline va a
//             DMX Master (le esegue TD, preciso), con l'etichetta "⟳ …" per
//             riconoscerle e ricomporle in un blocco al ritorno.
// Anche modulo Node (motore del bridge, test).
//
// Chase (L.chases[]): {id, name, steps: [{scene, hold?}], hold: {value, unit: 'beats'|'s'},
//                      fadePct (0..100 del tempo dello step), pingpong}
// Timeline dei chase (L.chaseTimeline): {cues: [{time, label, chase: <id>|'off'}]}
const CHASE_MARK='⟳';
// BPM dai colpi di TAP (ms): media degli ultimi intervalli coerenti, 40..240
function tapBpm(times){
  const t=(times||[]).slice(-8),iv=[];for(let i=1;i<t.length;i++)iv.push(t[i]-t[i-1]);
  const ok=iv.filter(d=>d>=250&&d<=1500);if(ok.length<2)return null;
  const avg=ok.reduce((a,b)=>a+b,0)/ok.length;return Math.round(60000/avg*2)/2;
}
const chaseSec=(h,bpm)=>Math.max(.05,h?.unit==='s'?+h.value||1:(+h?.value||1)*60/(bpm>0?bpm:120));
// ordine degli step (avanti e indietro: 1 2 3 2 1 2 3 …)
function chaseOrder(ch){const n=(ch?.steps||[]).length,o=[...Array(n).keys()];return ch?.pingpong&&n>2?[...o,...o.slice(1,-1).reverse()]:o}
// step da start a end (escluso): [{time, step, scene, fade}]
function chaseExpand(ch,start,end,bpm,max=500){
  const order=chaseOrder(ch),out=[];if(!order.length)return out;
  let t=start;
  for(let k=0;t<end-1e-6&&out.length<max;k++){
    const i=order[k%order.length],st=ch.steps[i],dur=chaseSec(st.hold||ch.hold,bpm);
    if(st.scene)out.push({time:+t.toFixed(3),step:i,scene:st.scene,fade:+(dur*Math.max(0,Math.min(100,ch.fadePct??0))/100).toFixed(2)});
    t+=dur;
  }
  return out;
}
// la timeline dei chase in cue di DMX Master (etichetta "⟳ nome n")
function chaseTimelineCues(doc,chases,length,bpm){
  const cues=[...(doc?.cues||[])].filter(c=>Number.isFinite(+c.time)).sort((a,b)=>a.time-b.time),out=[];
  cues.forEach((c,i)=>{
    const ch=(chases||[]).find(x=>x.id===c.chase);if(!ch||c.chase==='off')return;
    const end=Math.min(length,cues[i+1]?.time??length);
    for(const s of chaseExpand(ch,+c.time,end,bpm))out.push({time:s.time,scene:s.scene,fade:s.fade,label:`${CHASE_MARK} ${ch.name} ${s.step+1}`});
  });
  return out;
}
const isChaseCue=c=>String(c?.label??c?.name??'').startsWith(CHASE_MARK);
if(typeof module==='object'&&module.exports){module.exports={CHASE_MARK,tapBpm,chaseSec,chaseOrder,chaseExpand,chaseTimelineCues,isChaseCue}}
