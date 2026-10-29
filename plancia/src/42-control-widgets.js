/* ---------- controlli di base: fader, manopola, pad XY, pulsante, indicatore, colore, testo, orologio ---------- */
// Tipi registrati nel registro (05-widget-registry.js): prima erano sparsi negli
// switch di 40 (interno, disegno del valore), 41 (tocco), 80 (orologio) e 95 (aiuto).
// Il comportamento e' quello di prima, riga per riga.

// inizio di un trascinamento: cattura il puntatore; la funzione restituita chiude
// il gesto (toglie gli stati visivi e salva il layout)
function startDrag(el,e){
  e.preventDefault();el.setPointerCapture(e.pointerId);
  return()=>{el.classList.remove('active','press');el.onpointermove=null;el.onpointerup=el.onpointercancel=null;save()};
}
const TRACK_HTML='<div class="trk"><div class="fill"></div></div>';
function paintTrack(el,w){
  const f=el.querySelector('.fill'),v=w.value;
  if(w.w>w.h){f.style.width=v*100+'%';f.style.height=''}else{f.style.height=v*100+'%';f.style.width=''}
}
const ignorePointer=()=>{};

// fader, manopola e indicatore: il primo argomento nel range
const receiveLevel=(w,args)=>{if(!args.length)return false;w.value=oscNorm(w,args[0]);return true};

registerWidget('fader',{range:true,midi:true,size:[2,5],label:'Fader',receive:receiveLevel,
  inner:()=>TRACK_HTML,paint:paintTrack,
  onPointer(e,el,w){
    const end=startDrag(el,e),r=el.querySelector('.box').getBoundingClientRect();
    const move=ev=>{const hz=w.w>w.h;set(w,clamp(hz?(ev.clientX-r.left)/r.width:1-(ev.clientY-r.top)/r.height))};
    el.classList.add('active');move(e);el.onpointermove=move;el.onpointerup=el.onpointercancel=end;
  },
  help(w){const a=w.addr||'';
    if(a==='/dmx/master')return['Master','Livello generale di tutte le luci.'];
    if(a==='/dmx/fade')return['Fade','Secondi di dissolvenza quando cambi scena.'];
    if(a==='/dmx/strobe/rate')return['Velocità strobo','Lampi al secondo dello strobo.'];
    if(a.startsWith('/dmx/group/'))return[`Gruppo ${w.label}`,'Livello di questo gruppo di luci (rig), sopra al master.'];
    if(a.startsWith('/mh/'))return[w.label,'Valore per le teste selezionate.'];
    return[w.label||'Fader',`Trascina su e giù (${a||'nessun indirizzo'}).`];
  }});

registerWidget('meter',{range:true,receive:receiveLevel,
  inspector:{footer:()=>'<p class="hint">L\'indicatore riceve soltanto: si muove quando arriva OSC su questo indirizzo.</p>'},
  size:[1,5],label:'Indicatore',
  inner:()=>TRACK_HTML,paint:paintTrack,onPointer:ignorePointer});

registerWidget('knob',{range:true,midi:true,size:[2,2],label:'Manopola',receive:receiveLevel,
  inner:()=>`<div class="knob"><svg viewBox="0 0 100 100" aria-hidden="true">
      <path class="tr" d="M23.13 76.87A38 38 0 1 1 76.87 76.87" pathLength="100"/>
      <path class="vl" d="M23.13 76.87A38 38 0 1 1 76.87 76.87" pathLength="100"/>
      <circle class="cap" cx="50" cy="50" r="24"/><line class="ptr" x1="58" y1="50" x2="70" y2="50"/></svg></div>`,
  paint(el,w){
    el.querySelector('.vl').style.strokeDasharray=`${w.value*100} 100`;
    el.querySelector('.ptr').setAttribute('transform',`rotate(${135+270*w.value} 50 50)`);
  },
  // relativa: si gira trascinando su/giu' (o a destra), non salta al punto toccato
  onPointer(e,el,w){
    const end=startDrag(el,e),s={x:e.clientX,y:e.clientY,v:w.value};
    el.classList.add('active');
    el.onpointermove=ev=>set(w,clamp(s.v+((s.y-ev.clientY)+(ev.clientX-s.x)*.5)/220));
    el.onpointerup=el.onpointercancel=end;
  }});

