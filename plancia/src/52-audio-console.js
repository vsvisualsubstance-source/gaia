/* ---------- Console Audio: deck, mixer, libreria (docs/console-audio.md) ---------- */
// Console stile Traktor per la libreria musicale. Il motore vero (gaia-audio,
// Rust, su OPS/touring) e' l'unica fonte di verita' e manda lo stato al
// bridge; finche' non c'e', un motore SIMULATO qui nella pagina muove le
// testine, segue fader e crossfader e fa il sync sulle griglie, cosi' la
// console si prova gia' coi dati veri: tracce, BPM, griglie e forme d'onda
// arrivano dall'analisi (bridge /api/audio/*, audio-lib.js).
// Nessun suono nella pagina: l'audio esce solo dal motore, sull'impianto.
const AU_WAVE_RATE=50;                 // punti/s della forma d'onda di dettaglio
const AU_RANGES=[.08,.16,.5];          // escursione del fader del tempo
const AU_HOT=4;                        // hot cue per deck
const auDeck=()=>({track:null,wave:null,overImg:null,pos:0,playing:false,tempo:0,range:.08,keylock:true,sync:false,
  cue:0,hot:Array(AU_HOT).fill(null),nudge:0,preview:false,loading:false,zoom:8,snap:true,scrub:false});
const AU_ZOOMS=[2,4,8,16,32];           // secondi visibili nella forma d'onda del deck
const auCh=()=>({gain:1,hi:0,mid:0,lo:0,filter:0,fader:1,cue:false,meter:0});
const AU={tracks:[],libState:'',live:false,last:0,master:'A',
  decks:{A:auDeck(),B:auDeck()},mix:{A:auCh(),B:auCh(),xfader:0,master:.9,cue_mix:.5},
  lib:{q:'',folder:'',sort:'folder',dir:1,target:'A'}};

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
  d.loading=true;
  try{const r=await(await fetch('/api/audio/track?id='+encodeURIComponent(id))).json();if(!r.ok)throw new Error(r.error);
    const t=r.track;Object.assign(d,{track:t,wave:{detail:auB64(t.wave.detail_b64),overview:t.wave.overview},overImg:null,
      pos:t.first_beat||0,cue:t.first_beat||0,hot:Array(AU_HOT).fill(null),playing:false,preview:false,nudge:0})}
  catch(e){showError('Console Audio: traccia non caricata ('+e.message+').')}
  d.loading=false;
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
  if(AU.live||now===AU.last)return;
  const dt=Math.min(.1,(now-(AU.last||now))/1000);AU.last=now;
  for(const k of['A','B']){const d=AU.decks[k],ch=AU.mix[k];
    if(d.sync)auSyncTempo(k);
    if(d.playing&&d.track&&!d.scrub){d.pos+=dt*auRate(d);if(d.pos>=d.track.seconds){d.pos=d.track.seconds;d.playing=false}}
    // livello dal dettaglio della forma d'onda, per i meter
    let lv=0;if(d.playing&&d.wave){const i=Math.floor(d.pos*AU_WAVE_RATE)*3,w=d.wave.detail;lv=Math.max(w[i]||0,w[i+1]||0,w[i+2]||0)/255}
    ch.meter=Math.max(lv*ch.gain*auXGain(k)*ch.fader,ch.meter*.86)}
}
// crossfader a potenza costante: -1 = tutto A, +1 = tutto B
function auXGain(k){const x=(AU.mix.xfader+1)/2;return k==='A'?Math.cos(x*Math.PI/2):Math.sin(x*Math.PI/2)}

