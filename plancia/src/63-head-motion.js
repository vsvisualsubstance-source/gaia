/* ---------- movimento teste: sequenze di cue nella traccia TESTE ---------- */
// Idea di Copilot (99-motion-scenes.js, 2/11): animare le teste mobili. Un'animazione
// calcolata dal tablet si fermerebbe col tablet; in TD non c'e' un generatore di
// movimento e il movimento si fa con cue in sequenza e fade tra scene "solo teste"
// (nota TD 39). Qui si genera quella sequenza: la esegue DMX Master anche senza
// tablet. Una scena pos_<posizione> (categoria heads) per posizione, catturata
// richiamando la posizione su tutte le teste; le cue arrivano nell'editor della
// timeline, da rivedere prima dell'invio.
const HM_PATTERNS=[{id:'loop',label:'In fila · A B C A B C'},{id:'pingpong',label:'Avanti e indietro · A B C B A'}];
const hmSceneId=pos=>'pos_'+String(pos).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
// posizioni di DMX Master [{index, position, label}]; senza TD quelle della Plancia
function tdHeadPositions(){
  const p=G.dxm['td-dmx-win']?.heads?.programmer?.positions;
  return Array.isArray(p)&&p.length?p:POS.map((n,index)=>({index,position:n,label:n}));
}
function hmOrder(seq,pattern){return pattern==='pingpong'&&seq.length>2?[...seq,...seq.slice(1,-1).reverse()]:seq}
// un passo ogni step secondi da start a end (escluso); fade in % del passo
function hmCues({positions,pattern,start,end,step,fadePct}){
  const order=hmOrder(positions,pattern),out=[];
  if(!order.length||!(step>0))return out;
  const fade=+(step*Math.max(0,Math.min(100,fadePct))/100).toFixed(2);
  for(let i=0,t=start;t<end-1e-6&&out.length<200;i++,t=start+i*step){
    const pos=order[i%order.length];
    out.push({t:+t.toFixed(3),name:`↻ ${pos.label||pos.position}`,targets:`@${hmSceneId(pos.position)}; fade=${fade}`});
  }
  return out;
}
const hmSleep=ms=>new Promise(ok=>setTimeout(ok,ms));
// cattura le scene pos_* che mancano (o tutte con recapture), in LIVE come la
// cattura a mano; la selezione teste resta "tutte" alla fine
async function hmEnsureScenes(positions,recapture,onStep=()=>{}){
  const need=positions.filter(p=>recapture||!tdSceneById(hmSceneId(p.position)));
  if(!need.length)return 0;
  const heads=tdHeadEntries().map(h=>h.id);
  if(!heads.length)throw new Error('DMX Master non pubblica teste mobili.');
  const wasActive=tdShowActive()===true;
  try{
    if(wasActive){
      if(!devCmd('td-dmx-win',{action:'disable',service:'show_active'}))throw new Error('Non collegata a Gaia: apri ⋯ → Gaia.');
      await tdWait(()=>tdShowActive()===false);
    }
    fire('/mh/select/heads',heads);await hmSleep(400);
    for(const p of need){
      const id=hmSceneId(p.position),pub=()=>`${G.devices['td-dmx-win']?.ts}|${JSON.stringify(tdSceneById(id))}`,before=pub();
      onStep(p);fire('/mh/position',[p.index]);await hmSleep(900);
      await tdSceneCommand('show_scene_capture',{name:id,label:`Teste · ${p.label||p.position}`,categories:['heads']},()=>!!tdSceneById(id)&&pub()!==before);
    }
  }finally{if(wasActive)devCmd('td-dmx-win',{action:'enable',service:'show_active'})}
  return need.length;
}
function openHeadMotion(w){
  const s=$('#scrim');s.hidden=false;
  const positions=tdHeadPositions(),D=timelineDuration(w),bpm=+w.bpm>0?+w.bpm:null;
  const f={sel:[],pattern:'loop',start:Math.floor(rt(w).t),end:D,step:4,unit:bpm?'beat':'s',fadePct:80,replace:true,recapture:false};
  const stepSec=()=>f.unit==='beat'&&bpm?f.step*60/bpm:f.step;
  const paint=()=>{
    const picked=f.sel.map(i=>positions[i]),cues=hmCues({positions:picked,pattern:f.pattern,start:f.start,end:f.end,step:stepSec(),fadePct:f.fadePct});
    const missing=picked.filter(p=>f.recapture||!tdSceneById(hmSceneId(p.position)));
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Movimento teste">
      <div class="top"><h3>↻ Movimento teste</h3><button class="btn ghost" id="hmClose">Chiudi</button></div>
      <p class="hint">Le teste passano da una posizione all'altra con un fade: una cue per passo nella traccia TESTE. Le esegue DMX Master, anche a tablet chiuso. Tocca le posizioni nell'ordine in cui le vuoi.</p>
      <div class="hm-pos">${positions.map((p,i)=>{const k=f.sel.indexOf(i);return`<button class="chip${k>=0?' on':''}" data-hm-pos="${i}">${k>=0?`<i>${k+1}</i>`:''}${esc(p.label||p.position)}</button>`}).join('')}</div>
      <div class="two"><label>Andamento<select id="hmPattern">${HM_PATTERNS.map(x=>`<option value="${x.id}"${x.id===f.pattern?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
        <label>Passo<span class="row"><input id="hmStep" type="number" min="0.5" step="0.5" value="${f.step}" style="flex:1"><select id="hmUnit"${bpm?'':' disabled'}><option value="s"${f.unit==='s'?' selected':''}>secondi</option><option value="beat"${f.unit==='beat'?' selected':''}>battiti${bpm?` (${bpm} BPM)`:''}</option></select></span></label></div>
      <div class="two"><label>Da (M:SS)<input id="hmStart" value="${esc(formatCueTime(f.start))}" inputmode="decimal"></label><label>A (M:SS)<input id="hmEnd" value="${esc(formatCueTime(f.end))}" inputmode="decimal"></label></div>
      <label>Fade · ${f.fadePct}% del passo (${(stepSec()*f.fadePct/100).toFixed(1)} s): 100% = movimento continuo, poco = scatti<input id="hmFade" type="range" min="0" max="100" step="5" value="${f.fadePct}"></label>
      <label class="chk"><input id="hmReplace" type="checkbox"${f.replace?' checked':''}> Togli le cue teste già presenti tra Da e A</label>
      <label class="chk"><input id="hmRecap" type="checkbox"${f.recapture?' checked':''}> Ricattura le scene delle posizioni (dopo averle ricalibrate)</label>
      <p class="hint"><b>${cues.length} cue</b> ogni ${stepSec().toFixed(2)} s${picked.length?` · ${hmOrder(picked,f.pattern).map(p=>esc(p.label||p.position)).join(' → ')}`:''}${missing.length?` · da catturare: ${missing.map(p=>hmSceneId(p.position)).join(', ')} (luci in LIVE per qualche secondo, tutte le teste selezionate)`:''}${cues.length>=200?' · massimo 200 cue':''}</p>
      <p class="hint" id="hmStatus"></p>
      <div class="row"><button class="btn primary" id="hmGo"${picked.length>1&&cues.length?'':' disabled'}>Crea le cue e apri l'editor</button></div>
    </div>`;
    const q=x=>s.querySelector(x);
    q('#hmClose').onclick=closeSheet;
    s.querySelectorAll('[data-hm-pos]').forEach(b=>b.onclick=()=>{const i=+b.dataset.hmPos,k=f.sel.indexOf(i);if(k>=0)f.sel.splice(k,1);else f.sel.push(i);paint()});
    q('#hmPattern').onchange=e=>{f.pattern=e.target.value;paint()};
    q('#hmStep').onchange=e=>{if(+e.target.value>0)f.step=+e.target.value;paint()};
    q('#hmUnit').onchange=e=>{f.unit=e.target.value;paint()};
    q('#hmStart').onchange=e=>{const t=parseCueTime(e.target.value);if(Number.isFinite(t))f.start=clamp(t,0,D);paint()};
    q('#hmEnd').onchange=e=>{const t=parseCueTime(e.target.value);if(Number.isFinite(t))f.end=clamp(t,0,D);paint()};
    q('#hmFade').onchange=e=>{f.fadePct=+e.target.value;paint()};
    q('#hmReplace').onchange=e=>{f.replace=e.target.checked};
    q('#hmRecap').onchange=e=>{f.recapture=e.target.checked;paint()};
    q('#hmGo').onclick=async()=>{
      const go=q('#hmGo'),st=q('#hmStatus');go.disabled=true;
      try{
        const n=await hmEnsureScenes(picked,f.recapture,p=>{st.textContent=`Cattura scena ${hmSceneId(p.position)}…`});
        if(n)showInfo(`${n} scene di posizione catturate in DMX Master.`);
        // base: la timeline di TD se la segue, altrimenti la bozza della Plancia
        const doc=isShowTimeline(w)&&showClock.authority?tdTimelineDoc():null;
        let list=doc?timelineFromTD(doc):parseCues(w).map(c=>({t:c.t,name:c.name,targets:cueTargets(c)}));
        if(f.replace)list=list.filter(c=>{const id=/@([^;]+)/.exec(c.targets||'')?.[1]?.trim();return!(c.t>=f.start&&c.t<f.end&&id&&cueIsHeads({sceneId:id}))});
        list=[...list,...hmCues({positions:picked,pattern:f.pattern,start:f.start,end:f.end,step:stepSec(),fadePct:f.fadePct})].sort((a,b)=>a.t-b.t);
        renderCueEditor(w,list,doc?{td:true,duration:Math.max(1,+doc.length||w.duration),bpm:+doc.bpm>0?+doc.bpm:null,rev:doc.rev,_dirty:true}:{td:false,_dirty:true});
      }catch(e){st.textContent='';go.disabled=false;showError('Movimento teste: '+e.message)}
    };
  };
  paint();
}
