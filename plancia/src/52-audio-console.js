/* ---------- Console Audio: deck, mixer, libreria (docs/console-audio.md) ---------- */
// Console stile Traktor per la libreria musicale. Il motore vero (gaia-audio,
// Rust, su OPS/touring) e' l'unica fonte di verita' e manda lo stato al
// bridge; finche' non c'e', un motore SIMULATO qui nella pagina muove le
// testine, segue fader e crossfader e fa il sync sulle griglie, cosi' la
// console si prova gia' coi dati veri: tracce, BPM, griglie e forme d'onda
// arrivano dall'analisi (bridge /api/audio/*, audio-lib.js).
// Nessun suono nella pagina: l'audio esce solo dal motore, sull'impianto.
// Col motore collegato (stato audio_state dal bridge, ~15/s) la pagina manda
// i comandi e mostra lo stato che riceve; la testina si interpola tra uno
// stato e l'altro. Senza stato per 2,5 s si torna al motore simulato.
const AU_WAVE_RATE=50;                 // punti/s della forma d'onda di dettaglio
const AU_RANGES=[.08,.16,.5];          // escursione del fader del tempo
const AU_HOT=4;                        // hot cue mostrati per deck
const AU_HOT_SAVED=8;                  // hot cue salvati con la traccia (audio-lib.js)
const auDeck=()=>({track:null,wave:null,overImg:null,pos:0,playing:false,tempo:0,range:.08,keylock:true,sync:false,
  cue:0,hot:Array(AU_HOT_SAVED).fill(null),nudge:0,preview:false,loading:false,zoom:8,snap:true,scrub:false});
const AU_ZOOMS=[2,4,8,16,32];           // secondi visibili nella forma d'onda del deck
const auCh=()=>({gain:1,hi:0,mid:0,lo:0,filter:0,fader:1,cue:false,meter:0});
const AU={tracks:[],playlists:[],libState:'',live:false,liveAt:0,out:null,meterM:0,phones:null,last:0,master:'A',
  decks:{A:auDeck(),B:auDeck()},mix:{A:auCh(),B:auCh(),xfader:0,master:.9,cue_mix:.5,cue_level:.8},
  lib:{q:'',folder:'',sort:'folder',dir:1,target:'A',view:'',lastPl:''}};

/* ----- libreria (dal bridge) ----- */
async function auLoadLibrary(refresh){
  AU.libState='Carico la libreria…';
  try{const r=await(await fetch('/api/audio/library'+(refresh?'?refresh=1':''))).json();
    AU.tracks=r.ok?r.tracks:[];AU.libState=AU.tracks.length?'':'Nessuna traccia analizzata: su OPS "gaia-audio analyze" (audio-engine).'}
  catch{AU.tracks=[];AU.libState='Libreria non raggiungibile dal bridge.'}
}
function auB64(s){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
async function auLoad(deck,id){
  const d=AU.decks[deck];if(d.playing){showError(`Deck ${deck} in onda: fermalo prima di caricare.`);return}
  // col motore: carica lui (e legge i punti salvati); la pagina prende solo cio' che serve a disegnare
  if(AU.live)emit({type:'audio',cmd:'deck.load',deck,track:id},true);
  await auFetchTrack(deck,id);
}
async function auFetchTrack(deck,id){
  const d=AU.decks[deck];d.loading=true;
  try{const r=await(await fetch('/api/audio/track?id='+encodeURIComponent(id))).json();if(!r.ok)throw new Error(r.error);
    const t=r.track;Object.assign(d,{track:t,wave:{detail:auB64(t.wave.detail_b64),overview:t.wave.overview},overImg:null});
    if(!AU.live){Object.assign(d,{pos:0,cue:t.first_beat||0,hot:Array(AU_HOT_SAVED).fill(null),playing:false,preview:false,nudge:0});
      // punti salvati con la traccia: si riparte dal cue
      if(t.cues){d.cue=t.cues.cue??d.cue;d.hot=Array.from({length:AU_HOT_SAVED},(_,i)=>t.cues.hot?.[i]??null)}
      d.pos=d.cue}}
  catch(e){showError('Console Audio: traccia non caricata ('+e.message+').')}
  d.loading=false;
}
// stato dal motore vero: e' lui la fonte di verita'
function auApplyState(s){
  const now=performance.now();AU.liveAt=now;AU.live=true;AU.master=s.master==='B'?'B':'A';AU.out=s.outputs?.[0]||null;AU.cueOut=(s.outputs||[]).find(o=>o.role==='cue')||null;AU.lightsOut=(s.outputs||[]).find(o=>o.role==='lights')||null;AU.phones=!!s.headphones;AU.meterM=+s.meters?.master||0;AU.meterL=+(s.meters?.master_l??s.meters?.master)||0;AU.meterR=+(s.meters?.master_r??s.meters?.master)||0;
  for(const k of['A','B']){const sd=s.decks?.[k],d=AU.decks[k];if(!sd)continue;
    for(const f of['playing','tempo','range','keylock','sync','cue','nudge','preview','scrub','snap'])if(sd[f]!=null)d[f]=sd[f];
    d.phaseErr=sd.phase_err??null;
    d.trimMs=sd.trim_ms??0;          // fase fine a mano (ms, + = anticipa)   // scarto di fase dal master (ms), solo deck in SYNC che suona
    d.hot=Array.from({length:AU_HOT_SAVED},(_,i)=>sd.hot?.[i]??null);
    if(!d.localScrub)d.pos=sd.pos;d.basePos=sd.pos;d.baseAt=now;
    // traccia caricata da un altro tablet (o tolta): la pagina prende forma d'onda e griglia
    const id=sd.track||null;
    if(id!==(d.track?.id||null)&&!d.loading){if(!id)Object.assign(d,{track:null,wave:null,overImg:null});else auFetchTrack(k,id)}
    if(s.mix?.[k])Object.assign(AU.mix[k],s.mix[k])}
  for(const f of['xfader','master','cue_mix','cue_level'])if(s.mix?.[f]!=null)AU.mix[f]=s.mix[f];
}

// cue e hot cue salvati con la traccia (bridge -> <id>.cues.json): li ritrova chi la ricarica
function auSaveCues(k){const d=AU.decks[k];if(!d.track)return;
  fetch('/api/audio/cues?id='+encodeURIComponent(d.track.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cue:d.cue,hot:d.hot})})
    .then(r=>r.json()).then(r=>{if(!r.ok)throw new Error(r.error)}).catch(e=>showError('Console Audio: punti non salvati ('+e.message+').'))}

/* ----- correzione della griglia (GRID): la fa il motore e la salva nella cache ----- */
const auTaps={A:[],B:[]};
function auGridEdit(k,op,value){
  const d=AU.decks[k];if(!d.track)return;
  if(!AU.live){showError('Correggere la griglia richiede il motore audio collegato.');return}
  emit({type:'audio',cmd:'grid.edit',deck:k,op,...(value!=null?{value}:{})},true);
}
// griglia corretta (audio_grid dal motore): vale per i deck e la libreria
function auGridUpdate(m){
  const g={bpm:+m.bpm||0,first_beat:+m.first_beat||0,confidence:+m.confidence||0,locked:!!m.locked};
  for(const k of['A','B']){const d=AU.decks[k];if(d.track?.id===m.id)Object.assign(d.track,g)}
  const t=AU.tracks.find(x=>x.id===m.id);if(t)Object.assign(t,g);
  showInfo(`Griglia: ${g.bpm.toFixed(2)} BPM, battito 1 a ${g.first_beat.toFixed(3)} s${g.locked?' (bloccata: una nuova analisi non la cambia)':''}.`);
}

