'use strict';
// Render leggero con un laser vero in uscita: 15 fotogrammi al secondo, scritta LEGGERO,
// laser disegnato senza ombre (shadowBlur) e a tratti raggruppati per colore.
//   node test/render-laser-light.js [--shot file.png]   (incluso in npm run check)

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const T=window.__planciaTest;
      T.L.fixtures=[{id:'l1',type:'laser',name:'LASER',x:0,y:-2,z:3,angle:0,spread:40,tilt:10,cube:'c1',enabled:true}];
      T.L.pages.push(T.P('Palco prova',[T.W('stage',0,0,16,10,{label:'Palco',view:'render'})]));T.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();
      // gateway finto: cubo in uscita e un'anteprima pesante (2000 punti, 6 colori)
      const cols=['ff0000','00ff00','0000ff','ffff00','ff00ff','00ffff'];
      window.__laserOn=on=>{T.G.devices['laser-ops']={family:'laser',_seen:Date.now(),laser:{cubes:[{id:'c1',online:true,armed:on,streaming:on}]}};
        T.G.laserPreview={at:Date.now(),cubes:{c1:Array.from({length:2000},(_,i)=>{const a=i/2000*Math.PI*16;return[Math.round(Math.cos(a)*80*(i%300)/300),Math.round(Math.sin(a)*80*(i%300)/300),i%50?cols[Math.floor(i/333)]:0]})}}};
      window.__laserOn(true);
      setInterval(()=>{if(T.G.laserPreview)T.G.laserPreview.at=Date.now()},300);
      return 1})()`);
    await sleep(800);
    const count = () => p.ev(`(()=>{const el=document.querySelector('.t-stage')?.closest('.w')||document.querySelector('.w .t-stage')?.parentElement;
      const w=[...document.querySelectorAll('.w')].find(x=>x.querySelector('.t-stage')||x.querySelector('.sv-cam'));return new Promise(r=>{let n=0,last=w._lastDraw;const t0=performance.now();
      const f=()=>{if(w._lastDraw!==last){n++;last=w._lastDraw}if(performance.now()-t0<2000)requestAnimationFrame(f);else r(n/2)};f()})})()`);
    const fpsLight = await count();
    check(fpsLight >= 10 && fpsLight <= 17, `laser in uscita: Render a ~15 fotogrammi al secondo (${fpsLight})`);
    check(await p.ev(`/LEGGERO · laser/.test(document.querySelector('.hud')?.textContent||'')`), 'scritta "LEGGERO · laser" nella riga del Render');
    // costo di un disegno del laser vero con 2000 punti
    const ms = await p.ev(`(()=>{const T=window.__planciaTest,c=document.createElement('canvas');c.width=1400;c.height=800;const g=c.getContext('2d');
      const f=T.L.fixtures[0],proj=(x,y,z)=>({x:700+x*60,y:600-y*20-z*60,scale:1,zs:60});
      const t0=performance.now();for(let i=0;i<20;i++)T.drawRealLaser(g,f,proj(0,-2,3),3,40*Math.PI/180,0,14,proj);return (performance.now()-t0)/20})()`);
    check(ms < 8, `disegno del laser vero con 2000 punti: ${ms.toFixed(2)} ms a fotogramma`);
    check(await p.ev(`(()=>{const T=window.__planciaTest,c=document.createElement('canvas').getContext('2d');let blur=0;const g=new Proxy(c,{set(o,k,v){if(k==='shadowBlur'&&v>0)blur++;o[k]=v;return true},get(o,k){const v=o[k];return typeof v==='function'?v.bind(o):v}});
      const f=T.L.fixtures[0],proj=(x,y,z)=>({x:700+x*60,y:600-y*20-z*60});T.drawRealLaser(g,f,proj(0,-2,3),3,.7,0,14,proj);return blur===0})()`), 'laser vero senza shadowBlur');
    const shot = arg('--shot');
    if (shot) await p.shot(path.resolve(shot));
    // laser fermo: Render di nuovo a ogni fotogramma
    await p.ev(`(()=>{window.__laserOn(false);return 1})()`);
    await sleep(300);
    const fpsFull = await count();
    check(fpsFull > 25, `laser fermo: Render a ritmo pieno (${fpsFull})`);
    check(!(await p.ev(`/LEGGERO/.test(document.querySelector('.hud')?.textContent||'')`)), 'laser fermo: niente scritta LEGGERO');
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('render leggero: prova fallita:', e.message); process.exitCode = 2; });