registerWidget('xy',{range:true,size:[4,4],label:'Pad XY',
  receive:(w,args)=>{if(args.length>1){w.value=oscNorm(w,args[0]);w.valueY=oscNorm(w,args[1])}return true},
  inner:()=>'<div class="pad"><i class="hx"></i><i class="vy"></i><i class="dot"></i></div>',
  paint(el,w){
    const X=w.value*100+'%',Y=(1-w.valueY)*100+'%',d=el.querySelector('.dot');
    d.style.left=X;d.style.top=Y;el.querySelector('.hx').style.top=Y;el.querySelector('.vy').style.left=X;
  },
  valueText:w=>fmt(out(w,w.value))+' · '+fmt(out(w,w.valueY)),
  args:w=>[out(w,w.value),out(w,w.valueY)],
  // assoluto: le teste vanno subito dove si tocca
  onPointer(e,el,w){
    const end=startDrag(el,e),r=el.querySelector('.box').getBoundingClientRect();
    const move=ev=>setXY(w,clamp((ev.clientX-r.left)/r.width),clamp(1-(ev.clientY-r.top)/r.height));
    el.classList.add('active');move(e);el.onpointermove=move;el.onpointerup=el.onpointercancel=end;
  },
  help:()=>['Pan / Tilt','Trascina per puntare le teste selezionate.']});

registerWidget('button',{oscAddress:true,range:{min:'Valore OFF',max:'Valore ON'},midi:true,
  receive:(w,[a])=>{w.value=(+a===w.max||+a>(w.min+w.max)/2)?1:0;return true},
  inspector:{html:w=>`<label>Comportamento<select id="fMode"><option value="push">Momentaneo</option><option value="toggle">Interruttore</option></select></label>`,
    bind:(w,{on,val})=>{val('#fMode',w.mode);on('#fMode',v=>{w.mode=v;w.value=0},'change')}},
  size:[2,2],label:'Pulsante',
  showsValue:w=>w.mode==='toggle',
  inner:w=>`<span class="tag">${w.mode==='toggle'?'TOG':''}</span>`,
  paint:(el,w)=>el.classList.toggle('on',w.value>.5),
  valueText:w=>w.value>.5?'ON':'OFF',
  args:w=>[w.value>.5?w.max:w.min],                    // OFF = min, ON = max
  // interruttore: cambia a ogni tocco; momentaneo: attivo finche' si tiene premuto
  onPointer(e,el,w){
    const end=startDrag(el,e);
    el.classList.add('press');
    set(w,w.mode==='toggle'?(w.value>.5?0:1):1);
    el.onpointerup=el.onpointercancel=()=>{if(w.mode!=='toggle')set(w,0);end()};
  },
  help(w){const a=w.addr||'';
    if(a==='/dmx/blackout')return['Blackout','Spegne tutto finché non lo ritocchi.'];
    if(a==='/dmx/strobe')return[w.label,w.mode==='toggle'?'Strobo acceso/spento.':'Strobo solo finché tieni premuto.'];
    if(a==='/show/go')return['GO','Manda la prossima cue della timeline.'];
    if(a==='/show/back')return['Back','Torna alla cue precedente della timeline.'];
    return[w.label||'Pulsante',w.mode==='toggle'?'Acceso/spento a ogni tocco.':'Attivo finché tieni premuto.'];
  }});

