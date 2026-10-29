/* ---------- tutorial contestuale: "?" = visita guidata della pagina aperta ---------- */
// Un passo per ogni controllo della pagina (ricavato dal tipo di widget e
// dall'indirizzo, quindi vale anche per pagine personalizzate), poi la barra
// in alto. Evidenzia il controllo e spiega cosa fa e quando usarlo.
const HELP_PAGES={
  Show:'Pagina per ESEGUIRE lo show: vedi il palco, l\'orologio, le scene e la timeline (qui in sola lettura: si prepara nella pagina Timeline).',
  Regia:'Console di regia luci: fai andare lo show a mano. A sinistra la pila delle scene con GO/BACK, in basso master e gruppi.',
  Laser:'Laser: scene laser da mandare ai cubi e, per ogni LaserCube, sorgente, arm, intensità e zona di sicurezza. Armare è sempre manuale.',
  Audio:'Reattività audio: per ogni gruppo di luci decidi se segue la musica, quanto e con quale sorgente, oppure applichi un preset.',
  Luci:'Le luci una per una: vedi il colore che esce davvero e cambi la palette di singole luci o gruppi.',
  DMX:'Controlli DMX completi: scene, palette dei rig, chase, fade, strobo e livelli dei gruppi.',
  'Teste mobili':'Programmatore delle teste: selezione, posizione, colore, gobo, dimmer, zoom e fuoco.',
  Timeline:'Pagina per PREPARARE: componi la timeline dello show, crea e cattura le scene, scegli palette e posizioni.',
  Palco:'Design del palco: pianta con la patch DMX, render, LED wall.',
  Gaia:'Gaia: mood, pensieri e chat dell\'agente, luci della stanza.',
  PatchDeck:'PatchDeck: i due deck video, effetti e controller.',
  Mix:'Mixer audio: fader, effetti e pad.',
};
function helpForWidget(w){const t=widgetType(w.type);return t?.help?t.help(w):[w.label||NAMES[w.type]||w.type,`Indirizzo ${w.addr||'—'}.`]}
const HELP_BAR=[
  ['#projBtn','Progetto','Il nome del progetto aperto. Il pallino arancione = modifiche non ancora salvate nel progetto (il layout resta comunque autosalvato su OPS). Tocca per salvare, aprire, duplicare, esportare.'],
  ['#gconn','Gaia','Collegamento a Gaia (MQTT): verde = DMX Master e gli altri servizi rispondono.'],
  ['#conn','OSC','Collegamento OSC col bridge: serve se MQTT non c\'è (riserva).'],
  ['#editBtn','Modifica griglia','Per spostare, ridimensionare e aggiungere controlli su questa pagina.'],
  ['#menuBtn','Impostazioni','Connessioni, template di pagine, canali OSC, progetti.'],
];
function startHelpTour(){
  closeHelpTour();
  const pg=page(),seen=new Set(),steps=[];
  steps.push({el:null,t:`Pagina ${pg.name}`,d:HELP_PAGES[pg.name]||'Ecco cosa c\'è in questa pagina.'});
  for(const w of [...pg.widgets].sort((a,b)=>a.y-b.y||a.x-b.x)){
    const key=w.type+'|'+(w.addr||'')+'|'+(w.mode||'')+'|'+(w.param||'');if(seen.has(key))continue;seen.add(key);
    const el=stage.querySelector(`[data-id="${w.id}"]`);if(!el)continue;
    const [t,d]=helpForWidget(w);steps.push({el,t,d});
  }
  for(const [sel,t,d] of HELP_BAR){const el=$(sel);if(el&&el.offsetParent)steps.push({el,t,d,bar:true})}
  const hole=document.createElement('div'),tip=document.createElement('div');hole.className='tour-hole';tip.className='tour-tip';tip.setAttribute('role','dialog');
  document.body.append(hole,tip);let i=0;
  const show=()=>{
    const s=steps[i],r=s.el?.getBoundingClientRect();
    if(r){Object.assign(hole.style,{left:r.left-4+'px',top:r.top-4+'px',width:r.width+8+'px',height:r.height+8+'px'});hole.classList.remove('full')}
    else hole.classList.add('full');
    tip.innerHTML=`<div class="tour-n">${i+1} / ${steps.length}${s.bar?' · barra in alto':''}</div><b>${esc(s.t)}</b><p>${esc(s.d)}</p>
      <div class="row"><button class="btn sm ghost" data-tour="x">Chiudi</button><span style="flex:1"></span>${i?'<button class="btn sm" data-tour="p">‹ Indietro</button>':''}<button class="btn sm primary" data-tour="n">${i<steps.length-1?'Avanti ›':'Fine'}</button></div>`;
    // fumetto sotto il controllo (o sopra se non c'e' spazio), dentro lo schermo
    const tw=Math.min(360,innerWidth-24);tip.style.width=tw+'px';
    let x=r?Math.min(Math.max(12,r.left),innerWidth-tw-12):(innerWidth-tw)/2,y=r?r.bottom+12:innerHeight/3;
    tip.style.left=x+'px';tip.style.top=y+'px';
    const th=tip.getBoundingClientRect().height;if(r&&y+th>innerHeight-12)tip.style.top=Math.max(12,r.top-th-12)+'px';
    if(r&&r.height>innerHeight*.6)tip.style.top=Math.max(12,r.top+16)+'px';
  };
  tip.onclick=e=>{const b=e.target.closest('[data-tour]');if(!b)return;const k=b.dataset.tour;
    if(k==='x'||(k==='n'&&i===steps.length-1))return closeHelpTour();i+=k==='n'?1:-1;show()};
  hole.onclick=closeHelpTour;
  startHelpTour._key=e=>{if(e.key==='Escape')closeHelpTour();else if(e.key==='ArrowRight'&&i<steps.length-1){i++;show()}else if(e.key==='ArrowLeft'&&i>0){i--;show()}};
  addEventListener('keydown',startHelpTour._key);
  show();
}
function closeHelpTour(){document.querySelectorAll('.tour-hole,.tour-tip').forEach(x=>x.remove());if(startHelpTour._key)removeEventListener('keydown',startHelpTour._key)}
$('#helpBtn').onclick=startHelpTour;
