/* ---------- interazione ---------- */
function bind(el,w){
  el.addEventListener('pointerdown',e=>{
    if(editing) return editDown(e,el,w);
    const t=widgetType(w.type);if(t?.onPointer)return t.onPointer(e,el,w);
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
  el.onpointerup=el.onpointercancel=()=>{el.onpointermove=el.onpointerup=el.onpointercancel=null;save();if(rz&&widgetType(w.type)?.refreshOnResize)refresh(w)};
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
  // parte comune dell'ispettore; quella del tipo viene dal registro (spec.inspector)
  const T=w.type,spec=widgetType(T)||{},flag=v=>typeof v==='function'?v(w):!!v;
  const hasAddr=flag(spec.oscAddress??true),hasRange=!!spec.range,hasMidi=!!spec.midi,ins=spec.inspector||{};
  const rangeLabels=typeof spec.range==='object'?spec.range:{min:'Min',max:'Max'};
  const gaiaOscAddress=String(w.addr||'').startsWith('/gaia/');
  const missingOscChannel=w.oscChannel&&!C.oscChannels.some(c=>c.id===w.oscChannel);
  insp.innerHTML=`<h3>${NAMES[T]}</h3>
    <label>Etichetta<input id="fLabel"></label>
    ${hasAddr?`<label>${spec.addrLabel||'Indirizzo OSC'}<input id="fAddr" class="mono" spellcheck="false" autocapitalize="off"></label>`:''}
    ${hasAddr&&!gaiaOscAddress?`<label>Canale OSC<select id="fOscChannel"><option value="">Predefinito · ${esc(C.host)}:${C.port}</option>${C.oscChannels.map(c=>`<option value="${esc(c.id)}">${esc(oscChannelName(c))}</option>`).join('')}${missingOscChannel?`<option value="${esc(w.oscChannel)}">Non configurato · ${esc(w.oscChannel)}</option>`:''}</select></label>
      ${missingOscChannel?'<p class="hint">Questo layout riferisce un canale assente su questo browser. Configuralo in Impostazioni o scegli un altro canale.</p>':''}
      <p class="hint">La famiglia e l’istanza identificano la destinazione; indirizzo e argomenti restano quelli definiti dal contratto del progetto TD.</p>`:''}
    ${hasAddr&&gaiaOscAddress?'<p class="hint">Questo indirizzo usa il canale Gaia dedicato (/gaia/), non un canale OSC personalizzato.</p>':''}
    ${hasRange?`<div class="two"><label>${rangeLabels.min}<input id="fMin" type="number" step="any"></label><label>${rangeLabels.max}<input id="fMax" type="number" step="any"></label></div>`:''}
    ${ins.html?ins.html(w):''}
    ${hasMidi?`<div class="two"><label>MIDI canale<input id="fCh" type="number" min="1" max="16"></label><label>MIDI CC<input id="fCc" type="number" min="0" max="127" placeholder="off"></label></div>`:''}
    <label>Colore</label><div class="sw">${SWATCH.map(c=>`<button class="swb" data-c="${c}" style="--c:${c}" aria-label="Colore ${c}" aria-pressed="${c===w.color}"></button>`).join('')}</div>
    <div class="row"><button class="btn" id="fDup">Duplica</button><button class="btn danger" id="fDel">Elimina</button></div>
    ${ins.footer?ins.footer(w):''}`;
  const on=(id,fn,ev='input',rebuild=true)=>{const n=$(id);if(n)n.addEventListener(ev,e=>{fn(e.target.type==='checkbox'?e.target.checked:e.target.value);save();if(rebuild)refresh(w)})};
  const val=(id,v)=>{const n=$(id);if(n){if(n.type==='checkbox')n.checked=!!v;else n.value=v??''}};
  val('#fLabel',w.label); on('#fLabel',v=>w.label=v);
  if(hasAddr){val('#fAddr',w.addr); on('#fAddr',v=>w.addr=v.trim())}
  if($('#fOscChannel')){val('#fOscChannel',w.oscChannel||'');on('#fOscChannel',v=>w.oscChannel=v,'change')}
  if(hasRange){val('#fMin',w.min);val('#fMax',w.max);on('#fMin',v=>{if(v!==''&&!isNaN(v))w.min=+v});on('#fMax',v=>{if(v!==''&&!isNaN(v))w.max=+v})}
  ins.bind?.(w,{on,val});
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
