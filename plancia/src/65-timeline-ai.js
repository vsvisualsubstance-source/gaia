/* ---------- timeline: controllo dei difetti e timeline base con Ollama ---------- */
// auditTimeline: regole nel codice, stesse risposte ogni volta, niente modello.
// expandTimelinePlan: dal piano a sezioni di Ollama alle cue delle tracce, calcolo
// deterministico. Le prime due funzioni sono pure: anche modulo Node per i test.
const AUDIT_CHANNELS_HEADS=['dimmer','strobe'];
// d = {cues:[{t,name,sceneId,fade}], duration, bpm, scenes, chases, chaseCues, fx, fxCues, motions, motionCues, laserScenes, laserCues, videoCues, fixtures, groups, footprint}
function auditTimeline(d){
  const out=[],add=(level,track,t,msg)=>out.push({level,track,t,msg}),D=+d.duration||0,bpm=+d.bpm>0?+d.bpm:120;
  const has=(list,id)=>(list||[]).some(x=>x.id===id),scene=id=>(d.scenes||[]).find(s=>s.id===id);
  const cats=id=>scene(id)?.categories||[],isHeads=id=>{const c=cats(id);return c.length>0&&c.every(x=>x==='heads')};
  const secs=h=>h?.unit==='s'?+h.value||0:(+h?.value||0)*60/bpm;
  const sorted=l=>[...(l||[])].filter(c=>Number.isFinite(+c.time)).sort((a,b)=>a.time-b.time);
  const past=(track,list)=>sorted(list).forEach(c=>{if(D&&c.time>=D)add('errore',track,c.time,`Cue oltre la fine della timeline (${D} s): non partirà mai.`)});
  // LUCI e TESTE POS.
  const cues=[...(d.cues||[])].sort((a,b)=>a.t-b.t);
  cues.forEach((c,i)=>{
    const track=isHeads(c.sceneId)?'TESTE POS.':'LUCI';
    if(D&&c.t>=D)add('errore',track,c.t,`"${c.name}": oltre la fine della timeline (${D} s), non partirà mai.`);
    if(c.sceneId&&(d.scenes||[]).length&&!scene(c.sceneId))add('errore',track,c.t,`"${c.name}": la scena "${c.sceneId}" non esiste in DMX Master.`);
    if(!c.sceneId&&c.scene==null&&!(c.params||[]).length)add('info',track,c.t,`"${c.name}": cue senza scena (solo un segnaposto).`);
    // stesso strato: una cue che tocca le stesse categorie interrompe il fade
    const cc=cats(c.sceneId),next=cues.slice(i+1).find(n=>cats(n.sceneId).some(x=>cc.includes(x)));
    const fade=c.fade!=null?+c.fade:2;
    if(next&&cc.length&&fade>next.t-c.t+.001)add('attenzione',track,c.t,`"${c.name}": il fade di ${fade} s non finisce, "${next.name}" arriva dopo ${(next.t-c.t).toFixed(1)} s.`);
  });
  if(cues.length&&cues[0].t>0.5)add('info','LUCI',0,`Prima della prima cue (${cues[0].t} s) le luci restano come sono.`);
  // SEQUENZE
  past('SEQUENZE',d.chaseCues);
  sorted(d.chaseCues).forEach((c,i,l)=>{if(c.chase==='off')return;const ch=(d.chases||[]).find(x=>x.id===c.chase);
    if(!ch){add('errore','SEQUENZE',c.time,'Il chase di questa cue non esiste più.');return}
    const bad=ch.steps.filter(s=>s.scene&&(d.scenes||[]).length&&!scene(s.scene)).map(s=>s.scene);
    if(bad.length)add('errore','SEQUENZE',c.time,`"${ch.name}": scene che non esistono: ${[...new Set(bad)].join(', ')}.`);
    if(!ch.steps.some(s=>s.scene))add('errore','SEQUENZE',c.time,`"${ch.name}": nessuna scena negli step.`);
    const fast=Math.min(...ch.steps.map(s=>secs(s.hold||ch.hold)));
    if(fast<.25)add('attenzione','SEQUENZE',c.time,`"${ch.name}": step di ${fast.toFixed(2)} s: dal vivo, via rete, sotto 0,25 s non è preciso.`);
    const end=l[i+1]?.time??D,n=end>c.time&&ch.steps.length?Math.ceil((end-c.time)/Math.max(.05,secs(ch.hold))):0;
    if(n>200&&!d.chasesInTd)add('attenzione','SEQUENZE',c.time,`"${ch.name}": circa ${n} cue in DMX Master, lista molto lunga.`);
    // colori della traccia LUCI coperti dal chase
    const lay=new Set(ch.steps.flatMap(s=>cats(s.scene))),over=cues.filter(q=>q.t>c.time&&q.t<end&&cats(q.sceneId).some(x=>lay.has(x)));
    // dopo "Fermo" resta acceso l'ultimo step finche' una cue luci non cambia quelle categorie
    if(l[i+1]?.chase==='off'){const nx=cues.find(q=>q.t>=end-.001&&cats(q.sceneId).some(x=>lay.has(x))),gap=(nx?nx.t:D)-end;
      if(gap>5)add('attenzione','SEQUENZE',end,`"${ch.name}" si ferma ma resta acceso il suo ultimo step per ${Math.round(gap)} s, fino a ${nx?`"${nx.name}"`:'la fine'}: metti una cue luci dopo il Fermo.`)}
    if(over.length)add('attenzione','SEQUENZE',c.time,`"${ch.name}" e la traccia LUCI si sovrappongono: ${over.map(q=>`"${q.name}"`).join(', ')} durerà solo fino allo step dopo.`);
  });
  const total=(d.cues||[]).length+sorted(d.chaseCues).reduce((a,c,i,l)=>{const ch=(d.chases||[]).find(x=>x.id===c.chase);if(!ch)return a;const end=l[i+1]?.time??D;return a+Math.max(0,Math.ceil((end-c.time)/Math.max(.05,secs(ch.hold))))},0);
  if(total>200&&!d.chasesInTd)add('attenzione','SEQUENZE',0,`Circa ${total} cue in DMX Master, quasi tutte dai chase: lista lunga, GO e BACK diventano scomodi.`);
  // EFFETTI
  past('EFFETTI',d.fxCues);
  const lightsOf=g=>(d.fixtures||[]).filter(f=>f.group===g&&(+f.address>0));
  sorted(d.fxCues).forEach(c=>(c.effects||[]).forEach(id=>{const f=(d.fx||[]).find(x=>x.id===id);
    if(!f){add('errore','EFFETTI',c.time,'Un effetto di questa cue non esiste più.');return}
    const g=f.target?.group;if(!g)return;
    const kind=(d.groups||[]).find(x=>x.group===g)?.kind;
    if(!(d.groups||[]).some(x=>x.group===g))add('errore','EFFETTI',c.time,`"${f.name}": il gruppo "${g}" non è in questo progetto.`);
    else if(!lightsOf(g).length)add('attenzione','EFFETTI',c.time,`"${f.name}": il gruppo "${g}" non ha luci, non si vedrà niente.`);
    if(kind==='heads'&&!AUDIT_CHANNELS_HEADS.includes(f.channel||'dimmer'))add('attenzione','EFFETTI',c.time,`"${f.name}": sulle teste funziona il dimmer, non il canale ${f.channel}.`);
    if(kind==='level'&&(f.channel==='color'||f.channel==='white'))add('attenzione','EFFETTI',c.time,`"${f.name}": il gruppo "${g}" ha solo il livello, niente colore.`);
    if(f.channel==='color'&&!f.palette&&!(f.colors||[]).length)add('errore','EFFETTI',c.time,`"${f.name}": effetto colore senza colori.`);
  }));
  // TESTE MOV.
  past('TESTE MOV.',d.motionCues);
  const mo=sorted(d.motionCues);
  mo.forEach((c,i)=>{if(c.scene==='off')return;const sc=(d.motions||[]).find(x=>x.id===c.scene);
    if(!sc){add('errore','TESTE MOV.',c.time,'Il movimento di questa cue non esiste più.');return}
    if(!(d.fixtures||[]).some(f=>f.type==='mh'))add('attenzione','TESTE MOV.',c.time,`"${sc.name}": nel progetto non ci sono teste.`);
    const end=mo[i+1]?.time??D,over=cues.filter(q=>q.t>=c.time&&q.t<end&&isHeads(q.sceneId));
    if(over.length)add('attenzione','TESTE MOV.',c.time,`"${sc.name}": mentre gira, il movimento vince su pan e tilt: ${over.map(q=>`"${q.name}"`).join(', ')} cambierà solo colore, gobo e dimmer.`);
  });
  if(mo.length&&mo[mo.length-1].scene!=='off')add('info','TESTE MOV.',mo[mo.length-1].time,'L\'ultimo movimento continua fino alla fine e, in loop, oltre: manca un Fermo.');
  // LASER e VIDEO
  past('LASER',d.laserCues);past('VIDEO',d.videoCues);
  sorted(d.laserCues).forEach(c=>{if(c.scene&&!has(d.laserScenes,c.scene))add('errore','LASER',c.time,'La scena laser di questa cue non esiste più.');
    if(!c.mode&&!c.scene)add('errore','LASER',c.time,'Cue laser senza sorgente né scena.')});
  sorted(d.videoCues).forEach(c=>{if(!c.deck&&!c.show&&c.show!=='')add('info','VIDEO',c.time,'Cue video senza deck né uscita.')});
  // patch: indirizzi sovrapposti nello stesso universo
  const fp=d.footprint||(()=>0),spans=(d.fixtures||[]).filter(f=>+f.address>0&&fp(f)>0).map(f=>({f,a:+f.address,b:+f.address+fp(f)-1,u:f.universe}));
  spans.forEach((x,i)=>spans.slice(i+1).forEach(y=>{if(x.u===y.u&&x.a<=y.b&&y.a<=x.b)add('errore','PATCH',0,`${x.f.name} (${x.a}-${x.b}) e ${y.f.name} (${y.a}-${y.b}) si sovrappongono nell'universo ${x.u}.`)}));
  const rank={errore:0,attenzione:1,info:2};
  return out.sort((a,b)=>rank[a.level]-rank[b.level]||a.t-b.t);
}
// piano a sezioni -> cue. Una traccia riceve una cue solo quando cambia qualcosa.
function expandTimelinePlan(plan,{duration=null}={}){
  const warnings=[],secs=(Array.isArray(plan?.sections)?plan.sections:[]).filter(s=>+s?.seconds>0);
  if(!secs.length)return{duration:duration||180,bpm:+plan?.bpm||120,cues:[],chaseCues:[],fxCues:[],motionCues:[],laserCues:[],warnings:['Il piano non contiene sezioni.']};
  const sum=secs.reduce((a,s)=>a+ +s.seconds,0),D=Math.max(10,Math.min(3600,+duration||sum)),k=D/sum;
  if(duration&&Math.abs(k-1)>.05)warnings.push(`Il modello ha previsto ${Math.round(sum)} s: sezioni adattate ai ${D} s chiesti.`);
  const round=t=>Math.round(t*2)/2,cues=[],chaseCues=[],fxCues=[],motionCues=[],laserCues=[];
  let t=0,chase='',fx='[]',motion='',laser='',scene='',heads='';
  secs.forEach((s,i)=>{
    const at=round(t),name=String(s.name||`Sezione ${i+1}`).replace(/>/g,'›').trim().slice(0,40);
    if(s.scene&&s.scene!==scene){cues.push({t:at,name,targets:`@${s.scene}`});scene=s.scene}
    // col movimento acceso il motore vince su pan e tilt: la posizione non servirebbe
    if(s.heads&&!s.motion&&s.heads!==heads){cues.push({t:+(at+.5).toFixed(2),name:`${name}: teste`,targets:`@${s.heads}`});heads=s.heads}
    if((s.chase||'')!==chase){chaseCues.push({time:at,label:s.chase?name:'',chase:s.chase||'off'});chase=s.chase||''}
    const e=[...new Set((s.effects||[]).filter(Boolean))],ek=JSON.stringify(e);
    if(ek!==fx){fxCues.push({time:at,label:e.length?name:'',effects:e});fx=ek}
    if((s.motion||'')!==motion){motionCues.push({time:at,label:s.motion?name:'',scene:s.motion||'off'});motion=s.motion||''}
    if((s.laser||'')!==laser){laserCues.push(s.laser?{time:at,label:name,cube:'all',mode:'scene',scene:s.laser}:{time:at,label:'Spento',cube:'all',mode:'off',scene:''});laser=s.laser||''}
    t+=+s.seconds*k;
  });
  return{duration:Math.round(D),bpm:+plan?.bpm>0?+plan.bpm:null,cues,chaseCues,fxCues,motionCues,laserCues,sections:secs.map(s=>({...s,seconds:Math.round(+s.seconds*k)})),warnings};
}
if(typeof module==='object'&&module.exports)module.exports={auditTimeline,expandTimelinePlan};
// ---- UI (solo nel browser)
function timelineAuditData(w){
  const scenes=tdScenes(),cues=L.tlTdDirty||w.cues?parseCues(w):timelineCues(w); // quello che partirebbe con ⇪ TD
  return{cues,duration:timelineDuration(w),bpm:+w.bpm||hmBpm(),scenes,chases:chases(),chaseCues:chaseDoc().cues,fx:lightFx(),fxCues:fxDoc().cues,motions:hmScenes(),motionCues:hmDoc().cues,
    chasesInTd:chaseTdReady(),laserScenes:laserScenes(),laserCues:laserDoc().cues,videoCues:videoDoc().cues,fixtures:L.fixtures,groups:groupsOf(),footprint:f=>modelFootprint(f.model||typeDefaultModel(f.type))||0};
}
function openTimelineAudit(w){
  const list=auditTimeline(timelineAuditData(w)),s=$('#scrim');s.hidden=false;
  const n=l=>list.filter(x=>x.level===l).length,dirty=L.tlTdDirty&&isShowTimeline(w)&&showClock.authority;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Controllo timeline">
    <div class="top"><h3>✓ Controllo della timeline</h3><button class="btn ghost" id="auClose">Chiudi</button></div>
    <p class="hint"><b>${n('errore')} errori</b> · ${n('attenzione')} da guardare · ${n('info')} note. Il controllo non cambia niente.${dirty?' <b class="pr-dirty">Ci sono modifiche non ancora mandate a DMX Master (⇪ TD).</b>':''}</p>
    <div class="tla-list">${list.map(x=>`<div class="tla-row ${x.level}"><i>${x.level}</i><b>${esc(x.track)}</b><span>${formatCueTime(x.t)}</span><p>${esc(x.msg)}</p></div>`).join('')||'<p class="hint">Nessun problema trovato.</p>'}</div>
  </div>`;
  s.querySelector('#auClose').onclick=closeSheet;
}
// Ollama e' spento di solito: si offre di accenderlo dall'agent che lo gestisce
async function aiRequest(path,body){
  const call=async()=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.ok)throw new Error(d.error||'errore');return d};
  try{return await call()}catch(e){
    const dev=Object.keys(G.devices).find(id=>G.devices[id]?.services?.ollama!==undefined);
    if(!/raggiungibile/.test(e.message)||!dev)throw e;
    if(!await uiConfirm('Ollama è spento. Lo accendo?',{ok:'Accendi'}))throw e;
    devCmd(dev,{action:'enable',service:'ollama'});await new Promise(ok=>setTimeout(ok,6000));
    return call();
  }
}
let lastTlPlan=null;
function timelineLibrary(){
  const sc=tdScenes(),P=x=>({id:x.id,name:x.name||x.label||x.id});
  return{scenes:sc.filter(s=>sceneKind(s.categories)?.id!=='heads'&&sceneKind(s.categories)?.id!=='strobe').map(P),heads:sc.filter(s=>sceneKind(s.categories)?.id==='heads').map(P),
    chases:chases().map(P),effects:lightFx().map(P),motions:hmScenes().map(P),laser:laserScenes().map(P)};
}
function openTimelineAI(w){
  const s=$('#scrim');s.hidden=false;const p=lastTlPlan,x=p?expandTimelinePlan(p.plan,{duration:p.duration}):null,lib=timelineLibrary();
  const nm=(l,id)=>l.find(y=>y.id===id)?.name||id||'—';
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline da descrizione">
    <div class="top"><h3>✨ Timeline base da descrizione</h3><button class="btn ghost" id="taClose">Chiudi</button></div>
    <p class="hint">Descrivi lo show a parole. Ollama (su OPS) lo divide in sezioni scegliendo solo tra scene, chase, effetti e movimenti che esistono; le cue le calcola la Plancia. Niente va a DMX Master finché non controlli e premi ⇪ TD.</p>
    <label>Descrizione<textarea id="taPrompt" rows="3" placeholder="es. Show di 3 minuti: intro lenta blu, strofa calda, ritornello con movimento delle teste ed effetti, finale con strobo.">${esc(p?.prompt||'')}</textarea></label>
    <label>Durata (M:SS)<input id="taDur" value="${esc(formatCueTime(p?.duration||timelineDuration(w)))}" inputmode="decimal"></label>
    <div class="row"><button class="btn primary" id="taGen">✨ Genera con Ollama</button><span class="hint" id="taSt"></span></div>
    ${x?`<div class="ai-plan"><h4>${x.sections?.length||0} sezioni · ${formatCueTime(x.duration)} <span class="hint">(${esc(p.model)}, ${p.seconds} s)</span></h4>
      <table class="ai-table"><tr><th>Sezione</th><th>s</th><th>Luci</th><th>Teste</th><th>Chase</th><th>Effetti</th><th>Movim.</th></tr>${(x.sections||[]).map(z=>`<tr><td>${esc(z.name)}</td><td>${z.seconds}</td><td>${esc(nm(lib.scenes,z.scene))}</td><td>${esc(nm(lib.heads,z.heads))}</td><td>${esc(nm(lib.chases,z.chase))}</td><td>${esc((z.effects||[]).filter(Boolean).map(e=>nm(lib.effects,e)).join(' + ')||'—')}</td><td>${esc(nm(lib.motions,z.motion))}</td></tr>`).join('')}</table>
      ${p.plan.notes?`<p class="hint">Ollama: ${esc(p.plan.notes)}</p>`:''}${[...(p.corrections||[]),...x.warnings].map(m=>`<p class="hint warn">${esc(m)}</p>`).join('')}
      <div class="row"><button class="btn primary" id="taApply">Applica alla timeline</button></div></div>`:''}
    ${L.aiTlBackup?'<div class="row"><button class="btn ghost" id="taUndo">↶ Rimetti la timeline di prima</button></div>':''}
  </div>`;
  const q=y=>s.querySelector(y);q('#taClose').onclick=closeSheet;
  q('#taGen').onclick=async()=>{const prompt=q('#taPrompt').value.trim(),duration=parseCueTime(q('#taDur').value);
    if(!prompt){showError('Scrivi prima la descrizione dello show.');return}
    if(!(duration>=10)){showError('Durata: scrivi M:SS, almeno 10 s.');return}
    if(!lib.scenes.length&&!lib.chases.length){showError('DMX Master non pubblica scene: collega Gaia.');return}
    const b=q('#taGen'),st=q('#taSt');b.disabled=true;const t0=Date.now(),tick=setInterval(()=>st.textContent=`Ollama sta pensando… ${Math.round((Date.now()-t0)/1000)} s`,1000);
    try{const d=await aiRequest('/api/timeline-ai',{prompt:`${prompt}\nDurata totale: ${Math.round(duration)} secondi.`,lib});lastTlPlan={prompt,duration,plan:d.plan,model:d.model,seconds:d.seconds,corrections:d.corrections||[]};clearInterval(tick);openTimelineAI(w)}
    catch(e){clearInterval(tick);b.disabled=false;st.textContent='';showError('Timeline AI: '+e.message)}};
  if(q('#taApply'))q('#taApply').onclick=async()=>{
    const has=timelineCues(w).length+chaseDoc().cues.length+fxDoc().cues.length+hmDoc().cues.length+laserDoc().cues.length;
    if(has&&!await uiConfirm('Sostituire le cue di luci, teste, sequenze, effetti, movimento e laser con quelle del piano? Video resta com\'è.\nSi può rimettere com\'era.',{ok:'Sostituisci'}))return;
    L.aiTlBackup={cues:w.cues,duration:w.duration,bpm:w.bpm,chase:chaseDoc(),fx:fxDoc(),motion:hmDoc(),laser:laserDoc()};
    w.cues=serializeCues(x.cues);w.duration=x.duration;if(x.bpm)w.bpm=x.bpm;syncShowWidgets(w);
    L.chaseTimeline={cues:x.chaseCues};L.fxTimeline={cues:x.fxCues};L.headTimeline={...hmDoc(),cues:x.motionCues};L.laserTimeline={...laserDoc(),cues:x.laserCues};tlMarkTd();
    save();refreshShowTimelines();closeSheet();showInfo(`Timeline base: ${x.sections?.length||0} sezioni. Controlla${showClock.authority?', poi ⇪ TD per mandarla a DMX Master':''}.`)};
  if(q('#taUndo'))q('#taUndo').onclick=()=>{const b=L.aiTlBackup;w.cues=b.cues;w.duration=b.duration;w.bpm=b.bpm;syncShowWidgets(w);L.chaseTimeline=b.chase;L.fxTimeline=b.fx;L.headTimeline=b.motion;L.laserTimeline=b.laser;delete L.aiTlBackup;tlMarkTd();save();refreshShowTimelines();closeSheet();showInfo('Timeline rimessa come prima.')};
}
async function tlMenu(w){
  const act=await uiChoose('Timeline',[{label:'Tracce da vedere',value:'tracks'},{label:'✓ Controlla la timeline',value:'audit'},{label:'✨ Timeline base con Ollama',value:'ai'}]);
  if(act==='tracks')tlChooseTracks(w);else if(act==='audit')openTimelineAudit(w);else if(act==='ai')openTimelineAI(w);
}
