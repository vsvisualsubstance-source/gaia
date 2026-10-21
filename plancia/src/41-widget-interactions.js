/* ---------- interazione ---------- */
function bind(el,w){
  el.addEventListener('pointerdown',e=>{
    if(editing) return editDown(e,el,w);
    if(GAIA_TYPES.has(w.type)) return gBind(e,el,w);
    if(w.type==='label'||w.type==='meter'||w.type==='clock') return;
    const end=()=>{el.classList.remove('active','press');el.onpointermove=null;el.onpointerup=el.onpointercancel=null;save()};
    if(w.type==='stage'){const b=e.target.closest('[data-v]');if(b){w.view=b.dataset.v;el.querySelectorAll('.seg button').forEach(x=>x.setAttribute('aria-pressed',x===b));save()}
      else if(e.target.closest('[data-act="syncall"]'))syncAllFixtures();
      else if(e.target.closest('[data-act="importtd"]'))importFromTD();
      else if(e.target.closest('[data-act="resolve"]'))resolveDuplicates();
      else if(e.target.closest('[data-act="types"]'))syncTypesToTD();
      else if(e.target.closest('[data-act="groups"]'))openGroupEditor();
      else if(e.target.closest('[data-act="scenes"]'))openSceneEditor();
      else if(e.target.closest('[data-act="models"]'))openModelEditor();
      else if(e.target.closest('[data-act="stage-ai"]'))openStageAI();
      else if(w.view==='plot')stageDown(e,el,w);
      else if(e.target.closest('canvas'))(L.fixtures||[]).forEach(f=>{
        const state=wallVideoPlayers.get(f.id);
        if(f.type==='wall'&&state&&['blocked','error'].includes(state.status))retryWallVideo(f);
      });
      return}
    if(w.type==='timeline'){
      const b=e.target.closest('[data-act]'); if(b){e.preventDefault();if(b.dataset.act==='edit-cues')openCueEditor(w);else tlAct(w,b.dataset.act);return}
      const lane=e.target.closest('.tl-lane'); if(!lane)return;
      const block=e.target.closest('.tl-blk');
      if(block){
        if(isShowTimeline(w)&&showClock.authority){
          e.preventDefault();
          const cue=timelineCues(w)[+block.dataset.k];
          if(cue)showClockCommand(w,'cue',cue.index||(+block.dataset.k+1));
          return;
        }
        // sola lettura (pagina Show): il blocco salta alla cue, non si sposta
        if(w.readonly){e.preventDefault();const cue=parseCues(w)[+block.dataset.k];if(cue)seek(w,cue.t);return}
        e.preventDefault();el.setPointerCapture(e.pointerId);
        const cues=parseCues(w).map(c=>({t:c.t,name:c.name,targets:cueTargets(c)})),i=+block.dataset.k,r=lane.getBoundingClientRect(),startX=e.clientX,startT=cues[i]?.t??0;
        block.classList.add('dragging');
        const move=ev=>{const t=clamp(startT+(ev.clientX-startX)/r.width*w.duration,0,Math.max(0,w.duration-.01));block.style.left=t/w.duration*100+'%'};
        el.onpointermove=move;
        el.onpointerup=el.onpointercancel=ev=>{
          const delta=Math.abs(ev.clientX-startX);el.onpointermove=el.onpointerup=el.onpointercancel=null;
          if(delta<5){openCueEditor(w);return}
          cues[i].t=clamp(startT+(ev.clientX-startX)/r.width*w.duration,0,Math.max(0,w.duration-.01));
          w.cues=serializeCues(cues);save();refresh(w);
        };
        return;
      }
      e.preventDefault(); el.setPointerCapture(e.pointerId); const r=lane.getBoundingClientRect();
      const mv=ev=>seek(w,clamp((ev.clientX-r.left)/r.width)*timelineDuration(w)); mv(e); el.onpointermove=mv; el.onpointerup=el.onpointercancel=end; return;
    }
    if(w.type==='scenes'){
      if(e.target.closest('[data-act="manage-scenes"]')){e.preventDefault();openSceneEditor();return}
      if(w.mode==='head-presets'){
        const manage=e.target.closest('[data-act="manage-presets"]'),preset=e.target.closest('[data-head-preset]');
        if(manage){e.preventDefault();openHeadPresetEditor(w);return}
        if(preset){e.preventDefault();recallHeadPreset(w,+preset.dataset.headPreset);return}
        return;
      }
      const it=e.target.closest('[data-i]'); if(!it)return; e.preventDefault(); const i=+it.dataset.i;
      if(w.mode==='dmx-enum'){
        const info=tdEnumInfo(w),option=info.meta?.options?.[i];
        if(!info.id){showError('Nessun device DMX V8 pubblicato.');return}
        if(!info.meta||option===undefined){showError('Il parametro enum DMX V8 non è disponibile.');return}
        setDmxParam(info.id,info.meta.n,String(option));return;
      }
      if(w.mode==='multi'||w.mode==='head-select'){const a=items(w).map((_,k)=>Array.isArray(w.value)?(+w.value[k]||0):0);a[i]=a[i]?0:1;w.value=a;
        if(w.mode==='head-select')w.selectedHeads=(w.headValues||[]).filter((_,k)=>!!a[k]);
        paint(el,w);send(w)}
      else{w.value=-2;set(w,i)}
      save(); return;
    }
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    if(w.type==='color'){
      const sw=e.target.closest('[data-s]');
      if(sw){const [h,s]=rgb2hsv(...SWC[+sw.dataset.s]);w.value={h,s};paint(el,w);send(w);save();return}
      const disc=el.querySelector('.disc'),r=disc.getBoundingClientRect();
      const mv=ev=>{const dx=(ev.clientX-r.left)/r.width*2-1,dy=(ev.clientY-r.top)/r.height*2-1;
        w.value={h:((Math.atan2(dy,dx)/(2*Math.PI))+1)%1,s:clamp(Math.hypot(dx,dy))};paint(el,w);send(w)};
      el.classList.add('active'); mv(e); el.onpointermove=mv; el.onpointerup=el.onpointercancel=end; return;
    }
    const r=el.querySelector('.box').getBoundingClientRect();
    if(w.type==='button'){
      el.classList.add('press');
      set(w, w.mode==='toggle' ? (w.value>.5?0:1) : 1);
      el.onpointerup=el.onpointercancel=()=>{if(w.mode!=='toggle')set(w,0);end()};
      return;
    }
    const s={x:e.clientX,y:e.clientY,v:w.value};
    const move=ev=>{
      if(w.type==='fader'){const hz=w.w>w.h; set(w,clamp(hz?(ev.clientX-r.left)/r.width:1-(ev.clientY-r.top)/r.height))}
      else if(w.type==='knob'){set(w,clamp(s.v+((s.y-ev.clientY)+(ev.clientX-s.x)*.5)/220))}
      else if(w.type==='xy'){setXY(w,clamp((ev.clientX-r.left)/r.width),clamp(1-(ev.clientY-r.top)/r.height))}
    };
    el.classList.add('active'); if(w.type!=='knob') move(e);
    el.onpointermove=move; el.onpointerup=el.onpointercancel=end;
  });
}
function editDown(e,el,w){
  e.preventDefault(); e.stopPropagation(); select(w.id);
  el=elOf(w.id); el.setPointerCapture(e.pointerId);
  const rz=e.target.classList.contains('rs'), r=stage.getBoundingClientRect();
  const cw=r.width/COLS, ch=r.height/ROWS, s={x:w.x,y:w.y,w:w.w,h:w.h,px:e.clientX,py:e.clientY};
  el.onpointermove=ev=>{
    const dx=Math.round((ev.clientX-s.px)/cw), dy=Math.round((ev.clientY-s.py)/ch);
    if(rz){w.w=clamp(s.w+dx,1,COLS-w.x);w.h=clamp(s.h+dy,1,ROWS-w.y)}
    else{w.x=clamp(s.x+dx,0,COLS-w.w);w.y=clamp(s.y+dy,0,ROWS-w.h)}
    place(el,w); paint(el,w);
  };
  el.onpointerup=el.onpointercancel=()=>{el.onpointermove=el.onpointerup=el.onpointercancel=null;save();if((w.type==='scenes'||GAIA_TYPES.has(w.type))&&rz)refresh(w)};
}
stage.addEventListener('pointerdown',e=>{if(editing&&e.target===stage)select(null)});
function select(id){selId=id;stage.querySelectorAll('.w').forEach(n=>n.classList.toggle('sel',n.dataset.id===id));renderInsp()}