registerWidget('color',{size:[4,4],label:'Colore',
  receive:(w,args)=>{if(args.length>2){const[h,s]=rgb2hsv(+args[0],+args[1],+args[2]);w.value={h,s}}return true},
  inner:()=>`<div class="cw"><div class="disc"><i class="mk"></i></div><div class="sws">${SWC.map((c,i)=>`<i data-s="${i}" style="--s:${hex(c)}"></i>`).join('')}</div></div>`,
  paint(el,w){
    const h=w.value?.h??0,s=w.value?.s??0,mk=el.querySelector('.mk');
    mk.style.left=50+Math.cos(h*2*Math.PI)*s*50+'%';mk.style.top=50+Math.sin(h*2*Math.PI)*s*50+'%';
    mk.style.background=hex(hsv2rgb(h,s,1));
  },
  valueText:w=>hex(colorRGB(w)).toUpperCase(),
  args:w=>colorRGB(w).map(x=>+x.toFixed(4)),          // r g b 0..1
  // un campione sotto la ruota, oppure la ruota (tinta = angolo, saturazione = distanza dal centro)
  onPointer(e,el,w){
    const end=startDrag(el,e),sw=e.target.closest('[data-s]');
    if(sw){const [h,s]=rgb2hsv(...SWC[+sw.dataset.s]);w.value={h,s};paint(el,w);send(w);save();return}
    const r=el.querySelector('.disc').getBoundingClientRect();
    const mv=ev=>{const dx=(ev.clientX-r.left)/r.width*2-1,dy=(ev.clientY-r.top)/r.height*2-1;
      w.value={h:((Math.atan2(dy,dx)/(2*Math.PI))+1)%1,s:clamp(Math.hypot(dx,dy))};paint(el,w);send(w)};
    el.classList.add('active');mv(e);el.onpointermove=mv;el.onpointerup=el.onpointercancel=end;
  },
  help:w=>['Colore',(w.addr||'').startsWith('/mh')?'Colore delle teste selezionate (ruota o RGB secondo il modello).':'Colore del LED wall.']});

registerWidget('label',{oscAddress:false,size:[4,1],label:'Testo',showsValue:false,showsAddr:false,
  inner:()=>'',onPointer:ignorePointer});

registerWidget('clock',{oscAddress:false,
  inspector:{html:()=>`<label>Modalità<select id="fCMode"><option value="tod">Ora del giorno</option><option value="show">Timecode show (25 fps)</option><option value="countdown">Countdown a orario</option></select></label>
      <label>Orario di fine<input id="fTarget" type="time"></label>`,
    bind:(w,{on,val})=>{val('#fCMode',w.mode);val('#fTarget',w.target||'23:30');on('#fCMode',v=>w.mode=v,'change');on('#fTarget',v=>w.target=v)}},
  size:[4,2],label:'Orologio',showsValue:false,showsAddr:false,
  inner:()=>'<div class="clk"><div class="clk-main">--:--:--</div><div class="clk-sub"></div></div>',
  onPointer:ignorePointer,
  // ora, conto alla rovescia verso w.target, o timecode dello show (da DMX Master se c'e')
  tick(el,w){
    const m=el.querySelector('.clk-main'),sb=el.querySelector('.clk-sub'),d=new Date();let a,b,cl='';
    if(w.mode==='show'){
      a=tc(showT);const sample=showClock.authority?showClockSample():null,available=!!sample&&showClockFresh(sample);
      b=showClock.authority?`TD · ${available?sample.source.toUpperCase():'OFFLINE · FERMO'} · TC 25 fps`:`TC 25 fps · ${showPlaying?'PLAY':'STOP'}`;
      if(available&&sample.state.playing)cl='live';
    }
    else if(w.mode==='countdown'){const [hh,mm]=(w.target||'23:30').split(':').map(Number),e=new Date(d);e.setHours(hh||0,mm||0,0,0);
      let s=Math.round((e-d)/1000);const neg=s<0;s=Math.abs(s);a=(neg?'+':'')+[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');
      b=neg?`Oltre l'orario di fine (${w.target})`:`Fine alle ${w.target||'23:30'}`;cl=neg?'over':s<300?'warn':''}
    else{a=d.toLocaleTimeString('it-IT',{hour12:false});b=d.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}
    if(m.textContent!==a)m.textContent=a;if(sb.textContent!==b)sb.textContent=b;
    el.classList.toggle('warn',cl==='warn');el.classList.toggle('over',cl==='over');el.classList.toggle('live',cl==='live');
  },
  help:w=>[w.mode==='show'?'Orologio dello show':w.mode==='countdown'?'Conto alla rovescia':'Ora','Tempo dello show (timecode 25 fps) che arriva da DMX Master. Se dice OFFLINE l\'orologio è fermo.']});
