/* ---------- palco da descrizione (Ollama su OPS, via bridge /api/stage-ai) ---------- */
// Il modello produce un PIANO COMPATTO {stage:{width,depth}, groups:[{type,
// count,row,group?}], notes}; qui lo si espande in fixture vere in modo
// deterministico (posizioni, nomi, gruppi, indirizzi DMX). Niente viene
// mandato a DMX Master da solo: si controlla nella Pianta, poi ⇪ TD.
const AI_ROWS={back:'fondo palco',mid:'centro palco',front:'bordo palco',truss:'americana',side_left:'lato sinistro',side_right:'lato destro',audience:'verso il pubblico',center:'centro'};
const AI_TYPES={par:'PAR / wash',bar:'Barra LED',mh:'Testa mobile',blinder:'Blinder',haze:'Haze',wall:'LED wall',laser:'Laser',speaker:'Cassa'};
const AI_PREFIX={par:'PAR',bar:'BAR',mh:'MH',blinder:'BLI',haze:'HAZ',wall:'LED WALL',laser:'LAS',speaker:'SPK'};
const AI_DEFAULT_GROUP={bar:'ledbar',mh:'mh',blinder:'blinder',haze:'haze',wall:'ledwall'};
const AI_GROUP_KIND={par:'chase',bar:'chase',blinder:'level',haze:'level'};

// opts: {stage:{trussHeight}, mode:'replace'|'add', existing:[fixture], knownGroups:[nome],
//        footprint:(type)=>canali (0 = non DMX)}
function expandStagePlan(plan,opts={}){
  const warnings=[],out=[],newGroups=[];
  const W=Math.min(40,Math.max(4,+plan?.stage?.width||12)),D=Math.min(30,Math.max(3,+plan?.stage?.depth||8));
  const truss=+opts.stage?.trussHeight||7,existing=opts.mode==='add'?(opts.existing||[]):[];
  const known=new Set(opts.knownGroups||[]),fp=opts.footprint||(()=>0);
  const groups=(Array.isArray(plan?.groups)?plan.groups:[]).filter(g=>AI_PREFIX[g?.type]&&+g.count>0);
  if(!groups.length)warnings.push('Il piano non contiene fixture riconosciute.');
  // numerazione dei nomi: continua dopo quelli che ci sono gia' (modalita' aggiungi)
  const num={};for(const f of existing){const m=/^([A-Z ]+?)\s*(\d+)$/.exec(f.name||'');if(m)num[m[1].trim()]=Math.max(num[m[1].trim()]||0,+m[2])}
  // indirizzi: per universo, dopo l'ultimo canale usato
  const used={};for(const f of existing){const n=fp(f.type);if(n&&f.universe>0)used[f.universe]=Math.max(used[f.universe]||0,(+f.address||1)+n-1)}
  let uni=1;const alloc=n=>{for(;;){const start=(used[uni]||0)+1;if(start+n-1<=512){used[uni]=start+n-1;return[uni,start]}uni++;if(uni>16)return[0,0]}};
  const rowCount={};let total=0;
  for(const g of groups){
    let count=Math.min(48,Math.round(+g.count));
    if(total+count>200){warnings.push('Oltre 200 fixture: piano troncato.');count=Math.max(0,200-total)}
    total+=count;
    const row=AI_ROWS[g.row]?g.row:'mid',k=rowCount[row]=(rowCount[row]||0)+1;
    let group=String(g.group||'').trim().toLowerCase();
    if(g.type==='mh'&&group&&group!=='mh'){warnings.push(`Teste "${group}": le teste sono un motore solo, messe in mh.`);group='mh'}
    if(!group||!/^[a-z][a-z0-9_]{1,15}$/.test(group))group=g.type==='par'?(row==='back'?'back':'front'):AI_DEFAULT_GROUP[g.type]||'';
    if(group&&AI_GROUP_KIND[g.type]&&!known.has(group)&&!newGroups.some(x=>x.group===group)){newGroups.push({group,kind:AI_GROUP_KIND[g.type],label:''});known.add(group)}
    const side=row==='side_left'?-1:row==='side_right'?1:0;
    for(let i=0;i<count;i++){
      const t=count>1?i/(count-1):.5;
      let x,y,z=null;
      if(side){x=side*(W/2+.5);y=1+(D-2)*t}
      else{x=count>1?-W/2+.8+(W-1.6)*t:0;
        y={back:.6,mid:D/2,front:D-.4,truss:D*.35,center:D/2,audience:D+1}[row];
        y+= (row==='front'||row==='audience'?-1:1)*(k-1)*.5}
      if(row==='truss')z=truss;
      if(g.type==='speaker'&&!side){x=(i%2?1:-1)*(W/2+1.2);y=D-1}
      const P=AI_PREFIX[g.type];num[P]=(num[P]||0)+1;
      const n=fp(g.type),[u,a]=n?alloc(n):[0,0];
      if(n&&!u)warnings.push('Universi esauriti: alcune fixture senza indirizzo.');
      out.push({type:g.type,name:`${P}${g.type==='wall'?' ':''}${num[P]}`,group,universe:u,address:a,x:+x.toFixed(2),y:+y.toFixed(2),...(z!=null?{z}:{}),...(g.type==='mh'||row==='truss'?{mountToTruss:true}:{})});
    }
  }
  return{stage:{width:W,depth:D},fixtures:out,newGroups,warnings};
}

