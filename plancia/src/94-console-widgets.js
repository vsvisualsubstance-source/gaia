/* ---------- widget da console: Luci (fixgrid) e pila di scene GO/BACK (cuestack) ---------- */
// fixgrid: tutte le luci DMX della patch come tessere col colore che escono
// davvero (dmx_output), selezione per luce/gruppo/pari/dispari e palette
// per fixture (93-fixture-colors.js). Le teste hanno il loro colore
// (programmatore, pagina Teste): qui si selezionano ma la palette non le tocca.
const FG_SEL=new Map(); // id widget -> Set id fixture (solo in memoria)
const FG_FILTER=new Map(); // id widget -> gruppo mostrato ('' = tutte)
const fgSel=w=>{if(!FG_SEL.has(w.id))FG_SEL.set(w.id,new Set());return FG_SEL.get(w.id)};
const fgFixtures=w=>{const g=FG_FILTER.get(w.id)||'';return(L.fixtures||[]).filter(f=>FIX_TYPES[f.type]?.ch&&(!g||f.group===g))};
function fgTileColor(f){
  const fb=fixtureOutput(f)?.record;
  if(fb?.rgbOut&&Math.max(...fb.rgbOut)>0){const m=Math.max(...fb.rgbOut);return{c:dmxHex(fb.rgbOut.map(v=>v/m)),k:fb.sent?Math.max(.25,m):.15}}
  if(fb&&fb.sent&&fb.intensity!=null)return{c:'#ffe9c4',k:Math.max(.15,fb.intensity)};
  return{c:'#3a404b',k:1};
}
function paintFixGrid(el,w,force){
  const box=el.querySelector('.fg');if(!box)return;
  const all=(L.fixtures||[]).filter(f=>FIX_TYPES[f.type]?.ch),list=fgFixtures(w),sel=fgSel(w),filter=FG_FILTER.get(w.id)||'';
  const groups=[...new Set(all.map(f=>f.group).filter(Boolean))];
  const sig=JSON.stringify([list.map(f=>[f.id,f.name,f.group,fixturePaletteOf(f),fixtureAudioOf(f),fixtureGainOf(f)]),[...sel],filter,groups,fixturePaletteList().length]);
  if(force||box._sig!==sig){
    box._sig=sig;
    const selF=all.filter(f=>sel.has(f.id)),chase=selF.filter(fixtureHasPalette),heads=selF.length-chase.length;
    const common=chase.length&&chase.every(f=>fixturePaletteOf(f)===fixturePaletteOf(chase[0]))?fixturePaletteOf(chase[0]):null;
    const aMode=chase.length&&chase.every(f=>fixtureAudioOf(f)===fixtureAudioOf(chase[0]))?fixtureAudioOf(chase[0]):null,
      aGain=chase.length&&chase.every(f=>fixtureGainOf(f)===fixtureGainOf(chase[0]))?fixtureGainOf(chase[0]):null;
    box.innerHTML=`<div class="fg-bar">
        <button class="pal-chip${!filter?' on':''}" data-fg-filter="">Tutte</button>${groups.map(g=>`<button class="pal-chip${filter===g?' on':''}" data-fg-filter="${esc(g)}">${esc(groupLabel(g))}</button>`).join('')}
        <span class="fg-sp"></span>
        <button class="pal-chip" data-fg-sel="all">Seleziona tutte</button><button class="pal-chip" data-fg-sel="odd">Dispari</button><button class="pal-chip" data-fg-sel="even">Pari</button><button class="pal-chip" data-fg-sel="none">Nessuna</button>
      </div>
      <div class="fg-tiles">${list.length?list.map(f=>{const pal=fixturePaletteOf(f);return`<button class="fg-tile${sel.has(f.id)?' on':''}" data-fg="${esc(f.id)}"><i class="fg-sw"></i><b>${esc(f.name)}</b><span>${esc(groupLabel(f.group))}${fixtureHasPalette(f)?` · ${esc(pal||'rig')}`:' · colore teste'}</span>${fixtureHasPalette(f)&&(fixtureAudioOf(f)!=='full'||fixtureGainOf(f)!==1)?`<em class="fg-aud" title="Audio di questa luce">♪ ${esc(AUDIO_MODE_SHORT[fixtureAudioOf(f)]||'')}${fixtureGainOf(f)!==1?' ×'+fixtureGainOf(f).toFixed(1):''}</em>`:''}</button>`}).join('')
        :'<p class="hint">Nessuna luce DMX nella patch: aggiungile dalla Pianta (pagina Palco).</p>'}</div>
      <div class="fg-foot">${!selF.length?'<p class="hint">Tocca una o più luci (o un gruppo + "Seleziona tutte"), poi una palette. Cambia solo il colore: livello, audio e strobo restano quelli del rig.</p>'
        :!chase.length?'<p class="hint">Hai selezionato solo teste mobili: il loro colore si sceglie dalla pagina Teste (programmatore).</p>'
        :`<p class="hint"><b>${chase.length} luci</b>${heads?` (${heads} teste escluse: colore dalla pagina Teste)`:''} · palette: ${esc(common===null?'diverse':common||'segue il rig')}</p>${paletteChipsHtml(common??'__mixed__',`fgPal-${w.id}`)}
        <p class="hint"><b>Audio</b> delle luci selezionate · modo: ${esc(aMode?AUDIO_MODE_IT[aMode]||aMode:'diversi')}</p>${audioControlsHtml(aMode,aGain,`fgAud-${w.id}`)}<p class="hint fg-msg"></p>`}</div>`;
  }
  // colori reali: aggiornati ad ogni giro, senza ricostruire le tessere
  box.querySelectorAll('[data-fg]').forEach(t=>{const f=all.find(x=>x.id===t.dataset.fg);if(!f)return;const {c,k}=fgTileColor(f);const sw=t.querySelector('.fg-sw');
    if(sw._c!==c+k){sw._c=c+k;sw.style.background=c;sw.style.opacity=String(.35+.65*k)}});
}
async function fixGridDown(e,el,w){
  const t=e.target,sel=fgSel(w),list=fgFixtures(w);
  const tile=t.closest('[data-fg]'),flt=t.closest('[data-fg-filter]'),bulk=t.closest('[data-fg-sel]'),pal=t.closest('[data-pal]'),aud=t.closest('[data-aud]');
  if(t.closest('[data-aud-gain]'))return; // il cursore si gestisce al rilascio (change)
  if(tile){sel.has(tile.dataset.fg)?sel.delete(tile.dataset.fg):sel.add(tile.dataset.fg)}
  else if(flt)FG_FILTER.set(w.id,flt.dataset.fgFilter);
  else if(bulk){const k=bulk.dataset.fgSel;if(k==='none')sel.clear();else{list.forEach((f,i)=>{if(k==='all'||(k==='odd'&&i%2===0)||(k==='even'&&i%2===1))sel.add(f.id);else if(k!=='all')sel.delete(f.id)})}}
  else if(aud){
    e.preventDefault();const targets=(L.fixtures||[]).filter(f=>sel.has(f.id)&&fixtureHasPalette(f));
    try{const r=await setFixturesAudio(targets,{audio:aud.dataset.aud});showInfo(`Audio: ${AUDIO_MODE_IT[aud.dataset.aud]||aud.dataset.aud} su ${r.done} luci${r.notInTd?` · ${r.notInTd} non ancora su DMX Master`:''}.`)}
    catch(err){showError('Audio luci: '+err.message)}
  }
  else if(pal){
    e.preventDefault();const targets=(L.fixtures||[]).filter(f=>sel.has(f.id)&&fixtureHasPalette(f)),msg=el.querySelector('.fg-msg');
    if(msg)msg.textContent='Mando a DMX Master…';
    try{const r=await setFixturesPalette(targets,pal.dataset.pal);
      showInfo(`Colore: ${pal.dataset.pal||'segue il rig'} su ${r.done} luci${r.notInTd.length?` · ${r.notInTd.length} non ancora su DMX Master (⇪ TD nel Palco)`:''}.`)}
    catch(err){showError('Colore luci: '+err.message)}
  }
  else return;
  e.preventDefault();paintFixGrid(el,w,true);
}

