'use strict';
// Test di caratterizzazione: fotografa il comportamento ATTUALE della Plancia
// e lo confronta con il riferimento in test/snapshots/characterization.json.
// Serve al refactor: qualunque differenza va spiegata (bug corretto) o e' una
// regressione. Gira nel browser headless (test/browser-harness.js) con una
// build di test che espone l'interno (window.__planciaTest).
//
//   npm run characterize            confronta con il riferimento
//   npm run characterize -- --update  riscrive il riferimento (solo per un cambio voluto)
//
// Cosa fotografa (senza id casuali):
//   widgets     argomenti OSC (argsOf) di ogni tipo, ai valori di default e a valori scelti
//   messages    messaggi davvero spediti al bridge da set/setXY/fire (OSC, canale, MIDI)
//   templates   pagine e widget di ogni template (tipo, posizione, indirizzo, modo)
//   migrations  un layout di vecchio formato passato per tutta la catena uiRev
//   incoming    OSC e MQTT in arrivo: valori dei widget e stato che cambiano
//   render      Render del palco a stato fisso: simulato, reale, misto (impronta dei pixel)
//   layout      il layout dei dati veri: identico dopo un ricaricamento (idempotente)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const ROOT = path.join(__dirname, '..');
const SNAP = path.join(__dirname, 'snapshots', 'characterization.json');
const UPDATE = process.argv.includes('--update');

// eseguito nella pagina: restituisce dati JSON senza id casuali
const PAGE_WIDGETS = `(()=>{const T=window.__planciaTest,out={};
  const pick=w=>({type:w.type,x:w.x,y:w.y,w:w.w,h:w.h,addr:w.addr||'',mode:w.mode||'',label:w.label||''});
  const probes={fader:[{value:.25}],knob:[{value:.75}],meter:[{value:.5}],button:[{value:1},{value:0,mode:'toggle'}],
    xy:[{value:.25,valueY:.75}],scenes:[{value:2},{mode:'multi',value:[1,0,1]}],color:[{value:{h:.5,s:1}},{value:{h:0,s:0}}],
    label:[{}],clock:[{}],timeline:[{}]};
  for(const type of Object.keys(T.DEF)){
    const [w,h]=T.DEF[type],base=T.W(type,0,0,w,h,{addr:'/prova/'+type,min:-1,max:1});
    const row={label:T.NAMES[type],size:[w,h],args:T.argsOf(base)};
    row.probes=(probes[type]||[]).map(o=>{const x=T.W(type,0,0,w,h,{addr:'/prova/'+type,min:-1,max:1,...o});return{set:o,args:T.argsOf(x)}});
    out[type]=row;
  }
  return out})()`;

const PAGE_MESSAGES = `(async()=>{const T=window.__planciaTest,raf=()=>new Promise(r=>requestAnimationFrame(()=>r()));
  window.__sent.length=0;
  const f=T.W('fader',0,0,2,5,{addr:'/dmx/master',min:0,max:255,midi:{ch:2,cc:7}});
  const b=T.W('button',0,0,2,2,{addr:'/dmx/blackout',mode:'toggle',oscChannel:'dmx'});
  const xy=T.W('xy',0,0,4,4,{addr:'/mh/pantilt',min:-1,max:1});
  T.set(f,.5);T.set(b,1);T.setXY(xy,.75,.25);await raf();await raf();
  T.fire('/dmx/scene',[3]);T.fire('/gaia/td/mood/calm',[1],'gaia');
  return window.__sent.map(m=>JSON.parse(JSON.stringify(m)))})()`;

const PAGE_TEMPLATES = `(()=>{const T=window.__planciaTest,out={};
  const pick=w=>[w.type,w.x,w.y,w.w,w.h,w.addr||'',w.mode||'',w.label||''];
  for(const[k,t]of Object.entries(T.TPL))out[k]={name:t.name,pages:t.pages().map(p=>({name:p.name,widgets:p.widgets.map(pick)}))};
  return out})()`;

