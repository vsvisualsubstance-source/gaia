'use strict';
// Mapping del progetto nel Render 3D (20/11): il Render 3D (iframe nella Plancia) usa il mapping
// della pagina Mapping (corner pin o mesh) per l'immagine del proiettore; i 4 punti cliccati sul
// modello finiscono nel mapping del progetto (BroadcastChannel -> Plancia -> save).
//   node test/render3d-mapping.js   (senza scansione in data/render3d si salta)
const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');
const SCAN = path.join(__dirname, '..', 'data', 'render3d');
const OUT = path.join(__dirname, '..', 'test-output', 'render3d-mapping');
const POS = { Lb: [1.83, -5.79], Rb: [2.31, 5.47], Lf: [-8.82, -5.03], Rf: [-8.52, 5.69] };

async function main() {
  if (!fs.existsSync(path.join(SCAN, 'scan.js'))) { console.log('salto: manca la scansione (data/render3d)'); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    fs.cpSync(SCAN, path.join(p.tmp, 'render3d'), { recursive: true });
    const base = await p.ev('location.origin');
    const fixtures = Object.entries(POS).map(([id, [X, Z]]) => ({ id: 'col-' + id, type: 'bar', name: 'COL ' + id, vertical: true, z: 0, x: Z, y: 4 - X }));
    fixtures.push({ id: 'scr', type: 'screen', name: 'SCHERMO 1', x: -4, y: 3, z: 1, w: 4, h: 2.25, rot: 30 });
    fixtures.push({ id: 'prj1', type: 'projector', name: 'PROIETTORE 1', x: 0, y: 11, z: 3, rot: 0, target: 'scr', throw: 1.5, src: 'procedural' });
    const doc = { app: 'plancia-light-frames', v: 1, fps: 30, created: new Date().toISOString(), project: 'prova mapping', duration: 1, stage: { width: 12, depth: 8, trussHeight: 5 },
      fixtures, frames: Array.from({ length: 31 }, (_, i) => ({ t: Math.round(i * 1000 / 30), f: {} })) };
    const up = await fetch(`${base}/api/light-frames?name=prova_mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }).then(r => r.json());
    check(up.ok, 'registrazione col proiettore');
    // nella Plancia: proiettore nel Palco e mapping a mesh 3x3 col centro spostato
    await p.ev(`(()=>{const T=window.__planciaTest,L=T.L;L.fixtures=(L.fixtures||[]).filter(f=>f.type!=='projector');
      L.fixtures.push({id:'prj1',type:'projector',name:'PROIETTORE 1',x:0,y:11,z:3,target:'',throw:1.5,sourceType:'procedural',enabled:true});
      const m=PlanciaMapping.defMap();m.mode='mesh';PlanciaMapping.setMeshN(m,3);m.off[4]=[0.08,-0.05];L.mapping={v:1,out:{prj1:{map:m}}};T.save();
      [...document.querySelectorAll('#groups .tab')].find(b=>b.textContent==='Render 3D')?.click();return 1})()`);
    const W = `document.querySelector('.r3d-frame')?.contentWindow`;
    let st = null;
    for (let i = 0; i < 100; i++) {
      await sleep(250);
      st = await p.ev(`(()=>{const R=${W}?.__r3d;const it=R?.PAL?.items?.find(i=>i.kind==='projector');return it?{src:it.mapSrc,mode:it.map?.mode,n:it.map?.n}:null})()`).catch(() => null);
      if (st?.src === 'progetto') break;
    }
    check(st?.src === 'progetto' && st.mode === 'mesh' && st.n === 3, `Render 3D usa il mapping del progetto: ${JSON.stringify(st)}`);
    // i 4 punti sul modello (gli angoli dello schermo) -> nel mapping del progetto
    const sent = await p.ev(`(()=>{const R=${W}.__r3d,P=R.PAL,sc=P.items.find(i=>i.kind==='screen'),pj=P.items.find(i=>i.kind==='projector'),g=sc.g,w=sc.f.w,h=sc.f.h;
      const pts=[[-w/2,h/2],[w/2,h/2],[w/2,-h/2],[-w/2,-h/2]].map(([x,y])=>{const v=g.localToWorld(new g.position.constructor(x,y,0));R.compInner.worldToLocal(v);return [v.x,v.y,v.z]});
      P.prj.prj1={pts};${W}.document.getElementById('palDX').dispatchEvent(new Event('input'));
      const it=P.items.find(i=>i.kind==='projector');R.pmSend('prj1',it.corners);return it.corners})()`);
    let saved = null;
    for (let i = 0; i < 20; i++) { await sleep(250); saved = await p.ev(`window.__planciaTest.L.mapping.out.prj1`); if (saved?.from === 'render3d') break; }
    check(saved?.from === 'render3d' && saved.map.mode === 'corners' && Math.abs(saved.map.corners[2][0] - sent[2][0]) < 1e-6, `i 4 punti del Render 3D finiscono nel mapping del progetto: ${JSON.stringify(saved?.map?.corners)}`);
    let after = null;
    for (let i = 0; i < 20; i++) { await sleep(250); after = await p.ev(`(()=>{const R=${W}.__r3d,it=R.PAL.items.find(i=>i.kind==='projector');return {src:it.mapSrc,pts:!!R.PAL.prj.prj1?.pts,c:it.corners}})()`); if (after.src === 'progetto' && !after.pts) break; }
    check(after.src === "progetto" && !after.pts && Math.abs(after.c[2][0] - sent[2][0]) < 1e-6, `Render 3D di nuovo sul mapping del progetto (punti locali tolti): ${JSON.stringify(after)} vs ${JSON.stringify(sent)}`);
    // modifica nella pagina Mapping -> il Render 3D la segue
    await p.ev(`(()=>{const T=window.__planciaTest;T.L.mapping.out.prj1.map.corners[0]=[0.2,0.1];T.save();return 1})()`);
    let c0 = null;
    for (let i = 0; i < 20; i++) { await sleep(250); c0 = await p.ev(`${W}.__r3d.PAL.items.find(i=>i.kind==='projector').corners[0]`); if (c0[0] === 0.2) break; }
    check(c0[0] === 0.2 && c0[1] === 0.1, `angolo cambiato nella Plancia arriva al Render 3D: ${JSON.stringify(c0)}`);
    await p.shot(path.join(OUT, 'render3d.png'));
    check(!p.problems.length, 'nessuna eccezione' + (p.problems.length ? ': ' + p.problems.slice(0, 3).join(' | ') : ''));
  } finally { p.close(); }
  if (fail.length) { console.log(`\n${fail.length} controlli falliti`); process.exitCode = 1; } else console.log('\ntutto ok');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