function freeSpot(wd,ht){
  const occ=Array.from({length:ROWS},()=>Array(COLS).fill(0));
  page().widgets.forEach(w=>{for(let y=w.y;y<w.y+w.h&&y<ROWS;y++)for(let x=w.x;x<w.x+w.w&&x<COLS;x++)occ[y][x]=1});
  for(let y=0;y<=ROWS-ht;y++)for(let x=0;x<=COLS-wd;x++){let ok=true;
    for(let j=y;j<y+ht&&ok;j++)for(let i=x;i<x+wd;i++)if(occ[j][i]){ok=false;break}
    if(ok)return[x,y]}
  return[0,0];
}
const EXTRA={gaia:{addr:''},patchdeck:{addr:'',deck:'a'},tddevice:{addr:'',fam:''},gaiadmx:{addr:''},scenes:{items:'Scena A\nScena B\nScena C\nScena D',value:0},color:{value:{h:0,s:0}},timeline:{...tlOpts(),addr:''},
  clock:{mode:'tod',addr:''},stage:{view:'render',addr:''},label:{addr:''}};
document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
  const t=b.dataset.add,[wd,ht]=DEF[t],[x,y]=freeSpot(wd,ht);
  const n=page().widgets.filter(w=>w.type===t).length+1;
  const w=W(t,x,y,wd,ht,{label:NAMES[t]+' '+n,addr:`/${t}/${n}`,color:SWATCH[page().widgets.length%SWATCH.length],value:t==='button'?0:.5,...(EXTRA[t]||{})});
  if(t==='timeline')w.addr='/show'+(n>1?n:'');
  page().widgets.push(w); save(); stage.appendChild(build(w)); select(w.id);
});
function addPage(){L.pages.push(P('Pagina '+(L.pages.length+1),[]));pi=L.pages.length-1;selId=null;save();render()}