// ---- UI (solo nel browser) ----
var lastAiPlan=null;
const pendingTD=()=>(L.fixtures||[]).filter(f=>FIX_TYPES[f.type]?.ch&&!f._synced).length;
// dmx_fixtures set = sostituisce TUTTA la patch di TD (nota 39) con le
// fixture DMX della Pianta, nello schema dell'editor (nota 17)
async function replacePatchInTD(){
  const list=(L.fixtures||[]).filter(f=>FIX_TYPES[f.type]?.ch).map(f=>({id:f.id,type:f.type,name:f.name,group:f.group,model:f.model,
    universe:f.universe,address:f.address,x:f.x,y:f.y,enabled:f.enabled!==false}));
  const before=(tdParams().dmx_fixtures||[]).length;
  if(!confirm(`Sostituire TUTTA la patch di DMX Master (${before} fixture) con le ${list.length} della Pianta?
Le fixture che ora sono in TD e non nella Pianta vengono tolte.`))return;
  const ids=new Set(list.map(f=>f.id));
  try{
    await tdSceneCommand('dmx_fixtures',list,()=>{const td=(tdParams().dmx_fixtures||[]).filter(x=>x.uid);return td.length===list.length&&td.every(x=>ids.has(x.uid))},12000);
    for(const f of L.fixtures)if(ids.has(f.id))f._synced=true;
    save();closeSheet();showInfo(`Patch di DMX Master sostituita: ${list.length} fixture.`);
  }catch(e){showError('Patch: '+e.message)}
}
function openStageAI(){
  const s=$('#scrim');s.hidden=false;
  const plan=lastAiPlan?.plan,canUndo=!!L.aiBackup;
  const preview=lastAiPlan?expandStagePlan(plan,{stage:L.stage,mode:lastAiPlan.mode,existing:L.fixtures,knownGroups:groupsOf().map(g=>g.group),footprint:t=>footprintFor(t)}):null;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Palco AI">
    <div class="top"><h3>✨ Palco da descrizione</h3><button class="btn ghost" id="aiClose">Chiudi</button></div>
    <p class="hint">Descrivi il palco a parole: dimensioni, quante luci, di che tipo e dove (americana, fondo, bordo, lati, verso il pubblico). Ollama (sul PC OPS) ne fa un piano; Plancia calcola posizioni, nomi, gruppi e indirizzi DMX. Niente va a DMX Master finché non controlli nella Pianta e premi ⇪ TD.</p>
    <label>Descrizione<textarea id="aiPrompt" rows="4" placeholder="es. Club, palco 10 per 6. Otto PAR sull'americana, quattro teste mobili sull'americana, due barre LED sul fondo, una haze e due blinder verso il pubblico.">${esc(lastAiPlan?.prompt||'')}</textarea></label>
    <div class="row ai-mode"><label class="chk"><input type="radio" name="aiMode" value="replace"${lastAiPlan?.mode!=='add'?' checked':''}> Sostituisci tutte le fixture</label>
      <label class="chk"><input type="radio" name="aiMode" value="add"${lastAiPlan?.mode==='add'?' checked':''}> Aggiungi a quelle che ci sono</label></div>
    <div class="row"><button class="btn primary" id="aiGen">✨ Genera con Ollama</button><span class="hint" id="aiStatus"></span></div>
    ${preview?`<div class="ai-plan">
      <h4>Piano · palco ${preview.stage.width} × ${preview.stage.depth} m · ${preview.fixtures.length} fixture <span class="hint">(${esc(lastAiPlan.model)}, ${lastAiPlan.seconds} s)</span></h4>
      <table class="ai-table"><tr><th>Tipo</th><th>Quante</th><th>Dove</th><th>Gruppo</th></tr>${(plan.groups||[]).map(g=>`<tr><td>${esc(AI_TYPES[g.type]||g.type)}</td><td>${g.count}</td><td>${esc(AI_ROWS[g.row]||g.row)}</td><td>${esc(g.group||'—')}</td></tr>`).join('')}</table>
      ${plan.notes?`<p class="hint">Ollama: ${esc(plan.notes)}</p>`:''}
      ${preview.newGroups.length?`<p class="hint warn">Gruppi nuovi da creare: ${preview.newGroups.map(g=>`<b>${esc(g.group)}</b> (${g.kind})`).join(', ')}. Li aggiungo alla lista; poi ▦ Gruppi → Salva e invia a TD.</p>`:''}
      ${preview.warnings.map(w=>`<p class="hint warn">${esc(w)}</p>`).join('')}
      <div class="row"><button class="btn primary" id="aiApply">Applica alla Pianta</button></div></div>`:''}
    ${pendingTD()?`<div class="ai-plan"><p class="hint">${pendingTD()} fixture della Pianta non sono ancora in DMX Master. <b>Aggiungi</b>: usa ⇪ TD nel Palco. <b>Sostituisci</b>: manda qui tutta la patch, così in TD non restano le fixture vecchie (con indirizzi sovrapposti). Attenzione: scene e preset delle teste fanno riferimento alle teste di prima.</p>
      <div class="row"><button class="btn" id="aiReplaceTD">⇪ Sostituisci la patch di DMX Master</button></div></div>`:''}
    ${canUndo?`<div class="row"><button class="btn ghost" id="aiUndo" title="Rimette le fixture e il palco di prima dell'ultima applicazione">↶ Annulla l'ultima applicazione</button></div>`:''}
  </div>`;
  s.querySelector('#aiClose').onclick=closeSheet;
  s.querySelector('#aiGen').onclick=async()=>{
    const prompt=s.querySelector('#aiPrompt').value.trim(),mode=s.querySelector('input[name="aiMode"]:checked').value;
    if(!prompt){showError('Scrivi prima la descrizione del palco.');return}
    const btn=s.querySelector('#aiGen'),st=s.querySelector('#aiStatus');btn.disabled=true;
    const t0=Date.now(),tick=setInterval(()=>st.textContent=`Ollama sta pensando… ${Math.round((Date.now()-t0)/1000)} s (di solito 30-60 s)`,1000);
    try{
      const r=await fetch('/api/stage-ai',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt})});
      const d=await r.json();if(!d.ok)throw new Error(d.error||'errore');
      lastAiPlan={prompt,mode,plan:d.plan,model:d.model,seconds:d.seconds};
      clearInterval(tick);openStageAI();
    }catch(e){clearInterval(tick);btn.disabled=false;st.textContent='';showError('Palco AI: '+e.message)}
  };
  if(s.querySelector('#aiApply'))s.querySelector('#aiApply').onclick=()=>{
    const p=expandStagePlan(lastAiPlan.plan,{stage:L.stage,mode:lastAiPlan.mode,existing:L.fixtures,knownGroups:groupsOf().map(g=>g.group),footprint:t=>footprintFor(t)});
    if(lastAiPlan.mode!=='add'&&(L.fixtures||[]).length&&!confirm(`Sostituire le ${(L.fixtures||[]).length} fixture della Pianta con le ${p.fixtures.length} del piano?\nSi può annullare con "↶ Annulla l'ultima applicazione".`))return;
    L.aiBackup={fixtures:JSON.parse(JSON.stringify(L.fixtures||[])),stage:JSON.parse(JSON.stringify(L.stage||{})),groups:L.groups?JSON.parse(JSON.stringify(L.groups)):null,ts:Date.now()};
    const made=p.fixtures.map(f=>{const x=mkFix(f.type,f.name,f.x,f.y,f.universe,f.address);x.group=f.group;if(f.z!=null)x.z=f.z;if(f.mountToTruss)x.mountToTruss=true;return x});
    L.stage={...(L.stage||stageDefaults()),width:p.stage.width,depth:p.stage.depth};
    L.fixtures=lastAiPlan.mode==='add'?[...(L.fixtures||[]),...made]:made;
    if(p.newGroups.length)L.groups=[...groupsOf().map(g=>({...g})),...p.newGroups.map(g=>({group:g.group,kind:g.kind,label:g.group}))];
    ensureStageData(L);save();render();closeSheet();
    showInfo(`${made.length} fixture nella Pianta.${p.newGroups.length?' Gruppi nuovi: ▦ Gruppi → Salva e invia a TD.':''} Controlla, poi ⇪ TD per mandarle a DMX Master.`);
  };
  if(s.querySelector('#aiReplaceTD'))s.querySelector('#aiReplaceTD').onclick=replacePatchInTD;
  if(s.querySelector('#aiUndo'))s.querySelector('#aiUndo').onclick=()=>{
    if(!confirm('Rimettere fixture, palco e gruppi di prima dell\'ultima applicazione?'))return;
    const b=L.aiBackup;L.fixtures=b.fixtures;L.stage=b.stage;if(b.groups)L.groups=b.groups;else delete L.groups;delete L.aiBackup;
    ensureStageData(L);save();render();closeSheet();showInfo('Pianta rimessa come prima.');
  };
}

if(typeof module==='object'&&module.exports){module.exports={expandStagePlan,AI_ROWS,AI_TYPES};}