// un layout di vecchio formato (prima delle migrazioni uiRev): selettore teste
// "MH 1..8", chase locale, due pagine DMX V8 doppie, niente pagine nuove
const PAGE_MIGRATIONS = `(()=>{const T=window.__planciaTest,W=T.W,P=T.P,saved=T.L;
  const legacy={pages:[
    P('Show',[W('timeline',0,0,10,3,{label:'Timeline',addr:'/show',cues:'0:00 Intro > 1'})]),
    P('Timeline',[W('timeline',0,0,16,4,{label:'Timeline',addr:'/show',cues:'0:00 A > 1\\n1:00 B > 2'})]),
    P('Teste mobili',[W('scenes',0,0,8,2,{addr:'/mh/select',mode:'multi',items:'MH 1\\nMH 2\\nMH 3\\nMH 4\\nMH 5\\nMH 6\\nMH 7\\nMH 8',value:[1,0,1,0,0,0,0,0]}),
      W('scenes',8,0,8,2,{addr:'/mh/position',items:'Centro\\nPubblico',cols:4})]),
    P('Regia',[W('scenes',0,0,4,2,{addr:'/dmx/chase',label:'Chase'})]),
    P('DMX V8',[W('tddevice',0,0,8,4,{fam:'dmx'})]),
    P('DMX V8',[W('tddevice',0,0,8,4,{fam:'dmx'})])],fixtures:[]};
  T.ensureStageData(legacy);T.L=legacy;
  const steps=[];
  for(const[name,fn]of T.migrations){fn();steps.push([name,T.L.uiRev||0])}
  const L=T.L,res={steps,uiRev:L.uiRev,pages:L.pages.map(p=>({name:p.name,widgets:p.widgets.map(w=>[w.type,w.addr||'',w.mode||'',w.label||''])})),
    laserScenes:(L.laserScenes||[]).map(s=>s.id)};
  T.L=saved;return res})()`;