/* ---------- ispettore ---------- */
function renderInsp(){
  insp.hidden=!editing; if(!editing)return;
  const w=selId&&findW(selId);
  if(!w){
    insp.innerHTML=`<h3>Pagina</h3><label>Nome<input id="pgName"></label>
      <div class="row"><button class="btn" id="pgAdd">Nuova pagina</button><button class="btn danger" id="pgDel">Elimina pagina</button></div>
      <p class="hint">Questa modalità modifica la griglia dei widget, non le fixture del palco. Trascina un widget per spostarlo, usa l'angolo per ridimensionarlo; ogni modifica si salva automaticamente.</p>
      <p class="hint">Da <code>⋯</code> trovi i template pronti: DMX, teste mobili, timeline, design del palco.</p>`;
    $('#pgName').value=page().name;
    $('#pgName').oninput=e=>{page().name=e.target.value||'Pagina';save();renderTabs()};
    $('#pgAdd').onclick=addPage;
    const del=$('#pgDel'); del.disabled=L.pages.length<2; let armed=false;
    del.onclick=()=>{if(!armed){armed=true;del.textContent='Conferma eliminazione';return}
      L.pages.splice(pi,1);pi=Math.max(0,pi-1);save();render()};
    return;
  }
  const T=w.type, hasAddr=!['label','stage','clock'].includes(T)&&!GAIA_TYPES.has(T)&&!(T==='scenes'&&['dmx-enum','head-presets'].includes(w.mode)), hasRange=['fader','knob','xy','meter','button'].includes(T), hasMidi=['fader','knob','button'].includes(T);
  const gaiaOscAddress=String(w.addr||'').startsWith('/gaia/');
  const missingOscChannel=w.oscChannel&&!C.oscChannels.some(c=>c.id===w.oscChannel);
  const enumDevice=T==='scenes'?(w.device||pickDev(w,'dmx')||''):'';
  const availableEnums=enumParams(enumDevice);
  const deviceOptions=T==='tddevice'?devIds(w.fam||''):devIds('');
  insp.innerHTML=`<h3>${NAMES[T]}</h3>
    <label>Etichetta<input id="fLabel"></label>
    ${hasAddr?`<label>${T==='timeline'?'Indirizzo base OSC':'Indirizzo OSC'}<input id="fAddr" class="mono" spellcheck="false" autocapitalize="off"></label>`:''}
    ${hasAddr&&!gaiaOscAddress?`<label>Canale OSC<select id="fOscChannel"><option value="">Predefinito · ${esc(C.host)}:${C.port}</option>${C.oscChannels.map(c=>`<option value="${esc(c.id)}">${esc(oscChannelName(c))}</option>`).join('')}${missingOscChannel?`<option value="${esc(w.oscChannel)}">Non configurato · ${esc(w.oscChannel)}</option>`:''}</select></label>
      ${missingOscChannel?'<p class="hint">Questo layout riferisce un canale assente su questo browser. Configuralo in Impostazioni o scegli un altro canale.</p>':''}
      <p class="hint">La famiglia e l’istanza identificano la destinazione; indirizzo e argomenti restano quelli definiti dal contratto del progetto TD.</p>`:''}
    ${hasAddr&&gaiaOscAddress?'<p class="hint">Questo indirizzo usa il canale Gaia dedicato (/gaia/), non un canale OSC personalizzato.</p>':''}
    ${hasRange?`<div class="two"><label>${T==='button'?'Valore OFF':'Min'}<input id="fMin" type="number" step="any"></label><label>${T==='button'?'Valore ON':'Max'}<input id="fMax" type="number" step="any"></label></div>`:''}
    ${T==='button'?`<label>Comportamento<select id="fMode"><option value="push">Momentaneo</option><option value="toggle">Interruttore</option></select></label>`:''}
    ${T==='scenes'?`${!['dmx-enum','head-presets'].includes(w.mode)?'<label>Voci (una per riga)<textarea id="fItems"'+(w.mode==='head-select'?' disabled':'')+'></textarea></label>':''}<div class="two"><label>Modalità<select id="fSMode"><option value="push">Una attiva</option><option value="multi">Selezione multipla</option><option value="head-select">Selezione teste TD</option><option value="dmx-enum">Parametro enum DMX V8</option><option value="head-presets">Preset PTZ salvati</option></select></label><label>Colonne<input id="fCols" type="number" min="0" max="12" placeholder="auto"></label></div>
      ${w.mode==='dmx-enum'?`<label>Device DMX V8<select id="fTdDevice"><option value="">Automatico</option>${devIds('dmx').map(id=>`<option value="${esc(id)}"${id===w.device?' selected':''}>${esc(id)}</option>`).join('')}</select></label>
        <label>Parametro enum<select id="fTdParam"><option value="">Automatico · palette preferita</option>${[['Palette dei rig',availableEnums.filter(p=>/_palette$/.test(p.n))],['Altri parametri',availableEnums.filter(p=>!/_palette$/.test(p.n))]].filter(([,l])=>l.length).map(([g,l])=>`<optgroup label="${g}">${l.map(p=>`<option value="${esc(p.n)}"${p.n===w.param?' selected':''}>${esc(p.label)} · ${esc(p.n)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <p class="hint">Le voci arrivano dalla matrice <code>dmx_matrix</code>; il click invia al device il valore originale dell'enum via MQTT. Nessuna opzione o stato viene inventato.</p>`
        :w.mode==='head-presets'?'<p class="hint">I preset PTZ si gestiscono dal widget in modalità normale. Sono snapshot locali condivisi nel layout; non sono preset interni al motore TD.</p>'
        :'<p class="hint">Invia l’indice della voce (0, 1, 2…) oppure, in selezione multipla, un elenco di 0 e 1.</p>'}`:''}
    ${T==='timeline'?`<div class="two"><label class="chk"><input id="fReadonly" type="checkbox"> Sola lettura: si esegue, le cue si modificano nella pagina Timeline</label><label>Durata (s)<input id="fDur" type="number" min="10"></label><label>BPM<input id="fBpm" type="number" min="40" max="240"></label></div>
      <label>Cue<textarea id="fCues" spellcheck="false" style="min-height:180px"></textarea></label>
      <button class="btn" id="fCueEditor">Apri editor cue</button>
      <label>Device DMX V8 per le cue<select id="fTLDmxDevice"><option value="">Automatico</option>${devIds('dmx').map(id=>`<option value="${esc(id)}"${id===w.dmxDevice?' selected':''}>${esc(id)}</option>`).join('')}</select></label>
      <p class="hint">Usa l’editor cue per aggiungere, spostare e riordinare le cue locali. Le modifiche si salvano nel layout condiviso OPS; “Aggiorna” in ⋯ → Progetti aggiorna anche lo snapshot nominato. Se DMX Master pubblica un clock attivo, la timeline /show lo segue e invia i comandi al master.</p>`:''}
    ${T==='clock'?`<label>Modalità<select id="fCMode"><option value="tod">Ora del giorno</option><option value="show">Timecode show (25 fps)</option><option value="countdown">Countdown a orario</option></select></label>
      <label>Orario di fine<input id="fTarget" type="time"></label>`:''}
    ${T==='stage'?`<label>Vista<select id="fView"><option value="render">Render</option><option value="plot">Pianta e patch</option></select></label>
      <h4>Dimensioni reali (m)</h4><div class="two">
        <label>Larghezza palco<input id="stWidth" type="number" min="2" max="60" step="0.1"></label>
        <label>Profondità palco<input id="stDepth" type="number" min="2" max="60" step="0.1"></label>
        <label>Quota piano palco<input id="stFloor" type="number" min="0" max="20" step="0.1"></label>
        <label>Altezza truss<input id="stTruss" type="number" min="1" max="30" step="0.1"></label></div>
      <details><summary>Aree: platea e FOH</summary><div class="two">
        <label>Platea X (centro)<input id="audX" type="number" step="0.1"></label>
        <label>Platea Y (inizio)<input id="audY" type="number" step="0.1"></label>
        <label>Platea larghezza<input id="audW" type="number" min="1" step="0.1"></label>
        <label>Platea profondità<input id="audD" type="number" min="1" step="0.1"></label>
        <label>FOH X (centro)<input id="fohX" type="number" step="0.1"></label>
        <label>FOH Y<input id="fohY" type="number" step="0.1"></label>
        <label>FOH larghezza<input id="fohW" type="number" min="0.5" step="0.1"></label>
        <label>FOH profondità<input id="fohD" type="number" min="0.5" step="0.1"></label></div></details>
      <p class="hint">La Pianta si modifica fuori da “Modifica griglia”: trascina una fixture per spostarla, toccala per le proprietà, tocca uno spazio vuoto per aggiungerne una. Geometria e sorgente LED si salvano automaticamente su OPS. “⇪ TD” è un invio separato e riguarda solo le fixture DMX; LED wall, casse e laser restano gestiti da Plancia.</p>`:''}
    ${GAIA_TYPES.has(T)&&T!=='gaia'?`<label>${T==='gaiadmx'?'Stanza':'Device'}<select id="gDev"><option value="">Automatico</option>${(T==='gaiadmx'?Object.keys(G.dmx).sort():deviceOptions).map(x=>`<option value="${esc(x)}"${x===(T==='gaiadmx'?w.stanza:w.device)?' selected':''}>${esc(x)}</option>`).join('')}</select></label>`:''}
    ${T==='patchdeck'?`<label>Deck<select id="gDeck"><option value="a">Deck A</option><option value="b">Deck B</option></select></label>`:''}
    ${T==='tddevice'?`<label>Tipo di device (per la scelta automatica)<select id="gFam"><option value="">Qualsiasi</option><option value="patchdeck">PatchDeck</option><option value="mixeraudio">Controller (mixeraudio)</option><option value="dmx">DMX V8</option></select></label>`:''}
    ${T==='gaia'?`<label>Stanza della chat<input id="gSt2" class="mono"></label><p class="hint">I messaggi vanno su <code>gaia/voice/command/&lt;stanza&gt;</code> come un comando vocale. I tasti − e + spostano il mood via <code>gaia/touchdesigner/mood</code>: in Admin → Automazioni va acceso "touchdesignerMood".</p>`:''}
    ${GAIA_TYPES.has(T)&&T!=='gaia'?'<p class="hint">Device e stanze compaiono qui quando pubblicano il loro stato sul broker di Gaia.</p>':''}
    ${hasMidi?`<div class="two"><label>MIDI canale<input id="fCh" type="number" min="1" max="16"></label><label>MIDI CC<input id="fCc" type="number" min="0" max="127" placeholder="off"></label></div>`:''}
    <label>Colore</label><div class="sw">${SWATCH.map(c=>`<button class="swb" data-c="${c}" style="--c:${c}" aria-label="Colore ${c}" aria-pressed="${c===w.color}"></button>`).join('')}</div>
    <div class="row"><button class="btn" id="fDup">Duplica</button><button class="btn danger" id="fDel">Elimina</button></div>
    ${T==='meter'?'<p class="hint">L\'indicatore riceve soltanto: si muove quando arriva OSC su questo indirizzo.</p>':''}`;
  const on=(id,fn,ev='input',rebuild=true)=>{const n=$(id);if(n)n.addEventListener(ev,e=>{fn(e.target.type==='checkbox'?e.target.checked:e.target.value);save();if(rebuild)refresh(w)})};
  const val=(id,v)=>{const n=$(id);if(n){if(n.type==='checkbox')n.checked=!!v;else n.value=v??''}};
  val('#fLabel',w.label); on('#fLabel',v=>w.label=v);
  if(hasAddr){val('#fAddr',w.addr); on('#fAddr',v=>w.addr=v.trim())}
  if($('#fOscChannel')){val('#fOscChannel',w.oscChannel||'');on('#fOscChannel',v=>w.oscChannel=v,'change')}
  if(hasRange){val('#fMin',w.min);val('#fMax',w.max);on('#fMin',v=>{if(v!==''&&!isNaN(v))w.min=+v});on('#fMax',v=>{if(v!==''&&!isNaN(v))w.max=+v})}
  if(T==='button'){val('#fMode',w.mode);on('#fMode',v=>{w.mode=v;w.value=0},'change')}
  if(T==='scenes'){val('#fItems',w.items);val('#fSMode',w.mode||'push');val('#fCols',w.cols||'');
    on('#fItems',v=>w.items=v);$('#fSMode').addEventListener('change',e=>{
      const old=w.mode;w.mode=e.target.value;w.value=w.mode==='multi'||w.mode==='head-select'?[]:0;
      if(w.mode==='head-select'){w.addr='/mh/select/heads';w.headValues=[];w.selectedHeads=[];delete w._headsInitialized;syncHeadSelectors()}
      else if(old==='head-select'&&w.addr==='/mh/select/heads')w.addr='/mh/select';
      if(w.mode==='dmx-enum'){w.addr='';w.device=w.device||'';w.param=w.param||''}
      if(w.mode==='head-presets'){w.addr='';w.headPresets=w.headPresets||[]}
      else if(old==='head-presets'&&!w.addr)w.addr='/mh/preset/recall';
      save();refresh(w);renderInsp();
    });on('#fCols',v=>w.cols=+v||0);
    if($('#fTdDevice'))$('#fTdDevice').addEventListener('change',e=>{w.device=e.target.value;
      if(w.param&&!enumParams(w.device||pickDev(w,'dmx')).some(p=>p.n===w.param))w.param='';
      save();refresh(w);renderInsp()});
    if($('#fTdParam'))$('#fTdParam').addEventListener('change',e=>{w.param=e.target.value;save();refresh(w);renderInsp()});
  }
  if(T==='timeline'){val('#fDur',w.duration);val('#fBpm',w.bpm);val('#fCues',w.cues);
    on('#fDur',v=>{if(+v>=10)w.duration=+v});on('#fBpm',v=>{if(+v>0)w.bpm=+v});on('#fCues',v=>w.cues=v);
    if($('#fCueEditor'))$('#fCueEditor').onclick=()=>openCueEditor(w);
    if($('#fReadonly')){$('#fReadonly').checked=!!w.readonly;$('#fReadonly').onchange=e=>{w.readonly=e.target.checked;save();refresh(w)}}
    if($('#fTLDmxDevice'))$('#fTLDmxDevice').addEventListener('change',e=>{w.dmxDevice=e.target.value;save();renderInsp()})}
  if(T==='clock'){val('#fCMode',w.mode);val('#fTarget',w.target||'23:30');on('#fCMode',v=>w.mode=v,'change');on('#fTarget',v=>w.target=v)}
  if(T==='stage'){
    val('#fView',w.view);on('#fView',v=>w.view=v,'change');
    const st=L.stage;
    const stageFields=[
      ['#stWidth',st,'width',2,60],['#stDepth',st,'depth',2,60],['#stFloor',st,'floorHeight',0,20],['#stTruss',st,'trussHeight',1,30],
      ['#audX',st.audience,'x',-100,100],['#audY',st.audience,'y',-100,200],['#audW',st.audience,'width',1,200],['#audD',st.audience,'depth',1,200],
      ['#fohX',st.foh,'x',-100,100],['#fohY',st.foh,'y',-100,200],['#fohW',st.foh,'width',.5,50],['#fohD',st.foh,'depth',.5,50]];
    for(const [selector,target,key,min,max] of stageFields){
      val(selector,target[key]);
      $(selector).addEventListener('change',e=>{
        const n=Number(e.target.value);
        if(!Number.isFinite(n)){e.target.value=target[key];return}
        target[key]=clamp(n,min,max);e.target.value=target[key];save();
      });
    }
  }
  if($('#gDev')){val('#gDev',T==='gaiadmx'?(w.stanza||''):(w.device||''));
    if(T==='tddevice')$('#gDev').addEventListener('change',e=>{w.device=e.target.value;save();refresh(w)});
    else on('#gDev',v=>{if(T==='gaiadmx')w.stanza=v;else w.device=v},'change')}
  if(T==='patchdeck'){val('#gDeck',w.deck||'a');on('#gDeck',v=>w.deck=v,'change')}
  if(T==='tddevice'){val('#gFam',w.fam||'');$('#gFam').addEventListener('change',e=>{
    w.fam=e.target.value;if(w.device&&!devIds(w.fam).includes(w.device))w.device='';
    save();refresh(w);renderInsp();
  })}
  if(T==='gaia'){val('#gSt2',GC.stanza);on('#gSt2',v=>{GC.stanza=v.trim()||'studio';store.set(GKEY,GC)},'change',false)}
  if(hasMidi){val('#fCh',w.midi.ch);val('#fCc',w.midi.cc);on('#fCh',v=>w.midi.ch=clamp(+v||1,1,16));on('#fCc',v=>w.midi.cc=v===''?'':clamp(Math.round(+v),0,127))}
  insp.querySelectorAll('.swb').forEach(b=>b.onclick=()=>{w.color=b.dataset.c;save();refresh(w);insp.querySelectorAll('.swb').forEach(x=>x.setAttribute('aria-pressed',x===b))});
  $('#fDup').onclick=()=>{const c=JSON.parse(JSON.stringify(w));c.id=uid();[c.x,c.y]=freeSpot(c.w,c.h);page().widgets.push(c);save();stage.appendChild(build(c));select(c.id)};
  $('#fDel').onclick=()=>removeW(w);
}
function removeW(w){page().widgets=page().widgets.filter(x=>x!==w);save();elOf(w.id)?.remove();select(null)}
document.addEventListener('keydown',e=>{
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))return;
  if(editing&&selId&&(e.key==='Delete'||e.key==='Backspace')){const w=findW(selId);if(w)removeW(w)}
  if(e.key==='Escape'){if(!$('#scrim').hidden)closeSheet();else select(null)}
  if(!editing&&e.key===' '){const w=allW().find(x=>x.type==='timeline');if(w){e.preventDefault();tlAct(w,'go')}}
});
$('#editBtn').onclick=()=>{editing=!editing;selId=null;render()};
