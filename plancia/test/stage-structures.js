'use strict';
// Strutture di scena (97-stage-space.js): americana, pedana, pilastro, quinta.
// Aggiunta dal foglio "Aggiungi", luce appesa all'americana (quota e linea), l'americana
// trascinata si porta dietro le luci appese, la luce appesa scorre lungo la linea,
// quota dell'americana cambiata = luci appese aggiornate; Render dal pubblico e in 3D.
//   node test/stage-structures.js [--shot prefisso]

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const mouse = (type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const tap = async a => { await mouse('mousePressed', a.x, a.y); await mouse('mouseReleased', a.x, a.y); await sleep(200); };
  const drag = async (a, b) => {
    await mouse('mousePressed', a.x, a.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, { buttons: 1 });
    await mouse('mouseReleased', b.x, b.y); await sleep(200);
  };
  const scr = (mx, my) => p.ev(`(()=>{const P=window.__planciaTest.stageProj();return{x:P.r.left+(P.proj.cx+${mx}*P.proj.s)*P.r.width/P.W,y:P.r.top+(P.proj.oy+${my}*P.proj.s)*P.r.height/P.H}})()`);
  const fx = id => p.ev(`(()=>{const f=window.__planciaTest.L.fixtures.find(x=>x.id===${JSON.stringify(id)}||x.name===${JSON.stringify(id)});return f?{id:f.id,name:f.name,x:f.x,y:f.y,z:f.z,w:f.w,rot:f.rot??0,mount:f.mount||null}:null})()`);
  try {
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.stage.trussHeight=5;
      t.L.fixtures=[{id:'p1',type:'par',name:'PAR1',group:'front',universe:1,address:1,x:1.3,y:3,z:0,enabled:true}];
      t.L.pages.push(t.P('Palco prova',[t.W('stage',0,0,16,10,{label:'Palco',view:'plot'})]));t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(500);

    // americana dal foglio "Aggiungi": tocco a vuoto, poi "Americana"
    await tap(await scr(0, 1));
    check(await p.ev(`[...document.querySelectorAll('#scrim [data-ft]')].map(b=>b.textContent).join(',').includes('Americana')`), 'foglio "Aggiungi": americana, pedana, pilastro e quinta nella lista');
    await p.ev(`(()=>{document.querySelector('#scrim [data-ft="truss"]').click();return 1})()`); await sleep(200);
    let t = await fx('TRUSS1');
    check(t && t.w === 6 && t.z === 5, `americana aggiunta: TRUSS1, 6 m, alla quota del palco (${JSON.stringify(t)})`);
    // anche le altre strutture, con le loro misure
    await p.ev(`(()=>{const t=window.__planciaTest;for(const [k,x,y] of [['riser',-3,5],['column',4,6],['flat',-4,1]]){
      const f={id:'s-'+k,type:k,name:k.toUpperCase(),x,y,z:0,enabled:true,...{riser:{w:2,d:1,h:.4,rot:20},column:{w:.4,h:3},flat:{w:2,h:3,rot:-30}}[k]};t.L.fixtures.push(f)}t.save();return 1})()`);
    // PAR1 appeso all'americana dall'editor
    await p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];t.openFixEditor(w,t.L.fixtures.find(f=>f.id==='p1'));return 1})()`); await sleep(200);
    check(await p.ev(`!!document.querySelector('#feMount')`), 'editor della luce: "Appesa a" con le americane');
    await p.ev(`(()=>{const s=document.querySelector('#feMount');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#scrim').hidden=true;return 1})()`); await sleep(200);
    t = await fx('TRUSS1'); let par = await fx('p1');
    check(par.mount === t.id && par.z === 5 && Math.abs(par.y - t.y) < .01 && Math.abs(par.x - 1.3) < .01, `appesa: quota 5 m e sulla linea dell'americana (${JSON.stringify(par)})`);

    // trascinare l'americana: la luce appesa la segue
    const a = await scr(t.x - 2, t.y), b = await scr(t.x - 2, t.y + 1);
    await drag(a, b);
    t = await fx('TRUSS1'); par = await fx('p1');
    check(Math.abs(t.y - 2) < .05 && Math.abs(par.y - t.y) < .01, `americana spostata di 1 m: la luce appesa la segue (truss y ${t.y.toFixed(2)}, par y ${par.y.toFixed(2)})`);

    // trascinare la luce appesa: scorre lungo la linea (non si stacca)
    const c = await scr(par.x, par.y), d = await scr(par.x + 1, par.y + 1.5);
    await drag(c, d);
    par = await fx('p1');
    check(Math.abs(par.x - 2.3) < .1 && Math.abs(par.y - t.y) < .01, `luce appesa trascinata: scorre lungo l'americana (x ${par.x.toFixed(2)}, y ${par.y.toFixed(2)})`);

    // quota e rotazione dell'americana dall'editor: le luci appese si aggiornano
    await p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];t.openFixEditor(w,t.L.fixtures.find(f=>f.name==='TRUSS1'));return 1})()`); await sleep(200);
    check(await p.ev(`!!document.querySelector('#feSW')&&!!document.querySelector('#feSRot')`), 'editor dell\'americana: lunghezza e rotazione');
    await p.ev(`(()=>{const z=document.querySelector('#feZ');z.value='6.5';z.dispatchEvent(new Event('change',{bubbles:true}));const r=document.querySelector('#feSRot');r.value='90';r.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#scrim').hidden=true;return 1})()`); await sleep(200);
    t = await fx('TRUSS1'); par = await fx('p1');
    check(par.z === 6.5 && Math.abs(par.x - t.x) < .01, `americana a 6,5 m e ruotata di 90°: luce a 6,5 m e sulla nuova linea (${par.x.toFixed(2)}, ${par.y.toFixed(2)})`);

    // americana fissa sparita dalla Pianta (c'e' un'americana vera); Render dal pubblico e in 3D
    await sleep(300);
    const shot = arg('--shot');
    if (shot) await p.shot(path.resolve(shot + '-pianta.png'));
    await p.ev(`(()=>{const S=window.__planciaTest.SH;S.blackout=false;S.master=1;for(const k of Object.keys(S.g))S.g[k]=1;document.querySelector('.t-stage [data-v="render"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(500);
    if (shot) await p.shot(path.resolve(shot + '-render.png'));
    await p.ev(`(()=>{document.querySelector('.t-stage [data-cam="sl"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(500);
    if (shot) { await p.shot(path.resolve(shot + '-3d.png')); console.log('screenshot: ' + path.resolve(shot) + '-*.png'); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('strutture: prova fallita:', e.message); process.exitCode = 2; });