// cuestack: scene di DMX Master in pila. Tocca una riga = la prepari come
// PROSSIMA; GO la richiama (col fade attuale) e prepara la successiva;
// BACK richiama la precedente di quella attiva.
const CS_NEXT=new Map(); // id widget -> index scena preparata
function csState(w){
  const list=tdScenes(),act=tdActiveScene(tdParams())?.index??null,ai=list.findIndex(s=>s.index===act);
  let next=CS_NEXT.get(w.id);if(next==null||!list.some(s=>s.index===next))next=list[ai+1]?.index??list[0]?.index??null;
  return{list,act,ai,next};
}
function paintCueStack(el,w,force){
  const box=el.querySelector('.cs');if(!box)return;
  const {list,act,next}=csState(w),sig=JSON.stringify([list.map(s=>[s.index,s.label||s.id]),act,next,SH.fade.toFixed(1)]);
  if(!force&&box._sig===sig)return;box._sig=sig;
  box.innerHTML=list.length?`<div class="cs-list">${list.map(s=>{const look=tdSceneLook(s);return`<button class="cs-row${s.index===act?' act':''}${s.index===next?' nxt':''}" data-cs="${s.index}">
      <span class="cs-no">${s.index===act?'▶':s.index===next?'NEXT':String(s.index).padStart(2,'0')}</span><b>${esc(s.label||s.id)}</b><i style="background:${look.grad||'transparent'}"></i></button>`}).join('')}</div>
    <div class="cs-btns"><button class="btn cs-back" data-cs-act="back">◀ BACK</button><button class="btn primary cs-go" data-cs-act="go">GO ▶<small>fade ${SH.fade.toFixed(1)} s</small></button></div>`
    :'<p class="hint">Nessuna scena da DMX Master (non collegato o nessuna scena catturata: ▣ Scene nel Palco).</p>';
}
function cueStackDown(e,el,w){
  const row=e.target.closest('[data-cs]'),act=e.target.closest('[data-cs-act]');if(!row&&!act)return;e.preventDefault();
  const {list,ai,next}=csState(w);
  if(row)CS_NEXT.set(w.id,+row.dataset.cs);
  else if(act.dataset.csAct==='go'&&next!=null){fire('/dmx/scene',[next],w.oscChannel);const i=list.findIndex(s=>s.index===next);CS_NEXT.set(w.id,list[i+1]?.index??list[0].index)}
  else if(act.dataset.csAct==='back'&&ai>0){const prev=list[ai-1].index;fire('/dmx/scene',[prev],w.oscChannel);CS_NEXT.set(w.id,list[ai]?.index)}
  paintCueStack(el,w,true);
}

