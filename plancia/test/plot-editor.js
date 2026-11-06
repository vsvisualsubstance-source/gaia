'use strict';
// Editor oggetti della Pianta (61-stage-fixtures.js): selezione con Shift+clic e
// riquadro, duplica (nomi e indirizzi liberi, blocchi nuovi), specchia, riga,
// distribuisci, fila di copie, trascinamento di gruppo, direzione, elimina, Esc.
//   node test/plot-editor.js [--shot file.png]

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const mouse = (type, x, y, mod = 0, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, modifiers: mod, ...extra });
  const tap = async (a, mod = 0) => { await mouse('mousePressed', a.x, a.y, mod); await mouse('mouseReleased', a.x, a.y, mod); await sleep(120); };
  const drag = async (a, b, mod = 0) => {
    await mouse('mousePressed', a.x, a.y, mod);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, mod, { buttons: 1 });
    await mouse('mouseReleased', b.x, b.y, mod); await sleep(150);
  };
  const scr = (mx, my) => p.ev(`(()=>{const P=window.__planciaTest.stageProj();return{x:P.r.left+(P.proj.cx+${mx}*P.proj.s)*P.r.width/P.W,y:P.r.top+(P.proj.oy+${my}*P.proj.s)*P.r.height/P.H}})()`);
  const fxs = () => p.ev(`window.__planciaTest.L.fixtures.map(f=>({id:f.id,name:f.name,x:f.x,y:f.y,address:f.address,block:f.block||null,aim:f.aim??null,synced:!!f._synced,unit:f.unit??null}))`);
  const sel = () => p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];return[...(t.stageUI[w.id]?.sel||[])]})()`);
  const act = async a => { await p.ev(`(()=>{const b=document.querySelector('.t-stage [data-sel="${a}"]');if(!b)return false;b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true})()`); await sleep(200); };
  const answer = async v => { await sleep(150); await p.ev(`(()=>{const b=document.querySelector('.ui-confirm');const i=b.querySelector('input');if(i)i.value=${JSON.stringify(v)};b.querySelector('[data-ok]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`); await sleep(250); };
  const byName = (list, n) => list.find(f => f.name === n);
  try {
    await p.ev(`(()=>{const t=window.__planciaTest;
      t.L.fixtures=[
        {id:'p1',type:'par',name:'PAR1',group:'front',universe:1,address:1,x:-3,y:2,enabled:true,unit:1,_synced:true},
        {id:'p2',type:'par',name:'PAR2',group:'front',universe:1,address:9,x:-2,y:2.4,enabled:true,unit:2,_synced:true},
        {id:'p3',type:'par',name:'PAR3',group:'front',universe:1,address:17,x:3,y:1.6,enabled:true,unit:3,aim:30},
        {id:'c1',type:'bar',name:'COL1-1',group:'ledbar',universe:1,address:40,x:0,y:-1,z:.2,vertical:true,w:1,block:'COL1',unit:4},
        {id:'c2',type:'bar',name:'COL1-2',group:'ledbar',universe:1,address:44,x:0,y:-1,z:1.2,vertical:true,w:1,block:'COL1',unit:4}];
      t.L.pages.push(t.P('Palco prova',[t.W('stage',0,0,16,10,{label:'Palco',view:'plot'})]));t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(600);
    const SHIFT = 8;

    // Shift+clic: due luci, barra degli strumenti
    await tap(await scr(-3, 2), SHIFT); await tap(await scr(-2, 2.4), SHIFT);
    check(JSON.stringify((await sel()).sort()) === '["p1","p2"]', `Shift+clic seleziona PAR1 e PAR2: ${JSON.stringify(await sel())}`);
    await sleep(200);
    check(await p.ev(`(()=>{const b=document.querySelector('.t-stage .sel-bar');return!b.hidden&&b.textContent.includes('2 luci')})()`), 'barra degli strumenti con "2 luci"');
    check(!(await p.ev(`!document.querySelector('#scrim').hidden`)), 'Shift+clic non apre l\'editor della luce');

    // trascinare una luce selezionata sposta tutta la selezione
    const a = await scr(-3, 2), b = await scr(-2, 2);
    await drag(a, b);
    let L = await fxs();
    check(Math.abs(byName(L, 'PAR1').x + 2) < .05 && Math.abs(byName(L, 'PAR2').x + 1) < .05 && Math.abs(byName(L, 'PAR3').x - 3) < .01, `trascinamento di gruppo: PAR1 ${byName(L, 'PAR1').x.toFixed(2)}, PAR2 ${byName(L, 'PAR2').x.toFixed(2)} (+1 m), PAR3 fermo`);

    // duplica: nomi e indirizzi liberi, non sincronizzate, selezionate le copie
    await act('dup');
    L = await fxs();
    const d4 = byName(L, 'PAR4'), d5 = byName(L, 'PAR5');
    check(d4 && d5 && !d4.synced && !d5.synced, `duplica: PAR4 e PAR5 nuove, non ancora su DMX Master`);
    const used = L.filter(f => f.name !== 'PAR4' && f.name !== 'PAR5').map(f => f.address);
    check(d4 && d5 && d4.address !== d5.address && !used.includes(d4.address) && !used.includes(d5.address), `duplica: indirizzi liberi (${d4?.address}, ${d5?.address})`);
    check(JSON.stringify((await sel()).sort()) === JSON.stringify([d4.id, d5.id].sort()), 'duplica: selezionate le copie');

    // Esc deseleziona
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
    check((await sel()).length === 0, 'Esc deseleziona');

    // specchia PAR3 (x 3, aim 30) -> copia a x -3 con aim -30
    await tap(await scr(3, 1.6), SHIFT);
    await act('mirror');
    L = await fxs();
    const m = L.find(f => f.id !== 'p3' && Math.abs(f.x + 3) < .01 && Math.abs(f.y - 1.6) < .01);
    check(m && m.aim === -30, `specchia: copia a x -3 con direzione -30 (${m ? m.name + ' aim ' + m.aim : 'nessuna'})`);
    await act('none');

    // riquadro con ⬚: prende tutto il blocco COL1
    await p.ev(`(()=>{document.querySelector('.t-stage [data-selmode]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`); await sleep(120);
    const c = await scr(0, -1);
    await drag({ x: c.x - 25, y: c.y - 25 }, { x: c.x + 25, y: c.y + 25 });
    check(JSON.stringify((await sel()).sort()) === '["c1","c2"]', `riquadro: seleziona il blocco intero ${JSON.stringify(await sel())}`);

    // duplica un blocco: blocco nuovo COL2, unita' nuova comune
    await act('dup');
    L = await fxs();
    const nb = L.filter(f => f.block === 'COL2');
    check(nb.length === 2 && nb[0].unit === nb[1].unit && nb[0].unit !== 4, `duplica un blocco: COL2 con 2 barre e unità nuova comune (${nb.map(f => f.unit)})`);

    // fila: 2 copie a 1,5 m della selezione (le 2 barre di COL2)
    await act('array'); await answer('2 1.5');
    L = await fxs();
    check(L.filter(f => f.block === 'COL3').length === 2 && L.filter(f => f.block === 'COL4').length === 2, 'fila di 2 copie del blocco: COL3 e COL4');
    const x3 = L.find(f => f.block === 'COL3').x, x2 = L.find(f => f.block === 'COL2').x;
    check(Math.abs(x3 - x2 - 1.5) < .01, `fila: passo 1,5 m (${(x3 - x2).toFixed(2)})`);

    // distribuisci e riga: 4 blocchi a x 0.5, 2, 3.5 ... rimessi a passo regolare tra il primo e l'ultimo
    await act('none');
    await p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0],s=t.stageUI[w.id].sel;
      for(const f of t.L.fixtures)if(/^COL[1-4]$/.test(f.block||''))s.add(f.id);
      for(const f of t.L.fixtures)if(f.block==='COL2'){f.x=.1;f.y=-.5}
      return s.size})()`);
    await act('dist'); await act('row');
    L = await fxs();
    const xs = ['COL1', 'COL2', 'COL3', 'COL4'].map(b => L.find(f => f.block === b)).map(f => +f.x.toFixed(2)).sort((p, q) => p - q);
    const steps = xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(2));
    check(Math.max(...steps) - Math.min(...steps) < .02, `distribuisci: passo regolare tra i blocchi (${xs.join(', ')})`);
    const ys = new Set(L.filter(f => /^COL[1-4]$/.test(f.block || '')).map(f => f.y.toFixed(2)));
    check(ys.size === 1, `riga: stessa profondità per tutti i blocchi (${[...ys].join(', ')})`);

    // direzione della selezione
    await act('aim:180');
    L = await fxs();
    check(L.filter(f => /^COL[1-4]$/.test(f.block || '')).every(f => f.aim === 180), 'direzione ↑ (fondo) su tutta la selezione');

    const shot = arg('--shot');
    if (shot) { await sleep(300); await p.shot(path.resolve(shot)); console.log('screenshot: ' + path.resolve(shot)); }

    // elimina (Canc) con conferma
    const before = (await fxs()).length, n = (await sel()).length;
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await sleep(150);
    await p.ev(`(()=>{document.querySelector('.ui-confirm [data-v="1"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(200);
    check((await fxs()).length === before - n, `Canc elimina le ${n} luci selezionate`);
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('editor Pianta: prova fallita:', e.message); process.exitCode = 2; });
