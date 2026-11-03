/* ---------- TAP tempo, chase a step: libreria, editor, traccia SEQUENZE ---------- */
// Formato e calcolo in 63-chase.js. Il BPM battuto (L.showBpm) vale per quello
// che gira dal vivo (chase e movimenti teste, anche gia' partiti); la timeline
// tiene il suo BPM. Funzioni usate dal render della timeline: dichiarazioni function.
function liveBpm(){return+L.showBpm>0?+L.showBpm:hmBpm()}
let TAPS=[];
function tapTempo(){
  const now=performance.now();if(TAPS.length&&now-TAPS[TAPS.length-1]>2000)TAPS=[];TAPS.push(now);
  const bpm=tapBpm(TAPS);if(!bpm)return null;
  L.showBpm=bpm;save();emit({type:'tempo',bpm},true);
  if(lzDev())devCmd(lzDevId(),{action:'set',param:'bpm',value:bpm});   // scene laser a tempo
  return bpm;
}
function chases(){return Array.isArray(L.chases)?L.chases:[]}
function chaseDoc(){return L.chaseTimeline&&Array.isArray(L.chaseTimeline.cues)?L.chaseTimeline:{cues:[]}}
function chasePlay(ch){emit({type:'chase',action:'play',chase:ch,bpm:liveBpm()},true)}
function chaseStop(){emit({type:'chase',action:'stop'},true)}
const chaseSceneColor=id=>{const sc=tdScenes().find(s=>s.id===id);return sc?tdSceneLook(sc).ic||'#8a92a0':'#5d6573'};
function chaseStatusText(){
  const st=G.chaseSt;if(!st)return'motore: nessuno stato dal bridge';
  if(!st.chase)return'fermo';
  return`▶ ${st.chase.name} · step ${st.step+1}/${st.steps} · ${st.bpm} BPM${st.missing?` · scena "${st.missing}" non in DMX Master`:''}`;
}
// chase pronti ricavati dal catalogo di DMX Master: colori (lenti e veloci), teste, strobo
function chaseTemplatesFromTD(){
  const sc=tdScenes(),only=(s,set)=>(s.categories||[]).length&&(s.categories||[]).every(c=>set.includes(c));
  const colors=sc.filter(s=>s.id!=='base'&&only(s,['rigs','palette'])),heads=sc.filter(s=>only(s,['heads']));
  const on=sc.find(s=>only(s,['strobe'])&&/on/i.test(s.id)),off=sc.find(s=>only(s,['strobe'])&&/off/i.test(s.id));
  const C=(id,name,steps,o)=>steps.length>1?[{id:'cht-'+id,name,steps:steps.map(s=>({scene:s.id})),hold:{value:4,unit:'beats'},fadePct:50,pingpong:false,...o}]:[];
  return[...C('colori','Colori',colors,{}),...C('colori-veloci','Colori veloci',colors,{hold:{value:1,unit:'beats'},fadePct:0}),
    ...C('teste','Teste avanti e indietro',heads,{hold:{value:8,unit:'beats'},fadePct:80,pingpong:true}),
    ...C('strobo','Strobo a colpi',on&&off?[on,off]:[],{hold:{value:1,unit:'beats'},fadePct:0})];
}
// ---- widget: libreria dei chase
function chaseLibHtml(){
  const run=G.chaseSt?.chase?.id;
  return`<div class="hm"><div class="hm-top"><span class="hint ch-st">${esc(chaseStatusText())}</span>
      <button class="btn sm" data-ch="tap" title="Batti il tempo (3-4 colpi)">TAP <b class="ch-bpm">${liveBpm()}</b></button>
      <button class="btn sm" data-ch="stop">■ Stop</button><button class="btn sm ghost" data-ch="new">+ Nuovo</button><button class="btn sm ghost" data-ch="tpl" title="Chase pronti fatti con le scene di DMX Master">Template</button></div>
    <div class="ch-list">${chases().map(c=>`<div class="ch-row${run===c.id?' on':''}"><button class="ch-go" data-ch="play" data-ch-v="${esc(c.id)}" title="Parte dal vivo (il motore su OPS richiama le scene)">
      <b>${esc(c.name)}</b><span class="ch-steps">${c.steps.map((s,i)=>`<i data-k="${i}" style="--ic:${chaseSceneColor(s.scene)}"></i>`).join('')}</span>
      <em>${c.steps.length} step · ${c.hold.value} ${c.hold.unit==='s'?'s':'battiti'} · fade ${c.fadePct??0}%${c.pingpong?' · avanti e indietro':''}</em></button>
      <button class="lzs-ed" data-ch="edit" data-ch-v="${esc(c.id)}" title="Modifica">✎</button></div>`).join('')||'<p class="hint">Nessun chase ancora. Tocca <b>Template</b> per averne di pronti fatti con le scene di DMX Master (colori, teste, strobo), oppure <b>+ Nuovo</b>.</p>'}</div>
    <p class="hint">Un chase richiama in sequenza scene di DMX Master, con fade. Dal vivo lo esegue il motore su OPS (tieni la timeline luci in LIVE); in timeline va nella traccia SEQUENZE e lo esegue DMX Master.</p></div>`;
}
function chaseDown(e,el,w){
  const b=e.target.closest('[data-ch]');if(!b)return;e.preventDefault();
  const a=b.dataset.ch,c=chases().find(x=>x.id===b.dataset.chV);
  if(a==='tap'){const bpm=tapTempo();if(bpm)showInfo(`Tempo: ${bpm} BPM`);const v=el.querySelector('.ch-bpm');if(v)v.textContent=liveBpm();return}
  if(a==='play'&&c){chasePlay(c);showInfo(`Chase "${c.name}" dal vivo.`)}
  else if(a==='stop'){chaseStop();showInfo('Chase fermato: resta l\'ultima scena.')}
  else if(a==='edit'&&c)openChaseEditor(c);
  else if(a==='tpl'){if(!tdScenes().length){showError('DMX Master non pubblica scene: collega Gaia.');return}
    const have=new Set(chases().map(x=>x.id)),add=chaseTemplatesFromTD().filter(x=>!have.has(x.id));
    L.chases=[...chases(),...add];save();showInfo(add.length?`Aggiunti ${add.length} chase: ${add.map(x=>x.name).join(', ')}.`:'I chase pronti ci sono già.')}
  else if(a==='new'){const sc=tdScenes();openChaseEditor({id:'ch-'+uid(),name:'Nuovo chase',steps:sc.slice(0,4).map(s=>({scene:s.id})),hold:{value:4,unit:'beats'},fadePct:50,pingpong:false},true)}
}
function openChaseEditor(orig,isNew){
  const ch=JSON.parse(JSON.stringify(orig)),s=$('#scrim');s.hidden=false;
  const scenes=tdScenes(),opt=(v,cur,t)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`;
  const paint=()=>{
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Chase">
      <div class="top"><h3>Chase a step</h3><button class="btn ghost" id="chClose">Chiudi</button></div>
      <label>Nome<input id="chName" value="${esc(ch.name)}"></label>
      <div class="ch-steps ch-prev">${ch.steps.map((st,i)=>`<i data-k="${i}" style="--ic:${chaseSceneColor(st.scene)}"></i>`).join('')}</div>
      <div class="vcue-list">${ch.steps.map((st,i)=>`<div class="vcue-row ch-step" data-i="${i}">
        <span class="ch-n">${i+1}</span>
        <label>Scena<select class="chs-scene">${scenes.some(x=>x.id===st.scene)?'':opt(st.scene||'',st.scene,st.scene?`${st.scene} (non in DMX Master)`:'— scegli —')}${scenes.map(x=>opt(x.id,st.scene,x.label||x.id)).join('')}</select></label>
        <label>Tiene<input class="chs-hold" type="number" min="0.1" step="0.25" value="${st.hold?.value??''}" placeholder="${ch.hold.value}"></label>
        <div class="row"><button class="btn sm" data-mv="-1"${i?'':' disabled'}>↑</button><button class="btn sm" data-mv="1"${i<ch.steps.length-1?'':' disabled'}>↓</button><button class="btn sm danger" data-del>×</button></div>
      </div>`).join('')||'<p class="hint">Nessuno step.</p>'}</div>
      <div class="row"><button class="btn" id="chAdd">＋ Step</button>${scenes.length?'':'<span class="hint">DMX Master non pubblica scene: collega Gaia.</span>'}</div>
      <div class="two"><label>Ogni step dura<span class="row"><input id="chHold" type="number" min="0.1" step="0.25" value="${ch.hold.value}" style="flex:1"><select id="chUnit">${opt('beats',ch.hold.unit,`battiti (${liveBpm()} BPM)`)}${opt('s',ch.hold.unit,'secondi')}</select></span></label>
        <label class="ar-sl"><span>Fade · % dello step<b id="chFadeV">${ch.fadePct??0}%</b></span><input type="range" id="chFade" min="0" max="100" step="5" value="${ch.fadePct??0}"></label></div>
      <label class="chk"><input id="chPing" type="checkbox"${ch.pingpong?' checked':''}> Avanti e indietro (1 2 3 2 1 …)</label>
      <p class="hint">Le scene si sommano a strati: uno step che tocca solo i colori lascia stare teste e strobo. Fade 0% = cambi secchi, 100% = sfuma per tutto lo step. "Tiene" vuoto = durata di default.</p>
      <div class="row"><button class="btn" id="chTry">▶ Prova dal vivo</button><button class="btn" id="chStopB">■ Stop</button></div>
      <div class="cue-editor-actions">${isNew?'':'<button class="btn danger" id="chDel">Elimina</button><button class="btn ghost" id="chDup">Duplica</button>'}<button class="btn primary" id="chSave">Salva</button></div>
    </div>`;
    const q=x=>s.querySelector(x);
    s.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{read();const i=+b.closest('.ch-step').dataset.i,j=i+ +b.dataset.mv;[ch.steps[i],ch.steps[j]]=[ch.steps[j],ch.steps[i]];paint()});
    s.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{read();ch.steps.splice(+b.closest('.ch-step').dataset.i,1);paint()});
    q('#chAdd').onclick=()=>{read();const last=ch.steps[ch.steps.length-1]?.scene,next=scenes[(scenes.findIndex(x=>x.id===last)+1)%Math.max(1,scenes.length)];ch.steps.push({scene:next?.id||''});paint()};
    q('#chFade').oninput=e=>{q('#chFadeV').textContent=e.target.value+'%'};
    q('#chClose').onclick=closeSheet;
    q('#chTry').onclick=()=>{read();if(!ch.steps.some(x=>x.scene)){showError('Chase: scegli almeno una scena.');return}chasePlay(ch);showInfo(`Prova di "${ch.name}" (non salvato).`)};
    q('#chStopB').onclick=()=>{chaseStop()};
    q('#chSave').onclick=()=>{read();if(!ch.steps.some(x=>x.scene)){showError('Chase: scegli almeno una scena.');return}
      const list=[...chases()],i=list.findIndex(x=>x.id===ch.id);if(i<0)list.push(ch);else list[i]=ch;L.chases=list;save();closeSheet();showInfo(`Chase "${ch.name}" salvato.`)};
    if(q('#chDup'))q('#chDup').onclick=()=>{read();openChaseEditor({...JSON.parse(JSON.stringify(ch)),id:'ch-'+uid(),name:ch.name+' (copia)'},true)};
    if(q('#chDel'))q('#chDel').onclick=()=>{const used=chaseDoc().cues.filter(c=>c.chase===ch.id).length;
      if(!confirm(`Eliminare "${ch.name}"?${used?`\nÈ usato da ${used} cue della traccia SEQUENZE.`:''}`))return;
      L.chases=chases().filter(x=>x.id!==ch.id);save();closeSheet()};
    // anteprima: lo step che sarebbe in corso adesso, al BPM dal vivo
    const t0=performance.now(),strip=q('.ch-prev');
    const anim=()=>{if(!document.body.contains(strip))return;
      const seq=chaseExpand(ch,0,600,liveBpm(),2000),t=(performance.now()-t0)/1000%Math.max(.1,seq.length?seq[seq.length-1].time:1);
      let cur=-1;for(const x of seq){if(x.time<=t)cur=x.step;else break}
      strip.querySelectorAll('i').forEach((n,k)=>n.classList.toggle('on',k===cur));requestAnimationFrame(anim)};anim();
  };
  const read=()=>{const q=x=>s.querySelector(x);if(!q('#chName'))return ch;
    ch.name=q('#chName').value.trim()||'Chase';ch.hold={value:Math.max(.1,+q('#chHold').value||4),unit:q('#chUnit').value};
    ch.fadePct=+q('#chFade').value;ch.pingpong=q('#chPing').checked;
    s.querySelectorAll('.ch-step').forEach((r,i)=>{const h=+r.querySelector('.chs-hold').value;ch.steps[i]={scene:r.querySelector('.chs-scene').value,...(h>0?{hold:{value:h,unit:ch.hold.unit}}:{})}});
    return ch};
  paint();
}
registerWidget('chase',{size:[8,6],label:'Chase',showsValue:false,showsAddr:false,
  inner:()=>'<div class="hm-box"></div>',
  onPointer:chaseDown,
  tick:(el)=>{
    const box=el.querySelector('.hm-box'),sig=JSON.stringify([chases(),G.chaseSt?.chase?.id||null,tdScenes().map(s=>s.id)]);
    if(box&&box._sig!==sig){box._sig=sig;box.innerHTML=chaseLibHtml()}
    const st=el.querySelector('.ch-st'),txt=chaseStatusText();if(st&&st.textContent!==txt)st.textContent=txt;
    const bp=el.querySelector('.ch-bpm');if(bp&&bp.textContent!==String(liveBpm()))bp.textContent=liveBpm();
    const run=G.chaseSt?.chase?.id;el.querySelectorAll('.ch-row').forEach(r=>{const on=r.querySelector('[data-ch-v]')?.dataset.chV===run;
      r.querySelectorAll('.ch-steps i').forEach((n,k)=>n.classList.toggle('on',on&&k===G.chaseSt.step))})},
  help:()=>['Chase','Sequenze di scene di DMX Master, come le scene a step di Daslight: ogni step tiene per un tempo (battiti o secondi) e ci arriva con un fade. Tocca un chase per farlo partire dal vivo, ✎ per modificarlo, TAP per battere il tempo. In timeline: traccia SEQUENZE.']});

