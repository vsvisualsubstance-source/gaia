/* ---------- progetto di prova: un po' di tutto, per provare ogni funzione ---------- */
// Modello "Demo completo" in 📁 Progetti. Un rig che copre tutti i casi (luci
// indipendenti e a specchio, livelli, teste, LED wall, proiettore, casse, laser) e
// una timeline di 3 minuti con tutte le tracce piene. Non manda niente da solo: video,
// laser e movimento partono in LIVE, la patch va a DMX Master solo con Strumenti.
// Le scene sono quelle di DMX Master (per nome): una che manca diventa un marker.
function demoRig(){
  const out=[],add=(type,name,x,y,addr,o={})=>{const f=Object.assign(mkFix(type,name,x,y,addr?1:0,addr||0),o);out.push(f);return f};
  // front: ognuna per conto suo (unita' 1..4); back: a specchio (tutte unita' 1)
  [-3,-1,1,3].forEach((x,i)=>add('par',`FRONT${i+1}`,x,1,1+i*4,{group:'front',unit:i+1}));
  [-3,-1,1,3].forEach((x,i)=>add('par',`BACK${i+1}`,x,-1,17+i*4,{group:'back',unit:1,z:4.4,mountToTruss:true}));
  [-3,-1,1,3].forEach((x,i)=>add('bar',`BAR${i+1}`,x,-2.5,33+i*4,{group:'ledbar',unit:i+1}));
  add('blinder','STROBO',-4.5,0,49,{group:'blinder'});
  add('haze','HAZE',4.5,-2.5,50,{group:'haze'});
  [-2.4,-.8,.8,2.4].forEach((x,i)=>add('mh',`MH${i+1}`,x,.3,60+i*11,{model:'Wecam Moving Head 30W 11ch',z:4.4,mountToTruss:true}));
  add('wall','LED WALL',0,-3.4,0);
  const sc=add('screen','SCHERMO',-5.5,-3,0),pr=add('projector','PROIETTORE',-5.5,3,0);pr.target=sc.id;
  add('speaker','CASSA L',-6,2,0);add('speaker','CASSA R',6,2,0);
  add('laser','LASER 1',-2,-3,0,{cube:'c1'});add('laser','LASER 2',2,-3,0);
  return out;
}
function demoLaserScenes(){
  const base=lzsTemplates(),anim={rotate:0,scale:.8,pulse:0,pulse_hz:.5,orbit:0,orbit_hz:.2,draw_hz:0},col={mode:'fixed',rgb:[0,1,.5],palette:[[1,0,0],[0,1,0],[0,0,1]],rate:.2},audio={amount:0,to:'scale'};
  const out=[...base,
    {id:'demo-tempo',name:'A tempo (morbido)',strokes:lzsShape('stella'),color:{...col,rgb:[1,.7,0]},anim:{...anim,pulse:.5,pulse_hz:1,pulse_shape:'ease',swing:60,swing_hz:.5,swing_shape:'ease'},audio,tempo:{sync:true,bpm:120}},
    // animazione a frame, come un file ILDA: una linea che gira in 12 passi
    {id:'demo-frame',name:'Animazione a frame',strokes:[],frames:Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2,c=+Math.cos(a).toFixed(3),s=+Math.sin(a).toFixed(3);return{strokes:[{pts:[[-c,-s],[c,s]],closed:false,rgb:[1,i/12,0]}]}}),frame_fps:12,color:{...col,mode:'stroke'},anim,audio}];
  out.find(s=>s.id==='demo-frame').strokes=out.find(s=>s.id==='demo-frame').frames[0].strokes;
  try{const t=lzsTextScene('GAIA');t.id='demo-testo';t.name='Testo GAIA';out.push(t)}catch{/* senza canvas: niente testo */}
  return out;
}
function demoProjectLayout(){
  const pages=[...TPL.full.pages(),...TPL.consoleaudio.pages()],T=(t,name,targets)=>({t,name,targets});
  // traccia LUCI: una sezione ogni 20 s, fade diversi; TESTE POS. con le scene di sole teste
  const cues=serializeCues([
    T(0,'Apertura','@base; fade=2'),T(10,'Teste al pubblico','@teste_pubblico; fade=3'),T(20,'Rosso','@colore_rosso; fade=1'),T(40,'Blu','@colore_blu; fade=4'),
    T(60,'Magenta-Cyan','@pal_magenta_cyan; fade=0'),T(70,'Teste al cielo','@teste_cielo; fade=5'),T(80,'Forest','@pal_forest; fade=2'),
    T(100,'Strobo acceso','@strobo_on; fade=0'),T(110,'Strobo spento','@strobo_off; fade=0'),T(120,'Deep Purple','@pal_deep_purple; fade=3'),T(130,'Teste al pubblico 2','@teste_pubblico; fade=2'),T(160,'Finale','@base; fade=4')]);
  const tracks=['chase','fx','heads','motion','video','laser'];
  for(const p of pages)for(const w of p.widgets)if(w.type==='timeline'&&w.addr==='/show'){Object.assign(w,{cues,duration:180,bpm:120});if(!w.readonly)w.tracks=tracks}
  const fx=fxTemplates('front'),fxg={'fx-inseguimento':'back','fx-centro':'ledbar','fx-respiro':'back','fx-scintillio':'ledbar','fx-due-colori':'back'};
  fx.forEach(f=>{if(fxg[f.id])f.target={group:fxg[f.id]}});
  fx.push({id:'fx-teste-respiro',name:'Teste: respiro',template:true,target:{group:'mh'},channel:'dimmer',shape:'sine',period:{value:8,unit:'beats'},spread:{phase:.25,mirror:false},min:.2,max:1});
  const models=Object.fromEntries(tdModels().filter(m=>['D+RGB 4CH','Dimmer 1CH','Haze 2CH','Wecam Moving Head 30W 11ch'].includes(m.model)).map(m=>[m.model,modelPayload(m)]));
  const S=(id,...steps)=>steps.map(s=>({scene:s})),colors=['colore_rosso','colore_blu','pal_magenta_cyan','pal_forest','pal_deep_purple'];
  return{pages,fixtures:demoRig(),stage:{...stageDefaults(),width:12,depth:8},models,uiRev:14,tlTdDirty:true,
    groups:[{group:'front',kind:'chase',label:'Front',bind:'rig_a'},{group:'back',kind:'chase',label:'Back',bind:'rig_b'},{group:'mh',kind:'heads',label:'Teste',bind:'heads'},
      {group:'ledbar',kind:'chase',label:'LED bar'},{group:'haze',kind:'level',label:'Haze'},{group:'blinder',kind:'level',label:'Strobo'}],
    showBpm:120,
    chases:[{id:'dm-colori',name:'Colori',steps:S(0,...colors),hold:{value:4,unit:'beats'},fadePct:50,pingpong:false},
      {id:'dm-veloci',name:'Colori veloci',steps:S(0,...colors),hold:{value:1,unit:'beats'},fadePct:0,pingpong:false},
      {id:'dm-andata',name:'Avanti e indietro',steps:S(0,...colors),hold:{value:2,unit:'s'},fadePct:80,pingpong:true},
      {id:'dm-strobo',name:'Strobo a colpi',steps:S(0,'strobo_on','strobo_off'),hold:{value:1,unit:'beats'},fadePct:0,pingpong:false}],
    chaseTimeline:{cues:[{time:80,label:'Veloce',chase:'dm-veloci'},{time:100,label:'',chase:'off'},{time:135,label:'Lento',chase:'dm-colori'},{time:160,label:'',chase:'off'}]},
    lightFx:fx,
    fxTimeline:{cues:[{time:20,label:'Onda',effects:['fx-onda']},{time:40,label:'Inseguimento',effects:['fx-inseguimento','fx-centro']},{time:60,label:'Arcobaleno',effects:['fx-arcobaleno']},
      {time:80,label:'',effects:[]},{time:120,label:'Scintillio',effects:['fx-scintillio','fx-respiro','fx-teste-respiro']},{time:160,label:'',effects:[]}]},
    headMotions:hmTemplates(),
    headTimeline:{engine:'td',active:false,bpm:120,cues:[{time:20,label:'Cerchio',scene:'hm-cerchio'},{time:40,label:'Otto',scene:'hm-otto'},{time:60,label:'Scanner',scene:'hm-scanner'},
      {time:80,label:'Ventaglio',scene:'hm-apri'},{time:100,label:'Onda',scene:'hm-onda-cerchi'},{time:120,label:'Balletto',scene:'hm-balletto'},{time:160,label:'',scene:'off'}]},
    videoTimeline:{active:false,cues:[{time:0,label:'Patch 1 su A',deck:'A',patch:1,show:'A',fade:0,fx:{}},{time:30,label:'Patch 2 su B',deck:'B',patch:2,show:'B',fade:3,fx:{}},
      {time:60,label:'A + B',deck:'A',patch:3,show:'AB',fade:2,fx:{edge:.5}},{time:120,label:'Solo B',deck:'B',patch:4,show:'B',fade:4,fx:{mirror:1}},{time:160,label:'Nero',deck:'',patch:null,show:'none',fade:3,fx:{}}]},
    laserScenes:demoLaserScenes(),
    laserTimeline:{active:false,cues:[{time:0,label:'Cerchio',cube:'all',mode:'scene',scene:'tpl-cerchio'},{time:30,label:'Testo',cube:'all',mode:'scene',scene:'demo-testo'},{time:60,label:'A tempo',cube:'all',mode:'scene',scene:'demo-tempo'},
      {time:90,label:'A frame',cube:'all',mode:'scene',scene:'demo-frame'},{time:120,label:'Lissajous',cube:'all',mode:'scene',scene:'tpl-lissajous'},{time:160,label:'Spento',cube:'all',mode:'off',scene:''}]}};
}
