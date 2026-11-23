// 20/11: pagina Mapping. Il mapping di Regia (corner pin + mesh, mapping/mapping-core.js, globale
// PlanciaMapping) dentro la Plancia: un mapping per ogni proiettore del Palco, salvato nel
// progetto (L.mapping.out[<id proiettore>].map, formato di mapping-core). Lo legge il Render 3D
// (/api/mapping) e domani un motore nativo che fa solo mapping.
// Anteprima: la sorgente del proiettore (NDI/URL dal Video Service, o immagine di prova)
// deformata con WebGL, coi punti sopra. Trascina i punti; in corner pin trascinando fuori dai
// punti si sposta tutto; frecce 1 px (Maiusc 10), Tab punto successivo.
const MP={sel:new Map(),r3d:{},drag:null,card:new Map(),ok:new WeakSet()};
const MPM=()=>globalThis.PlanciaMapping||null;
function mappingDoc(){if(!L.mapping||typeof L.mapping!=='object')L.mapping={v:1,out:{}};if(!L.mapping.out)L.mapping.out={};return L.mapping}
const mappingProjectors=()=>(L.fixtures||[]).filter(f=>f.type==='projector');
function mappingOf(id,create){const d=mappingDoc();let o=d.out[id];
  if(!o&&create){o=d.out[id]={map:MPM().defMap()}}
  // ripulito una volta sola (dati vecchi o di un altro tablet): lo stesso oggetto resta in mano a chi lo trascina
  if(o&&!MP.ok.has(o.map)){o.map=MPM().fixMap(o.map);MP.ok.add(o.map)}return o||null}
function mappingPrj(w){const list=mappingProjectors();return list.find(f=>f.id===w.prj)||list[0]||null}
const mappingVisible=()=>page().widgets.some(w=>w.type==='mapping');
// corner pin calcolati dal Render 3D (◰ mappa 4 punti sul modello): dall'iframe del Render 3D in
// questa pagina, o da un Render 3D aperto in un'altra scheda (BroadcastChannel)
// apply: il Render 3D ha appena calcolato i 4 punti sul modello -> nel mapping del progetto (corner pin)
try{const bc=new BroadcastChannel('plancia-mapping');bc.onmessage=e=>{const m=e.data;
  if(m?.type!=='r3d-corners'||!m.id||!Array.isArray(m.corners)||m.corners.length!==4)return;
  MP.r3d[m.id]={corners:m.corners,at:Date.now()};
  if(m.apply&&MPM()&&mappingProjectors().some(f=>f.id===m.id)){const o=mappingOf(m.id,true);o.map.corners=m.corners.map(p=>[+p[0],+p[1]]);o.map.mode='corners';o.from='render3d';o.at=Date.now();mappingSave();
    bc.postMessage({type:'mapping-saved',id:m.id,map:JSON.parse(JSON.stringify(o.map))})}};MP.bc=bc}catch{}
function mappingFromR3d(id){
  try{const it=R3D.frame?.contentWindow?.__r3d?.PAL?.items?.find(i=>i.kind==='projector'&&i.f.id===id);if(it?.corners&&it.mapSrc==='modello')return it.corners}catch{}
  return MP.r3d[id]?.corners||null}
function mappingCard(name){let c=MP.card.get(name);if(!c){c=document.createElement('canvas');c.width=640;c.height=360;drawTestCard(c.getContext('2d'),0,0,640,360,name);MP.card.set(name,c)}return c}
function mappingSource(f){const src=f.sourceType||'procedural';
  if(src==='url'||src==='ndi'){const v=wallVideoPlayers.get(f.id)?.video;if(v&&v.readyState>=2&&v.videoWidth)return{el:v,live:true}}
  return{el:mappingCard(f.name||'PROIETTORE'),live:false,why:src==='procedural'?'':wallPreviewMessage(f)}}