document.addEventListener('change',async e=>{const s=e.target.closest?.('[data-aud-gain^="fgAud-"]');if(!s)return;
  const wid=s.dataset.audGain.slice(6),sel=FG_SEL.get(wid);if(!sel)return;
  const targets=(L.fixtures||[]).filter(f=>sel.has(f.id)&&fixtureHasPalette(f));
  try{const r=await setFixturesAudio(targets,{audio_gain:+s.value});showInfo(`Guadagno audio ${(+s.value).toFixed(2)} su ${r.done} luci.`)}catch(err){showError('Audio luci: '+err.message)}});
document.addEventListener('input',e=>{const s=e.target.closest?.('[data-aud-gain]');if(!s)return;const b=s.parentElement.querySelector('b');if(b)b.textContent=(+s.value).toFixed(2)});

/* ---------- tipo di widget: fixgrid (luci (colori singoli)) ---------- */
registerWidget('fixgrid',{size:[10,6],label:'Luci',showsValue:false,showsAddr:false,
  inner:()=>'<div class="fg"></div>',
  onPointer:fixGridDown,
  tick:(el,w,{repaint})=>{if(repaint)paintFixGrid(el,w)},
  help:w=>['Luci e colori singoli','Ogni tessera è una luce col colore che esce davvero. Toccale per selezionarle (o scegli un gruppo + "Seleziona tutte", pari/dispari), poi tocca una palette: cambia solo il colore, livello e audio restano del rig. "Segue il rig" toglie la palette propria.']});

/* ---------- tipo di widget: cuestack (pila scene GO/BACK) ---------- */
registerWidget('cuestack',{size:[4,6],label:'Scene GO',showsValue:false,showsAddr:false,
  inner:()=>'<div class="cs"></div>',
  onPointer:cueStackDown,
  tick:(el,w,{repaint})=>{if(repaint)paintCueStack(el,w)},
  help:w=>['Pila scene (GO/BACK)','Le scene di DMX Master in ordine. ▶ = scena in uscita, NEXT = la prossima. Tocca una riga per prepararla come NEXT, poi GO la manda con il fade impostato. BACK torna alla scena precedente.']});
