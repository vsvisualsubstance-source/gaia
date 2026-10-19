/* ---------- template ---------- */
function W(type,x,y,w,h,o={}){return Object.assign({id:uid(),type,x,y,w,h,label:NAMES[type],addr:'',min:0,max:1,color:SWATCH[0],value:0,valueY:.5,mode:'push',midi:{ch:1,cc:''}},o)}
const P=(name,widgets)=>({id:uid(),name,widgets});
const sceneList=LOOKS.map(l=>l.n).join('\n');
const tlOpts=()=>({addr:'/show',duration:270,bpm:124,cues:TLCUES,color:SWATCH[0]});
const TPL={
  show:{name:'Panoramica show',desc:'Render del palco, orologi, scene, timeline e master in una schermata.',pages:()=>[P('Show',[
    W('stage',0,0,11,7,{label:'Palco',view:'render'}),
    W('clock',11,0,5,2,{label:'Ora',mode:'tod',color:SWATCH[5]}),
    W('clock',11,2,5,2,{label:'Show',mode:'show',color:SWATCH[0]}),
    W('scenes',11,4,5,3,{label:'Scene',addr:'/dmx/scene',items:sceneList,cols:4,value:0}),
    W('timeline',0,7,11,3,{label:'Timeline',...tlOpts()}),
    W('fader',11,7,2,3,{label:'Master',addr:'/dmx/master',value:1}),
    W('button',13,7,3,2,{label:'Blackout',addr:'/dmx/blackout',mode:'toggle',color:SWATCH[2]}),
    W('button',13,9,3,1,{label:'Flash strobo',addr:'/dmx/strobe',color:SWATCH[5]})
  ])]},
  dmx:{name:'Luci DMX',desc:'12 scene con crossfade, chase, blackout, strobo e fader di gruppo.',pages:()=>[P('DMX',[
    W('scenes',0,0,8,5,{label:'Scene OSC',addr:'/dmx/scene',items:sceneList,cols:4,value:0}),
    W('scenes',8,0,4,5,{label:'Palette · Rig A',mode:'dmx-enum',device:'',param:'dmx_a_palette',cols:4,color:SWATCH[1]}),
    W('scenes',12,0,4,5,{label:'Palette · Rig B',mode:'dmx-enum',device:'',param:'dmx_b_palette',cols:4,color:SWATCH[4]}),
    W('scenes',0,5,4,2,{label:'Chase',addr:'/dmx/chase',items:CHASE.join('\n'),cols:2,value:0,color:SWATCH[4]}),
    W('button',4,5,2,2,{label:'Blackout',addr:'/dmx/blackout',mode:'toggle',color:SWATCH[2]}),
    W('button',6,5,2,2,{label:'Strobo',addr:'/dmx/strobe',mode:'toggle',color:SWATCH[5]}),
    W('fader',8,5,4,2,{label:'Fade (s)',addr:'/dmx/fade',min:0,max:10,value:.15,color:SWATCH[1]}),
    W('fader',12,5,4,2,{label:'Strobo (Hz)',addr:'/dmx/strobe/rate',min:1,max:20,value:.37,color:SWATCH[5]}),
    ...[['Master','master',1,0],['Front','group/front',.85,0],['Back','group/back',.9,4],['Teste','group/mh',1,1],['LED bar','group/ledbar',.8,2],['LED wall','group/ledwall',.9,2],['Haze','group/haze',.55,5],['Blinder','group/blinder',0,5]]
      .map(([n,a,v,c],i)=>W('fader',i*2,7,2,5,{label:n,addr:'/dmx/'+a,value:v,color:SWATCH[c]}))
  ]),P('DMX V8',[
    W('tddevice',0,0,16,12,{label:'DMX V8 · controlli live',fam:'dmx',device:''})
  ])]},
  mh:{name:'Teste mobili',desc:'Selezione fixture, pan/tilt, colore, gobo, posizioni preset, dimmer e zoom.',pages:()=>[P('Teste mobili',[
    W('scenes',0,0,8,2,{label:'Selezione teste TD',addr:'/mh/select/heads',mode:'head-select',items:'',headValues:[],selectedHeads:[],value:[],cols:8,color:SWATCH[1]}),
    W('scenes',8,0,4,2,{label:'Posizioni',addr:'/mh/position',items:POS.join('\n'),cols:4,value:-1}),
    W('scenes',12,0,4,2,{label:'Preset PTZ',mode:'head-presets',headPresets:[],color:SWATCH[4]}),
    W('xy',0,2,6,8,{label:'Pan / Tilt',addr:'/mh/pantilt',min:-1,max:1,value:.5,valueY:.25,color:SWATCH[1]}),
    W('color',6,2,4,5,{label:'Colore',addr:'/mh/color',value:{h:.58,s:.55},color:SWATCH[1]}),
    W('scenes',6,7,4,3,{label:'Gobo',addr:'/mh/gobo',items:GOBOS.join('\n'),cols:3,value:0,color:SWATCH[3]}),
    W('fader',10,2,2,5,{label:'Dimmer',addr:'/mh/dimmer',value:1}),
    W('fader',12,2,2,5,{label:'Zoom',addr:'/mh/zoom',value:.3,color:SWATCH[4]}),
    W('fader',14,2,2,5,{label:'Focus',addr:'/mh/focus',value:.7,color:SWATCH[4]}),
    W('button',10,7,2,3,{label:'Strobo',addr:'/mh/strobe',mode:'toggle',color:SWATCH[5]}),
    W('button',12,7,2,3,{label:'Home',addr:'/mh/home',color:SWATCH[2]}),
    W('button',14,7,2,1,{label:'Segui',addr:'/mh/follow',mode:'toggle',color:SWATCH[3]}),
    W('button',14,8,2,2,{label:'Rilascia',addr:'/mh/release',color:SWATCH[1]})
  ])]},
  timeline:{name:'Timeline e clock',desc:'Cue list a tempo, timecode 25 fps, countdown a fine show, GO e Back.',pages:()=>[P('Timeline',[
    W('timeline',0,0,16,5,{label:'Timeline',...tlOpts()}),
    W('clock',0,5,6,2,{label:'Timecode',mode:'show',color:SWATCH[0]}),
    W('clock',6,5,5,2,{label:'Fine show',mode:'countdown',target:'23:30',color:SWATCH[1]}),
    W('clock',11,5,5,2,{label:'Ora',mode:'tod',color:SWATCH[5]}),
    W('button',0,7,4,3,{label:'GO',addr:'/show/go',color:SWATCH[3]}),
    W('button',4,7,2,3,{label:'Back',addr:'/show/back',color:SWATCH[5]}),
    W('scenes',6,7,10,3,{label:'Scena attiva',addr:'/dmx/scene',items:sceneList,cols:6,value:0})
  ])]},
  palco:{name:'Design palco',desc:'Pianta del rig con patch DMX, render live, contenuti LED wall e blinder.',pages:()=>[P('Palco',[
    W('stage',0,0,12,10,{label:'Design',view:'plot'}),
    W('color',12,0,4,4,{label:'LED wall',addr:'/led/color',value:{h:.9,s:.8},color:SWATCH[2]}),
    W('scenes',12,4,4,3,{label:'Contenuto LED',addr:'/led/mode',items:LEDM.join('\n'),cols:2,value:1,color:SWATCH[2]}),
    W('fader',12,7,2,3,{label:'LED',addr:'/led/bright',value:.9,color:SWATCH[2]}),
    W('fader',14,7,2,3,{label:'Blinder',addr:'/dmx/group/blinder',value:0,color:SWATCH[5]})
  ])]},
  mix:{name:'Mixer live',desc:'Fader canali con CC MIDI, meter, effetti, pad XY e scene.',pages:()=>{const mix=['Drums','Bass','Piano','Synth'];return[P('Mix',[
    ...mix.map((n,i)=>W('fader',i*2,0,2,6,{label:n,addr:'/mix/'+n.toLowerCase(),color:SWATCH[i],value:[.82,.64,.5,.36][i],midi:{ch:1,cc:String(20+i)}})),
    W('meter',8,0,1,6,{label:'L',addr:'/meter/l',color:SWATCH[3],value:.58}),
    W('meter',9,0,1,6,{label:'R',addr:'/meter/r',color:SWATCH[3],value:.51}),
    W('knob',10,0,2,3,{label:'Reverb',addr:'/fx/reverb',color:SWATCH[4],value:.3}),
    W('knob',12,0,2,3,{label:'Delay',addr:'/fx/delay',color:SWATCH[4],value:.55}),
    W('knob',14,0,2,3,{label:'Cutoff',addr:'/fx/cutoff',min:20,max:20000,color:SWATCH[1],value:.72}),
    W('xy',10,3,6,5,{label:'Filtro XY',addr:'/fx/xy',min:-1,max:1,color:SWATCH[1],value:.4,valueY:.62}),
    ...[1,2,3,4].map(n=>W('button',(n-1)*2,6,2,2,{label:'Clip '+n,addr:'/live/clip/'+n,color:SWATCH[0]})),
    W('button',8,6,2,2,{label:'Mute FX',addr:'/fx/mute',color:SWATCH[2],mode:'toggle'}),
    W('label',0,8,4,2,{label:'Master',color:SWATCH[5]}),
    W('fader',4,8,12,2,{label:'Volume',addr:'/mix/master',color:SWATCH[5],value:.8})
  ])]}}
};
TPL.gaia={name:'Gaia live',desc:'Agent Gaia (mood, pensieri, chat), PatchDeck V8 con FX, Controller V8, DMX V8 e luci di stanza via MQTT.',pages:()=>[
  P('Gaia',[W('gaia',0,0,10,10,{label:'Gaia'}),W('clock',10,0,6,2,{label:'Ora',mode:'tod',color:SWATCH[5]}),W('gaiadmx',10,2,6,8,{label:'Luci stanza',addr:''})]),
  P('PatchDeck',[W('patchdeck',0,0,8,6,{label:'Deck A',deck:'a',color:SWATCH[1]}),W('patchdeck',8,0,8,6,{label:'Deck B',deck:'b',color:SWATCH[2]}),
    W('tddevice',0,6,9,4,{label:'FX e servizi',fam:'patchdeck',color:SWATCH[1]}),W('tddevice',9,6,7,4,{label:'Controller',fam:'mixeraudio',color:SWATCH[3]})]),
  P('DMX V8',[W('tddevice',0,0,10,10,{label:'DMX V8',fam:'dmx',color:SWATCH[0]}),W('gaiadmx',10,0,6,10,{label:'DMX stanza',color:SWATCH[4]})])]};
