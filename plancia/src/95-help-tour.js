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
function helpForWidget(w){
  const a=w.addr||'';
  switch(w.type){
    case 'cuestack':return['Pila scene (GO/BACK)','Le scene di DMX Master in ordine. ▶ = scena in uscita, NEXT = la prossima. Tocca una riga per prepararla come NEXT, poi GO la manda con il fade impostato. BACK torna alla scena precedente.'];
    case 'laser':return['Laser',w.h<=3?'BLACKOUT LASER disarma subito tutti i cubi; Arma/Armato per cubo (chiede conferma). Il resto nella pagina Laser.':'In alto le Scene laser: tocca una scena (template o SVG importato) per mandarla ai cubi scelti, ✎ per modificarla. Sotto, una scheda per LaserCube: sorgente (Test = cerchio di prova, Scene = scene del gateway, PatchDeck = contorni del video, Yolo = grafica su superficie, mai sulle persone), ARMA con conferma, Master e Intensità massima. In "Zona di sicurezza" il rettangolo dove il fascio può andare: fuori il gateway spegne il raggio. Se la sorgente si ferma il cubo va al buio da solo. BLACKOUT LASER disarma tutto.'];
    case 'audiorigs':return['Audio dei gruppi',w.h<=3?'♪ accende o spegne la reattività audio del gruppo (spento = luce ferma), Kick = colpo sui bassi. Regolazioni complete nella pagina Audio.':'Una scheda per gruppo: ♪ Audio ON/OFF (tutte le luci del gruppo seguono la musica o restano ferme), Kick, sorgente A/B, il MODO delle luci (come il gruppo, ferma, solo bassi/medi/alti, solo kick) e il GUADAGNO (0 ferma, 1 normale, 2 doppio). In Taratura minimo, massimo, soglia kick e morbidezza del gruppo. Seleziona i gruppi con ☐ e tocca un preset. Per una luce sola: pagina Luci.'];
    case 'fixgrid':return['Luci e colori singoli','Ogni tessera è una luce col colore che esce davvero. Toccale per selezionarle (o scegli un gruppo + "Seleziona tutte", pari/dispari), poi tocca una palette: cambia solo il colore, livello e audio restano del rig. "Segue il rig" toglie la palette propria.'];
    case 'stage':return['Palco','Render: come escono le luci (colori reali da DMX Master). Pianta: posizioni e patch, tocca una luce per nome, indirizzo, modello e colore. In alto: 📐 Spazio = misure di palco, platea, regia e sala; ⇪/⇩ TD scambiano la patch, ▣ Scene, ▤ Modelli (libreria), ▦ Gruppi, 💡 Lampade, ✨ AI.'];
    case 'timeline':return['Timeline dello show',w.readonly?'Segue l\'orologio dello show di DMX Master. LIVE/TIMELINE dice chi comanda le luci: in TIMELINE vanno da sole con le cue, in LIVE comandi tu.':'Le cue dello show: tocca un blocco per modificarlo, "Cue" per l\'editor (scena e fade di ogni cue). Play/stop/inizio comandano l\'orologio. Sotto, la corsia VIDEO per PatchDeck.'];
    case 'clock':return[w.mode==='show'?'Orologio dello show':w.mode==='countdown'?'Conto alla rovescia':'Ora','Tempo dello show (timecode 25 fps) che arriva da DMX Master. Se dice OFFLINE l\'orologio è fermo.'];
    case 'color':return['Colore',a.startsWith('/mh')?'Colore delle teste selezionate (ruota o RGB secondo il modello).':'Colore del LED wall.'];
    case 'xy':return['Pan / Tilt','Trascina per puntare le teste selezionate.'];
    case 'scenes':
      if(w.mode==='dmx-enum')return['Palette del rig','Il colore di tutto il gruppo (rig). Per una luce sola usa la pagina Luci.'];
      if(w.mode==='head-select')return['Selezione teste','Scegli quali teste comandare con i controlli della pagina.'];
      if(w.mode==='head-presets')return['Preset teste','Posizioni e stati salvati delle teste: "Gestisci" per crearli.'];
      if(a==='/dmx/scene')return['Scene di DMX Master','Tocca una scena per richiamarla (con il fade impostato). "＋ Scene…" per catturare lo stato attuale, ricatturare, rinominare o eliminare.'];
      if(a==='/dmx/chase')return['Chase','Come si muovono i colori nei rig: lento, veloce, a tempo di musica…'];
      if(a==='/mh/position')return['Posizioni teste','Posizioni pronte per le teste selezionate.'];
      if(a.startsWith('/mh/gobo'))return['Gobo','Il disegno proiettato dalle teste.'];
      return['Scelte',`Tocca per scegliere (${a||'nessun indirizzo'}).`];
    case 'fader':
      if(a==='/dmx/master')return['Master','Livello generale di tutte le luci.'];
      if(a==='/dmx/fade')return['Fade','Secondi di dissolvenza quando cambi scena.'];
      if(a==='/dmx/strobe/rate')return['Velocità strobo','Lampi al secondo dello strobo.'];
      if(a.startsWith('/dmx/group/'))return[`Gruppo ${w.label}`,'Livello di questo gruppo di luci (rig), sopra al master.'];
      if(a.startsWith('/mh/'))return[w.label,'Valore per le teste selezionate.'];
      return[w.label||'Fader',`Trascina su e giù (${a||'nessun indirizzo'}).`];
    case 'button':
      if(a==='/dmx/blackout')return['Blackout','Spegne tutto finché non lo ritocchi.'];
      if(a==='/dmx/strobe')return[w.label,w.mode==='toggle'?'Strobo acceso/spento.':'Strobo solo finché tieni premuto.'];
      if(a==='/show/go')return['GO','Manda la prossima cue della timeline.'];
      if(a==='/show/back')return['Back','Torna alla cue precedente della timeline.'];
      return[w.label||'Pulsante',w.mode==='toggle'?'Acceso/spento a ogni tocco.':'Attivo finché tieni premuto.'];
    default:return[w.label||NAMES[w.type]||w.type,GAIA_TYPES.has(w.type)?'Controllo di Gaia / TouchDesigner via MQTT.':`Indirizzo ${a||'—'}.`];
  }
}
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
