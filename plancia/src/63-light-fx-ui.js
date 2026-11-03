/* ---------- effetti sulle luci: libreria, editor, traccia EFFETTI ---------- */
// Libreria nel layout condiviso (L.lightFx); timeline L.fxTimeline = {cues: [{time,
// label, effects: [id...]}]} che va in show_timeline.effects. Dal vivo: dmx_effect
// {effect, bpm} / {stop: id} / null; stato dal topic dmx_effects (nota TD 59).
// Funzioni usate dal render della timeline: dichiarazioni function.
function lightFx(){return Array.isArray(L.lightFx)?L.lightFx:[]}
function fxDoc(){return L.fxTimeline&&Array.isArray(L.fxTimeline.cues)?L.fxTimeline:{cues:[]}}
function fxTdReady(){return tdParams().dmx_effects_state!==undefined||!!G.dxm['td-dmx-win']?.patch?.effects}
function fxState(){return tdParams().dmx_effects_state||null}
function fxLiveIds(){return new Set((fxState()?.live||[]).map(x=>x.id))}
const fxTd=fx=>{const o=JSON.parse(JSON.stringify(fx));delete o.template;return o};
function fxPlay(fx){if(!fxTdReady()){showError('DMX Master non offre ancora gli effetti (dmx_effect).');return}
  devCmd('td-dmx-win',{action:'set',param:'dmx_effect',value:{effect:fxTd(fx),bpm:liveBpm()}})}