// messaggi IN ARRIVO: OSC dal bridge (receive) su un layout di prova, e MQTT
// (gIn) per ogni famiglia di topic; si fotografa cio' che cambia. Solo device
// e testi di prova: la simulazione di Gaia gira in sottofondo.
const PAGE_INCOMING = `(()=>{const T=window.__planciaTest,W=T.W,P=T.P,saved=T.L;
  const ws=[W('fader',0,0,1,4,{addr:'/in/f',min:0,max:255}),W('fader',0,0,1,4,{addr:'/in/f',min:0,max:255,oscChannel:'dmx'}),
    W('knob',0,0,2,2,{addr:'/in/k',min:-1,max:1}),W('meter',0,0,1,4,{addr:'/in/m',min:0,max:1}),
    W('xy',0,0,4,4,{addr:'/in/xy',min:-1,max:1}),W('button',0,0,2,2,{addr:'/in/b',min:0,max:1}),
    W('button',0,0,2,2,{addr:'/in/bt',min:0,max:255,mode:'toggle'}),W('scenes',0,0,4,2,{addr:'/in/s',items:'A\\nB\\nC'}),
    W('scenes',0,0,4,2,{addr:'/in/sm',mode:'multi',items:'A\\nB\\nC'}),
    W('scenes',0,0,4,2,{addr:'/mh/select/heads',mode:'head-select',headValues:['h1','h2','h3']}),
    W('color',0,0,2,2,{addr:'/in/c'}),W('label',0,0,2,1,{addr:'/in/l',label:'L'}),W('fader',0,0,1,4,{addr:'/in/f2',min:0,max:1})];
  T.L={...saved,pages:[P('vuota',[]),P('prova',ws)]};
  const msgs=[['/in/f',[127.5]],['/in/f',[255],'dmx'],['/in/k',[0.5]],['/in/m',[0.25]],['/in/xy',[0.5]],['/in/xy',[0.5,-0.5]],
    ['/in/b',[1]],['/in/bt',[200]],['/in/s',[2]],['/in/sm',[1,0,1]],['/mh/select/heads',['h2','h3']],['/in/c',[1,0,0]],
    ['/in/c',[0.5]],['/in/l',[3]],['/in/f2',[]],['/nessuno',[1]],['/dmx/master',[0.4]],['/dmx/fixture/id3',[0.8]]];
  const osc=[];
  for(const[address,args,channel]of msgs){T.receive({type:'osc',address,args,...(channel?{channel}:{})});
    osc.push([address,channel||'',ws.map(w=>JSON.stringify([w.value,w.valueY,w.selectedHeads]))])}
  const sh={master:T.SH.master},fx=T.DMX_OUTPUT.fixtures.get('id3');
  T.L=saved;
  const mqtt=[['gaia/device/zz-td/status',{device_id:'zz-td',params:{a:{v:1}},ts:1}],
    ['gaia/devices/zz-td/dmx_patch',{rev:2,params:{b:{v:2}}}],['gaia/devices/zz-td/dmx_patch',{rev:2,params:{b:{v:9}}}],
    ['gaia/devices/zz-pd/patchdeck_matrix',{device_id:'zz-pd',patches:[1,2]}],['gaia/devices/zz-pd/patch_thumb/4',{patch:4,label:'P4',data:'QUJD'}],
    ['gaia/devices/zz-dx/dmx_matrix',{device_id:'zz-dx',heads:[]}],['gaia/device/zz-ctl/audio_levels',{rms:0.5}],
    ['gaia/dmx/zz-sala/status',{stanza:'zz-sala',on:1}],['gaia/td/canvas',{zz:1}],['gaia/brain/state',{zz:2}],['gaia/brain/dream','zz sogno'],
    ['gaia/voice/tts/zz-sala','zz ciao'],['gaia/voice/command/zz-sala',{text:'zz luce',stanza:'zz-sala'}],
    ['gaia/devices/zz-laser/laser_preview',{cubes:{c1:[[0,0]]}}],['gaia/devices/zz-dmx/show_timeline',{rev:9,cues:[]}],
    ['gaia/devices/zz-dmx/dmx_rigs',{rigs:{zz_rig:{level:0.7,kicks:3}}}],
    ['gaia/show/clock/state',{v:1,master:'td-dmx-win',pos:12.5,playing:true,length:300}],
    ['gaia/devices/zz-dmx/dmx_output',{v:1,device_id:'zz-dmx',seq:4,master:0.6,blackout:false,strobe:false,scene:{index:1},fixtures:[{uid:'zz-1',id:91,sent:true,intensity:0.5}]}]];
  for(const[t,p]of mqtt)T.gIn(t,p);
  const G=T.G,strip=o=>JSON.parse(JSON.stringify(o??null,(k,v)=>['at','_seen','ts','receivedAt'].includes(k)?undefined:v));
  const mq={device:strip(G.devices['zz-td']),tdState:strip(G.tdState['zz-td']),pdm:strip(G.pdm['zz-pd']),thumb:strip(G.pdThumb['zz-pd']),
    dxm:strip(G.dxm['zz-dx']),levels:strip(G.levels['zz-ctl']),dmx:strip(G.dmx['zz-sala']),canvas:strip(G.canvas),brain:strip(G.brain),dream:G.dream,
    chat:G.chat.filter(c=>/^zz/.test(c.text)).map(c=>[c.who,c.text,c.room]),laser:strip(G.laserPreview?.cubes),
    tdTimeline:G.tdTimeline?.rev===9?'zz-dmx ignorato?':'ok',rig:strip(T.DMX_OUTPUT.rigs.zz_rig),
    clock:{pos:T.showClock.state?.pos,playing:T.showClock.state?.playing,authority:T.showClock.authority},
    topics:T.mqttTopics().slice().sort(),
    output:{master:T.DMX_OUTPUT.master,scene:T.DMX_OUTPUT.scene,device:T.DMX_OUTPUT.deviceId,fx:strip(T.DMX_OUTPUT.fixtures.get('zz-1'))}};
  return{osc,sh,fixture:fx?{intensity:fx.intensity}:null,mqtt:mq}})()`;