function mappingMsg(el,txt){const m=el.querySelector('.mp-msg');if(m&&m.textContent!==txt)m.textContent=txt}
function mappingBar(w){
  const list=mappingProjectors(),f=mappingPrj(w),o=f&&mappingOf(f.id),m=o?.map||MPM()?.defMap();
  if(!MPM())return'<span class="hint">Modulo mapping non caricato (mapping/mapping-core.js).</span>';
  if(!list.length)return'<span class="hint">Nessun proiettore nel Palco: aggiungine uno (Palco → Strumenti) e torna qui.</span>';
  return`<select data-mp="prj" title="Proiettore del Palco">${list.map(p=>`<option value="${esc(p.id)}"${p.id===f.id?' selected':''}>${esc(p.name||p.id)}</option>`).join('')}</select>
    <span class="mp-seg"><button class="btn sm${m.mode==='corners'?' on':''}" data-mp="mode" data-v="corners">Corner pin</button><button class="btn sm${m.mode==='mesh'?' on':''}" data-mp="mode" data-v="mesh">Mesh</button></span>
    ${m.mode==='mesh'?`<select data-mp="n" title="Punti della mesh">${[2,3,4,5,6,7,8].map(n=>`<option value="${n}"${n===m.n?' selected':''}>${n}×${n}</option>`).join('')}</select>`:''}
    <button class="btn sm ghost" data-mp="reset" title="Angoli ai bordi e mesh piatta">Reset</button>
    <button class="btn sm ghost" data-mp="rot" title="Proiettore capovolto (appeso)">↻ 180°</button>
    <button class="btn sm ghost" data-mp="r3d" title="Corner pin calcolato nel Render 3D con ◰ mappa 4 punti sul modello">⇦ dal Render 3D</button>`}
function mappingRepaintBar(el,w){const b=el.querySelector('.mp-bar');if(b)b.innerHTML=mappingBar(w);el._mpSig=null}
// quadro 16:9 del proiettore dentro il riquadro, in pixel del canvas
function mappingFrame(el){const v=el.querySelector('.mp-view'),r=v.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);
  let W=r.width,H=W*9/16;if(H>r.height){H=r.height;W=H*16/9}
  return{W:Math.max(2,Math.round(W*d)),H:Math.max(2,Math.round(H*d)),cssW:W,cssH:H,d}}
function mappingSave(){L.mapping=mappingDoc();save()}
function mappingNudge(e,el,w){
  const f=mappingPrj(w);if(!f)return;const o=mappingOf(f.id,true),m=o.map,P=MPM(),hs=P.handles(m),sel=Math.min(MP.sel.get(f.id)??0,hs.length-1),fr=mappingFrame(el);
  if(e.key==='Tab'){e.preventDefault();MP.sel.set(f.id,(sel+(e.shiftKey?hs.length-1:1))%hs.length);return}
  const st=e.shiftKey?10:1,d={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key];if(!d)return;
  e.preventDefault();P.moveHandle(m,sel,hs[sel][0]+d[0]/fr.cssW,hs[sel][1]+d[1]/fr.cssH);clearTimeout(MP.st);MP.st=setTimeout(mappingSave,400)}
function mappingDown(e,el,w){
  const b=e.target.closest('[data-mp]'),P=MPM();if(!P)return;
  if(b&&b.tagName==='BUTTON'){const f=mappingPrj(w);if(!f)return;const o=mappingOf(f.id,true),m=o.map,k=b.dataset.mp;
    if(k==='mode'){m.mode=b.dataset.v;MP.sel.set(f.id,0)}
    else if(k==='reset'){const d=P.defMap();m.corners=d.corners;m.off=Array.from({length:m.n*m.n},()=>[0,0])}
    else if(k==='rot')P.rotate180(m);
    else if(k==='r3d'){const c=mappingFromR3d(f.id);if(!c){mappingMsg(el,`Nessun corner pin dal Render 3D per ${f.name||'questo proiettore'}: nel Render 3D scegli il proiettore e usa ◰ mappa 4 punti.`);return}
      m.corners=c.map(p=>[+p[0],+p[1]]);m.mode='corners';o.from='render3d'}
    o.at=Date.now();mappingSave();mappingRepaintBar(el,w);return}
  const ov=e.target.closest('.mp-ov');if(!ov)return;
  const f=mappingPrj(w);if(!f)return;const o=mappingOf(f.id,true),m=o.map,r=ov.getBoundingClientRect();
  const pos=ev=>[(ev.clientX-r.left)/r.width,(ev.clientY-r.top)/r.height];
  const [x,y]=pos(e),k=P.hitHandle(m,x,y,r.width,r.height,20);ov.focus({preventScroll:true});
  let drag;
  if(k>=0){const h=P.handles(m)[k];drag={k,ox:h[0]-x,oy:h[1]-y};MP.sel.set(f.id,k)}
  else if(m.mode==='corners')drag={all:true,x,y,c:m.corners.map(c=>[...c])};else return;
  e.preventDefault();
  const move=ev=>{const [a,b2]=pos(ev);if(drag.all)m.corners=drag.c.map(c=>[c[0]+a-drag.x,c[1]+b2-drag.y]);else P.moveHandle(m,drag.k,a+drag.ox,b2+drag.oy)};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);removeEventListener('pointercancel',up);o.at=Date.now();mappingSave()};
  addEventListener('pointermove',move);addEventListener('pointerup',up);addEventListener('pointercancel',up)}