/* ----- tempo, griglia, sync ----- */
const auRate=d=>1+d.tempo*d.range+d.nudge;                     // velocita' di riproduzione
const auBpm=d=>(d.track?.bpm||0)*(1+d.tempo*d.range);           // BPM in uscita (senza nudge)
const auPeriod=d=>d.track?.bpm?60/d.track.bpm:0;                 // secondi di traccia per battito
const auGridOk=d=>!!d.track?.bpm&&(d.track.locked||d.track.confidence>=.4);
function auPhase(d){const p=auPeriod(d);return p?(((d.pos-d.track.first_beat)/p)%1+1)%1:0}
function auSnap(d,t){const p=auPeriod(d);if(!d.snap||!p||!auGridOk(d))return t;const fb=d.track.first_beat;return fb+Math.round((t-fb)/p)*p}
function auOther(k){return k==='A'?'B':'A'}
// il master del tempo: il deck scelto se suona, altrimenti l'altro che suona
function auMasterOf(k){const m=AU.decks[AU.master];return AU.master!==k&&m.track&&m.playing?m:null}
function auSyncTempo(k){
  const d=AU.decks[k],m=auMasterOf(k);if(!d.sync||!m||!d.track?.bpm||!m.track?.bpm)return;
  // tempo uguale al master, anche a meta'/doppio (70 contro 140)
  let target=auBpm(m);const r=d.track.bpm;while(target/r>1.5)target/=2;while(target/r<.67)target*=2;
  d.tempo=Math.max(-1,Math.min(1,(target/r-1)/d.range));
}
function auSyncPhase(k){
  const d=AU.decks[k],m=auMasterOf(k);if(!m||!auGridOk(d)||!auGridOk(m))return;
  let dp=auPhase(m)-auPhase(d);if(dp>.5)dp-=1;if(dp<-.5)dp+=1;
  d.pos+=dp*auPeriod(d);
}

/* ----- motore simulato (solo finche' il motore vero non c'e') ----- */
function auStep(now){
  if(AU.live){
    if(now-AU.liveAt>2500){AU.live=false;AU.out=null}   // motore sparito: si torna alla simulazione
    else{AU.last=now;for(const k of['A','B']){const d=AU.decks[k];
      if(d.playing&&!d.scrub&&!d.localScrub&&d.track&&d.baseAt)d.pos=Math.min(d.track.seconds,d.basePos+(now-d.baseAt)/1000*auRate(d))}
      return}}
  if(now===AU.last)return;
  const dt=Math.min(.1,(now-(AU.last||now))/1000);AU.last=now;
  for(const k of['A','B']){const d=AU.decks[k],ch=AU.mix[k];
    if(d.sync)auSyncTempo(k);
    if(d.playing&&d.track&&!d.scrub){d.pos+=dt*auRate(d);if(d.pos>=d.track.seconds){d.pos=d.track.seconds;d.playing=false}}
    // livello dal dettaglio della forma d'onda, per i meter
    let lv=0;if(d.playing&&d.wave){const i=Math.floor(d.pos*AU_WAVE_RATE)*3,w=d.wave.detail;lv=Math.max(w[i]||0,w[i+1]||0,w[i+2]||0)/255}
    // meter del canale prima del fader (come sui mixer DJ e nel motore); in uscita conta anche fader e crossfader
    ch.meter=Math.max(lv*ch.gain,ch.meter*.86);ch.out=lv*ch.gain*auXGain(k)*ch.fader}
}
// crossfader a potenza costante: -1 = tutto A, +1 = tutto B
function auXGain(k){const x=(AU.mix.xfader+1)/2;return k==='A'?Math.cos(x*Math.PI/2):Math.sin(x*Math.PI/2)}

/* ----- comandi: un posto solo, poi al motore vero o a quello simulato ----- */
function auCmd(c){
  if(AU.live){const d=c.deck&&AU.decks[c.deck];
    if(c.cmd==='deck.zoom'){d.zoom=c.value;return}
    if(c.cmd==='deck.scrub'&&d.track){d.localScrub=!!c.active;d.pos=Math.max(0,Math.min(d.track.seconds,c.pos))}
    if(c.cmd==='deck.tempo')d.tempo=c.value;
    if(c.cmd==='mix.set')Object.assign(c.ch?AU.mix[c.ch]:AU.mix,c.values);
    emit({type:'audio',...c},true);return}
  const d=c.deck&&AU.decks[c.deck];
  switch(c.cmd){
    // CUE tenuto (preascolto) + PLAY: continua, e lasciando CUE non si ferma (come i CDJ)
    case'deck.play':{if(!d.track)return;d.playing=d.preview?true:!d.playing;d.preview=false;if(d.playing&&d.sync)auSyncPhase(c.deck);
      // diventa master solo se il master attuale non e' un altro deck in onda
      const o=AU.decks[c.deck==='A'?'B':'A'];if(d.playing&&!(o.playing&&o.track))AU.master=c.deck;break}
    case'deck.cue_down':if(!d.track)return;
      if(d.playing){d.playing=false;d.pos=d.cue}
      else if(Math.abs(d.pos-d.cue)>.02){d.cue=auSnap(d,d.pos);auSaveCues(c.deck)}
      else{d.preview=true;d.playing=true}break;
    case'deck.cue_up':if(d.preview){d.preview=false;d.playing=false;d.pos=d.cue}break;
    case'deck.scrub':if(d.track){d.scrub=!!c.active;d.pos=Math.max(0,Math.min(d.track.seconds,c.pos));if(!c.active&&d.playing&&d.sync)auSyncPhase(c.deck)}break;
    case'deck.zoom':d.zoom=c.value;break;
    case'deck.jump':{if(!d.track)return;
      // punto precedente/successivo: inizio traccia, cue, hot cue (a meno di 0,3 s indietro si salta a quello prima)
      const pts=[0,d.cue,...d.hot.filter(t=>t!=null)].sort((a,b)=>a-b);
      const t=c.dir<0?[...pts].reverse().find(t=>t<d.pos-.3)??0:pts.find(t=>t>d.pos+.05);
      if(t!=null){d.pos=t;if(d.playing&&d.sync)auSyncPhase(c.deck)}break}
    case'deck.snap':d.snap=!d.snap;break;
    case'deck.seek':if(d.track)d.pos=Math.max(0,Math.min(d.track.seconds,c.pos));if(d.playing&&d.sync)auSyncPhase(c.deck);break;
    case'deck.hotcue':if(!d.track)return;
      if(c.op==='clear'){d.hot[c.n]=null;auSaveCues(c.deck)}
      else if(d.hot[c.n]==null){d.hot[c.n]=auSnap(d,d.pos);auSaveCues(c.deck)}
      else{d.pos=d.hot[c.n];if(d.playing&&d.sync)auSyncPhase(c.deck)}break;
    case'deck.tempo':d.tempo=Math.max(-1,Math.min(1,c.value));
      // deck agganciato: regolarlo a mano lo toglie dal SYNC, l'altro deck non cambia mai
      if(d.sync&&auMasterOf(c.deck))d.sync=false;break;
    case'deck.trim':{const v=Math.max(-50,Math.min(50,+c.ms||0));if(d.track)d.pos=Math.max(0,d.pos+(v-(d.trimMs||0))/1000);d.trimMs=v;break}
    case'deck.range':d.range=c.value;break;
    case'deck.nudge':d.nudge=c.value;break;
    case'deck.sync':d.sync=!d.sync;if(d.sync){auSyncTempo(c.deck);if(d.playing)auSyncPhase(c.deck)}break;
    case'deck.master':AU.master=c.deck;AU.decks[c.deck].sync=false;break;
    case'deck.keylock':d.keylock=!d.keylock;break;
    case'mix.set':if(c.ch)Object.assign(AU.mix[c.ch],c.values);else Object.assign(AU.mix,c.values);break;
  }
}