function fxStop(id){devCmd('td-dmx-win',{action:'set',param:'dmx_effect',value:id?{stop:id}:null})}
// gruppi a cui un effetto puo' andare: quelli della Plancia (colore, livello, teste)
function fxGroups(){return groupsOf().map(g=>({id:g.group,label:groupLabel(g.group)}))}
function fxGroupLights(fx){
  const g=fx?.target?.group;if(!g)return Math.max(1,(fx?.target?.fixtures||[]).length||4);
  return Math.max(1,(L.fixtures||[]).filter(f=>f.group===g&&FIX_TYPES[f.type]?.ch).length||4);
}
function fxPaletteColors(name){
  for(const r of Object.values(G.dxm?.['td-dmx-win']?.rigs||{})){const c=r?.params?.dmx_palette?.colors?.[name];if(Array.isArray(c)&&c.length)return c}
  return null;
}
// anteprima: una fila di luci, intensita' e colore come le calcola DMX Master
function fxDraw(cv,fx,t,{bpm=liveBpm()}={}){
  const g=cv.getContext('2d'),W=cv.width,H=cv.height,n=Math.min(16,fxGroupLights(fx));
  g.fillStyle='#0b0e13';g.fillRect(0,0,W,H);
  const vals=fxSample(fx,t,n,bpm,fx.palette?fxPaletteColors(fx.palette):null),r=Math.min(W/(n*2.4),H/3);
  vals.forEach((v,k)=>{const x=W*(k+.5)/n,y=H/2,base=fx.channel==='color'?v.rgb||[1,1,1]:fx.channel==='white'?[1,1,1]:[1,.75,.35];
    const lv=fx.channel==='color'?1:Math.max(0,Math.min(1,v.w)),c=base.map(z=>Math.round(z*255*(.12+.88*lv)));
    g.fillStyle=`rgb(${c})`;g.shadowColor=`rgb(${c})`;g.shadowBlur=r*lv*1.2;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.shadowBlur=0});
}
function fxAnimateThumbs(el){const t=performance.now()/1000;el.querySelectorAll('canvas[data-fx-cv]').forEach(cv=>{const fx=lightFx().find(x=>x.id===cv.dataset.fxCv);if(fx)fxDraw(cv,fx,t)})}
function fxStatusText(){
  if(!fxTdReady())return'DMX Master non offre ancora gli effetti';
  const st=fxState(),live=st?.live||[],tl=st?.timeline?.ids||[];
  return live.length||tl.length?`▶ ${[...live.map(x=>x.name||x.id),...tl.map(id=>(lightFx().find(f=>f.id===id)?.name||id)+' (timeline)')].join(', ')}`:'nessun effetto';
}
// ---- widget: libreria degli effetti
function fxLibHtml(){
  const on=fxLiveIds();
  return`<div class="hm"><div class="hm-top"><span class="hint fx-st">${esc(fxStatusText())}</span>
      <button class="btn sm" data-fx="tap" title="Batti il tempo (3-4 colpi)">TAP <b class="fx-bpm">${liveBpm()}</b></button>
      <button class="btn sm" data-fx="stopall">■ Ferma tutti</button><button class="btn sm ghost" data-fx="new">+ Nuovo</button><button class="btn sm ghost" data-fx="reset" title="Rimette i template mancanti">Template</button></div>
    <div class="hm-grid fx-grid">${lightFx().map(f=>`<div class="lzs-tile${on.has(f.id)?' on':''}"><button class="lzs-go" data-fx="toggle" data-fx-v="${esc(f.id)}" title="Acceso/spento dal vivo (DMX Master)">
      <canvas data-fx-cv="${esc(f.id)}" width="160" height="44"></canvas><span>${esc(f.name)}</span><em>${esc(groupLabel(f.target?.group||'')||'luci scelte')}</em></button>
      <button class="lzs-ed" data-fx="edit" data-fx-v="${esc(f.id)}" title="Modifica">✎</button></div>`).join('')||'<p class="hint">Nessun effetto: tocca Template.</p>'}</div>
    <p class="hint">Tocca un effetto per accenderlo o spegnerlo dal vivo: ne puoi tenere accesi più insieme, sopra al look della scena. In timeline: traccia EFFETTI. Li calcola DMX Master per ogni luce.</p></div>`;
}
function fxDown(e,el,w){
  const b=e.target.closest('[data-fx]');if(!b)return;e.preventDefault();
  const a=b.dataset.fx,f=lightFx().find(x=>x.id===b.dataset.fxV);
  if(a==='tap'){const bpm=tapTempo();if(bpm)showInfo(`Tempo: ${bpm} BPM (per gli effetti che accendi da ora)`);return}
  if(a==='toggle'&&f){if(fxLiveIds().has(f.id)){fxStop(f.id);showInfo(`Effetto "${f.name}" spento.`)}else{fxPlay(f);showInfo(`Effetto "${f.name}" acceso.`)}}
  else if(a==='stopall'){fxStop(null);showInfo('Effetti dal vivo spenti.')}
  else if(a==='edit'&&f)openLightFxEditor(f);
  else if(a==='new')openLightFxEditor({...fxTemplates(fxGroups()[0]?.id||'front')[0],id:'efx-'+uid(),name:'Nuovo effetto',template:false},true);
  else if(a==='reset'){const have=new Set(lightFx().map(x=>x.id)),add=fxTemplates(fxGroups()[0]?.id||'front').filter(x=>!have.has(x.id));
    L.lightFx=[...lightFx(),...add];save();showInfo(add.length?`Aggiunti ${add.length} template.`:'Tutti i template ci sono già.')}
}
function openLightFxEditor(orig,isNew){
  const fx=JSON.parse(JSON.stringify(orig)),s=$('#scrim');s.hidden=false;
  fx.period={value:4,unit:'beats',...fx.period};fx.spread={phase:0,mirror:false,...fx.spread};
  const opt=(list,cur)=>list.map(([k,t])=>`<option value="${esc(k)}"${String(k)===String(cur??'')?' selected':''}>${esc(t)}</option>`).join('');
  const sl=(id,label,v,min,max,step)=>`<label class="ar-sl"><span>${label}<b id="${id}V">${(+v).toFixed(2)}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  const pals=fixturePaletteList().map(p=>p.name),hex=c=>'#'+c.map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
  const paint=()=>{
    // il gruppo dell'effetto resta scelto anche se il progetto aperto non ce l'ha
    const g0=fx.target?.group,groups=[...fxGroups(),...(g0&&!fxGroups().some(g=>g.id===g0)?[{id:g0,label:`${g0} (non nel progetto)`}]:[])],cols=fx.colors||[];
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Effetto luci">
      <div class="top"><h3>Effetto sulle luci</h3><button class="btn ghost" id="fxClose">Chiudi</button></div>
      <canvas id="fxPrev" width="560" height="90" class="fx-prev"></canvas>
      <label>Nome<input id="fxName" value="${esc(fx.name)}"></label>
      <div class="two"><label>Luci<select id="fxGroup">${opt(groups.map(g=>[g.id,g.label]),fx.target?.group)}</select></label>
        <label>Agisce su<select id="fxChan">${opt(FX_CHANNELS,fx.channel)}</select></label></div>
      <div class="two"><label>Forma<select id="fxShape">${opt(FX_SHAPES,fx.shape)}</select></label>
        <label>Un ciclo dura<span class="row"><input id="fxPer" type="number" min="0.1" step="0.25" value="${fx.period.value}" style="flex:1"><select id="fxUnit">${opt([['beats',`battiti (${liveBpm()} BPM)`],['s','secondi']],fx.period.unit)}</select></span></label></div>
      <div class="two">${sl('fxPhase','Sfasamento tra le luci (cicli)',fx.spread.phase,0,1,.01)}<label class="chk"><input id="fxMirror" type="checkbox"${fx.spread.mirror?' checked':''}> A specchio dal centro</label></div>
      <div class="two">${sl('fxMin','Minimo',fx.min??0,0,1,.01)}${sl('fxMax','Massimo',fx.max??1,0,1,.01)}</div>
      ${['square','pulse','random'].includes(fx.shape)?sl('fxDuty',fx.shape==='random'?'Probabilità che una luce si accenda':fx.shape==='pulse'?'Durata del colpo (frazione del ciclo)':'Acceso per (frazione del ciclo)',fx.duty??(fx.shape==='pulse'?.25:fx.shape==='random'?1:.5),.02,1,.01):''}
      ${fx.channel==='color'?`<label>Colori<span class="row fx-cols">${cols.map((c,i)=>`<input type="color" data-col="${i}" value="${hex(c)}"><button class="btn sm ghost" data-coldel="${i}">×</button>`).join('')}<button class="btn sm" id="fxColAdd">＋</button></span></label>
        <label>Oppure una palette dei rig<select id="fxPal">${opt([['','— colori qui sopra —'],...pals.map(p=>[p,p])],fx.palette||'')}</select></label>`:''}
      <p class="hint">L'effetto sta sopra al look della scena: livello del gruppo, master, strobo e blackout agiscono dopo. Lo sfasamento fa scorrere l'onda da una luce all'altra (in ordine di unità, poi da sinistra a destra); a specchio parte dal centro. Le teste accettano solo dimmer.</p>
      <div class="row"><button class="btn" id="fxTry">▶ Prova dal vivo</button><button class="btn" id="fxStopB">■ Ferma</button></div>
      <div class="cue-editor-actions">${isNew?'':'<button class="btn danger" id="fxDel">Elimina</button><button class="btn ghost" id="fxDup">Duplica</button>'}<button class="btn primary" id="fxSave">Salva</button></div>
    </div>`;
    const q=x=>s.querySelector(x);
    s.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{q('#'+r.id+'V').textContent=(+r.value).toFixed(2);read()});
    ['#fxName','#fxPer','#fxMirror'].forEach(id=>q(id).addEventListener('input',read));
    ['#fxGroup','#fxUnit','#fxPal'].forEach(id=>q(id)?.addEventListener('change',read));
    // forma e canale cambiano i campi mostrati
    ['#fxChan','#fxShape'].forEach(id=>q(id).addEventListener('change',()=>{read();if(fx.channel==='color'&&!fx.colors?.length&&!fx.palette)fx.colors=[[1,0,0],[0,0,1]];paint()}));
    s.querySelectorAll('[data-col]').forEach(i=>i.addEventListener('input',read));
    s.querySelectorAll('[data-coldel]').forEach(b=>b.onclick=()=>{read();fx.colors.splice(+b.dataset.coldel,1);paint()});
    if(q('#fxColAdd'))q('#fxColAdd').onclick=()=>{read();fx.colors=[...(fx.colors||[]),[1,1,1]];paint()};
    q('#fxClose').onclick=closeSheet;
    q('#fxTry').onclick=()=>{read();fxPlay(fx);showInfo(`Prova di "${fx.name}" (non salvato).`)};
    q('#fxStopB').onclick=()=>fxStop(fx.id);
    q('#fxSave').onclick=()=>{read();if(fx.template){fx.id='efx-'+uid();if(fx.name===orig.name)fx.name+=' (mio)'}delete fx.template;
      const list=[...lightFx()],i=list.findIndex(x=>x.id===fx.id);if(i<0)list.push(fx);else list[i]=fx;L.lightFx=list;if(fxDoc().cues.some(c=>(c.effects||[]).includes(fx.id)))tlMarkTd();save();closeSheet();showInfo(`Effetto "${fx.name}" salvato.`)};
    if(q('#fxDup'))q('#fxDup').onclick=()=>{read();openLightFxEditor({...JSON.parse(JSON.stringify(fx)),id:'efx-'+uid(),name:fx.name+' (copia)',template:false},true)};
    if(q('#fxDel'))q('#fxDel').onclick=async()=>{const used=fxDoc().cues.filter(c=>(c.effects||[]).includes(fx.id)).length;
      if(used&&!await uiConfirm(`"${fx.name}" è usato da ${used} cue della traccia EFFETTI. Eliminarlo?`,{ok:'Elimina'}))return;
      fxStop(fx.id);L.lightFx=lightFx().filter(x=>x.id!==fx.id);save();closeSheet()};
    const cv=q('#fxPrev'),t0=performance.now();
    const anim=()=>{if(!document.body.contains(cv))return;fxDraw(cv,fx,(performance.now()-t0)/1000);requestAnimationFrame(anim)};anim();
  };
  const read=()=>{const q=x=>s.querySelector(x);if(!q('#fxName'))return fx;
    fx.name=q('#fxName').value.trim()||'Effetto';fx.target={group:q('#fxGroup').value};fx.channel=q('#fxChan').value;fx.shape=q('#fxShape').value;
    fx.period={value:Math.max(.1,+q('#fxPer').value||4),unit:q('#fxUnit').value};fx.spread={phase:+q('#fxPhase').value,mirror:q('#fxMirror').checked};
    fx.min=+q('#fxMin').value;fx.max=+q('#fxMax').value;
    if(q('#fxDuty'))fx.duty=+q('#fxDuty').value;else delete fx.duty;
    if(fx.channel==='color'){fx.colors=[...s.querySelectorAll('[data-col]')].map(i=>[1,3,5].map(k=>+(parseInt(i.value.slice(k,k+2),16)/255).toFixed(3)));
      const p=q('#fxPal')?.value;if(p)fx.palette=p;else delete fx.palette}else{delete fx.colors;delete fx.palette}
    return fx};
  paint();
}
registerWidget('lightfx',{size:[8,6],label:'Effetti luci',showsValue:false,showsAddr:false,
  inner:()=>'<div class="hm-box"></div>',
  onPointer:fxDown,
  tick:(el)=>{
    const box=el.querySelector('.hm-box'),sig=JSON.stringify([lightFx().map(f=>[f.id,f.name,f.target]),[...fxLiveIds()],groupsOf().length]);
    if(box&&box._sig!==sig){box._sig=sig;box.innerHTML=fxLibHtml()}
    const st=el.querySelector('.fx-st'),txt=fxStatusText();if(st&&st.textContent!==txt)st.textContent=txt;
    const bp=el.querySelector('.fx-bpm');if(bp&&bp.textContent!==String(liveBpm()))bp.textContent=liveBpm();fxAnimateThumbs(el)},
  help:()=>['Effetti luci','Onde di dimmer o di colore che scorrono sulle luci di un gruppo, scintillio, inseguimento, strobo a tempo: li calcola DMX Master per ogni luce, sopra al look della scena. Tocca un effetto per accenderlo o spegnerlo dal vivo (anche più insieme), ✎ per modificarlo. In timeline: traccia EFFETTI.']});