TPL.full={name:'Show completo',desc:'Tutte le pagine insieme: Gaia, PatchDeck, DMX V8, panoramica show, DMX, teste mobili, timeline, palco, mix.',
  pages:()=>['gaia','show','dmx','mh','timeline','palco','mix'].flatMap(k=>TPL[k].pages())};
const sample=()=>({pages:TPL.full.pages(),fixtures:defaultFixtures(),stage:stageDefaults()});

let L=store.get(KEY)||sample();
// Se L.rig esiste (show salvato PRIMA di oggi, quando il rig erano solo
// conteggi) va passato alla migrazione -- altrimenti un utente che
// aveva personalizzato il rig (es. 10 teste invece di 8) si trova con
// le fixture del default globale, non le "sue" (bug trovato dal vivo
// 2026-10-16, l'utente segnalava "il render non si aggiorna in base a
// quello disegnato" -- era anche questo: la migrazione ripartiva dal
// default invece di quello che aveva davvero configurato).
if(!L.fixtures)L.fixtures=defaultFixtures(L.rig);
ensureStageData(L);
// host/port: destinazione OSC generica (/dmx/..., /mh/..., /led/..., /show/...)
// -- DMX Master (TD, famiglia dmx) riceve questi indirizzi DIRETTAMENTE, non
// passa da osc_bridge.py (quello e' solo per /gaia/..., vedi GAIA_PLANCIA_INTEGRATION.md).
// 192.168.1.73:7020 = valore noto al 2026-10-15 -- se DMX Master cambia
// macchina/IP, aggiorna qui (o dall'interfaccia, persiste in locale).
let C=Object.assign({url:(location.protocol==='http:'?'ws://'+location.host:'ws://localhost:8080'),host:'192.168.1.73',port:7020},store.get(CKEY)||{});
C.oscChannels=Array.isArray(C.oscChannels)?C.oscChannels.filter(c=>c&&typeof c.id==='string'&&c.id).map(c=>({
  id:c.id,name:String(c.name||''),family:['dmx','patchdeck','mixeraudio','gaia','custom'].includes(c.family)?c.family:'custom',instance:String(c.instance||''),host:String(c.host||''),port:+c.port||''
})):[];
const OSC_FAMILIES={dmx:'DMX',patchdeck:'PatchDeck',mixeraudio:'Controller Audio',gaia:'Gaia',custom:'Altro'};
const oscChannelName=c=>`${c.name||OSC_FAMILIES[c.family]||'Canale'}${c.instance?' · '+c.instance:''} (${c.host}:${c.port})`;
const oscChannelId=c=>`osc:${encodeURIComponent(c.family)}:${encodeURIComponent(String(c.instance).trim().toLowerCase()||String(c.name).trim().toLowerCase())}`;
let pi=0, editing=false, selId=null, ws=null, retry=null, hello=null;
const stage=$('#stage'), insp=$('#insp');
const page=()=>L.pages[pi];
const allW=()=>L.pages.flatMap(p=>p.widgets);
const findW=id=>allW().find(w=>w.id===id)||null;
const save=()=>store.set(KEY,L);
save();
const out=(w,v)=>w.min+(w.max-w.min)*v;
const fmt=n=>{const a=Math.abs(n);return a>=100?Math.round(n).toString():a>=10?n.toFixed(1):n.toFixed(2)};
const items=w=>String(w.items||'').split('\n').map(s=>s.trim()).filter(Boolean);
const colsOf=(w,n)=>w.cols>0?Math.min(w.cols,n):clamp(Math.round(Math.sqrt(n*w.w/Math.max(1,w.h))),1,n);
const colorRGB=w=>hsv2rgb(w.value?.h??0,w.value?.s??0,1);
const lookHex=i=>{const c=LOOKS[i]?.wall.col||[0,0,0];return Math.max(...c)<.2?'#6b7280':hex(c.map(x=>Math.max(x,.18)))};
