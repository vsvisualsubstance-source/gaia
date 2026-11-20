'use strict';
// Pagina Mapping (20/11): corner pin e mesh di un proiettore del Palco, salvati nel progetto
// (L.mapping, letto da /api/mapping), con l'anteprima della sorgente.
//   node test/mapping-page.js
const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');
const OUT = path.join(__dirname, '..', 'test-output', 'mapping');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const click = async (x, y, type = 'left') => { for (const t of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type: t, x, y, button: type, clickCount: 1 }); };
  const drag = async (x0, y0, x1, y1) => {
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8, button: 'left', buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  };
  try {
    check(await p.ev(`typeof PlanciaMapping==='object'&&typeof PlanciaMapping.warpPt==='function'`), 'modulo mapping caricato nella Plancia');
    const pg = await p.ev(`(()=>{const T=window.__planciaTest,L=T.L;
      L.fixtures=(L.fixtures||[]).filter(f=>f.type!=='projector');
      L.fixtures.push({id:'prj1',type:'projector',name:'PROIETTORE 1',x:0,y:9,z:3,throw:1.5,sourceType:'procedural',enabled:true});
      const i=L.pages.findIndex(pg=>pg.widgets.some(w=>w.type==='mapping'));if(i<0)return -1;
      [...document.querySelectorAll('#groups .tab')].find(b=>b.textContent==='Render 3D')?.click();
      [...document.querySelectorAll('#tabs .tab')].find(b=>b.textContent==='Mapping')?.click();return i})()`);
    check(pg >= 0, 'pagina Mapping presente (migrazione)');
    await sleep(800);
    const box = await p.ev(`(()=>{const c=document.querySelector('.mp-ov');if(!c)return null;const r=c.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,msg:document.querySelector('.mp-msg').textContent,opts:[...document.querySelectorAll('[data-mp=prj] option')].map(o=>o.textContent)}})()`);
    check(box && box.w > 200 && box.h > 100, `anteprima 16:9 del proiettore: ${box && Math.round(box.w)}×${box && Math.round(box.h)}`);
    check(box?.opts?.includes('PROIETTORE 1'), 'proiettore del Palco nel menu');
    check(/Immagine di prova/.test(box?.msg || ''), 'sorgente procedurale = immagine di prova: ' + (box?.msg || '').slice(0, 80));
    const glPix = await p.ev(`(()=>{const c=document.querySelector('.mp-gl'),g=c.getContext('webgl'),px=new Uint8Array(4);g.readPixels(Math.round(c.width*.1),Math.round(c.height*.75),1,1,g.RGBA,g.UNSIGNED_BYTE,px);return [...px]})()`);
    check(glPix[0] + glPix[1] + glPix[2] > 200, `immagine di prova disegnata con WebGL (pixel ${glPix.join(',')})`);

    // trascina l'angolo alto sx di 60 px a destra e 30 in basso
    await drag(box.x + 1, box.y + 1, box.x + 61, box.y + 31);
    await sleep(500);
    const c0 = await p.ev(`window.__planciaTest.L.mapping?.out?.prj1?.map?.corners?.[0]`);
    check(c0 && Math.abs(c0[0] - 60 / box.w) < 0.02 && Math.abs(c0[1] - 30 / box.h) < 0.02, `angolo alto sx trascinato: ${JSON.stringify(c0)}`);
    // salvato nel progetto: il bridge lo dà al Render 3D
    let api = null;
    for (let i = 0; i < 20; i++) { await sleep(250); api = await p.ev(`fetch('/api/mapping').then(r=>r.json())`); if (api.mapping?.out?.prj1) break; }
    check(Math.abs((api.mapping?.out?.prj1?.map?.corners?.[0]?.[0] ?? 0) - c0[0]) < 1e-6, 'salvato nel progetto: /api/mapping lo restituisce');
    // trascinando fuori dai punti si sposta tutto
    await drag(box.x + box.w / 2, box.y + box.h / 2, box.x + box.w / 2 + 20, box.y + box.h / 2);
    await sleep(300);
    const all = await p.ev(`window.__planciaTest.L.mapping.out.prj1.map.corners`);
    check(Math.abs(all[2][0] - (1 + 20 / box.w)) < 0.02, `trascinando fuori dai punti si sposta tutto: ${JSON.stringify(all[2])}`);
    // tastiera: Tab al punto 2, freccia giu' con Maiusc = 10 px
    const before = all[1][1];
    await p.ev(`(()=>{const c=document.querySelector('.mp-ov');c.focus();c.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));return 1})()`);
    const after = await p.ev(`window.__planciaTest.L.mapping.out.prj1.map.corners[1][1]`);
    check(Math.abs(after - before - 10 / box.h) < 0.005, `Tab + Maiusc+giù: punto 2 sceso di 10 px (${before.toFixed(3)} → ${after.toFixed(3)})`);
    await p.shot(path.join(OUT, 'corner.png'));
    // mesh 3x3: 9 punti, il centro si piega
    await p.ev(`(()=>{document.querySelector('[data-mp=mode][data-v=mesh]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(300);
    await p.ev(`(()=>{const s=document.querySelector('select[data-mp=n]');s.value='3';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    await sleep(300);
    const mesh = await p.ev(`(()=>{const m=window.__planciaTest.L.mapping.out.prj1.map;return {mode:m.mode,n:m.n,h:PlanciaMapping.handles(m)}})()`);
    check(mesh.mode === 'mesh' && mesh.n === 3 && mesh.h.length === 9, `mesh 3×3: ${mesh.h.length} punti`);
    const hc = mesh.h[4];
    await drag(box.x + hc[0] * box.w, box.y + hc[1] * box.h, box.x + hc[0] * box.w + 25, box.y + hc[1] * box.h - 15);
    await sleep(300);
    const hc2 = await p.ev(`PlanciaMapping.handles(window.__planciaTest.L.mapping.out.prj1.map)[4]`);
    check(Math.abs((hc2[0] - hc[0]) * box.w - 25) < 3 && Math.abs((hc2[1] - hc[1]) * box.h + 15) < 3, `punto centrale della mesh piegato di 25,-15 px`);
    await p.shot(path.join(OUT, 'mesh.png'));
    // reset
    await p.ev(`(()=>{document.querySelector('[data-mp=reset]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    const rs = await p.ev(`(()=>{const m=window.__planciaTest.L.mapping.out.prj1.map;return {c:m.corners,flat:!PlanciaMapping.hasOff(m)}})()`);
    check(JSON.stringify(rs.c) === JSON.stringify([[0, 0], [1, 0], [1, 1], [0, 1]]) && rs.flat, 'Reset: angoli ai bordi e mesh piatta');
    check(!p.problems.length, 'nessuna eccezione' + (p.problems.length ? ': ' + p.problems.slice(0, 3).join(' | ') : ''));
  } finally { p.close(); }
  if (fail.length) { console.log(`\n${fail.length} controlli falliti`); process.exitCode = 1; } else console.log('\ntutto ok');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