/* ----- comandi: un posto solo, poi al motore vero o a quello simulato ----- */
function auCmd(c){
  if(AU.live){emit({type:'audio',...c},true);return}
  const d=c.deck&&AU.decks[c.deck];
  switch(c.cmd){
    case'deck.play':{if(!d.track)return;d.playing=!d.playing;if(d.playing&&d.sync)auSyncPhase(c.deck);
      // diventa master solo se il master attuale non e' un altro deck in onda
      const cur=AU.decks[AU.master];if(d.playing&&!(AU.master!==c.deck&&cur.playing&&cur.track))AU.master=c.deck;break}
    case'deck.cue_down':if(!d.track)return;
      if(d.playing){d.playing=false;d.pos=d.cue}
      else if(Math.abs(d.pos-d.cue)>.02)d.cue=auSnap(d,d.pos);
      else{d.preview=true;d.playing=true}break;
    case'deck.cue_up':if(d.preview){d.preview=false;d.playing=false;d.pos=d.cue}break;
    case'deck.scrub':if(d.track){d.scrub=!!c.active;d.pos=Math.max(0,Math.min(d.track.seconds,c.pos));if(!c.active&&d.playing&&d.sync)auSyncPhase(c.deck)}break;
    case'deck.zoom':d.zoom=c.value;break;
    case'deck.snap':d.snap=!d.snap;break;
    case'deck.seek':if(d.track)d.pos=Math.max(0,Math.min(d.track.seconds,c.pos));if(d.playing&&d.sync)auSyncPhase(c.deck);break;
    case'deck.hotcue':if(!d.track)return;
      if(c.op==='clear')d.hot[c.n]=null;
      else if(d.hot[c.n]==null)d.hot[c.n]=auSnap(d,d.pos);
      else{d.pos=d.hot[c.n];if(d.playing&&d.sync)auSyncPhase(c.deck)}break;
    case'deck.tempo':{d.tempo=Math.max(-1,Math.min(1,c.value));
      // deck in sync: il fader muove il master (come Traktor), il deck lo segue
      const m=d.sync&&auMasterOf(c.deck);
      if(m&&m.track?.bpm&&d.track?.bpm){let target=d.track.bpm*(1+d.tempo*d.range);const r=m.track.bpm;
        while(target/r>1.5)target/=2;while(target/r<.67)target*=2;m.tempo=Math.max(-1,Math.min(1,(target/r-1)/m.range))}break}
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
    <button class="au-btn sm" data-au="snap" title="Acceso: cue e hot cue sul battito. Spento: dove metti la testina">SNAP</button>
    <button class="au-btn sm" data-au="zoom" data-v="-1" title="Zoom: piu' traccia">−</button><span class="zm"></span><button class="au-btn sm" data-au="zoom" data-v="1" title="Zoom: piu' preciso">+</button>
    <span class="rem"></span></div>
  <div class="au-ctl">
    <button class="au-btn cue" data-au="cue">CUE</button><button class="au-btn play" data-au="play">▶</button>
    <button class="au-btn" data-au="sync">SYNC</button><button class="au-btn" data-au="master">MASTER</button><button class="au-btn" data-au="keylock">KEY</button>
  </div>
  <div class="au-hot">${Array.from({length:AU_HOT},(_,i)=>`<button class="au-btn" data-au="hot" data-n="${i}" title="Vuoto: salva qui. Pieno: salta. Tieni premuto: cancella.">${i+1}</button>`).join('')}</div>
  <div class="au-tempo"><button class="au-btn" data-au="nudge" data-v="-1" title="Tieni premuto: rallenta">‹‹</button>
    <input type="range" min="-1" max="1" step="0.001" value="0" data-au-r="tempo" data-deck="${k}" title="Tempo (doppio tocco: 0)">
    <button class="au-btn" data-au="nudge" data-v="1" title="Tieni premuto: accelera">››</button>
    <select data-au-s="range" data-deck="${k}">${AU_RANGES.map(r=>`<option value="${r}">±${r*100}%</option>`).join('')}</select></div>
</div>`}
function auPaintDeck(el,w){
  const box=el.querySelector('.au-deck');if(!box)return;const k=box.dataset.deck,d=AU.decks[k],col=w.color||SWATCH[0];
  auDrawWave(box.querySelector('.au-wave'),d,col);auDrawOver(box.querySelector('.au-over'),d,col);
  const set=(sel,txt)=>{const e=box.querySelector(sel);if(e&&e.textContent!==txt)e.textContent=txt};
  set('.au-title .t',d.track?d.track.title:(d.loading?'carico…':'Trascina o scegli una traccia dalla libreria'));
  set('.au-title .a',d.track?d.track.artist:'');
  set('.au-bpm b',d.track?.bpm?auBpm(d).toFixed(2):'—');
  set('.au-bpm i',`${d.tempo*d.range>=0?'+':''}${(d.tempo*d.range*100).toFixed(1)}%`);
  set('.au-time .el',d.playing?auFmt(d.pos):auFmtFine(d.pos));set('.au-time .zm',d.zoom+' s');
  box.querySelector('[data-au=snap]')?.classList.toggle('on',d.snap);set('.au-time .rem','-'+auFmt((d.track?.seconds||0)-d.pos));
  set('.au-time .st',!d.track?'':!auGridOk(d)?'griglia incerta: sync solo tempo':d.sync&&!auMasterOf(k)?'sync: nessun master in onda':AU.live?'':'simulazione');
  const on=(sel,v)=>box.querySelector(sel)?.classList.toggle('on',!!v);
  on('[data-au=play]',d.playing);on('[data-au=sync]',d.sync);on('[data-au=master]',AU.master===k&&d.playing);on('[data-au=keylock]',d.keylock);
  box.querySelector('[data-au=play]').textContent=d.playing?'❚❚':'▶';
  box.querySelectorAll('[data-au=hot]').forEach(b=>b.classList.toggle('on',d.hot[+b.dataset.n]!=null));
  const r=box.querySelector('[data-au-r=tempo]');if(r&&document.activeElement!==r&&+r.value!==d.tempo)r.value=d.tempo;
  const s=box.querySelector('[data-au-s=range]');if(s&&document.activeElement!==s&&+s.value!==d.range)s.value=d.range;
}

/* ----- widget: mixer ----- */
function auStripHtml(k){
  const knob=(key,label,min,max,v)=>`<label class="au-k"><span>${label}</span><input type="range" min="${min}" max="${max}" step="0.01" value="${v}" data-au-r="mix" data-ch="${k}" data-key="${key}" title="${label} (doppio tocco: centro)"></label>`;
  return`<div class="au-strip" data-ch="${k}"><b class="au-letter">${k}</b>
    ${knob('gain','GAIN',0,2,1)}${knob('hi','HI',-1,1,0)}${knob('mid','MID',-1,1,0)}${knob('lo','LOW',-1,1,0)}${knob('filter','FILTRO',-1,1,0)}
    <button class="au-btn" data-au="chcue" data-ch="${k}" title="Preascolto in cuffia">🎧</button>
    <div class="au-fadrow"><canvas class="au-meter" data-ch="${k}"></canvas><input class="au-vfader" type="range" min="0" max="1" step="0.01" value="1" data-au-r="mix" data-ch="${k}" data-key="fader"></div></div>`}
function auMixerHtml(){
  return`<div class="au au-mixer"><div class="au-strips">${auStripHtml('A')}
    <div class="au-strip au-mid"><b class="au-letter">M</b>
      <label class="au-k"><span>MASTER</span><input type="range" min="0" max="1" step="0.01" value=".9" data-au-r="mix" data-key="master"></label>
      <label class="au-k"><span>CUE · MIX</span><input type="range" min="0" max="1" step="0.01" value=".5" data-au-r="mix" data-key="cue_mix"></label>
      <div class="au-fadrow"><canvas class="au-meter" data-ch="M"></canvas></div></div>
    ${auStripHtml('B')}</div>
    <label class="au-xf"><span>A</span><input type="range" min="-1" max="1" step="0.01" value="0" data-au-r="mix" data-key="xfader" title="Crossfader (doppio tocco: centro)"><span>B</span></label></div>`}
function auPaintMixer(el){
  const box=el.querySelector('.au-mixer');if(!box)return;
  box.querySelectorAll('.au-meter').forEach(cv=>{const g=auCanvas(cv),W=cv.width,H=cv.height;if(!W)return;
    const k=cv.dataset.ch,v=k==='M'?Math.min(1,Math.max(AU.mix.A.meter,AU.mix.B.meter)*AU.mix.master):AU.mix[k].meter;
    g.clearRect(0,0,W,H);g.fillStyle='#272c35';g.fillRect(0,0,W,H);
    const h=v*H;const grd=g.createLinearGradient(0,H,0,0);grd.addColorStop(0,'#4fd18b');grd.addColorStop(.75,'#ffb23e');grd.addColorStop(1,'#ff5d5d');
    g.fillStyle=grd;g.fillRect(0,H-h,W,h)});
  box.querySelectorAll('[data-au-r=mix]').forEach(r=>{if(document.activeElement===r)return;
    const v=r.dataset.ch?AU.mix[r.dataset.ch][r.dataset.key]:AU.mix[r.dataset.key];if(+r.value!==v)r.value=v});
  box.querySelectorAll('[data-au=chcue]').forEach(b=>b.classList.toggle('on',AU.mix[b.dataset.ch].cue));
}

/* ----- widget: libreria ----- */
function auLibRows(){
  const q=AU.lib.q.trim().toLowerCase(),f=AU.lib.folder;
  let list=AU.tracks.filter(t=>(!f||t.folder===f)&&(!q||(t.title+' '+t.artist+' '+t.folder).toLowerCase().includes(q)));
  const key=AU.lib.sort,dir=AU.lib.dir,val=t=>key==='bpm'?t.bpm:key==='seconds'?t.seconds:key==='confidence'?t.confidence:String(t[key]||'').toLowerCase();
  list=[...list].sort((a,b)=>{const x=val(a),y=val(b);return(x<y?-1:x>y?1:0)*dir});
  return list;
}
function auLibHtml(){
  return`<div class="au au-lib"><div class="au-libbar">
    <input type="search" placeholder="Cerca titolo, artista, cartella" data-au-s="q">
    <select data-au-s="folder"></select>
    <span class="au-libn hint"></span>
    <button class="btn sm ghost" data-au="libreload">Aggiorna</button></div>
    <div class="au-libtab"></div></div>`}
function auPaintLib(el){
  const box=el.querySelector('.au-lib');if(!box)return;
  const folders=[...new Set(AU.tracks.map(t=>t.folder))].sort();
  const fs=box.querySelector('[data-au-s=folder]'),fsig=folders.join('|');
  if(fs._sig!==fsig){fs._sig=fsig;fs.innerHTML=`<option value="">Tutte le cartelle</option>`+folders.map(f=>`<option>${esc(f)}</option>`).join('');fs.value=AU.lib.folder}
  const rows=auLibRows(),loaded=['A','B'].map(k=>AU.decks[k].track?.id||'');
  const sig=JSON.stringify([AU.libState,AU.lib,rows.length,rows[0]?.id,rows[rows.length-1]?.id,loaded]);
  const tab=box.querySelector('.au-libtab');if(tab._sig===sig)return;tab._sig=sig;
  box.querySelector('.au-libn').textContent=AU.libState||`${rows.length} di ${AU.tracks.length} tracce`;
  const th=(k,l)=>`<th data-au="sort" data-k="${k}"${AU.lib.sort===k?` class="on"`:''}>${l}${AU.lib.sort===k?(AU.lib.dir>0?' ▲':' ▼'):''}</th>`;
  tab.innerHTML=`<table><thead><tr><th></th>${th('title','Titolo')}${th('artist','Artista')}${th('bpm','BPM')}${th('seconds','Durata')}${th('confidence','Griglia')}${th('folder','Cartella')}</tr></thead><tbody>
    ${rows.slice(0,400).map(t=>`<tr${loaded.includes(t.id)?' class="on"':''}><td class="au-load"><button class="au-btn" data-au="load" data-deck="A" data-id="${t.id}">A</button><button class="au-btn" data-au="load" data-deck="B" data-id="${t.id}">B</button></td>
      <td>${esc(t.title)}</td><td class="dim">${esc(t.artist)}</td><td class="num">${t.bpm?t.bpm.toFixed(2):'—'}</td><td class="num">${auFmt(t.seconds)}</td>
      <td>${t.locked?'<span class="au-gr ok">a mano</span>':t.confidence>=.4?'<span class="au-gr ok">ok</span>':'<span class="au-gr bad">incerta</span>'}</td><td class="dim">${esc(t.folder)}</td></tr>`).join('')}
    </tbody></table>${rows.length>400?`<p class="hint">Prime 400 di ${rows.length}: cerca o scegli una cartella.</p>`:''}`;
}

/* ----- tocco ----- */
let auHold=null;   // pulsante tenuto (cue, nudge, hot cue lungo)
function auDown(e,el,w){
  if(e.target.closest('input,select'))return;
  const b=e.target.closest('[data-au]');if(!b)return;e.preventDefault();
  const a=b.dataset.au,k=b.closest('[data-deck]')?.dataset.deck||b.dataset.deck;
  if(a==='play')auCmd({cmd:'deck.play',deck:k});
  else if(a==='cue'){auCmd({cmd:'deck.cue_down',deck:k});auHold={up:()=>auCmd({cmd:'deck.cue_up',deck:k})}}
  else if(a==='sync')auCmd({cmd:'deck.sync',deck:k});
  else if(a==='master')auCmd({cmd:'deck.master',deck:k});
  else if(a==='keylock')auCmd({cmd:'deck.keylock',deck:k});
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
  else if(a==='seek'){const d=AU.decks[k],r=b.getBoundingClientRect();if(d.track)auCmd({cmd:'deck.seek',deck:k,pos:(e.clientX-r.left)/r.width*d.track.seconds})}
  else if(a==='chcue'){const ch=b.dataset.ch;auCmd({cmd:'mix.set',ch,values:{cue:!AU.mix[ch].cue}})}
  else if(a==='load')auLoad(b.dataset.deck,b.dataset.id);
  else if(a==='sort'){const s=b.dataset.k;if(AU.lib.sort===s)AU.lib.dir*=-1;else{AU.lib.sort=s;AU.lib.dir=s==='bpm'||s==='confidence'?-1:1}}
  else if(a==='libreload')auLoadLibrary(true);
}
document.addEventListener('pointerup',()=>{const h=auHold;auHold=null;h?.up?.()});
document.addEventListener('pointermove',e=>auHold?.move?.(e));
// rotella sulla forma d'onda del deck: scorre la traccia (fermo); Ctrl+rotella: zoom
document.addEventListener('wheel',e=>{const cv=e.target.closest?.('.au-wave');if(!cv)return;
  const k=cv.closest('[data-deck]').dataset.deck,d=AU.decks[k];if(!d.track)return;e.preventDefault();
  if(e.ctrlKey){const i=AU_ZOOMS.indexOf(d.zoom);auCmd({cmd:'deck.zoom',deck:k,value:AU_ZOOMS[Math.max(0,Math.min(AU_ZOOMS.length-1,(i<0?2:i)+Math.sign(e.deltaY)))]});return}
  if(d.playing)return;
  auCmd({cmd:'deck.scrub',deck:k,active:false,pos:d.pos+Math.sign(e.deltaY)*d.zoom/80})},{passive:false});
document.addEventListener('pointercancel',()=>{const h=auHold;auHold=null;h?.up?.()});
document.addEventListener('input',e=>{const t=e.target;if(!t.dataset)return;
  if(t.dataset.auR==='tempo')auCmd({cmd:'deck.tempo',deck:t.dataset.deck,value:+t.value});
  else if(t.dataset.auR==='mix'){const v={[t.dataset.key]:+t.value};auCmd(t.dataset.ch?{cmd:'mix.set',ch:t.dataset.ch,values:v}:{cmd:'mix.set',values:v})}
  else if(t.dataset.auS==='q')AU.lib.q=t.value;
});
document.addEventListener('change',e=>{const t=e.target;if(!t.dataset)return;
  if(t.dataset.auS==='range')auCmd({cmd:'deck.range',deck:t.dataset.deck,value:+t.value});
  else if(t.dataset.auS==='folder')AU.lib.folder=t.value;
});
// doppio tocco su un controllo: torna al centro (tempo 0, EQ 0, crossfader al centro)
document.addEventListener('dblclick',e=>{const t=e.target;if(!t.dataset||t.type!=='range')return;
  const home={tempo:0,gain:1,hi:0,mid:0,lo:0,filter:0,xfader:0}[t.dataset.auR==='tempo'?'tempo':t.dataset.key];if(home==null)return;
  t.value=home;t.dispatchEvent(new Event('input',{bubbles:true}))});

/* ----- registrazione ----- */
const auTick=fn=>(el,w,{now})=>{auStep(now??performance.now());fn(el,w)};
registerWidget('audiodeck',{size:[6,6],label:'Deck',showsValue:false,showsAddr:false,oscAddress:false,
  inner:auDeckHtml,onPointer:auDown,tick:auTick(auPaintDeck),refreshOnResize:true,
  inspector:{html:()=>`<label>Deck<select id="auDeckSel"><option>A</option><option>B</option></select></label>`,
    bind:(w,{on,val})=>{val('#auDeckSel',w.deck||'A');on('#auDeckSel',v=>{w.deck=v},'change')}},
  help:()=>['Deck','Forma d\'onda della traccia (basse blu, medie ambra, alte bianche) con la griglia dei battiti: linee forti = inizio battuta, rosse = griglia incerta. Trascina la forma d\'onda per portare il punto preciso sotto la testina (− + per lo zoom, rotella per scorrere), poi CUE o un hot cue lo salvano: con SNAP acceso sul battito, spento esattamente lì. La panoramica sotto: tocca per saltare. CUE: da fermo salva il punto (sul battito), tenuto lo fa sentire; in onda torna al cue. SYNC segue il tempo e la fase del MASTER. Il fader del tempo cambia il BPM (±8/16/50%), ‹‹ ›› tenuti spingono o frenano per rimettere a tempo a orecchio. Hot cue 1-4: tocca per salvare o saltare, tieni premuto per cancellare.']});
registerWidget('audiomixer',{size:[4,6],label:'Mixer',showsValue:false,showsAddr:false,oscAddress:false,
  inner:auMixerHtml,onPointer:auDown,tick:auTick(auPaintMixer),
  help:()=>['Mixer','Per canale: gain, EQ alti/medi/bassi (tutto a sinistra = taglio), filtro (sinistra passa basso, destra passa alto), 🎧 preascolto in cuffia, fader di volume. Al centro master e mix della cuffia (cue ↔ master). Sotto il crossfader. Doppio tocco su un controllo: torna al centro.']});
registerWidget('audiolib',{size:[16,4],label:'Libreria',showsValue:false,showsAddr:false,oscAddress:false,
  inner:auLibHtml,onPointer:auDown,tick:auTick(auPaintLib),
  mounted:()=>{if(!AU.tracks.length&&!AU.libState)auLoadLibrary()},
  help:()=>['Libreria','Le tracce analizzate (BPM e griglia). Cerca, filtra per cartella, ordina toccando le colonne; A/B carica la traccia sul deck (non su un deck in onda). "Griglia incerta" = BPM o battito da controllare: il sync allinea solo il tempo.']});

TPL.consoleaudio={name:'Console Audio',desc:'Due deck con forma d\'onda, BPM, griglia e sync; mixer con EQ, filtro e crossfader; libreria musicale analizzata.',pages:()=>[P('Console Audio',[
  W('audiodeck',0,0,6,6,{label:'Deck A',deck:'A',color:SWATCH[1]}),
  W('audiomixer',6,0,4,6,{label:'Mixer',color:SWATCH[4]}),
  W('audiodeck',10,0,6,6,{label:'Deck B',deck:'B',color:SWATCH[0]}),
  W('audiolib',0,6,16,4,{label:'Libreria',color:SWATCH[3]})])]};