// ---- traccia EFFETTI: in show_timeline.effects (ogni cue dice quali effetti suonano)
function fxLaneHtml(w,D){
  const cues=[...fxDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const e=cues[i+1]?.time??D,names=(c.effects||[]).map(id=>lightFx().find(f=>f.id===id)?.name||'?');
    return`<div class="tl-blk tl-vblk" data-ci="${fxDoc().cues.indexOf(c)}" style="left:${c.time/D*100}%;width:${Math.max(0,e-c.time)/D*100}%;--ic:${names.length?'#ffb23e':'#5d6573'}"><span>${esc(c.label||names[0]||'Nessuno')}</span><em>${esc(names.length?names.join(' + '):'nessun effetto')}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k">EFFETTI</span>
    ${w.readonly?'':'<button class="tl-vcue" data-act="fcue" title="Elenco delle cue degli effetti">CUE</button>'}
    </div><div class="tl-vlane tl-tlane" data-trk="fx"${w.readonly?'':' title="Tocca un punto: quali effetti suonano da lì. Tocca un blocco per cambiarli, trascinalo per spostarlo"'}><div class="tl-cues">${blocks}</div><span class="tl-vst tl-fst"></span><div class="tl-ph tl-fph"></div></div></div>`;
}
function paintFxLane(el,w,D,t){
  const s=el.querySelector('.tl-fst');if(!s)return;
  const st=fxState(),ids=st?.timeline?.ids||[],msg=ids.length?`▶ ${ids.map(id=>lightFx().find(f=>f.id===id)?.name||id).join(' + ')}`:fxDoc().cues.length?(L.tlTdDirty||!tdTimelineDoc()?.effects?.cues?.length?'da mandare: ⇪ TD':'in DMX Master'):w.readonly?'':'tocca qui per far partire degli effetti';
  if(s.textContent!==msg)s.textContent=msg;
  const ph=el.querySelector('.tl-fph');if(ph&&D>0)ph.style.left=Math.max(0,Math.min(1,t/D))*100+'%';
}
function openFxCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  cues=cues||fxDoc().cues.map(c=>({...c,effects:[...(c.effects||[])]}));
  const td=isShowTimeline(w)&&showClock.authority;
  const rows=cues.map((c,i)=>`<div class="vcue-row fcue-row" data-v="${i}">
    <label>Posizione<input class="fc-time" value="${esc(formatCueTime(+c.time||0))}" inputmode="decimal"></label>
    <label>Nome<input class="fc-label" value="${esc(c.label||'')}" placeholder="es. Ritornello"></label>
    <div class="fc-fx">${lightFx().map(f=>`<label class="chk"><input type="checkbox" value="${esc(f.id)}"${(c.effects||[]).includes(f.id)?' checked':''}> ${esc(f.name)}</label>`).join('')||'<span class="hint">Nessun effetto in libreria.</span>'}</div>
    <button class="btn sm danger fc-del" title="Togli">×</button></div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline effetti">
    <div class="top"><h3>Timeline effetti luci</h3><button class="btn ghost" id="fcClose">Chiudi</button></div>
    <p class="hint">Da ogni cue suonano <b>esattamente</b> gli effetti spuntati, fino alla cue dopo (nessuno spuntato = effetti spenti). Battiti al BPM della timeline (${+w.bpm||120}). ${td?'Salva li manda a DMX Master con la timeline.':'La timeline non segue DMX Master: vanno a TD col prossimo invio.'}</p>
    <div class="vcue-list">${rows||'<p class="hint">Nessuna cue di effetti.</p>'}</div>
    <div class="row"><button class="btn" id="fcAdd">＋ Aggiungi cue</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="fcCancel">Annulla</button><button class="btn primary" id="fcSave">${td?'Salva e invia a DMX Master':'Salva'}</button></div>
  </div>`;
  const read=()=>[...s.querySelectorAll('.fcue-row')].map(r=>({time:parseCueTime(r.querySelector('.fc-time').value),label:r.querySelector('.fc-label').value.trim(),
    effects:[...r.querySelectorAll('.fc-fx input:checked')].map(x=>x.value)}));
  s.querySelector('#fcClose').onclick=s.querySelector('#fcCancel').onclick=closeSheet;
  s.querySelector('#fcAdd').onclick=()=>{const cur=read(),last=cur.reduce((m,c)=>Number.isFinite(c.time)?Math.max(m,c.time):m,-10);
    cur.push({time:Math.min(Math.max(0,D-1),last+10),label:'',effects:[]});openFxCueEditor(w,cur,meta)};
  s.querySelectorAll('.fc-del').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.closest('.fcue-row').dataset.v,1);openFxCueEditor(w,cur,meta)});
  s.querySelector('#fcSave').onclick=()=>{
    const cur=read(),bad=cur.find(c=>!Number.isFinite(c.time)||c.time<0||c.time>=D);
    if(bad){showError(`Cue di effetti "${bad.label||'?'}": posizione tra 0:00 e prima di ${formatCueTime(D)}.`);return}
    L.fxTimeline={cues:cur.sort((a,b)=>a.time-b.time)};save();refreshShowTimelines();closeSheet();showInfo(`Effetti in timeline: ${cur.length} cue.`);
    if(td){const doc=tdTimelineDoc();if(doc){w.cues=serializeCues(timelineFromTD(doc));w.duration=Math.max(1,+doc.length||w.duration);if(+doc.bpm>0)w.bpm=+doc.bpm;w.tdBaseRev=doc.rev}sendTimelineToTD(w)}
  };
}
// campo effects di show_timeline: effetti usati + cue; null = traccia tolta; undefined = TD non li offre
function fxTimelineEffects(){
  if(!fxTdReady())return undefined;
  const cues=fxDoc().cues.filter(c=>Number.isFinite(+c.time));if(!cues.length)return null;
  const known=new Set(lightFx().map(f=>f.id)),used=new Set(cues.flatMap(c=>(c.effects||[]).filter(id=>known.has(id))));
  return{effects:lightFx().filter(f=>used.has(f.id)).map(fxTd),cues:cues.map(c=>({time:+c.time,effects:(c.effects||[]).filter(id=>used.has(id)),label:c.label||''}))};
}
// 2026-11-03: libreria degli effetti con i template (uiRev 12); la pagina e' "Sequenze ed effetti"
function migrateUiLightFx(){
  if((L.uiRev||0)>=12)return;
  if(!Array.isArray(L.lightFx))L.lightFx=fxTemplates(groupsOf().find(g=>g.kind==='chase')?.group||'front');
  L.uiRev=12;save();
}