// ---- traccia SEQUENZE della timeline dello show: in DMX Master diventa cue "⟳ …"
function chaseLaneHtml(w,D){
  const cues=[...chaseDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const e=cues[i+1]?.time??D,ch=chases().find(x=>x.id===c.chase);
    return`<div class="tl-blk tl-vblk" data-ci="${chaseDoc().cues.indexOf(c)}" style="left:${c.time/D*100}%;width:${Math.max(0,e-c.time)/D*100}%;--ic:${c.chase==='off'||!ch?'#5d6573':'#b18cff'}"><span>${esc(c.label||ch?.name||'Fermo')}</span><em>${esc(c.chase==='off'?'fermo':ch?`${ch.steps.length} step`:'(chase tolto)')}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k">SEQUENZE</span>
    ${w.readonly?'':'<button class="tl-vcue" data-act="ccue" title="Elenco delle cue dei chase">CUE SEQ</button>'}${!w.readonly&&isShowTimeline(w)&&showClock.authority?'<button class="tl-vcue" data-act="csend" title="Manda la timeline a DMX Master (i chase diventano cue)">⇪ TD</button>':''}
    </div><div class="tl-vlane tl-clane"${w.readonly?'':' title="Tocca un punto per far partire un chase da lì, tocca un blocco per cambiarlo"'}><div class="tl-cues">${blocks}</div><span class="tl-vst tl-cst"></span><div class="tl-ph tl-cph"></div></div></div>`;
}
function paintChaseLane(el,w,D,t){
  const s=el.querySelector('.tl-cst');if(!s)return;
  const n=chaseDoc().cues.length,inTd=(tdTimelineDoc()?.cues||[]).filter(isChaseCue).length;
  const msg=G.chaseSt?.chase?chaseStatusText():n?(inTd?`${inTd} cue in DMX Master`:'da mandare a DMX Master: ⇪ TD'):w.readonly?'':'tocca qui per far partire un chase';
  if(s.textContent!==msg)s.textContent=msg;
  const ph=el.querySelector('.tl-cph');if(ph&&D>0)ph.style.left=Math.max(0,Math.min(1,t/D))*100+'%';
}
// tocco sulla traccia: in un punto vuoto sceglie il chase che parte da li', su un blocco lo cambia o lo toglie
async function chaseLaneTap(w,t,ci){
  const doc=chaseDoc(),cue=ci>=0?doc.cues[ci]:null;
  if(!chases().length){showError('Nessun chase: crea quelli pronti con "Template" nella pagina Sequenze.');return}
  const at=Math.max(0,Math.min(timelineDuration(w)-.01,Math.round(t*2)/2));
  const pick=await uiChoose(cue?`Cue a ${formatCueTime(cue.time)}: ${chases().find(x=>x.id===cue.chase)?.name||'Fermo'}`:`Da ${formatCueTime(at)} parte…`,
    [...chases().map(x=>({label:x.name,value:x.id,on:cue?.chase===x.id})),{label:'■ Fermo',value:'off',on:cue?.chase==='off'},...(cue?[{label:'Togli questa cue',value:'__del',cls:'danger'}]:[])]);
  if(pick==null)return;
  const cues=doc.cues.map(c=>({...c}));
  if(pick==='__del')cues.splice(ci,1);else if(cue)cues[ci].chase=pick;else cues.push({time:at,label:'',chase:pick});
  L.chaseTimeline={cues:cues.sort((a,b)=>a.time-b.time)};save();refreshShowTimelines();
  showInfo(isShowTimeline(w)&&showClock.authority?'Traccia SEQUENZE cambiata: ⇪ TD per mandarla a DMX Master.':'Traccia SEQUENZE cambiata.');
}
// la timeline va a DMX Master con le cue dei chase rigenerate
function chaseSendTimeline(w){const doc=tdTimelineDoc();if(doc){w.cues=serializeCues(timelineFromTD(doc));w.duration=Math.max(1,+doc.length||w.duration);if(+doc.bpm>0)w.bpm=+doc.bpm;w.tdBaseRev=doc.rev}sendTimelineToTD(w)}
function openChaseCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  cues=cues||chaseDoc().cues.map(c=>({...c}));
  const opt=(v,cur,t)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`;
  const rows=cues.map((c,i)=>`<div class="vcue-row ccue-row" data-v="${i}">
    <label>Posizione<input class="cc-time" value="${esc(formatCueTime(+c.time||0))}" inputmode="decimal"></label>
    <label>Nome<input class="cc-label" value="${esc(c.label||'')}" placeholder="es. Ritornello chase"></label>
    <label>Chase<select class="cc-chase">${opt('off',c.chase,'■ Fermo')}${chases().map(x=>opt(x.id,c.chase,x.name)).join('')}</select></label>
    <button class="btn sm danger cc-del" title="Togli">×</button></div>`).join('');
  const td=isShowTimeline(w)&&showClock.authority;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline sequenze">
    <div class="top"><h3>Timeline sequenze (chase)</h3><button class="btn ghost" id="ccClose">Chiudi</button></div>
    <p class="hint">Ogni cue fa partire un <b>chase</b> fino alla cue successiva (o lo ferma). Battiti al BPM della timeline (${+w.bpm||120}). ${td?'Salva li manda a DMX Master insieme alla timeline: diventano cue "⟳ …" che esegue TD.':'La timeline non segue DMX Master: si salvano qui e vanno a TD col prossimo invio.'}</p>
    <div class="vcue-list">${rows||'<p class="hint">Nessuna cue di chase.</p>'}</div>
    <div class="row"><button class="btn" id="ccAdd">＋ Aggiungi cue</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="ccCancel">Annulla</button><button class="btn primary" id="ccSave">${td?'Salva e invia a DMX Master':'Salva'}</button></div>
  </div>`;
  const read=()=>[...s.querySelectorAll('.ccue-row')].map(r=>({time:parseCueTime(r.querySelector('.cc-time').value),label:r.querySelector('.cc-label').value.trim(),chase:r.querySelector('.cc-chase').value}));
  s.querySelector('#ccClose').onclick=s.querySelector('#ccCancel').onclick=closeSheet;
  s.querySelector('#ccAdd').onclick=()=>{const cur=read(),last=cur.reduce((m,c)=>Number.isFinite(c.time)?Math.max(m,c.time):m,-10);
    cur.push({time:Math.min(Math.max(0,D-1),last+10),label:'',chase:chases()[0]?.id||'off'});openChaseCueEditor(w,cur,meta)};
  s.querySelectorAll('.cc-del').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.closest('.ccue-row').dataset.v,1);openChaseCueEditor(w,cur,meta)});
  s.querySelector('#ccSave').onclick=()=>{
    const cur=read(),bad=cur.find(c=>!Number.isFinite(c.time)||c.time<0||c.time>=D);
    if(bad){showError(`Cue di chase "${bad.label||'?'}": posizione tra 0:00 e prima di ${formatCueTime(D)}.`);return}
    L.chaseTimeline={cues:cur.sort((a,b)=>a.time-b.time)};save();refreshShowTimelines();closeSheet();
    showInfo(`Sequenze salvate: ${cur.length} cue.`);
    if(td)chaseSendTimeline(w);
  };
}
// cue della timeline per DMX Master: quelle dei chase rigenerate, mai doppie
function withChaseCues(cues,w){
  const own=cues.filter(c=>!isChaseCue(c)),taken=new Set(own.map(c=>Math.round(c.time*100)));
  const gen=chaseTimelineCues(chaseDoc(),chases(),w.duration,+w.bpm||120).map(c=>{let k=Math.round(c.time*100);while(taken.has(k))k++;taken.add(k);return{...c,time:k/100}});
  return[...own,...gen].sort((a,b)=>a.time-b.time);
}
// 2026-11-03: pagina "Sequenze" (chase) dopo Regia (uiRev 10)
function migrateUiChase(){
  if((L.uiRev||0)>=10)return;
  if(!Array.isArray(L.chases))L.chases=[];
  const fresh=TPL.sequenze.pages()[0];
  if(!L.pages.some(p=>p.name===fresh.name)){const at=L.pages.findIndex(p=>p.name==='Regia')+1||L.pages.length;L.pages.splice(at,0,fresh)}
  L.uiRev=10;save();
}