/* ----- disegno ----- */
const auFmtFine=s=>{s=Math.max(0,s||0);return`${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,'0')}`};
const auFmt=s=>{s=Math.max(0,s||0);return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`};
function auCanvas(cv){const r=cv.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);
  if(w&&h&&(cv.width!==w||cv.height!==h)){cv.width=w;cv.height=h}return cv.getContext('2d')}
// forma d'onda di dettaglio attorno alla testina: basse blu, medie ambra, alte bianche (come Traktor)
function auDrawWave(cv,d,col){
  const g=auCanvas(cv),W=cv.width,H=cv.height;if(!W)return;g.clearRect(0,0,W,H);
  if(!d.track||!d.wave){g.fillStyle='#868e9b';g.font=`${12*(devicePixelRatio||1)}px sans-serif`;g.fillText(d.loading?'carico…':'nessuna traccia',8,H/2);return}
  const span=d.zoom,pps=W/span,t0=d.pos-span/2,det=d.wave.detail,mid=H/2;
  for(let x=0;x<W;x++){const i=Math.floor((t0+x/pps)*AU_WAVE_RATE);if(i<0||i*3>=det.length)continue;
    const l=det[i*3]/255,m=det[i*3+1]/255,h=det[i*3+2]/255,played=x<W/2;
    g.fillStyle=played?'#1d4f8a':'#2f7fdc';g.fillRect(x,mid-l*mid*.95,1,l*mid*1.9);
    g.fillStyle=played?'#8a6020':'#ffb23e';g.fillRect(x,mid-m*mid*.7,1,m*mid*1.4);
    g.fillStyle=played?'#888':'#fff';g.fillRect(x,mid-h*mid*.45,1,h*mid*.9)}
  const p=auPeriod(d);
  if(p){const fb=d.track.first_beat,ok=auGridOk(d);let k=Math.ceil((t0-fb)/p);
    for(let t=fb+k*p;t<t0+span;t+=p,k++){const x=(t-t0)*pps;g.fillStyle=!ok?'rgba(255,93,93,.35)':k%4===0?'rgba(255,255,255,.75)':'rgba(255,255,255,.22)';g.fillRect(x,0,k%4===0?2:1,H)}}
  const mark=(t,c)=>{const x=(t-t0)*pps;if(x<0||x>W)return;g.fillStyle=c;g.beginPath();g.moveTo(x-6,0);g.lineTo(x+6,0);g.lineTo(x,9);g.fill()};
  mark(d.cue,'#ff5d5d');d.hot.forEach(t=>t!=null&&mark(t,'#4fd18b'));
  g.fillStyle=col;g.fillRect(W/2-1,0,2,H);
}
function auDrawOver(cv,d,col){
  const g=auCanvas(cv),W=cv.width,H=cv.height;if(!W)return;g.clearRect(0,0,W,H);
  if(!d.track||!d.wave)return;
  if(!d.overImg||d.overImg.width!==W){const o=document.createElement('canvas');o.width=W;o.height=H;const og=o.getContext('2d'),ov=d.wave.overview;
    og.fillStyle='#5b6372';for(let x=0;x<W;x++){const v=ov[Math.floor(x/W*ov.length)]/255;og.fillRect(x,H/2-v*H/2,1,v*H)}d.overImg=o}
  g.drawImage(d.overImg,0,0);
  const px=d.pos/d.track.seconds*W;g.fillStyle='rgba(12,14,17,.55)';g.fillRect(0,0,px,H);
  g.fillStyle='#ff5d5d';g.fillRect(d.cue/d.track.seconds*W,0,2,H);
  g.fillStyle='#4fd18b';d.hot.forEach(t=>t!=null&&g.fillRect(t/d.track.seconds*W,0,2,H));
  g.fillStyle=col;g.fillRect(px-1,0,2,H);
  if(d.track.seconds-d.pos<30&&d.playing&&Math.floor(performance.now()/400)%2){g.strokeStyle='#ff5d5d';g.lineWidth=3;g.strokeRect(0,0,W,H)}
}

/* ----- widget: deck ----- */
function auDeckHtml(w){
  const k=w.deck||'A';
  return`<div class="au au-deck" data-deck="${k}">
  <div class="au-head"><b class="au-letter">${k}</b><div class="au-title"><span class="t"></span><span class="a"></span></div>
    <div class="au-bpm"><b></b><i></i></div></div>
  <canvas class="au-wave" data-au="wave" title="Trascina per spostare la traccia sotto la testina; rotella: scorri, Ctrl+rotella: zoom"></canvas><canvas class="au-over" data-au="seek"></canvas>
  <div class="au-time"><span class="el"></span><span class="st"></span>
    <button class="au-btn sm" data-au="jump" data-v="-1" title="Punto precedente: hot cue, cue o inizio traccia">⏮</button><button class="au-btn sm" data-au="jump" data-v="1" title="Punto successivo: cue o hot cue">⏭</button>
    <button class="au-btn sm" data-au="snap" title="Acceso: cue e hot cue sul battito. Spento: dove metti la testina">SNAP</button>
    <button class="au-btn sm" data-au="zoom" data-v="-1" title="Zoom: piu' traccia">−</button><span class="zm"></span><button class="au-btn sm" data-au="zoom" data-v="1" title="Zoom: piu' preciso">+</button>
    <span class="rem"></span></div>
  <div class="au-ctl">
    <button class="au-btn cue" data-au="cue">CUE</button><button class="au-btn play" data-au="play">▶</button>
    <button class="au-btn" data-au="sync">SYNC</button><button class="au-btn" data-au="master">MASTER</button><button class="au-btn" data-au="keylock">KEY</button>
    <button class="au-btn" data-au="grid" title="Correggi la griglia dei battiti di questa traccia (BPM e battito 1)">GRID</button>
  </div>
  <div class="au-hot">${Array.from({length:AU_HOT},(_,i)=>`<button class="au-btn" data-au="hot" data-n="${i}" title="Vuoto: salva qui. Pieno: salta. Tieni premuto: cancella.">${i+1}</button>`).join('')}</div>
  <div class="au-grid" hidden>
    <button class="au-btn" data-au="gop" data-op="anchor" title="Il battito 1 della battuta (la cassa) è dove sta la testina: porta la testina sul colpo (trascina la forma d'onda) e tocca qui">⌖ 1 QUI</button>
    <button class="au-btn" data-au="gop" data-op="move" data-v="-0.005" title="Griglia 5 ms prima">‹ 5ms</button>
    <button class="au-btn" data-au="gop" data-op="move" data-v="0.005" title="Griglia 5 ms dopo">5ms ›</button>
    <button class="au-btn" data-au="gop" data-op="half" title="BPM a metà">÷2</button>
    <button class="au-btn" data-au="gop" data-op="double" title="BPM doppio">×2</button>
    <button class="au-btn" data-au="gbpm" title="Scrivi il BPM esatto">BPM</button>
    <button class="au-btn" data-au="gtap" title="Batti a tempo (almeno 4 colpi): diventa il BPM della traccia">TAP</button>
  </div>
  <div class="au-tempo"><button class="au-btn" data-au="nudge" data-v="-1" title="Tieni premuto: rallenta">‹‹</button>
    <input type="range" min="-1" max="1" step="0.001" value="0" data-au-r="tempo" data-deck="${k}" title="Tempo (doppio tocco: 0)">
    <button class="au-btn" data-au="nudge" data-v="1" title="Tieni premuto: accelera">››</button>
    <button class="au-btn au-trim" data-au="trim" data-v="-1" title="Fase fine: 1 ms indietro (resta). Doppio tocco: 0">‹1</button>
    <button class="au-btn au-trim" data-au="trim" data-v="1" title="Fase fine: 1 ms avanti (resta). Doppio tocco: 0">1›</button>
    <select data-au-s="range" data-deck="${k}">${AU_RANGES.map(r=>`<option value="${r}">±${r*100}%</option>`).join('')}</select></div>
</div>`}
function auPaintDeck(el,w){
  const box=el.querySelector('.au-deck');if(!box)return;const k=box.dataset.deck,d=AU.decks[k],col=w.color||SWATCH[0];
  auDrawWave(box.querySelector('.au-wave'),d,col);auDrawOver(box.querySelector('.au-over'),d,col);
  const set=(sel,txt)=>{const e=box.querySelector(sel);if(e&&e.textContent!==txt)e.textContent=txt};
  set('.au-title .t',d.track?d.track.title:(d.loading?'carico…':'Scegli una traccia dalla libreria: pulsante A o B'));
  set('.au-title .a',d.track?d.track.artist:'');
  set('.au-bpm b',d.track?.bpm?auBpm(d).toFixed(2):'—');
  set('.au-bpm i',`${d.tempo*d.range>=0?'+':''}${(d.tempo*d.range*100).toFixed(1)}%`);
  set('.au-time .el',d.playing?auFmt(d.pos):auFmtFine(d.pos));set('.au-time .zm',d.zoom+' s');
  box.querySelector('[data-au=snap]')?.classList.toggle('on',d.snap);set('.au-time .rem','-'+auFmt((d.track?.seconds||0)-d.pos));
  set('.au-time .st',d.gridEdit&&d.track?`GRID · ${d.track.bpm?d.track.bpm.toFixed(2):'—'} BPM${d.track.locked?' · bloccata':''}${AU.live?'':' · serve il motore'}`:audioDoc().active&&G.audioTlSt?.engine?'TIMELINE: comanda la traccia AUDIO':!d.track?'':!auGridOk(d)?'griglia incerta: sync solo tempo':d.sync&&!auMasterOf(k)?'sync: nessun master in onda':AU.live&&d.sync&&d.phaseErr!=null?`SYNC · fase ${d.phaseErr>=0?'+':''}${d.phaseErr.toFixed(1)} ms${d.trimMs?` · fine ${d.trimMs>0?'+':''}${d.trimMs} ms`:''}${Math.abs(d.phaseErr)>5?' · aggancio…':''}`:AU.live?(d.track?.variable?'tempo variabile: controlla la griglia':''):'simulazione');
  const on=(sel,v)=>box.querySelector(sel)?.classList.toggle('on',!!v);
  on('[data-au=grid]',d.gridEdit);
  const hotRow=box.querySelector('.au-hot'),gridRow=box.querySelector('.au-grid');if(gridRow&&gridRow.hidden===!!d.gridEdit){gridRow.hidden=!d.gridEdit;hotRow.hidden=!!d.gridEdit}
  on('[data-au=play]',d.playing);on('[data-au=sync]',d.sync);on('[data-au=master]',AU.master===k&&d.playing);on('[data-au=keylock]',d.keylock);
  box.querySelector('[data-au=play]').textContent=d.playing?'❚❚':'▶';
  box.querySelectorAll('[data-au=hot]').forEach(b=>b.classList.toggle('on',d.hot[+b.dataset.n]!=null));
  const r=box.querySelector('[data-au-r=tempo]');if(r&&document.activeElement!==r&&+r.value!==d.tempo)r.value=d.tempo;
  const s=box.querySelector('[data-au-s=range]');if(s&&document.activeElement!==s&&+s.value!==d.range)s.value=d.range;
}

/* ----- widget: mixer ----- */
// manopola rotativa: dentro c'e' l'input range di sempre (nascosto), la manopola lo muove
// trascinando in verticale (su = destra); doppio tocco: torna al centro. bip = arco dal centro.
const AU_ROT=135;
function auRot(key,label,min,max,v,ch,title){
  const bip=min<0||key==='gain';
  return`<div class="au-rot${bip?' bip':''}" data-au="rot" title="${title||label} (trascina su/giù, doppio tocco: centro)">
    <svg viewBox="0 0 40 40"><path class="tr" d="${auArc(-AU_ROT,AU_ROT)}"/><path class="val" d=""/><circle class="cap" cx="20" cy="20" r="10.5"/><line class="ptr" x1="20" y1="20" x2="20" y2="10.5"/></svg>
    <span>${label}</span><input type="range" hidden min="${min}" max="${max}" step="0.01" value="${v}" data-au-r="mix" ${ch?`data-ch="${ch}" `:''}data-key="${key}"></div>`}
function auArc(a1,a2){const R=16,p=a=>{const r=(a-90)*Math.PI/180;return`${(20+R*Math.cos(r)).toFixed(2)} ${(20+R*Math.sin(r)).toFixed(2)}`};
  if(Math.abs(a2-a1)<.5)return'';return`M${p(a1)} A${R} ${R} 0 ${a2-a1>180?1:0} 1 ${p(a2)}`}
function auPaintRot(box){
  box.querySelectorAll('.au-rot').forEach(el=>{const r=el.querySelector('input'),f=(+r.value-+r.min)/(+r.max-+r.min);
    if(el._f===f)return;el._f=f;const a=-AU_ROT+2*AU_ROT*f,b=el.classList.contains('bip')?0:-AU_ROT;
    el.querySelector('.val').setAttribute('d',auArc(Math.min(a,b),Math.max(a,b)));
    el.querySelector('.ptr').setAttribute('transform',`rotate(${a.toFixed(1)} 20 20)`)})}
function auStripHtml(k){
  const knob=(key,label,min,max,v)=>auRot(key,label,min,max,v,k);
  return`<div class="au-strip" data-ch="${k}"><b class="au-letter">${k}</b>
    <div class="au-body"><div class="au-rots">${knob('gain','GAIN',0,2,1)}${knob('hi','HI',-1,1,0)}${knob('mid','MID',-1,1,0)}${knob('lo','LOW',-1,1,0)}${knob('filter','FILTRO',-1,1,0)}</div>
    <div class="au-fadcol"><div class="au-fadrow"><canvas class="au-meter" data-ch="${k}"></canvas><input class="au-vfader" type="range" min="0" max="1" step="0.01" value="1" data-au-r="mix" data-ch="${k}" data-key="fader"></div>
    <button class="au-btn au-hp" data-au="chcue" data-ch="${k}" title="Preascolto in cuffia">🎧</button></div></div></div>`}
function auMixerHtml(){
  return`<div class="au au-mixer"><div class="au-strips">${auStripHtml('A')}
    <div class="au-strip au-mid"><b class="au-letter">M</b>
      <div class="au-body"><div class="au-rots">${auRot('master','MASTER',0,1,.9)}${auRot('cue_mix','CUE · MIX',0,1,.5,null,'Cuffia: a sinistra solo i canali con 🎧, a destra solo il master')}${auRot('cue_level','CUE · VOL',0,1,.8,null,'Volume della cuffia')}</div>
      <div class="au-fadcol"><div class="au-fadrow au-mst" title="Uscita master: sinistro e destro"><canvas class="au-meter" data-ch="L"></canvas><canvas class="au-meter" data-ch="R"></canvas></div>
      <div class="au-lr au-hp"><span>L</span><span>R</span></div></div></div></div>
    ${auStripHtml('B')}</div>
    <label class="au-xf"><span>A</span><input type="range" min="-1" max="1" step="0.01" value="0" data-au-r="mix" data-key="xfader" title="Crossfader (doppio tocco: centro)"><span>B</span></label></div>`}
function auPaintMixer(el){
  const box=el.querySelector('.au-mixer');if(!box)return;
  box.querySelectorAll('.au-meter').forEach(cv=>{const g=auCanvas(cv),W=cv.width,H=cv.height;if(!W)return;
    const k=cv.dataset.ch,sim=()=>Math.max(AU.mix.A.out||0,AU.mix.B.out||0)*AU.mix.master,v=Math.min(1,k==='L'?(AU.live?AU.meterL:sim()):k==='R'?(AU.live?AU.meterR:sim()):AU.mix[k].meter);
    g.clearRect(0,0,W,H);g.fillStyle='#272c35';g.fillRect(0,0,W,H);
    const h=v*H;const grd=g.createLinearGradient(0,H,0,0);grd.addColorStop(0,'#4fd18b');grd.addColorStop(.75,'#ffb23e');grd.addColorStop(1,'#ff5d5d');
    g.fillStyle=grd;g.fillRect(0,H-h,W,h)});
  box.querySelectorAll('[data-au-r=mix]').forEach(r=>{if(document.activeElement===r||r.parentNode.classList.contains('drag'))return;
    const v=r.dataset.ch?AU.mix[r.dataset.ch][r.dataset.key]:AU.mix[r.dataset.key];if(+r.value!==v)r.value=v});
  auPaintRot(box);
  // 🎧: senza canali cuffia sull'uscita del motore (scheda a 2 canali) il preascolto non si sente
  const noPh=AU.live&&AU.phones===false;
  box.querySelectorAll('[data-au=chcue]').forEach(b=>{b.classList.toggle('on',AU.mix[b.dataset.ch].cue);b.classList.toggle('na',noPh);
    const t=noPh?'Preascolto in cuffia: l\'uscita del motore non ha i canali 3-4 (cuffia)':'Preascolto in cuffia (canali 3-4 della scheda)';if(b.title!==t)b.title=t});
}

/* ----- widget: libreria e playlist ----- */
// Playlist globali (come la collezione di Traktor): le salva il bridge accanto
// all'analisi (audio-lib.js, <cache>/playlists.json) e le rimanda a tutti i tablet.
// AU.lib.view = '' (tutta la libreria) | id della playlist mostrata.
function auPlaylist(id){return AU.playlists.find(p=>p.id===id)||null}
function auSavePlaylists(list){
  if(!bridgeOnline()){showError('Playlist: server OPS non connesso, modifica non salvata.');return false}
  AU.playlists=list;emit({type:'audio_playlists_set',playlists:list},true);return true;
}
function auSetPlaylist(id,fn){const list=AU.playlists.map(p=>p.id===id?{...fn({...p,tracks:[...p.tracks]}),updated:new Date().toISOString()}:p);return auSavePlaylists(list)}
async function auNewPlaylist(withTrack){
  const name=(await uiPrompt('Nome della nuova playlist',''))?.trim();if(!name)return null;
  const p={id:'pl-'+uid()+uid(),name:name.slice(0,80),tracks:withTrack?[withTrack]:[],updated:new Date().toISOString()};
  if(!auSavePlaylists([...AU.playlists,p]))return null;
  showInfo(`Playlist "${p.name}" creata${withTrack?' con il brano':''}.`);return p;
}
async function auAddToPlaylist(id){
  const t=AU.tracks.find(x=>x.id===id);if(!t)return;
  const pick=await uiChoose(`Aggiungi "${t.title}" a…`,[...AU.playlists.map(p=>({label:`${p.name} (${p.tracks.length})`,value:p.id,on:p.id===AU.lib.lastPl})),{label:'＋ Nuova playlist…',value:'__new'}]);
  if(pick==null)return;
  if(pick==='__new'){const p=await auNewPlaylist(id);if(p)AU.lib.lastPl=p.id;return}
  const p=auPlaylist(pick);if(!p)return;AU.lib.lastPl=pick;
  if(p.tracks.includes(id)){showInfo(`"${t.title}" è già in "${p.name}".`);return}
  if(auSetPlaylist(pick,x=>({...x,tracks:[...x.tracks,id]})))showInfo(`"${t.title}" aggiunto a "${p.name}" (${p.tracks.length+1}).`);
}
async function auPlaylistMenu(){
  const p=auPlaylist(AU.lib.view);if(!p)return;
  const pick=await uiChoose(`Playlist "${p.name}"`,[{label:'Rinomina',value:'ren'},{label:'Duplica',value:'dup'},{label:'Svuota',value:'clr'},{label:'Elimina playlist',value:'del',cls:'danger'}]);
  if(pick==='ren'){const n=(await uiPrompt('Nuovo nome',p.name))?.trim();if(n)auSetPlaylist(p.id,x=>({...x,name:n.slice(0,80)}))}
  else if(pick==='dup'){const c={...p,id:'pl-'+uid()+uid(),name:(p.name+' (copia)').slice(0,80),tracks:[...p.tracks],updated:new Date().toISOString()};if(auSavePlaylists([...AU.playlists,c]))AU.lib.view=c.id}
  else if(pick==='clr'){if(await uiConfirm(`Togliere tutti i ${p.tracks.length} brani da "${p.name}"?`,{ok:'Svuota'}))auSetPlaylist(p.id,x=>({...x,tracks:[]}))}
  else if(pick==='del'){const used=auTimelineUses(p.id);
    if(!await uiConfirm(`Eliminare la playlist "${p.name}"?${used?`\nÈ usata da ${used} cue della traccia AUDIO: resteranno senza playlist.`:''}\nI brani restano nella libreria.`,{ok:'Elimina'}))return;
    if(auSavePlaylists(AU.playlists.filter(x=>x.id!==p.id))){AU.lib.view='';showInfo(`Playlist "${p.name}" eliminata.`)}}
}
// cue della timeline audio che usano una playlist (pagina Timeline): 0 se il modulo non c'e'
function auTimelineUses(id){return(L.audioTimeline?.cues||[]).filter(c=>c.src?.kind==='playlist'&&c.src.id===id).length}
function auLibRows(){
  const q=AU.lib.q.trim().toLowerCase(),match=t=>!q||(t.title+' '+t.artist+' '+t.folder).toLowerCase().includes(q);
  const pl=auPlaylist(AU.lib.view);
  // playlist: nell'ordine della playlist (i brani tolti dalla libreria restano visibili, da togliere)
  if(pl){const byId=new Map(AU.tracks.map(t=>[t.id,t]));
    return pl.tracks.map((id,i)=>({...(byId.get(id)||{id,title:'(brano non più in libreria)',artist:'',folder:'',bpm:0,seconds:0,confidence:0,missing:true}),plIndex:i})).filter(match)}
  const f=AU.lib.folder;
  let list=AU.tracks.filter(t=>(!f||t.folder===f)&&match(t));
  const key=AU.lib.sort,dir=AU.lib.dir,val=t=>key==='bpm'?t.bpm:key==='seconds'?t.seconds:key==='confidence'?t.confidence:String(t[key]||'').toLowerCase();
  list=[...list].sort((a,b)=>{const x=val(a),y=val(b);return(x<y?-1:x>y?1:0)*dir});
  return list;
}
function auLibHtml(){
  return`<div class="au au-lib"><div class="au-libbar"><span class="au-sim"></span>
    <select data-au-s="view" title="Tutta la libreria o una playlist"></select>
    <button class="btn sm ghost" data-au="plnew" title="Nuova playlist">＋ Playlist</button>
    <button class="btn sm ghost au-plmenu" data-au="plmenu" title="Rinomina, duplica, svuota o elimina la playlist">⋯</button>
    <span class="au-auto"></span>
    <input type="search" placeholder="Cerca titolo, artista, cartella" data-au-s="q">
    <select data-au-s="folder"></select>
    <span class="au-libn hint"></span>
    <button class="btn sm ghost" data-au="libreload">Aggiorna</button></div>
    <div class="au-libtab"></div></div>`}
// Autoplay (audio-auto.js nel bridge): suona da solo dalla playlist scelta qui sopra o da tutta
// la libreria, in ordine o a caso, con dissolvenza. Indipendente dalla timeline.
function auAutoHtml(){
  const a=G.audioAuto;
  if(!a?.active)return`<button class="btn sm au-auto-go" data-au="autogo" title="Suona da solo: dalla playlist scelta (o da tutta la libreria), in ordine o a caso, con dissolvenza tra i brani">▶ AUTO</button>`;
  const who=x=>x?esc(x.title+(x.artist?' – '+x.artist:'')):'';
  const msg=a.stopping?'si ferma…':a.waiting?'in attesa: comanda la traccia AUDIO della timeline':a.error?esc(a.error)
    :a.now?`${a.now.deck} · ${who(a.now)} <span class="dim">${auFmt(a.now.pos)} / ${auFmt(a.now.len)}</span>${a.next?` <span class="dim">→ ${who(a.next)}</span>`:''}`:'carico…';
  return`<span class="au-auto-on" title="${esc(`${a.sourceName} · ${a.mode==='order'?'in ordine':'a caso'} · dissolvenza ${a.fade} s`)}"><b>AUTO</b> ${msg}</span>
    <button class="au-btn" data-au="autonext" title="Brano successivo (con dissolvenza)"${a.stopping||a.waiting?' disabled':''}>⏭</button><button class="au-btn" data-au="autostop" title="Ferma l'autoplay (sfuma il brano in onda)"${a.stopping?' disabled':''}>■</button>`}
async function auAutoStart(){
  const pl=auPlaylist(AU.lib.view),src=pl?`la playlist "${pl.name}" (${pl.tracks.length} brani)`:`tutta la libreria (${AU.tracks.length} brani)`;
  const mode=await uiChoose(`Autoplay da ${src}`,[...(pl?[{label:'In ordine',value:'order'}]:[]),{label:'A caso',value:'shuffle'}],
    {hint:'Suona da solo sui deck A e B, alternandoli, finché non lo fermi. Per cambiare sorgente scegli prima la playlist nella Libreria. Se la traccia AUDIO della timeline è accesa comanda lei e l\'autoplay aspetta.'});
  if(!mode)return;
  const fade=await uiChoose('Dissolvenza tra un brano e l\'altro',[0,4,8,12,20].map(s=>({label:s?`${s} s`:'Nessuna (taglio)',value:String(s),on:s===8})));
  if(fade==null)return;
  emit({type:'audio_auto',action:'start',source:pl?pl.id:'',mode,fade:+fade},true);
}
function auPaintLib(el){
  const box=el.querySelector('.au-lib');if(!box)return;
  {const ab=box.querySelector('.au-auto'),a=G.audioAuto,h=auAutoHtml(),sig=a?.active?JSON.stringify({...a,now:a.now&&{...a.now,pos:Math.floor(a.now.pos)}}):'off';
    if(ab&&ab._sig!==sig){ab._sig=sig;ab.innerHTML=h;ab.classList.toggle('on',!!a?.active)}}
  if(AU.lib.view&&!auPlaylist(AU.lib.view))AU.lib.view='';   // playlist eliminata da un altro tablet
  const pl=auPlaylist(AU.lib.view);
  const vs=box.querySelector('[data-au-s=view]'),vsig=JSON.stringify([AU.lib.view,AU.playlists.map(p=>[p.id,p.name,p.tracks.length])]);
  if(vs._sig!==vsig){vs._sig=vsig;vs.innerHTML=`<option value="">Tutta la libreria</option>`+AU.playlists.map(p=>`<option value="${esc(p.id)}">▶ ${esc(p.name)} (${p.tracks.length})</option>`).join('');vs.value=AU.lib.view}
  box.querySelector('.au-plmenu').hidden=!pl;
  const folders=[...new Set(AU.tracks.map(t=>t.folder))].sort();
  const fs=box.querySelector('[data-au-s=folder]'),fsig=folders.join('|');
  if(fs._sig!==fsig){fs._sig=fsig;fs.innerHTML=`<option value="">Tutte le cartelle</option>`+folders.map(f=>`<option>${esc(f)}</option>`).join('');fs.value=AU.lib.folder}
  fs.hidden=!!pl;
  const sim=box.querySelector('.au-sim'),o=AU.out;
  const [st,tip]=!AU.live?['SIMULAZIONE · NESSUN SUONO','Il motore audio gaia-audio non è collegato: i comandi si provano qui, ma non esce suono']
    :o?.ok?['MOTORE · '+o.device+(AU.lightsOut?(AU.lightsOut.ok?' · LUCI ✓':' · LUCI ✗'):''),'Motore gaia-audio collegato: uscita '+o.device+(o.rate?' a '+o.rate+' Hz':'')+(AU.cueOut?(AU.cueOut.ok?' · cuffia: '+AU.cueOut.device:' · cuffia NON aperta ('+(AU.cueOut.device||'')+': '+(AU.cueOut.error||'?')+')'):'')+(AU.lightsOut?(AU.lightsOut.ok?' · luci (DMX Master): '+AU.lightsOut.device+' a '+AU.lightsOut.rate+' Hz':' · uscita luci NON aperta ('+(AU.lightsOut.device||'')+': '+(AU.lightsOut.error||'?')+')'):'')]
    :['MOTORE · NESSUNA USCITA','Motore collegato ma senza scheda audio: '+(o?.error||'uscita non aperta')+'. Riprova da solo ogni 5 s.'];
  if(sim.textContent!==st){sim.textContent=st;sim.title=tip;sim.classList.toggle('live',!!(AU.live&&o?.ok))}
  const rows=auLibRows(),loaded=['A','B'].map(k=>AU.decks[k].track?.id||'');
  const sig=JSON.stringify([AU.libState,AU.lib,rows.length,rows.map(r=>r.id).join().length,rows[0]?.id,rows[rows.length-1]?.id,loaded,pl?.tracks]);
  const tab=box.querySelector('.au-libtab');if(tab._sig===sig)return;tab._sig=sig;
  const tot=pl?pl.tracks.reduce((s,id)=>s+(AU.tracks.find(t=>t.id===id)?.seconds||0),0):0;
  box.querySelector('.au-libn').textContent=AU.libState||(pl?`${pl.tracks.length} brani · ${auFmt(tot)}`:`${rows.length} di ${AU.tracks.length} tracce`);
  const th=(k,l)=>pl?`<th>${l}</th>`:`<th data-au="sort" data-k="${k}"${AU.lib.sort===k?` class="on"`:''}>${l}${AU.lib.sort===k?(AU.lib.dir>0?' ▲':' ▼'):''}</th>`;
  const n=pl?pl.tracks.length:0;
  const ctl=t=>pl?`<td class="au-plctl"><button class="au-btn" data-au="plup" data-i="${t.plIndex}"${t.plIndex?'':' disabled'} title="Su">▲</button><button class="au-btn" data-au="pldown" data-i="${t.plIndex}"${t.plIndex<n-1?'':' disabled'} title="Giù">▼</button><button class="au-btn" data-au="plrm" data-i="${t.plIndex}" title="Togli dalla playlist">✕</button></td>`
    :`<td class="au-plctl"><button class="au-btn" data-au="pladd" data-id="${t.id}" title="Aggiungi a una playlist">＋</button></td>`;
  tab.innerHTML=`<table><thead><tr><th></th>${pl?'<th>#</th>':''}${th('title','Titolo')}${th('artist','Artista')}${th('bpm','BPM')}${th('seconds','Durata')}${th('confidence','Griglia')}${pl?'':th('folder','Cartella')}<th></th></tr></thead><tbody>
    ${rows.slice(0,400).map(t=>`<tr${loaded.includes(t.id)?' class="on"':''}${t.missing?' class="au-miss"':''}><td class="au-load">${t.missing?'':`<button class="au-btn" data-au="load" data-deck="A" data-id="${t.id}">A</button><button class="au-btn" data-au="load" data-deck="B" data-id="${t.id}">B</button>`}</td>
      ${pl?`<td class="num dim">${t.plIndex+1}</td>`:''}<td>${esc(t.title)}</td><td class="dim">${esc(t.artist)}</td><td class="num">${t.bpm?t.bpm.toFixed(2):'—'}</td><td class="num">${t.missing?'—':auFmt(t.seconds)}</td>
      <td>${t.missing?'':t.locked?'<span class="au-gr ok">a mano</span>':t.variable?'<span class="au-gr bad" title="Il tempo cambia lungo il brano (suonato dal vivo): controlla la griglia">variabile</span>':t.confidence>=.4?`<span class="au-gr ok"${t.residual_ms!=null?` title="colpi di cassa a ${t.residual_ms} ms dalla griglia"`:''}>ok</span>`:'<span class="au-gr bad">incerta</span>'}</td>${pl?'':`<td class="dim">${esc(t.folder)}</td>`}${ctl(t)}</tr>`).join('')}
    </tbody></table>${pl&&!n?'<p class="hint">Playlist vuota: torna a "Tutta la libreria" e aggiungi i brani con ＋.</p>':''}${rows.length>400?`<p class="hint">Prime 400 di ${rows.length}: cerca o scegli una cartella.</p>`:''}`;
}

/* ----- tocco ----- */
let auHold=null;   // pulsante tenuto (cue, nudge, hot cue lungo)
function auDown(e,el,w){
  if(e.target.closest('input,select'))return;
  const b=e.target.closest('[data-au]');if(!b)return;e.preventDefault();
  const a=b.dataset.au,k=b.closest('[data-deck]')?.dataset.deck||b.dataset.deck;
  if(a==='rot'){const r=b.querySelector('input'),y0=e.clientY,v0=+r.value,span=+r.max-+r.min;b.classList.add('drag');
    // 160 px = corsa intera; con Shift piu' fine
    auHold={move:ev=>{const v=Math.max(+r.min,Math.min(+r.max,v0+(y0-ev.clientY)/(ev.shiftKey?640:160)*span));if(Math.abs(v-+r.value)<.004)return;
        r.value=v;r.dispatchEvent(new Event('input',{bubbles:true}))},up:()=>b.classList.remove('drag')};return}
  if(a==='play')auCmd({cmd:'deck.play',deck:k});
  else if(a==='cue'){auCmd({cmd:'deck.cue_down',deck:k});auHold={up:()=>auCmd({cmd:'deck.cue_up',deck:k})}}
  else if(a==='sync')auCmd({cmd:'deck.sync',deck:k});
  else if(a==='master')auCmd({cmd:'deck.master',deck:k});
  else if(a==='keylock')auCmd({cmd:'deck.keylock',deck:k});
  else if(a==='trim'){const d=AU.decks[k],now=Date.now(),dbl=b._t&&now-b._t<350;b._t=now;
    auCmd({cmd:'deck.trim',deck:k,ms:dbl?0:Math.max(-50,Math.min(50,(d.trimMs||0)+ +b.dataset.v))})}
  else if(a==='nudge'){auCmd({cmd:'deck.nudge',deck:k,value:.04*+b.dataset.v});auHold={up:()=>auCmd({cmd:'deck.nudge',deck:k,value:0})}}
  else if(a==='hot'){const n=+b.dataset.n,t=setTimeout(()=>{auCmd({cmd:'deck.hotcue',deck:k,n,op:'clear'});auHold=null},600);
    auHold={up:()=>{clearTimeout(t);auCmd({cmd:'deck.hotcue',deck:k,n,op:'go'})}}}
  else if(a==='wave'){const d=AU.decks[k];if(!d.track)return;
    // trascinare la forma d'onda sposta la traccia sotto la testina (a sinistra = avanti)
    const r=b.getBoundingClientRect(),x0=e.clientX,p0=d.pos;
    auCmd({cmd:'deck.scrub',deck:k,active:true,pos:p0});
    auHold={move:ev=>auCmd({cmd:'deck.scrub',deck:k,active:true,pos:p0-(ev.clientX-x0)/r.width*d.zoom}),
      up:()=>auCmd({cmd:'deck.scrub',deck:k,active:false,pos:AU.decks[k].pos})}}
  else if(a==='zoom'){const d=AU.decks[k],i=AU_ZOOMS.indexOf(d.zoom);auCmd({cmd:'deck.zoom',deck:k,value:AU_ZOOMS[Math.max(0,Math.min(AU_ZOOMS.length-1,(i<0?2:i)-(+b.dataset.v)))]})}
  else if(a==='snap')auCmd({cmd:'deck.snap',deck:k});
  else if(a==='grid'){const d=AU.decks[k];d.gridEdit=!d.gridEdit;auTaps[k]=[]}
  else if(a==='gop')auGridEdit(k,b.dataset.op,b.dataset.v!=null?+b.dataset.v:undefined);
  else if(a==='gbpm'){const d=AU.decks[k];if(!d.track)return;uiPrompt(`BPM esatto di "${d.track.title}"`,d.track.bpm?d.track.bpm.toFixed(2):'').then(v=>{const b=parseFloat(String(v||'').replace(',','.'));if(b>20&&b<400)auGridEdit(k,'bpm',b);else if(v)showError('BPM tra 20 e 400.')})}
  else if(a==='gtap'){const t=performance.now(),list=(auTaps[k]=(auTaps[k]||[]).filter(x=>t-x<3000).concat(t));
    if(list.length>=4){const iv=(list[list.length-1]-list[0])/(list.length-1)/1000,b=Math.round(60/iv*100)/100;showInfo(`TAP: ${b} BPM (${list.length} colpi)`);
      if(list.length>=6)auGridEdit(k,'bpm',b)}else showInfo(`TAP: ${list.length} colp${list.length===1?'o':'i'}… continua`)}
  else if(a==='jump')auCmd({cmd:'deck.jump',deck:k,dir:+b.dataset.v});
  else if(a==='seek'){const d=AU.decks[k],r=b.getBoundingClientRect();if(d.track)auCmd({cmd:'deck.seek',deck:k,pos:(e.clientX-r.left)/r.width*d.track.seconds})}
  else if(a==='chcue'){const ch=b.dataset.ch;auCmd({cmd:'mix.set',ch,values:{cue:!AU.mix[ch].cue}})}
  else if(a==='load')auLoad(b.dataset.deck,b.dataset.id);
  else if(a==='sort'){const s=b.dataset.k;if(AU.lib.sort===s)AU.lib.dir*=-1;else{AU.lib.sort=s;AU.lib.dir=s==='bpm'||s==='confidence'?-1:1}}
  else if(a==='libreload')auLoadLibrary(true);
  else if(a==='plnew')auNewPlaylist().then(p=>{if(p)AU.lib.view=p.id});
  else if(a==='plmenu')auPlaylistMenu();
  else if(a==='autogo')auAutoStart();
  else if(a==='autonext')emit({type:'audio_auto',action:'next'},true);
  else if(a==='autostop')emit({type:'audio_auto',action:'stop'},true);
  else if(a==='pladd')auAddToPlaylist(b.dataset.id);
  else if(a==='plup'||a==='pldown'){const i=+b.dataset.i,j=a==='plup'?i-1:i+1;
    auSetPlaylist(AU.lib.view,x=>{if(j<0||j>=x.tracks.length)return x;[x.tracks[i],x.tracks[j]]=[x.tracks[j],x.tracks[i]];return x})}
  else if(a==='plrm'){const i=+b.dataset.i;auSetPlaylist(AU.lib.view,x=>{x.tracks.splice(i,1);return x})}
}
document.addEventListener('pointerup',()=>{const h=auHold;auHold=null;h?.up?.()});
document.addEventListener('pointermove',e=>auHold?.move?.(e));
// rotella sulla forma d'onda del deck: scorre la traccia (fermo); Ctrl+rotella: zoom
document.addEventListener('wheel',e=>{const cv=e.target.closest?.('.au-wave');if(!cv)return;
  const k=cv.closest('[data-deck]').dataset.deck,d=AU.decks[k];if(!d.track)return;e.preventDefault();
  if(e.ctrlKey){const i=AU_ZOOMS.indexOf(d.zoom);auCmd({cmd:'deck.zoom',deck:k,value:AU_ZOOMS[Math.max(0,Math.min(AU_ZOOMS.length-1,(i<0?2:i)+Math.sign(e.deltaY)))]});return}
  if(d.playing)return;
  // col motore la rotella si sente (scrub breve), poi lo scrub si chiude dove si e' arrivati
  const to=Math.max(0,Math.min(d.track.seconds,d.pos+Math.sign(e.deltaY)*d.zoom/80));
  if(!AU.live){auCmd({cmd:'deck.scrub',deck:k,active:false,pos:to});return}
  auCmd({cmd:'deck.scrub',deck:k,active:true,pos:to});clearTimeout(auWheelT);
  auWheelT=setTimeout(()=>auCmd({cmd:'deck.scrub',deck:k,active:false,pos:AU.decks[k].pos}),180)},{passive:false});
let auWheelT=null;
document.addEventListener('pointercancel',()=>{const h=auHold;auHold=null;h?.up?.()});
document.addEventListener('input',e=>{const t=e.target;if(!t.dataset)return;
  if(t.dataset.auR==='tempo')auCmd({cmd:'deck.tempo',deck:t.dataset.deck,value:+t.value});
  else if(t.dataset.auR==='mix'){const v={[t.dataset.key]:+t.value};auCmd(t.dataset.ch?{cmd:'mix.set',ch:t.dataset.ch,values:v}:{cmd:'mix.set',values:v})}
  else if(t.dataset.auS==='q')AU.lib.q=t.value;
});
document.addEventListener('change',e=>{const t=e.target;if(!t.dataset)return;
  if(t.dataset.auS==='range')auCmd({cmd:'deck.range',deck:t.dataset.deck,value:+t.value});
  else if(t.dataset.auS==='folder')AU.lib.folder=t.value;
  else if(t.dataset.auS==='view')AU.lib.view=t.value;
});
// doppio tocco su un controllo: torna al centro (tempo 0, EQ 0, crossfader al centro)
document.addEventListener('dblclick',e=>{const t=e.target.closest?.('.au-rot')?.querySelector('input')||e.target;if(!t.dataset||t.type!=='range')return;
  const home={tempo:0,gain:1,hi:0,mid:0,lo:0,filter:0,xfader:0,cue_mix:.5,master:.9,cue_level:.8}[t.dataset.auR==='tempo'?'tempo':t.dataset.key];if(home==null)return;
  t.value=home;t.dispatchEvent(new Event('input',{bubbles:true}))});

/* ----- registrazione ----- */
const auTick=fn=>(el,w,{now})=>{auStep(now??performance.now());fn(el,w)};
registerWidget('audiodeck',{size:[6,6],label:'Deck',showsValue:false,showsAddr:false,oscAddress:false,
  inner:auDeckHtml,onPointer:auDown,tick:auTick(auPaintDeck),refreshOnResize:true,
  inspector:{html:()=>`<label>Deck<select id="auDeckSel"><option>A</option><option>B</option></select></label>`,
    bind:(w,{on,val})=>{val('#auDeckSel',w.deck||'A');on('#auDeckSel',v=>{w.deck=v},'change')}},
  help:()=>['Deck','Forma d\'onda della traccia (basse blu, medie ambra, alte bianche) con la griglia dei battiti: linee forti = inizio battuta, rosse = griglia incerta. Trascina la forma d\'onda per portare il punto preciso sotto la testina (− + per lo zoom, rotella per scorrere), poi CUE o un hot cue lo salvano: con SNAP acceso sul battito, spento esattamente lì. ⏮ ⏭ portano al punto precedente o successivo (inizio traccia, cue, hot cue). La panoramica sotto: tocca per saltare. CUE: da fermo salva il punto (sul battito), tenuto lo fa sentire; in onda torna al cue. SYNC segue il tempo e la fase del MASTER. Il fader del tempo cambia il BPM (±8/16/50%), ‹‹ ›› tenuti spingono o frenano per rimettere a tempo a orecchio. Hot cue 1-4: tocca per salvare o saltare, tieni premuto per cancellare.']});
registerWidget('audiomixer',{size:[4,6],label:'Mixer',showsValue:false,showsAddr:false,oscAddress:false,
  inner:auMixerHtml,onPointer:auDown,tick:auTick(auPaintMixer),
  help:()=>['Mixer','Per canale: gain, EQ alti/medi/bassi (tutto a sinistra = taglio), filtro (sinistra passa basso, destra passa alto), 🎧 preascolto in cuffia, fader di volume. Il meter del canale misura prima del fader: si vede il livello anche del brano in preascolto; il meter M è l\'uscita master. Al centro master e mix della cuffia (cue ↔ master). Sotto il crossfader. Doppio tocco su un controllo: torna al centro.']});
registerWidget('audiolib',{size:[16,4],label:'Libreria',showsValue:false,showsAddr:false,oscAddress:false,
  inner:auLibHtml,onPointer:auDown,tick:auTick(auPaintLib),
  mounted:()=>{if(!AU.tracks.length&&!AU.libState)auLoadLibrary()},
  help:()=>['Libreria','Le tracce analizzate (BPM e griglia). Cerca, filtra per cartella, ordina toccando le colonne; A/B carica la traccia sul deck (non su un deck in onda). "Griglia incerta" = BPM o battito da controllare: il sync allinea solo il tempo. ▶ AUTO suona da solo dalla playlist scelta (o da tutta la libreria), in ordine o a caso, alternando i deck con la dissolvenza scelta: ⏭ passa al brano dopo, ■ sfuma e ferma. Con la traccia AUDIO della timeline accesa comanda la timeline e l\'autoplay aspetta.']});

TPL.consoleaudio={name:'Console Audio',desc:'Due deck con forma d\'onda, BPM, griglia e sync; mixer con EQ, filtro e crossfader; libreria musicale analizzata.',pages:()=>[P('Console Audio',[
  W('audiodeck',0,0,6,6,{label:'Deck A',deck:'A',color:SWATCH[1]}),
  W('audiomixer',6,0,4,6,{label:'Mixer',color:SWATCH[4]}),
  W('audiodeck',10,0,6,6,{label:'Deck B',deck:'B',color:SWATCH[0]}),
  W('audiolib',0,6,16,4,{label:'Libreria',color:SWATCH[3]})])]};
