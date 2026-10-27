/* ---------- timeline VIDEO di PatchDeck (GAIA_INTERFACE "OPS, 16", nota TD 41) ---------- */
// La esegue il bridge su OPS (video-timeline.js), non il tablet: qui si
// disegna e si modifica. Documento nel layout condiviso: L.videoTimeline =
// {active, cues:[{time, label, deck:'A'|'B'|'', patch, show, fx:{...}}]}.
// Interruttore proprio (VIDEO LIVE/TIMELINE): 'active' del clock vale solo
// per le luci. Fade = dissolvenza col deck_mix di PatchDeck (nel bridge).
const VIDEO_FX=[['edge','Edge'],['feedback','Feedback'],['fb_scale','FB scale'],['fb_blur','FB blur'],['mirror','Mirror']];
const VIDEO_SHOW={'':'invariato',A:'solo A',B:'solo B',AB:'A + B',none:'nessuno'};
let VIDEO_ST=null; // ultimo stato dal bridge {active, mqtt, clock, t, cue, label, deck}
const videoDoc=()=>L.videoTimeline&&Array.isArray(L.videoTimeline.cues)?L.videoTimeline:{active:false,cues:[]};
const pdDevice=()=>devIds('patchdeck')[0]||'td-pd-pc-win';
const pdPatches=()=>{const p=G.pdm[pdDevice()]?.patches;return Array.isArray(p)&&p.length?p:Array.from({length:42},(_,i)=>i+1)};
// nome e miniatura di una patch (patchdeck_matrix.patch_labels + patch_thumb/<n>)
function pdPatchInfo(n,dev=pdDevice()){
  const lab=G.pdm[dev]?.patch_labels,l=Array.isArray(lab)?lab[n-1]:lab?.[n]??lab?.[String(n)],t=G.pdThumb?.[dev]?.[n];
  return{label:l||t?.label||`patch ${n}`,img:t?.url||''};
}
function videoCueText(c){
  return[c.deck&&c.patch?`${c.deck} ← ${pdPatchInfo(c.patch).label}`:'',c.show?VIDEO_SHOW[c.show]+(+c.fade>0&&(c.show==='A'||c.show==='B')?` in ${+c.fade}s`:''):'',Object.keys(c.fx||{}).length?'FX':''].filter(Boolean).join(' · ');
}
// traccia video sotto le cue luci della timeline /show
function videoLaneHtml(w,D){
  const cues=[...videoDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const e=cues[i+1]?.time??D;
    return`<div class="tl-blk tl-vblk" style="left:${c.time/D*100}%;width:${Math.max(0,e-c.time)/D*100}%;--ic:${c.deck==='B'?SWATCH[4]:SWATCH[1]}"><span>${esc(c.label||'Video')}</span><em>${esc(videoCueText(c))}</em></div>`}).join('');
  return`<div class="tl-vhead"><span class="k">VIDEO</span>
    <button class="tl-live tl-vlive" data-act="vlive"${w.readonly?' disabled':''} title="VIDEO · TIMELINE: PatchDeck segue la timeline (la esegue il bridge su OPS). LIVE: comandi tu dal tablet">—</button>
    ${w.readonly?'':'<button class="tl-vcue" data-act="vcue" title="Cue video: deck, patch, cosa mostrare, effetti">CUE VIDEO</button>'}
    <span class="tl-vst"></span></div>
    <div class="tl-vlane"><div class="tl-cues">${blocks}</div><div class="tl-ph tl-vph"></div></div>`;
}
function toggleVideoActive(){
  const doc=videoDoc(),on=!!doc.active;
  if(!on&&!confirm('Il VIDEO segue la timeline?\nIl bridge manda subito a PatchDeck patch, deck ed effetti del tempo corrente.'))return;
  L.videoTimeline={...doc,active:!on};save();refreshShowTimelines();
  showInfo(on?'VIDEO LIVE: PatchDeck si comanda dal tablet.':'VIDEO TIMELINE: il bridge comanda PatchDeck secondo la timeline.');
}
function paintVideoLane(el,w,D,t){
  const b=el.querySelector('.tl-vlive');if(!b)return;
  const on=!!videoDoc().active,txt=on?'TIMELINE':'LIVE';
  if(b.textContent!==txt){b.textContent=txt;b.classList.toggle('is-tl',on);b.classList.toggle('is-live',!on)}
  const st=VIDEO_ST,msg=!st?'bridge: nessuno stato':!st.mqtt?'bridge senza MQTT':!st.clock?'nessun orologio dello show':
    on?(st.cue>=0?`cue ${st.cue+1}${st.label?' · '+st.label:''}`:'prima della prima cue'):'PatchDeck dal tablet';
  const s=el.querySelector('.tl-vst');if(s&&s.textContent!==msg)s.textContent=msg;
  const ph=el.querySelector('.tl-vph');if(ph&&D>0)ph.style.left=Math.max(0,Math.min(1,t/D))*100+'%';
}
function openVideoCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  cues=cues||videoDoc().cues.map(c=>({...c,fx:{...(c.fx||{})}}));
  const patches=pdPatches(),opt=(v,cur,t)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`;
  const rows=cues.map((c,i)=>`<div class="vcue-row" data-v="${i}">
    <label>Posizione<input class="vc-time" value="${esc(formatCueTime(+c.time||0))}" inputmode="decimal"></label>
    <label>Nome<input class="vc-label" value="${esc(c.label||'')}" placeholder="es. Intro video"></label>
    <label>Deck<select class="vc-deck">${opt('',c.deck,'—')}${opt('A',c.deck,'A')}${opt('B',c.deck,'B')}</select></label>
    <label>Patch<button type="button" class="vc-pbtn">${c.patch?`${pdPatchInfo(c.patch).img?`<img src="${pdPatchInfo(c.patch).img}" alt="">`:''}<span>${esc(pdPatchInfo(c.patch).label)}</span>`:'<span>— scegli —</span>'}</button><input type="hidden" class="vc-patch" value="${esc(c.patch??'')}"></label>
    <label>Mostra<select class="vc-show">${Object.entries(VIDEO_SHOW).map(([k,t])=>opt(k,c.show,t)).join('')}</select></label>
    <label>Fade (s)<input class="vc-fade" type="number" min="0" max="60" step="0.5" value="${+c.fade>0?+c.fade:''}" placeholder="stacco" title="Dissolvenza verso il deck mostrato (solo A o solo B); vuoto = stacco netto"></label>
    <button class="btn sm danger vc-del" title="Togli">×</button>
    <details class="vc-fx"${Object.keys(c.fx||{}).length?' open':''}><summary>Effetti (vuoto = invariato)</summary><div class="vc-fxs">${VIDEO_FX.map(([k,t])=>`<label>${t}<input class="vc-fxv" data-k="${k}" type="number" min="0" max="1" step="0.05" value="${c.fx?.[k]??''}"></label>`).join('')}</div></details>
  </div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline video">
    <div class="top"><h3>Timeline video · PatchDeck</h3><button class="btn ghost" id="vcClose">Chiudi</button></div>
    <p class="hint">Ogni cue, all'istante indicato, carica una <b>patch</b> su un <b>deck</b>, decide cosa si <b>vede</b> (A, B, entrambi) e imposta gli <b>effetti</b>. Come le scene, si sommano: un campo vuoto lascia com'era. Per vedere B senza scatti caricalo prima ("Mostra: invariato") e mostralo con una cue dopo. Con <b>Fade</b> (solo A o solo B) il passaggio è una dissolvenza col mix A/B di PatchDeck; vuoto = stacco netto. Le cue le esegue il bridge su OPS seguendo l'orologio dello show (durata ${formatCueTime(D)}).</p>
    <div class="vcue-list">${rows||'<p class="hint">Nessuna cue video.</p>'}</div>
    <div class="row"><button class="btn" id="vcAdd">＋ Aggiungi cue video</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="vcCancel">Annulla</button><button class="btn primary" id="vcSave">Salva</button></div>
  </div>`;
  const read=()=>[...s.querySelectorAll('.vcue-row')].map(r=>{
    const fx={};r.querySelectorAll('.vc-fxv').forEach(x=>{if(x.value.trim()!=='')fx[x.dataset.k]=Math.max(0,Math.min(1,+x.value))});
    const deck=r.querySelector('.vc-deck').value,patch=r.querySelector('.vc-patch').value;
    const fade=+r.querySelector('.vc-fade').value;
    return{time:parseCueTime(r.querySelector('.vc-time').value),label:r.querySelector('.vc-label').value.trim(),deck,patch:patch?+patch:null,show:r.querySelector('.vc-show').value||null,...(fade>0?{fade:Math.min(60,fade)}:{}),fx}});
  s.querySelector('#vcClose').onclick=s.querySelector('#vcCancel').onclick=closeSheet;
  // galleria delle patch (miniatura + nome) al posto del menu a tendina
  s.querySelectorAll('.vc-pbtn').forEach(btn=>btn.onclick=()=>{
    s.querySelector('.vc-gal')?.remove();
    const row=btn.closest('.vcue-row'),inp=row.querySelector('.vc-patch'),gal=document.createElement('div');gal.className='vc-gal';
    gal.innerHTML=`<div class="vc-gal-top"><b>Patch per il deck ${esc(row.querySelector('.vc-deck').value||'?')}</b><button type="button" class="btn sm ghost" data-g="x">Chiudi</button></div>
      <div class="vc-gal-grid"><button type="button" class="vc-gi" data-g=""><span>— nessuna —</span></button>${patches.map(n=>{const i=pdPatchInfo(n);
        return`<button type="button" class="vc-gi${String(n)===inp.value?' on':''}" data-g="${n}">${i.img?`<img src="${i.img}" alt="" loading="lazy">`:'<i></i>'}<span>${esc(i.label)}</span></button>`}).join('')}</div>`;
    row.after(gal);gal.scrollIntoView({block:'nearest'});
    gal.onclick=e=>{const g=e.target.closest('[data-g]');if(!g)return;if(g.dataset.g!=='x'){inp.value=g.dataset.g;const i=g.dataset.g?pdPatchInfo(+g.dataset.g):null;
      btn.innerHTML=i?`${i.img?`<img src="${i.img}" alt="">`:''}<span>${esc(i.label)}</span>`:'<span>— scegli —</span>'}gal.remove()};
  });
  s.querySelector('#vcAdd').onclick=()=>{const cur=read(),last=cur.reduce((m,c)=>Number.isFinite(c.time)?Math.max(m,c.time):m,-10);
    cur.push({time:Math.min(Math.max(0,D-1),last+10),label:`Video ${cur.length+1}`,deck:'A',patch:null,show:null,fx:{}});openVideoCueEditor(w,cur,meta)};
  s.querySelectorAll('.vc-del').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.closest('.vcue-row').dataset.v,1);openVideoCueEditor(w,cur,meta)});
  s.querySelector('#vcSave').onclick=()=>{
    const cur=read(),bad=cur.find(c=>!Number.isFinite(c.time)||c.time<0||c.time>=D);
    if(bad){showError(`Cue video "${bad.label||'?'}": posizione tra 0:00 e prima di ${formatCueTime(D)}.`);return}
    const noDeck=cur.find(c=>c.patch&&!c.deck);if(noDeck){showError(`Cue video "${noDeck.label}": scegli il deck per la patch.`);return}
    L.videoTimeline={...videoDoc(),cues:cur.sort((a,b)=>a.time-b.time).map(c=>({...c,deck:c.deck||'',show:c.show||null}))};
    save();refreshShowTimelines();closeSheet();showInfo(`Timeline video salvata: ${cur.length} cue.`);
  };
}
