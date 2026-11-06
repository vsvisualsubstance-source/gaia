'use strict';
// Planimetria del locale come sfondo della Pianta (src/97-stage-space.js):
// caricamento al bridge (/api/plan-image -> /plans/<hash>.jpg), calibrazione
// della scala con due tocchi veri sulla Pianta e la misura scritta, spostamento.
//   node test/stage-plan.js [--img pianta.jpg] [--shot file.png]
// Senza --img usa una pianta finta disegnata qui: una quota di 1000 px = 1336 cm.

const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const img = arg('--img');
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  // tocco vero (CDP) nel punto del client
  const tap = async (x, y, to) => {
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    if (to) for (let i = 1; i <= 8; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (to.x - x) * i / 8, y: y + (to.y - y) * i / 8, button: 'left', buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to ? to.x : x, y: to ? to.y : y, button: 'left', clickCount: 1 });
    await sleep(150);
  };
  try {
    // pagina con la sola Pianta
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(t.P('Pianta prova',[t.W('stage',0,0,16,10,{label:'Palco',view:'plot'})]));t.render();const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(500);
    const b64 = img ? fs.readFileSync(img).toString('base64') : '';
    // carica: con --img la pianta vera, altrimenti una finta 1200x800 con la quota da x=100 a x=1100 a y=400
    const up = await p.ev(`(async()=>{const t=window.__planciaTest;let blob;
      if(${JSON.stringify(b64)}){blob=await (await fetch('data:image/jpeg;base64,${b64}')).blob()}
      else{const c=document.createElement('canvas');c.width=1200;c.height=800;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1200,800);
        g.strokeStyle='#000';g.lineWidth=6;g.strokeRect(50,50,1100,700);g.beginPath();g.moveTo(100,400);g.lineTo(1100,400);g.stroke();
        blob=await new Promise(ok=>c.toBlob(ok,'image/png'))}
      const f=new File([blob],'pianta.png',{type:blob.type});const pl=await t.uploadPlanImage(f);
      const r=await fetch(pl.src);return{plan:pl,status:r.status,type:r.headers.get('content-type')}})()`);
    check(/^\/plans\/[0-9a-f]{16}\.jpg$/.test(up.plan.src) && up.status === 200 && up.type === 'image/jpeg', `caricata nel bridge: ${up.plan.src} (${up.plan.pw}x${up.plan.ph} px)`);
    await sleep(600);
    // due capi della quota: px dell'immagine -> punti dello schermo
    const qa = img ? { x: +arg('--ax', 350), y: +arg('--ay', 660) } : { x: 100, y: 400 }, qb = img ? { x: +arg('--bx', 885), y: +arg('--by', 660) } : { x: 1100, y: 400 };
    const real = img ? +arg('--real', 13.36) : 13.36;
    // calibra: entro nel modo dallo Spazio
    await p.ev(`(()=>{window.__planciaTest.openSpaceEditor();document.querySelector('#spPlCal').click();return 1})()`);
    await sleep(300);
    check(!!(await p.ev(`(()=>window.__planciaTest.planEdit?.mode)()`)), 'modo calibra attivo');
    const scr = async (px, py) => p.ev(`(()=>{const t=window.__planciaTest,pl=t.L.stage.plan,P=t.stageProj();
      const mx=pl.cx-pl.pw*pl.mpp/2+${px}*pl.mpp,my=pl.cy-pl.ph*pl.mpp/2+${py}*pl.mpp;
      const lx=P.proj.cx+mx*P.proj.s,ly=P.proj.oy+my*P.proj.s;return{x:P.r.left+lx*P.r.width/P.W,y:P.r.top+ly*P.r.height/P.H}})()`);
    const A = await scr(qa.x, qa.y), B = await scr(qb.x, qb.y);
    await tap(A.x, A.y);
    await tap(B.x, B.y);
    await sleep(200);
    await p.ev(`(()=>{const b=document.querySelector('.ui-confirm');b.querySelector('input').value='${Math.round(real * 100)}';b.querySelector('[data-ok]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(300);
    const pl = await p.ev(`(()=>window.__planciaTest.L.stage.plan)()`);
    const got = Math.abs(qb.x - qa.x) * pl.mpp;
    check(Math.abs(got - real) < real * 0.02, `scala: la quota misura ${got.toFixed(2)} m (attesa ${real} m, tocchi a mano: 2%)`);
    // sposta: trascino di 100 px a destra
    await p.ev(`(()=>{window.__planciaTest.openSpaceEditor();document.querySelector('#spPlMove').click();return 1})()`);
    await sleep(300);
    const before = await p.ev(`(()=>window.__planciaTest.L.stage.plan.cx)()`);
    const C = await scr(pl.pw / 2, pl.ph / 2);
    await tap(C.x, C.y, { x: C.x + 100, y: C.y });
    const after = await p.ev(`(()=>window.__planciaTest.L.stage.plan.cx)()`);
    const pxm = await p.ev(`(()=>{const P=window.__planciaTest.stageProj();return P.proj.s*P.r.width/P.W})()`);
    check(Math.abs((after - before) * pxm - 100) < 3, `trascinata di ${((after - before) * pxm).toFixed(1)} px (100)`);
    await tap(C.x, C.y + 40);
    check(!(await p.ev(`(()=>window.__planciaTest.planEdit)()`)), 'un tocco senza trascinare chiude lo spostamento');
    const shot = arg('--shot');
    if (shot) { await sleep(300); await p.shot(path.resolve(shot)); console.log('screenshot: ' + path.resolve(shot)); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('planimetria: prova fallita:', e.message); process.exitCode = 2; });
