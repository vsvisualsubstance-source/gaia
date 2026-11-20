'use strict';
// Elementi del Palco nel Render 3D (20/11): LED wall, schermo e proiettore della registrazione,
// messi nella scansione con l'allineamento automatico (colonne collegate) o manuale (2 punti).
//   node test/render3d-palco.js   (senza scansione in data/render3d si salta)
// Registrazione finta: il Palco e' la scansione ruotata di 90 gradi e spostata (X = 4 - y, Z = x).

const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const SCAN = path.join(__dirname, '..', 'data', 'render3d');
const OUT = path.join(__dirname, '..', 'test-output', 'render3d-palco');
const POS = { Lb: [1.83, -5.79], Rb: [2.31, 5.47], Lf: [-8.82, -5.03], Rf: [-8.52, 5.69] };   // colonne nella scansione
const toPalco = ([X, Z], k = 1) => ({ x: Z * k, y: (4 - X) * k });

function recording(k = 1) {
  const fixtures = Object.entries(POS).map(([id, p]) => ({ id: 'col-' + id, type: 'bar', name: 'COL ' + id, vertical: true, z: 0, ...toPalco(p, k) }));
  fixtures.push({ id: 'led', type: 'wall', name: 'LED1', x: 0, y: 0.5 * k, z: 0, w: 6, h: 3.5, rot: 0, src: 'procedural' });
  fixtures.push({ id: 'scr', type: 'screen', name: 'SCHERMO 1', x: -4 * k, y: 3 * k, z: 1, w: 4, h: 2.25, rot: 30 });
  fixtures.push({ id: 'prj', type: 'projector', name: 'PROIETTORE 1', x: 0, y: 11 * k, z: 3, rot: 0, target: 'scr', throw: 1.5, src: 'ndi', ref: 'PATCHDECK (Out)' });
  const frames = Array.from({ length: 61 }, (_, i) => ({ t: Math.round(i * 1000 / 30), f: { led: { c: 'ff2040', k: 0.9 }, 'col-Lb': { c: '2060ff', k: 1 }, 'col-Rb': { c: '2060ff', k: 1 } } }));
  return { app: 'plancia-light-frames', v: 1, fps: 30, created: new Date().toISOString(), project: 'prova palco', duration: 2,
    stage: { width: 12, depth: 8, trussHeight: 5 }, fixtures, frames };
}

