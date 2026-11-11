'use strict';
// Orientamento delle luci (60-stage-rendering.js, editor in 61-stage-fixtures.js):
// direzione in pianta e inclinazione, pulsanti rapidi, propagazione al blocco,
// Pianta e Render disegnati senza errori.
//   node test/fixture-aim.js [--shot prefisso]

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const click = sel => p.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
  const fx = () => p.ev(`JSON.stringify(Object.fromEntries(window.__planciaTest.L.fixtures.map(f=>[f.id,[f.aim??null,f.pitch??null]])))`);
  try {
    await p.ev(`(()=>{const t=window.__planciaTest;
      t.L.fixtures=[
        {id:'c1',type:'bar',name:'COL1-1',group:'ledbar',universe:1,address:1,x:-3,y:-.6,z:.2,vertical:true,w:1,block:'COL1',unit:1,enabled:true},
        {id:'c2',type:'bar',name:'COL1-2',group:'ledbar',universe:1,address:15,x:-3,y:-.6,z:1.2,vertical:true,w:1,block:'COL1',unit:1,enabled:true},
        {id:'b1',type:'bar',name:'BAR1',group:'ledbar',universe:1,address:40,x:2,y:1,enabled:true,aim:90},
        {id:'p1',type:'par',name:'PAR1',group:'front',universe:1,address:60,x:0,y:2,enabled:true},
        {id:'p2',type:'par',name:'PAR2',group:'front',universe:1,address:64,x:3,y:2,enabled:true,aim:180,pitch:0}];
      t.L.pages.push(t.P('Palco prova',[t.W('stage',0,0,16,10,{label:'Palco',view:'plot'})]));t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(500);
    // editor della barra in colonna: "Fondo" vale per tutto il blocco
    await p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];t.openFixEditor(w,t.L.fixtures.find(f=>f.id==='c1'));return 1})()`);
    await sleep(200);
    check(await p.ev(`!!document.querySelector('#feAim')&&!!document.querySelector('#feAimBlock')?.checked`), 'editor: campi direzione e inclinazione, "vale per tutto il blocco" acceso');
    check(await p.ev(`document.querySelector('#feAim').value===''`), 'direzione non impostata: campo vuoto (niente valore dato per scontato)');
    await click('.fe-aim [data-aim="180"]'); await sleep(100);
    let v = JSON.parse(await fx());
    check(v.c1[0] === 180 && v.c2[0] === 180, `"Fondo": 180 su tutto il blocco COL1 (${JSON.stringify([v.c1, v.c2])})`);
    await click('.fe-aim [data-pitch="90"]'); await sleep(100);
    v = JSON.parse(await fx());
    check(v.c1[1] === 90 && v.c2[1] === 90, '"Su": inclinazione 90 sul blocco');
    await p.ev(`(()=>{const i=document.querySelector('#feAim');i.value='-270';i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`); await sleep(100);
    v = JSON.parse(await fx());
    check(v.c1[0] === 90, `-270 diventa 90 (gradi riportati tra -180 e 180): ${v.c1[0]}`);
    await p.ev(`(()=>{const i=document.querySelector('#feAim');i.value='';i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`); await sleep(100);
    v = JSON.parse(await fx());
    check(v.c1[0] === null && v.c2[0] === null, 'campo svuotato: direzione di nuovo "non impostata"');
    await p.ev(`(()=>{const i=document.querySelector('#feAim');i.value='180';i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    await p.ev(`(()=>{for(const [id,v] of [['feBeam','12'],['fePower','250']]){const i=document.querySelector('#'+id);i.value=v;i.dispatchEvent(new Event('change',{bubbles:true}))}return 1})()`);
    await sleep(100);
    const bp = await p.ev(`JSON.stringify(window.__planciaTest.L.fixtures.filter(f=>f.block==='COL1').map(f=>[f.beamDeg,f.power]))`);
    check(bp === '[[12,2.5],[12,2.5]]', `apertura 12 gradi e intensità 250% su tutto il blocco: ${bp}`);
    // altezza e nome da soli si salvano (si erano persi i loro ascoltatori)
    await p.ev(`(()=>{for(const [id,v] of [['feZ','2.4'],['feName','COL1-BASSA']]){const i=document.querySelector('#'+id);i.value=v;i.dispatchEvent(new Event('change',{bubbles:true}))}return 1})()`);
    await sleep(100);
    const zn = await p.ev(`JSON.stringify((f=>[f.z,f.name])(window.__planciaTest.L.fixtures.find(f=>f.id==='c1')))`);
    check(zn === '[2.4,"COL1-BASSA"]', `altezza dal piano e nome salvati cambiandoli da soli: ${zn}`);
    // laser: inclinazione verticale accanto all'orientamento in pianta
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.fixtures.push({id:'lt',type:'laser',name:'LASER T',x:0,y:-2,z:3,angle:0,spread:40,enabled:true});
      t.openFixEditor(t.L.pages[t.L.pages.length-1].widgets[0],t.L.fixtures.find(f=>f.id==='lt'));const i=document.querySelector('#feTilt');i.value='30';i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    await sleep(100);
    check(await p.ev(`window.__planciaTest.L.fixtures.find(f=>f.id==='lt').tilt`) === 30, 'laser: inclinazione 30 gradi salvata cambiandola da sola');
    await p.ev(`(()=>{const i=document.querySelector('#feTilt');i.value='0';i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    check(await p.ev(`!('tilt' in window.__planciaTest.L.fixtures.find(f=>f.id==='lt'))`), 'laser: inclinazione 0 = campo tolto (orizzontale)');
    const ax = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest,a=T.laserAxes({tilt:90},0),b=T.laserAxes({tilt:-30},Math.PI/2);
      const proj=(x,y,z)=>({x,y,z}),hit=T.laserPoint({x:0,y:0},3,[0,6,-3],proj);return JSON.stringify({a:a.fwd.map(v=>+v.toFixed(3)),b:b.fwd.map(v=>+v.toFixed(3)),hit})})()`));
    check(JSON.stringify(ax.a) === '[0,0,1]' && ax.b[0] > .8 && ax.b[2] === -0.5, `asse del laser: 90 gradi dritto in alto, -30 verso il basso (${JSON.stringify(ax.a)} ${JSON.stringify(ax.b)})`);
    check(ax.hit.z === 0 && Math.abs(ax.hit.y - 3) < 1e-9, `raggio verso il basso: si ferma sul pavimento (${JSON.stringify(ax.hit)})`);
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.fixtures=t.L.fixtures.filter(f=>f.id!=='lt');document.querySelector('#scrim').hidden=true;return 1})()`);
    // laser senza cubo e PAR inclinato verso il basso (pozza di luce) per lo screenshot
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.fixtures.push({id:'l1',type:'laser',name:'LASER',x:0,y:-2,z:3,angle:0,spread:40,enabled:true},{id:'p3',type:'par',name:'PAR3',group:'front',universe:1,address:70,x:-1,y:1,z:4,pitch:-60,aim:0,beamDeg:30,enabled:true});return 1})()`);
    await p.ev(`(()=>{document.querySelector('#scrim').hidden=true;return 1})()`);
    await sleep(400);
    const shot = arg('--shot');
    if (shot) await p.shot(path.resolve(shot + '-pianta.png'));
    await p.ev(`(()=>{const S=window.__planciaTest.SH;S.blackout=false;S.master=1;for(const k of Object.keys(S.g))S.g[k]=1;return 1})()`);
    await p.ev(`(()=>{document.querySelector('.t-stage [data-v="render"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(800);
    if (shot) { await p.shot(path.resolve(shot + '-render.png')); console.log('screenshot: ' + path.resolve(shot) + '-*.png'); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('orientamento luci: prova fallita:', e.message); process.exitCode = 2; });
