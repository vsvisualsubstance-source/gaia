/* ---------- disegno widget ---------- */
const ICON={play:'<svg viewBox="0 0 12 12"><path d="M2.5 1.5v9l8-4.5z"/></svg>',pause:'<svg viewBox="0 0 12 12"><path d="M2 1.5h3v9H2zM7 1.5h3v9H7z"/></svg>',
  stop:'<svg viewBox="0 0 12 12"><path d="M2 2h8v8H2z"/></svg>',start:'<svg viewBox="0 0 12 12"><path d="M1.5 1.5h2v9h-2zM11 1.5v9L4 6z"/></svg>',
  loop:'<svg viewBox="0 0 12 12"><path d="M3 4h5.5L7 2.5 8 1.5 11.2 4.7 8 8 7 7l1.5-1.5H3a.5.5 0 0 0-.5.5v1H1V6a2 2 0 0 1 2-2zM9.5 6.5H11V7a2 2 0 0 1-2 2H4.5L6 10.5 5 11.5 1.8 8.3 5 5l1 1-1.5 1.5H9a.5.5 0 0 0 .5-.5z"/></svg>'};
let portraitUnit=48;
function place(el,w){
  if(stage.classList.contains('portrait')){
    el.style.left='0';el.style.top='';el.style.width='100%';
    el.style.height=`${Math.max(120,Math.round(w.h*portraitUnit))}px`;
  }else{
    el.style.left=w.x/COLS*100+'%'; el.style.top=w.y/ROWS*100+'%';
    el.style.width=w.w/COLS*100+'%'; el.style.height=w.h/ROWS*100+'%';
  }
  el.classList.toggle('hz',w.w>w.h);
}
// tutto per tipo dal registro (05-widget-registry.js); un tipo sconosciuto resta vuoto
function inner(w){return widgetType(w.type)?.inner?.(w)??''}
const showVal=w=>{const t=widgetType(w.type);return!t||(typeof t.showsValue==='function'?t.showsValue(w):t.showsValue)};
function build(w){
  const el=document.createElement('div');
  el.className='w t-'+w.type+(selId===w.id?' sel':''); el.dataset.id=w.id;
  el.style.setProperty('--c',w.color);
  const t=widgetType(w.type),addr=t&&!(typeof t.showsAddr==='function'?t.showsAddr(w):t.showsAddr)?'':(w.addr||'nessun indirizzo');
  el.innerHTML=`<div class="box">${inner(w)}<span class="lab">${esc(w.label)}</span><span class="addr">${esc(addr)}</span>${showVal(w)?'<span class="val"></span>':''}</div><span class="rs"></span>`;
  place(el,w); paint(el,w); bind(el,w);
  if(t?.mounted)t.mounted(el,w);
  return el;
}
function paint(el,w){
  if(!el) return;
  const val=el.querySelector('.val'),t=widgetType(w.type);
  t?.paint?.(el,w);
  if(val)val.textContent=t?.valueText?t.valueText(w):fmt(out(w,w.value));
}
const elOf=id=>stage.querySelector(`[data-id="${id}"]`);
function renderStage(){
  const portrait=!editing&&window.matchMedia('(max-width:760px) and (orientation:portrait)').matches;
  stage.classList.toggle('portrait',portrait);
  if(portrait)portraitUnit=clamp(stage.clientHeight/ROWS,44,56);
  const widgets=page().widgets;
  const ordered=portrait?[...widgets].sort((a,b)=>a.y-b.y||a.x-b.x):widgets;
  stage.replaceChildren(...ordered.map(build));
}
window.addEventListener('resize',()=>{
  const portrait=!editing&&window.matchMedia('(max-width:760px) and (orientation:portrait)').matches;
  if(portrait!==stage.classList.contains('portrait'))renderStage();
});
function refresh(w){const o=elOf(w.id); if(o) o.replaceWith(build(w))}
function renderTabs(){
  const t=$('#tabs'); t.innerHTML='';
  L.pages.forEach((p,i)=>{const b=document.createElement('button');b.className='tab';b.textContent=p.name;b.setAttribute('aria-current',i===pi);
    b.onclick=()=>{pi=i;selId=null;render()};t.appendChild(b)});
  if(editing){const b=document.createElement('button');b.className='tab add';b.textContent='+';b.title='Nuova pagina';b.onclick=addPage;t.appendChild(b)}
}
function render(){oscIndexStale();document.body.classList.toggle('editing',editing);$('#addbar').hidden=!editing;
  $('#editBtn').textContent=editing?'Fine griglia':'Modifica griglia';
  $('#editBtn').title=editing?'Termina la modifica della griglia dei widget. Le fixture del palco si modificano direttamente nella Pianta.':'Modifica solo la griglia dei widget; per spostare o aggiungere luci usa direttamente la Pianta.';
  $('#editBtn').classList.toggle('primary',editing);
  renderTabs();renderStage();renderInsp();syncHeadSelectors()}

/* ---------- invio OSC ---------- */
// argomenti OSC: quelli dichiarati dal tipo (registro), altrimenti il valore nel suo range
function argsOf(w){const t=widgetType(w.type);return t?.args?t.args(w):[out(w,w.value)]}
const queue=new Map(); let raf=0;
function send(w){if(!w.addr)return; queue.set(w.id,w); if(!raf) raf=requestAnimationFrame(flush)}
function flush(){raf=0; for(const w of queue.values()){
  const m={type:'osc',address:w.addr,args:argsOf(w),channel:w.oscChannel||'default'};
  emit(m); applyWidgets(m,w.id);
  if(w.midi&&w.midi.cc!==''&&w.midi.cc!=null) emit({type:'midi',ch:+w.midi.ch||1,cc:+w.midi.cc,value:Math.round((typeof w.value==='number'?w.value:0)*127)},true);
} queue.clear()}
function set(w,v){if(w.value===v)return; w.value=v; paint(elOf(w.id),w); send(w)}
function setXY(w,x,y){w.value=x;w.valueY=y;paint(elOf(w.id),w);send(w)}
function fire(address,args,channel){const m={type:'osc',address,args,channel:channel||'default'};emit(m);applyWidgets(m,null)}
function bus(a,args,src){model(a,args);timelineBus(a,args,src)}
