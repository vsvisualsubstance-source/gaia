/* ---------- bus dei messaggi MQTT ---------- */
// Ogni modulo dichiara qui i topic che ascolta, accanto al codice che li usa
// (REFACTOR.md, passo 3):
//
//   onMqtt('gaia/devices/+/laser_preview',(p,seg,obj,t)=>…)
//
// + e # come nelle iscrizioni MQTT; p = payload (JSON se lo e', altrimenti
// testo), seg = topic diviso per '/', obj = payload oggetto. Vince il primo
// pattern che corrisponde; un gestore che restituisce false non chiede di
// ridisegnare. Le iscrizioni al broker sono proprio questi pattern.
const MQTT_ROUTES=[];
function onMqtt(pattern,fn){MQTT_ROUTES.push({pattern,parts:pattern.split('/'),fn})}
function mqttMatches(parts,seg){
  for(let i=0;i<parts.length;i++){
    if(parts[i]==='#')return true;
    if(i>=seg.length||(parts[i]!=='+'&&parts[i]!==seg[i]))return false;
  }
  return parts.length===seg.length;
}
const mqttTopics=()=>[...new Set(MQTT_ROUTES.map(r=>r.pattern))];
// messaggio MQTT in arrivo (dal broker o dalla simulazione)
function gIn(t,p){
  const seg=t.split('/'),obj=!!p&&typeof p==='object';
  const r=MQTT_ROUTES.find(r=>mqttMatches(r.parts,seg));
  if(r&&r.fn(p,seg,obj,t)===false)return;
  G.dirty=true;
}