async function main() {
  if (!fs.existsSync(path.join(SCAN, 'scan.js'))) { console.log('salto: manca la scansione (data/render3d)'); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const p = await startPlancia();
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    fs.cpSync(SCAN, path.join(p.tmp, 'render3d'), { recursive: true });
    const base = await p.ev('location.origin');
    const up = async (doc, name) => (await fetch(`${base}/api/light-frames?name=${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }).then(r => r.json())).file;
    const f1 = await up(recording(1), 'prova_palco'), f2 = await up(recording(0.6), 'prova_palco_fuori_scala');
    await p.send('Page.navigate', { url: `${base}/render3d/?frames=${encodeURIComponent(f1)}` });
    let n = 0;
    for (let i = 0; i < 80 && !n; i++) { await sleep(250); n = await p.ev(`window.__r3d?.PAL?.items?.length||0`).catch(() => 0); }
    check(n === 3, `3 elementi del Palco nella scena (${n})`);
    const st = () => p.ev(`(()=>{const P=window.__r3d.PAL,g=k=>P.items.find(i=>i.kind===k);const w=g('wall').g,v=new THREE_V();
      return {T:{n:P.T.n,scale:P.T.scale,err:P.T.err},wall:w.position.toArray(),wallN:[w.matrixWorld.elements[8],w.matrixWorld.elements[10]],
        prj:{d:g('projector').dist,img:g('projector').img},col:g('wall').mat.color.toArray(),msg:document.getElementById('palMsg').textContent}})()`.replace('new THREE_V()', '0'));
    await sleep(500);
    let s = await st();
    check(s.T.n === 4 && Math.abs(s.T.scale - 1) < 0.01 && s.T.err < 0.01, `allineamento automatico dalle 4 colonne: scala ${s.T.scale.toFixed(3)}, scarto ${s.T.err?.toFixed(3)} m`);
    check(Math.abs(s.wall[0] - 3.5) < 0.05 && Math.abs(s.wall[1] - 1.75) < 0.05 && Math.abs(s.wall[2]) < 0.05, `LED wall al posto giusto: ${s.wall.map(v => v.toFixed(2))}`);
    check(s.wallN[0] < -0.9, `LED wall rivolto verso il pubblico (fondo sala, -x): ${s.wallN.map(v => v.toFixed(2))}`);
    check(s.col[0] > 0.9 && s.col[2] > 0.2 && s.col[1] < s.col[2], `LED wall col colore registrato: ${s.col.map(v => v.toFixed(2))}`);
    check(s.prj.d > 7 && s.prj.d < 10 && Math.abs(s.prj.img - s.prj.d / 1.5) < 0.01, `proiettore puntato sullo schermo: ${s.prj.d.toFixed(2)} m, immagine ${s.prj.img.toFixed(2)} m (tiro 1.5)`);
    check(/allineati con 4 punti/.test(s.msg), 'messaggio: ' + s.msg);
    await p.ev(`(()=>{document.querySelector('[data-cam=top]').click();return 1})()`); await sleep(1500); await p.shot(path.join(OUT, 'pianta.png'));
    await p.ev(`(()=>{document.querySelector('[data-cam=render]').click();return 1})()`); await sleep(1500); await p.shot(path.join(OUT, 'render.png'));
    // dal proiettore verso lo schermo: l'immagine di prova proiettata
    await p.ev(`(()=>{const R=window.__r3d,it=R.PAL.items,sc=it.find(i=>i.kind==='screen').g,pj=it.find(i=>i.kind==='projector').spot,c=R.camera();document.getElementById('walls').value='none';document.getElementById('walls').dispatchEvent(new Event('change'));
      const w=sc.getWorldPosition(sc.position.clone()),q=pj.getWorldPosition(pj.position.clone());c.position.copy(q).lerp(w,0.25).add({x:0,y:1.2,z:0});R.controls.target.copy(w);R.controls.update();return 1})()`);
    await sleep(1500); await p.shot(path.join(OUT, 'schermo.png'));

    // mapping sul modello: i 4 angoli dello schermo come punti cliccati -> l'immagine cade esattamente li'
    const mp = await p.ev(`(()=>{const R=window.__r3d,P=R.PAL,sc=P.items.find(i=>i.kind==='screen'),pj=P.items.find(i=>i.kind==='projector');
      const g=sc.g,w=sc.f.w,h=sc.f.h,pts=[[-w/2,h/2],[w/2,h/2],[w/2,-h/2],[-w/2,-h/2]].map(([x,y])=>{const v=g.localToWorld(new g.position.constructor(x,y,0));R.compInner.worldToLocal(v);return [v.x,v.y,v.z]});
      P.prj[pj.f.id]={pts};document.getElementById('palDX').dispatchEvent(new Event('input'));
      const it=P.items.find(i=>i.kind==='projector');return {c:it.corners,src:it.mapSrc,msg:document.getElementById('palPrjMsg').textContent}})()`);
    const c = mp.c || [];
    check(mp.src === 'modello' && c.length === 4 && c.every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1) && c[0][0] < c[1][0] && c[3][0] < c[2][0] && c[0][1] < c[3][1],
      `mapping dai 4 punti sul modello: angoli dentro l'immagine ${JSON.stringify(c)}`);
    check(/4 punti sul modello/.test(mp.msg) && /Corner pin/.test(mp.msg), 'messaggio del proiettore: ' + mp.msg.slice(0, 160));
    await p.ev(`(()=>{const R=window.__r3d,it=R.PAL.items,sc=it.find(i=>i.kind==='screen').g,pj=it.find(i=>i.kind==='projector').spot,c=R.camera();
      const w=sc.getWorldPosition(sc.position.clone()),q=pj.getWorldPosition(pj.position.clone());c.position.copy(q).lerp(w,0.25).add({x:0,y:1.2,z:0});R.controls.target.copy(w);R.controls.update();return 1})()`);
    await sleep(1500); await p.shot(path.join(OUT, 'mapping.png'));
    await p.ev(`(()=>{const P=window.__r3d.PAL;P.prj={};document.getElementById('palDX').dispatchEvent(new Event('input'));return 1})()`);

    // Palco non in scala (0.6): l'automatico trova la scala, le misure degli oggetti restano vere
    await p.send('Page.navigate', { url: `${base}/render3d/?frames=${encodeURIComponent(f2)}` });
    n = 0; for (let i = 0; i < 80 && !n; i++) { await sleep(250); n = await p.ev(`window.__r3d?.PAL?.items?.length||0`).catch(() => 0); }
    await sleep(500);
    s = await st();
    check(Math.abs(s.T.scale - 1 / 0.6) < 0.02 && Math.abs(s.wall[0] - 3.5) < 0.05, `Palco fuori scala: scala ${s.T.scale.toFixed(3)}, LED wall ancora a ${s.wall.map(v => v.toFixed(2))}`);

    // manuale: 2 punti (le colonne sx centro e dx fondo) dati come se cliccati
    await p.ev(`(()=>{const sel=document.getElementById('palMode');sel.value='manual';sel.dispatchEvent(new Event('change'));
      const P=window.__r3d.PAL;P.pts=[{id:'col-Lb',X:${POS.Lb[0]},Z:${POS.Lb[1]}},{id:'col-Rf',X:${POS.Rf[0]},Z:${POS.Rf[1]}}];
      document.getElementById('palDX').dispatchEvent(new Event('input'));return 1})()`);
    await sleep(300);
    s = await st();
    check(s.T.n === 2 && Math.abs(s.T.scale - 1 / 0.6) < 0.02 && Math.abs(s.wall[0] - 3.5) < 0.05 && Math.abs(s.wall[2]) < 0.05, `manuale con 2 punti: scala ${s.T.scale.toFixed(3)}, LED wall a ${s.wall.map(v => v.toFixed(2))}`);
    check(await p.ev(`getComputedStyle(document.getElementById('palManual')).display!=='none'`), 'manuale: compaiono le righe dei 2 punti');
    // ritocco: sposta avanti di 1 m
    await p.ev(`(()=>{const e=document.getElementById('palDX');e.value=1;e.dispatchEvent(new Event('input'));return 1})()`);
    await sleep(200); s = await st();
    check(Math.abs(s.wall[0] - 4.5) < 0.05, `ritocco "sposta avanti" +1 m: ${s.wall[0].toFixed(2)}`);
    // lo stato resta dopo il ricaricamento (punti manuali compresi)
    await sleep(1800);
    await p.send('Page.reload'); n = 0; for (let i = 0; i < 80 && !n; i++) { await sleep(250); n = await p.ev(`window.__r3d?.PAL?.items?.length||0`).catch(() => 0); }
    await sleep(500); s = await st();
    check(s.T.n === 2 && Math.abs(s.wall[0] - 4.5) < 0.05, `dopo il ricaricamento: manuale con 2 punti e ritocco tenuti (${s.T.n} punti, LED wall x ${s.wall[0].toFixed(2)})`);
    check(!p.problems.length, 'nessuna eccezione nella pagina' + (p.problems.length ? ': ' + p.problems.slice(0, 3).join(' | ') : ''));
    console.log('screenshot in ' + OUT);
  } finally { p.close(); }
  if (fail.length) { console.log(`\n${fail.length} controlli falliti`); process.exitCode = 1; } else console.log('\ntutto ok');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
