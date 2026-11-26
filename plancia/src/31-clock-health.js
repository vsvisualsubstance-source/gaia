/* ---------- salute dell'orologio dello show (26/11/2026, docs/show-clock.md) ----------
   Stessa misura nei tablet (qui, dentro app.js) e nel bridge (clock-health.js la richiede da qui).
   Per ogni follower: ritardo verso il broker (ping/pong: ultimo, minimo, jitter = 90° percentile -
   minimo) e SCARTO: a ogni nuovo stato del master, quanto la posizione che il follower stava
   contando (stato precedente + tempo passato) si discosta da quella nuova. E' il salto che fa a ogni
   correzione: viene dal ritardo variabile di rete e broker (Wi-Fi!). Solo fra due stati in play dello
   stesso master e senza salti voluti (seek, oltre 1 s). Piu' pause fra gli stati ed eta' dell'ultimo. */
const CH_KEEP=30;
function chMake(){return{rtts:[],errs:[],gaps:[],last:null,lastAt:0,states:[],skip:3}}
function chPush(a,v,n=CH_KEEP){a.push(v);if(a.length>n)a.shift()}
function chOnState(h,p,now){
  if(!p||!Number.isFinite(+p.pos))return;
  const L=h.last;
  if(L&&L.master===p.master&&L.playing&&p.playing&&L.seq!==p.seq){
    const rate=Number.isFinite(+L.rate)?+L.rate:1,err=((+L.pos+(now-h.lastAt)/1000*rate)-+p.pos)*1000;
    if(Math.abs(err)<1000)chPush(h.errs,err);
  }
  if(h.lastAt&&L&&L.seq!==p.seq)chPush(h.gaps,now-h.lastAt);
  chPush(h.states,now,60);
  h.last=p;h.lastAt=now;
}
// i primi ping (pagina o processo che si sta avviando) sono lenti per conto loro: non contano
function chOnRtt(h,rtt){if(!Number.isFinite(rtt)||rtt<0)return;if(h.skip>0){h.skip--;return}chPush(h.rtts,rtt,20)}
function chPct(a,q){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))]}
function chR1(v){return v==null?null:Math.round(v*10)/10}
function chReport(h,now,extra={}){
  const abs=h.errs.map(Math.abs),min=h.rtts.length?Math.min(...h.rtts):null,L=h.last;
  return{v:1,...extra,ts:now,
    master:L?.master||null,prio:L?.prio??null,playing:!!L?.playing,pos:L?chR1(+L.pos):null,
    age_ms:h.lastAt?now-h.lastAt:null,
    rtt_ms:h.rtts.length?chR1(h.rtts[h.rtts.length-1]):null,rtt_min_ms:chR1(min),
    jitter_ms:h.rtts.length>=5?chR1(chPct(h.rtts,.9)-min):null,
    err_ms:abs.length?chR1(abs.reduce((s,v)=>s+v,0)/abs.length):null,
    err_max_ms:abs.length?chR1(Math.max(...abs)):null,n:abs.length,
    gap_max_ms:h.gaps.length?Math.round(Math.max(...h.gaps)):null,
    rate_hz:h.states.length>=2?chR1((h.states.length-1)/((h.states[h.states.length-1]-h.states[0])/1000||1)):null};
}
// verde / giallo / rosso: scarto medio entro 10 / 40 ms, jitter entro 20 / 80 ms, stato entro 2,5 / 5 s
function chGrade(r){
  if(!r||r.age_ms==null)return'bad';
  const bad=r.age_ms>5000||(r.err_ms??0)>40||(r.jitter_ms??0)>80;
  const warn=r.age_ms>2500||(r.err_ms??0)>10||(r.jitter_ms??0)>20||(r.err_max_ms??0)>60;
  return bad?'bad':warn?'warn':'ok';
}
if(typeof module!=='undefined'&&module.exports)module.exports={chMake,chOnState,chOnRtt,chReport,chGrade};
