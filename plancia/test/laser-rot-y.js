'use strict';
// Rotazione Y del laser nella Plancia: anteprima uguale al gateway (laser_scene.spin_y),
// fader nel modello della pagina Laser e migrazione dei progetti salvati (uiRev 21).
//   node test/laser-rot-y.js   (incluso in npm run check)

const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    // migrazione: la Rotazione cede una colonna alla Rotazione Y; una seconda volta non fa niente
    const mig = await p.ev(`(()=>{const T=window.__planciaTest,run=()=>T.migrations.find(m=>m[0]==='migrateUiLaserRotY')[1]();
      T.L.pages=[T.P('Laser',[T.W('fader',0,7,2,3,{label:'Rotazione',addr:'/laser/fx/rotate',min:-180,max:180,value:.5}),T.W('fader',2,7,2,3,{label:'Zoom',addr:'/laser/fx/zoom'})])];
      T.L.uiRev=20;run();const a=T.L.pages[0].widgets.map(w=>[w.addr,w.x,w.w]);T.L.uiRev=20;run();
      return JSON.stringify({a,n:T.L.pages[0].widgets.length,rev:T.L.uiRev})})()`);
    const m = JSON.parse(mig);
    check(JSON.stringify(m.a) === JSON.stringify([['/laser/fx/rotate', 0, 1], ['/laser/fx/zoom', 2, 2], ['/laser/fx/rotate_y', 1, 1]]), `progetto salvato: Rotazione 1 colonna, Rotazione Y accanto (${JSON.stringify(m.a)})`);
    check(m.n === 3 && m.rev === 21, 'migrazione ripetuta: niente doppioni, uiRev 21');
    const tpl = await p.ev(`JSON.stringify(window.__planciaTest.TPL.laser.pages()[0].widgets.filter(w=>/rotate/.test(w.addr||'')).map(w=>[w.addr,w.x,w.w]))`);
    check(tpl === JSON.stringify([['/laser/fx/rotate', 0, 1], ['/laser/fx/rotate_y', 1, 1]]), `pagina Laser nuova: i due fader di rotazione ${tpl}`);
    // anteprima: 90 gradi = di taglio, 180 = specchiata (come il gateway)
    const pv = await p.ev(`(()=>{const sc={strokes:[{pts:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],closed:true}],color:{mode:'fixed',rgb:[0,0,1]},anim:{scale:1,rotate_y:90}};
      const lit=t=>window.__planciaTest.lzsAnimate(sc,t).filter(p=>p[4]);return JSON.stringify({edge:Math.max(...lit(1).map(p=>Math.abs(p[0]))),mirror:lit(2)[0].slice(0,2)})})()`);
    const v = JSON.parse(pv);
    check(v.edge < 1e-9 && Math.abs(v.mirror[0] - .5) < 1e-6 && Math.abs(v.mirror[1] + .5) < 1e-6, `anteprima: di taglio a 90, specchiata a 180 (${pv})`);
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('rotazione Y: prova fallita:', e.message); process.exitCode = 2; });
