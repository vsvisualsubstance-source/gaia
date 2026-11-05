/* ---------- traccia AUDIO della timeline dello show (la esegue il bridge: audio-timeline.js) ---------- */
// L.audioTimeline = {active, cues:[{time, label, fade, src:{kind:'track'|'playlist'|'stop', id}}]}
// Una cue suona un brano o una playlist (brani in fila, dissolvenza incrociata
// tra uno e l'altro) oppure sfuma e ferma; la cue dopo interrompe quella prima
// con la sua dissolvenza. Il bridge alterna i brani sui deck A e B del motore.
// Dichiarazioni function: il primo render avviene prima che i moduli siano valutati.
function audioDoc(){return L.audioTimeline&&Array.isArray(L.audioTimeline.cues)?L.audioTimeline:{active:false,cues:[]}}
function auTrackById(id){return AU.tracks.find(t=>t.id===id)||null}
function audioCueText(c){
  const k=c.src?.kind;
  if(k==='stop')return'■ Stop';
  if(k==='playlist'){const p=auPlaylist(c.src.id);return p?`▶ ${p.name} (${p.tracks.length})`:'▶ (playlist tolta)'}
  const t=auTrackById(c.src?.id);return t?t.title:(c.src?.id?(AU.tracks.length?'(brano non in libreria)':'brano'):'— scegli il brano —');
}
// durata di una cue (fino alla cue dopo al massimo), per disegnare il blocco
function audioCueLen(c){
  const k=c.src?.kind,f=Math.max(0,+c.fade||0);
  if(k==='stop')return f;
  if(k==='playlist'){const p=auPlaylist(c.src.id);if(!p)return 0;const ls=p.tracks.map(id=>auTrackById(id)?.seconds||0).filter(x=>x>0);
    return ls.reduce((s,l,i)=>s+l-(i?Math.min(f,l/2):0),0)}
  return auTrackById(c.src?.id)?.seconds||0;
}
function audioLaneHtml(w,D){
  if(!AU.tracks.length&&!AU.libState)auLoadLibrary().then(()=>refreshShowTimelines());
  const cues=[...audioDoc().cues].sort((a,b)=>a.time-b.time);
  const blocks=cues.map((c,i)=>{const nx=cues[i+1]?.time??D,len=audioCueLen(c),e=Math.min(nx,c.time+(len||nx-c.time));
    return`<div class="tl-blk tl-vblk" data-ci="${audioDoc().cues.indexOf(c)}" style="left:${c.time/D*100}%;width:${Math.max(.4,(e-c.time)/D*100)}%;--ic:${c.src?.kind==='stop'?'#5d6573':'#4fd18b'}"><span>${esc(c.label||audioCueText(c))}</span><em>${esc(c.label?audioCueText(c):(c.fade?`dissolvenza ${c.fade} s`:''))}</em></div>`}).join('');
  return`<div class="tl-trk"><div class="tl-vhead"><span class="k">AUDIO</span>
    <button class="tl-live tl-alive" data-act="alive"${w.readonly?' disabled':''} title="AUDIO · TIMELINE: il bridge suona brani e playlist sui deck A e B del motore secondo la timeline (comanda deck, fader e crossfader). LIVE: la Console Audio a mano">—</button>
    ${w.readonly?'':'<button class="tl-vcue" data-act="acue" title="Elenco delle cue audio">CUE</button>'}
    </div>
    <div class="tl-vlane tl-tlane" data-trk="audio"${w.readonly?'':' title="Tocca un punto per far partire un brano o una playlist, tocca un blocco per cambiarlo, trascinalo per spostarlo"'}><div class="tl-cues">${blocks}</div><span class="tl-vst tl-ast"></span><div class="tl-ph tl-aph"></div></div></div>`;
}
function paintAudioLane(el,w,D,t){
  const b=el.querySelector('.tl-alive');if(!b)return;
  const on=!!audioDoc().active,txt=on?'TIMELINE':'LIVE';
  if(b.textContent!==txt){b.textContent=txt;b.classList.toggle('is-tl',on);b.classList.toggle('is-live',!on)}
  const st=G.audioTlSt,msg=!st?'bridge: nessuno stato':!st.engine?'motore audio non collegato':!st.clock?'nessun orologio dello show':
    on?(st.seg>=0?st.label:'prima della prima cue'):'audio dalla Console';
  const s=el.querySelector('.tl-ast');if(s&&s.textContent!==msg)s.textContent=msg;
  const ph=el.querySelector('.tl-aph');if(ph&&D>0)ph.style.left=Math.max(0,Math.min(1,t/D))*100+'%';
}
async function toggleAudioActive(){
  const doc=audioDoc(),on=!!doc.active;
  if(!on&&!await uiConfirm('La musica segue la timeline?\nIl bridge comanda i deck A e B, i fader e il crossfader della Console Audio secondo il tempo dello show: quello che stai mixando a mano viene sostituito.',{ok:'TIMELINE'}))return;
  L.audioTimeline={...doc,active:!on};save();refreshShowTimelines();
  showInfo(on?'AUDIO LIVE: la Console Audio a mano.':'AUDIO TIMELINE: il bridge suona la traccia AUDIO.');
}
// brano: si scrive o si sceglie dall'elenco (titolo — artista); id nel data-id
const auTrackLabel=t=>`${t.title}${t.artist?' — '+t.artist:''}`;
function openAudioCueEditor(w,cues,meta={}){
  const D=meta.duration||timelineDuration(w),s=$('#scrim');s.hidden=false;
  if(!AU.tracks.length&&!AU.libState)auLoadLibrary().then(()=>{if(document.querySelector('.acue-row'))openAudioCueEditor(w,read(),meta)});
  cues=cues||audioDoc().cues.map(c=>({...c,src:{...(c.src||{})}}));
  const opt=(v,cur,t)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(t)}</option>`;
  const KINDS=[['track','Brano'],['playlist','Playlist'],['stop','Stop (sfuma e ferma)']];
  const rows=cues.map((c,i)=>{const k=c.src?.kind||'track',t=k==='track'?auTrackById(c.src?.id):null;
    return`<div class="vcue-row acue-row" data-v="${i}">
    <label>Posizione<input class="ac-time" value="${esc(formatCueTime(+c.time||0))}" inputmode="decimal"></label>
    <label>Nome<input class="ac-label" value="${esc(c.label||'')}" placeholder="es. Ingresso pubblico"></label>
    <label>Cosa<select class="ac-kind">${KINDS.map(([v,tx])=>opt(v,k,tx)).join('')}</select></label>
    <label class="ac-what">${k==='playlist'?`Playlist<select class="ac-pl">${opt('',c.src?.id,'— scegli —')}${AU.playlists.map(p=>opt(p.id,c.src?.id,`${p.name} (${p.tracks.length})`)).join('')}</select>`
      :k==='track'?`Brano<input class="ac-track" list="acTracks" data-id="${esc(c.src?.id||'')}" value="${esc(t?auTrackLabel(t):'')}" placeholder="scrivi per cercare">`:'<span class="hint">—</span>'}</label>
    <label>Dissolvenza (s)<input class="ac-fade" type="number" min="0" max="30" step="0.5" value="${+c.fade||0}"></label>
    <button class="btn sm danger ac-del" title="Togli">×</button></div>`}).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Timeline audio">
    <div class="top"><h3>Timeline audio</h3><button class="btn ghost" id="acClose">Chiudi</button></div>
    <p class="hint">Ogni cue, all'istante indicato, fa partire un <b>brano</b> o una <b>playlist</b> (i brani uno dopo l'altro, con la dissolvenza tra uno e l'altro) oppure <b>Stop</b>. Una cue interrompe la precedente con la sua dissolvenza. Il bridge alterna i brani sui deck A e B della Console Audio, a velocità naturale. Le playlist si preparano nella Console Audio.</p>
    <datalist id="acTracks">${AU.tracks.map(t=>`<option value="${esc(auTrackLabel(t))}"></option>`).join('')}</datalist>
    <div class="vcue-list">${rows||'<p class="hint">Nessuna cue audio.</p>'}</div>
    <div class="row"><button class="btn" id="acAdd">＋ Aggiungi cue audio</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="acCancel">Annulla</button><button class="btn primary" id="acSave">Salva</button></div>
  </div>`;
  const byLabel=new Map(AU.tracks.map(t=>[auTrackLabel(t),t.id]));
  function read(){return[...s.querySelectorAll('.acue-row')].map(r=>{const k=r.querySelector('.ac-kind').value,tr=r.querySelector('.ac-track'),pl=r.querySelector('.ac-pl');
    const id=k==='playlist'?pl?.value||'':k==='track'?(byLabel.get(tr?.value)||(!tr?.value?tr?.dataset.id:'')||''):'';
    return{time:parseCueTime(r.querySelector('.ac-time').value),label:r.querySelector('.ac-label').value.trim(),fade:Math.max(0,Math.min(30,+r.querySelector('.ac-fade').value||0)),
      src:k==='stop'?{kind:'stop'}:{kind:k,id}}})}
  s.querySelectorAll('.ac-kind').forEach(x=>x.onchange=()=>openAudioCueEditor(w,read(),meta));
  s.querySelectorAll('.ac-track').forEach(x=>x.onchange=()=>{const id=byLabel.get(x.value);if(id)x.dataset.id=id});
  s.querySelector('#acClose').onclick=s.querySelector('#acCancel').onclick=closeSheet;
  s.querySelector('#acAdd').onclick=()=>{const cur=read(),last=cur.reduce((m,c)=>Number.isFinite(c.time)?Math.max(m,c.time):m,-10);
    cur.push({time:Math.min(Math.max(0,D-1),last+10),label:'',fade:4,src:{kind:'track',id:''}});openAudioCueEditor(w,cur,meta)};
  s.querySelectorAll('.ac-del').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.closest('.acue-row').dataset.v,1);openAudioCueEditor(w,cur,meta)});
  s.querySelector('#acSave').onclick=()=>{
    const cur=read(),bad=cur.find(c=>!Number.isFinite(c.time)||c.time<0||c.time>=D);
    if(bad){showError(`Cue audio "${bad.label||audioCueText(bad)}": posizione tra 0:00 e prima di ${formatCueTime(D)}.`);return}
    const empty=cur.find(c=>c.src.kind!=='stop'&&!c.src.id);if(empty){showError(`Cue audio a ${formatCueTime(empty.time)}: scegli ${empty.src.kind==='playlist'?'la playlist':'il brano dall\'elenco'}.`);return}
    L.audioTimeline={...audioDoc(),cues:cur.sort((a,b)=>a.time-b.time)};
    save();refreshShowTimelines();closeSheet();showInfo(`Timeline audio salvata: ${cur.length} cue.${audioDoc().active?'':' Metti AUDIO in TIMELINE per farla suonare.'}`);
  };
}