// Render del palco su un canvas fuori schermo, con stato fisso: solo
// simulazione, tutte le fixture con uscita reale di DMX Master, e meta' e meta'.
// Si registra un'impronta dei pixel (e il colore medio, per capire cosa cambia).
const PAGE_RENDER = `(()=>{const T=window.__planciaTest,SH=T.SH,O=T.DMX_OUTPUT,L=T.L,saved=L.fixtures;
  // il layout vero non ha blinder ne' nebbia: due in piu', solo per la foto
  L.fixtures=[...(saved||[]),{uid:'zz-bl',id:901,type:'blinder',x:-2,y:7,z:1.5},{uid:'zz-hz',id:902,type:'haze',x:3,y:1,z:0}];
  const fx=L.fixtures.filter(f=>f.enabled!==false);
  const keep=JSON.stringify({master:SH.master,blackout:SH.blackout,strobe:SH.strobe,chase:SH.chase,g:SH.g,led:SH.led}),
    tc=[SH.wash,SH.back,SH.bar,SH.wall,...SH.heads.map(h=>h.T)].map(t=>t.c.slice()),hs=SH.heads.map(h=>[h.gobo,h.strobe]);
  const out={source:O.source,lastAt:O.lastAt,fixtures:O.fixtures};
  Object.assign(SH,{master:1,blackout:0,strobe:0,chase:0,g:{front:.85,back:.9,mh:1,ledbar:.8,ledwall:.9,haze:.55,blinder:.3},led:{mode:2,bright:.9}});
  SH.wash.c=[1,.4,.1];SH.back.c=[.2,.3,1];SH.bar.c=[.9,.1,.6];SH.wall.c=[.1,.9,.7];
  T.ensureHeadPool(fx.filter(f=>f.type==='mh').length);
  SH.heads.forEach((h,i)=>{h.T.c=[(i%5)/5-.4,.3+(i%3)*.2,1,.5,.2,.9,.4,.6];h.gobo=i%3;h.strobe=0});
  const shot=()=>{const c=document.createElement('canvas');c.width=480;c.height=270;const g=c.getContext('2d');
    T.drawRender(g,480,270,12345,.5);const d=g.getImageData(0,0,480,270).data;let h=2166136261,r=0,gg=0,b=0;
    for(let i=0;i<d.length;i++){h=Math.imul(h^d[i],16777619)>>>0}
    for(let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];b+=d[i+2]}const n=d.length/4;
    return{hash:h.toString(16),mean:[r/n,gg/n,b/n].map(v=>+v.toFixed(2))}};
  const real=(f,i)=>({key:String(f.uid??f.id),uid:String(f.uid??f.id),id:f.id??null,sent:i%4!==3,intensity:.3+(i%4)*.2,
    rgbOut:i%5===4?null:[(i%3)/2,.5,1-(i%3)/2],pan:f.type==='mh'?-90+i*20:null,tilt:f.type==='mh'?(i%2?40:-30):null,
    zoom:f.type==='mh'?.3:null,focus:f.type==='mh'?.7:null,gobo:null,colorWheel:null,shutter:null,colorSource:i%7===6?'unknown':null,receivedAt:Date.now()});
  const res={fixtures:fx.length,types:[...new Set(fx.map(f=>f.type))].sort()};
  try{
    O.source='unknown';O.lastAt=0;O.fixtures=new Map();res.simulated=shot();
    O.source='mqtt';O.lastAt=Date.now();O.fixtures=new Map(fx.map((f,i)=>[String(f.uid??f.id),real(f,i)]));res.real=shot();
    O.fixtures=new Map(fx.filter((f,i)=>i%2).map((f,i)=>[String(f.uid??f.id),real(f,i)]));res.mixed=shot();
  }finally{
    Object.assign(SH,JSON.parse(keep));[SH.wash,SH.back,SH.bar,SH.wall,...SH.heads.map(h=>h.T)].forEach((t,i)=>{if(tc[i])t.c=tc[i]});
    SH.heads.forEach((h,i)=>{if(hs[i])[h.gobo,h.strobe]=hs[i]});Object.assign(O,out);L.fixtures=saved;
  }
  return res})()`;

function summarizeLayout(L) {
  return JSON.stringify(L);
}

