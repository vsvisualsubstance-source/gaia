'use strict';
// Zoom e spostamento della vista del Palco (61-stage-fixtures.js), Pianta e Render,
// con mouse veri (CDP): rotella attorno al puntatore, trascinare a vuoto sposta la
// vista, trascinare una luce sposta la luce, tocco a vuoto apre "aggiungi", pulsanti.
//   node test/stage-view.js [--shot file.png]

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const mouse = (type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const drag = async (a, b) => {
    await mouse('mousePressed', a.x, a.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, { buttons: 1 });
    await mouse('mouseReleased', b.x, b.y); await sleep(150);
  };
  const tap = async a => { await mouse('mousePressed', a.x, a.y); await mouse('mouseReleased', a.x, a.y); await sleep(200); };
  // punto della Pianta (metri) -> schermo, con la proiezione disegnata ora
  const scr = (mx, my) => p.ev(`(()=>{const P=window.__planciaTest.stageProj();return{x:P.r.left+(P.proj.cx+${mx}*P.proj.s)*P.r.width/P.W,y:P.r.top+(P.proj.oy+${my}*P.proj.s)*P.r.height/P.H}})()`);
  const proj = () => p.ev(`(()=>{const P=window.__planciaTest.stageProj();return P.proj})()`);
  const view = k => p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];return t.stageUI[w.id]?.views?.['${k}']||null})()`);
  try {
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(t.P('Palco prova',[t.W('stage',0,0,16,10,{label:'Palco',view:'plot'})]));t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(600);

    // --- Pianta: rotella attorno al puntatore, il punto sotto resta fermo
    const a = await scr(1, 2), s0 = (await proj()).s;
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: a.x, y: a.y, deltaX: 0, deltaY: -300 });
    await sleep(150);
    const s1 = (await proj()).s, a2 = await scr(1, 2);
    check(s1 > s0 * 1.4, `Pianta: la rotella avvicina (scala ${s0.toFixed(1)} -> ${s1.toFixed(1)})`);
    check(Math.hypot(a2.x - a.x, a2.y - a.y) < 1.5, `Pianta: il punto sotto il puntatore resta fermo (${Math.hypot(a2.x - a.x, a2.y - a.y).toFixed(2)} px)`);

    // --- Pianta: trascinare a vuoto sposta la vista, nessuna luce si muove
    const before = await p.ev(`JSON.stringify(window.__planciaTest.L.fixtures.map(f=>[f.x,f.y]))`);
    const empty = await p.ev(`(()=>{const t=window.__planciaTest,P=t.stageProj(),hits=t.stageUI[t.L.pages[t.L.pages.length-1].widgets[0].id].hits||[];
      for(let y=60;y<P.H-60;y+=25)for(let x=60;x<P.W-60;x+=25)if(hits.every(h=>Math.hypot(h.x-x,h.y-y)>h.r+30))return{x:P.r.left+x*P.r.width/P.W,y:P.r.top+y*P.r.height/P.H};return null})()`);
    const v0 = await view('plot');
    await drag(empty, { x: empty.x + 120, y: empty.y + 40 });
    const v1 = await view('plot');
    check(Math.abs(v1.x - v0.x - 120) < 2 && Math.abs(v1.y - v0.y - 40) < 2, `Pianta: trascinare a vuoto sposta la vista di 120, 40 (${(v1.x - v0.x).toFixed(1)}, ${(v1.y - v0.y).toFixed(1)})`);
    check(before === await p.ev(`JSON.stringify(window.__planciaTest.L.fixtures.map(f=>[f.x,f.y]))`), 'Pianta: nessuna luce spostata');
    check(!(await p.ev(`!document.querySelector('#scrim').hidden`)), 'Pianta: trascinare a vuoto non apre "aggiungi"');

    // --- Pianta: una luce si trascina ancora (in metri, con lo zoom)
    const f0 = await p.ev(`(()=>{const f=window.__planciaTest.L.fixtures.find(f=>!f.block&&f.type!=='wall'&&f.type!=='screen');return{id:f.id,x:f.x,y:f.y}})()`);
    const fs0 = await scr(f0.x, f0.y), sNow = (await proj()).s, pxPerM = sNow * (await p.ev(`(()=>{const P=window.__planciaTest.stageProj();return P.r.width/P.W})()`));
    await drag(fs0, { x: fs0.x + pxPerM, y: fs0.y });
    const f1 = await p.ev(`(()=>{const f=window.__planciaTest.L.fixtures.find(x=>x.id==='${f0.id}');return{x:f.x,y:f.y}})()`);
    check(Math.abs(f1.x - f0.x - 1) < 0.05 && Math.abs(f1.y - f0.y) < 0.05, `Pianta: trascinare una luce la sposta di 1 m anche con lo zoom (${(f1.x - f0.x).toFixed(3)} m)`);

    // --- Pianta: tocco a vuoto apre ancora "aggiungi"
    await tap(empty);
    check(await p.ev(`!document.querySelector('#scrim').hidden&&/Aggiungi/i.test(document.querySelector('#scrim').textContent)`), 'Pianta: tocco a vuoto apre "aggiungi fixture"');
    await p.ev(`(()=>{document.querySelector('#scrim').hidden=true;return 1})()`);

    // --- pulsanti
    const btn = async z => { await p.ev(`(()=>{document.querySelector('.t-stage [data-zoom="${z}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`); await sleep(120); };
    await btn('fit');
    const vf = await view('plot');
    check(vf.z === 1 && vf.x === 0 && vf.y === 0, 'Pianta: ⤢ rimette la vista intera');
    await btn('in');
    check((await view('plot')).z > 1.3, 'Pianta: + avvicina');

    // --- Render: rotella, trascinamento, mai bordi vuoti
    await p.ev(`(()=>{document.querySelector('.t-stage [data-v="render"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(300);
    const R = await p.ev(`(()=>{const r=document.querySelector('.t-stage canvas').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: R.x, y: R.y, deltaX: 0, deltaY: 600 });
    await sleep(120);
    check(((await view('render'))?.z ?? 1) === 1, 'Render: non si allontana oltre l\'inquadratura intera');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: R.x, y: R.y, deltaX: 0, deltaY: -500 });
    await sleep(120);
    const r1 = await view('render');
    check(r1.z > 2, `Render: la rotella avvicina (z ${r1.z.toFixed(2)})`);
    await drag({ x: R.x, y: R.y }, { x: R.x + 5000, y: R.y });
    const r2 = await view('render');
    check(r2.x === 0, `Render: trascinando oltre il bordo si ferma al bordo (x ${r2.x.toFixed(1)})`);
    // --- telecamera del Render: viste rapide, girare, Shift + trascina, ritorno al pubblico
    const cam = () => p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];return t.stageUI[w.id]?.cam||{yaw:0,elev:0}})()`);
    const camBtn = async c => { await p.ev(`(()=>{document.querySelector('.t-stage [data-cam="${c}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`); await sleep(250); };
    check(await p.ev(`getComputedStyle(document.querySelector('.t-stage .sv-cam')).display!=='none'`), 'Render: comandi della telecamera visibili');
    await camBtn('sl');
    let cm = await cam();
    check(cm.yaw === -70 && cm.elev === 4, `vista "Sx": telecamera dal lato sinistro (${cm.yaw}°, ${cm.elev}°)`);
    await camBtn('right'); await camBtn('up');
    cm = await cam();
    check(cm.yaw === -50 && cm.elev === 14, `⟳ e △: gira di 20° e sale di 10° (${cm.yaw}°, ${cm.elev}°)`);
    await mouse('mousePressed', R.x, R.y, { modifiers: 8 });
    for (let i = 1; i <= 5; i++) await mouse('mouseMoved', R.x - i * 20, R.y, { buttons: 1, modifiers: 8 });
    await mouse('mouseReleased', R.x - 100, R.y, { modifiers: 8 }); await sleep(150);
    cm = await cam();
    check(Math.abs(cm.yaw - (-50 + 40)) < 1, `Shift + trascina: la telecamera gira (${cm.yaw.toFixed(1)}°)`);
    await camBtn('front');
    cm = await cam();
    check(cm.yaw === 0 && cm.elev === 0, '"Pubblico": torna la vista di sempre');

    // --- due dita (tocchi veri): allargare = avvicina, nessuna luce si sposta
    await btn('fit');
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const fx0 = await p.ev(`JSON.stringify(window.__planciaTest.L.fixtures.map(f=>[f.x,f.y]))`);
    const zr0 = (await view('render')).z;
    const tp = (x, y, id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 });
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(R.x - 40, R.y, 1), tp(R.x + 40, R.y, 2)] });
    for (let i = 1; i <= 8; i++) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(R.x - 40 - i * 10, R.y, 1), tp(R.x + 40 + i * 10, R.y, 2)] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    const zr1 = (await view('render')).z;
    check(Math.abs(zr1 / zr0 - 3) < 0.15, `due dita: allargare avvicina (z ${zr0.toFixed(2)} -> ${zr1.toFixed(2)}, dita da 80 a 240 px: x3)`);
    check(fx0 === await p.ev(`JSON.stringify(window.__planciaTest.L.fixtures.map(f=>[f.x,f.y]))`), 'due dita: nessuna luce spostata');
    const shot = arg('--shot');
    if (shot) { await sleep(300); await p.shot(path.resolve(shot)); console.log('screenshot: ' + path.resolve(shot)); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('vista palco: prova fallita:', e.message); process.exitCode = 2; });