registerWidget('mapping',{oscAddress:false,size:[16,10],label:'Mapping',showsValue:false,showsAddr:false,
  inner:w=>`<div class="mp-box"><div class="mp-bar">${mappingBar(w)}</div>
    <div class="mp-view"><canvas class="mp-gl"></canvas><canvas class="mp-ov" tabindex="0" aria-label="Punti del mapping"></canvas></div>
    <div class="hint mp-msg"></div></div>`,
  mounted:(el,w)=>{
    el.addEventListener('change',e=>{const s=e.target.closest('select[data-mp]');if(!s)return;
      if(s.dataset.mp==='prj'){w.prj=s.value;save();mappingRepaintBar(el,w);return}
      const f=mappingPrj(w);if(!f)return;const o=mappingOf(f.id,true);
      if(s.dataset.mp==='n'){MPM().setMeshN(o.map,+s.value);MP.sel.set(f.id,0);o.at=Date.now();mappingSave()}});
    el.querySelector('.mp-ov')?.addEventListener('keydown',e=>mappingNudge(e,el,w))},
  onPointer:mappingDown,
  tick(el,w){
    const P=MPM(),gl=el.querySelector('.mp-gl'),ov=el.querySelector('.mp-ov');if(!P||!gl||!ov)return;
    const f=mappingPrj(w);
    // la barra segue proiettori e modalita' cambiati da altri tablet
    const o=f&&mappingOf(f.id),m=o?.map||P.defMap(),sig=JSON.stringify([mappingProjectors().map(p=>[p.id,p.name]),f?.id,m.mode,m.n]);
    if(el._mpSig!==sig){if(el._mpSig!==undefined&&el._mpSig!==null)el.querySelector('.mp-bar').innerHTML=mappingBar(w);el._mpSig=sig}
    const fr=mappingFrame(el);
    for(const c of[gl,ov]){if(c.width!==fr.W||c.height!==fr.H){c.width=fr.W;c.height=fr.H}c.style.width=fr.cssW+'px';c.style.height=fr.cssH+'px'}
    if(!el._R){try{el._R=P.makeRenderer(gl)}catch{el._R=null}}
    if(!f){const g=ov.getContext('2d');g.clearRect(0,0,fr.W,fr.H);return}
    const s=mappingSource(f);
    if(el._R)el._R.render(m,s.el,{});
    const g=ov.getContext('2d');g.clearRect(0,0,fr.W,fr.H);
    P.drawOverlay(g,m,fr.W,fr.H,{sel:Math.min(MP.sel.get(f.id)??0,P.handles(m).length-1),label:f.name||'PROIETTORE',dpr:fr.d});
    const c=m.corners.map(p=>'('+p[0].toFixed(3)+', '+p[1].toFixed(3)+')').join(' ');
    mappingMsg(el,`${s.live?'Sorgente dal vivo':'Immagine di prova'}${s.why?' ('+s.why+')':''} · ${m.mode==='corners'?'corner pin':'mesh '+m.n+'×'+m.n}: ${c}${o?.from==='render3d'?' · dal Render 3D':''} · trascina i punti, frecce 1 px (Maiusc 10), Tab punto successivo`)},
  help:()=>['Mapping','Come si usa: scegli il proiettore (quelli del Palco). Corner pin: trascina i 4 angoli dove deve cadere l’immagine; trascinando fuori dai punti sposti tutto. Mesh (da 2×2 a 8×8): piega anche i punti in mezzo, per superfici non piane. Precisione: tocca il riquadro, poi frecce = 1 px, Maiusc + frecce = 10 px, Tab = punto successivo. Reset riporta tutto ai bordi; ↻ 180° per il proiettore appeso; "dal Render 3D" prende gli angoli fatti con ◰ mappa 4 punti sul modello. L’anteprima mostra la sorgente del proiettore (NDI o URL) o l’immagine di prova. Si salva nel progetto e lo usa il Render 3D; per ora non manda l’immagine al proiettore vero (servirà il motore video nativo).']});
// 2026-11-20: pagina Mapping nel gruppo Render 3D (uiRev 23)
TPL.mapping={name:'Mapping',desc:'Mapping video per proiettori e superfici.',pages:()=>[{id:uid(),name:'Mapping',widgets:[W('mapping',0,0,16,10,{label:'Mapping'})]}]};
function migrateUiMapping(){
  if((L.uiRev||0)>=23)return;
  if(!L.pages.some(p=>p.widgets.some(w=>w.type==='mapping')))L.pages.push({id:uid(),name:'Mapping',widgets:[W('mapping',0,0,16,10,{label:'Mapping'})]});
  L.uiRev=23;save();
}