function diff(a, b, at = '', out = []) {
  if (out.length > 30) return out;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || a === null || b === null || typeof a !== 'object') {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${at || '/'}: atteso ${JSON.stringify(a)?.slice(0, 120)} · ora ${JSON.stringify(b)?.slice(0, 120)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${at}/${k}`, out);
  return out;
}

async function main() {
  const p = await startPlancia({ hooks: true });
  let snap;
  try {
    const layoutBefore = summarizeLayout(await p.ev('window.__planciaTest.L'));
    snap = {
      widgets: await p.ev(PAGE_WIDGETS),
      messages: await p.ev(PAGE_MESSAGES),
      templates: await p.ev(PAGE_TEMPLATES),
      migrations: await p.ev(PAGE_MIGRATIONS),
      incoming: await p.ev(PAGE_INCOMING),
      render: await p.ev(PAGE_RENDER),
    };
    await p.reload();
    const layoutAfter = summarizeLayout(await p.ev('window.__planciaTest.L'));
    snap.layout = { idempotentOnReload: layoutBefore === layoutAfter, pages: JSON.parse(layoutAfter).pages.length };
    snap.inspector = await inspectorSnapshot(p);
    if (p.problems.length) throw new Error('errori nella pagina:\n  ' + p.problems.join('\n  '));
  } finally {
    p.close();
  }
  if (UPDATE || !fs.existsSync(SNAP)) {
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.writeFileSync(SNAP, JSON.stringify(snap, null, 1) + '\n');
    console.log(`riferimento ${UPDATE ? 'aggiornato' : 'creato'}: ${path.relative(ROOT, SNAP)}`);
    summary(snap);
    return;
  }
  const ref = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const d = diff(ref, snap);
  if (d.length) {
    console.log(`DIFFERENZE rispetto al riferimento (${d.length}${d.length > 30 ? '+' : ''}):\n  ` + d.join('\n  '));
    process.exitCode = 1;
  } else {
    summary(snap);
    console.log('identico al riferimento');
  }
  assert.ok(snap.layout.idempotentOnReload, 'il layout cambia da solo a ogni ricaricamento');
}

// ispettore di "Modifica griglia": per il primo widget di ogni tipo (e di ogni
// modo di scenes) l'HTML e i valori dei campi, entrando davvero in modifica e
// toccando il widget con un mouse vero
async function inspectorSnapshot(p) {
  await p.ev(`document.querySelector('#editBtn').click();1`);
  await sleep(500);
  const targets = await p.ev(`(()=>{const seen=new Set(),out=[];window.__planciaTest.L.pages.forEach((pg,pi)=>pg.widgets.forEach(w=>{
    const k=w.type==='scenes'?'scenes:'+(w.mode||'push'):w.type;if(seen.has(k))return;seen.add(k);out.push({k,pi,id:w.id})}));return out})()`);
  const out = {};
  for (const t of targets) {
    await p.ev(`document.querySelectorAll('#tabs > *')[${t.pi}].click();1`);
    await sleep(400);
    const c = await p.ev(`(()=>{const el=document.querySelector('[data-id="${t.id}"]'),r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(300);
    out[t.k] = await p.ev(`(()=>{const i=document.querySelector('#insp');
      return{html:i.innerHTML.replace(/\\s+/g,' ').trim(),
        fields:Object.fromEntries([...i.querySelectorAll('[id]')].filter(n=>'value' in n).map(n=>[n.id,n.type==='checkbox'?n.checked:n.value]))}})()`);
  }
  await p.ev(`document.querySelector('#editBtn').click();1`);
  return out;
}

function summary(s) {
  console.log(`  widget: ${Object.keys(s.widgets).length} tipi · messaggi: ${s.messages.length} · template: ${Object.keys(s.templates).length}` +
    ` · migrazioni: uiRev ${s.migrations.uiRev}, ${s.migrations.pages.length} pagine · layout idempotente: ${s.layout.idempotentOnReload}` +
    ` · ispettore: ${Object.keys(s.inspector || {}).length} tipi`);
}

main().catch(e => { console.error('caratterizzazione fallita:', e.message); process.exitCode = 2; });
