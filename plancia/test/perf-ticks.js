'use strict';
// Misura del ciclo di disegno: per ogni pagina, quanto tempo per fotogramma
// passa nei tick dei widget e quante volte ridisegnano (repaint).
//   node test/perf-ticks.js           solo simulazione
//   node test/perf-ticks.js --mqtt    con traffico come dal vivo (dmx_rigs 30/s, livelli audio 10/s)
const { startPlancia, sleep } = require('./browser-harness');
(async () => {
  const p = await startPlancia({ hooks: true });
  try {
    await p.ev(`(()=>{const T=window.__planciaTest;window.__perf={ms:0,calls:0,repaints:0,frames:0};
      for(const[type,spec]of T.WIDGET_TYPES){if(!spec.tick)continue;const f=spec.tick;
        spec.tick=(el,w,ctx)=>{const t0=performance.now();f(el,w,ctx);const P=window.__perf,d=performance.now()-t0;P.ms+=d;P.by=P.by||{};P.by[type]=(P.by[type]||0)+d;P.calls++;if(ctx.repaint)P.repaints++}}
      const raf=()=>{window.__perf.frames++;requestAnimationFrame(raf)};raf();return 1})()`);
    if (process.argv.includes('--mqtt')) await p.ev(`(()=>{const T=window.__planciaTest;let k=0;
      setInterval(()=>{k++;T.gIn('gaia/devices/td-dmx-win/dmx_rigs',{rigs:{rig_a:{level:Math.random(),kicks:k>>3}}})},33);
      setInterval(()=>T.gIn('gaia/device/ctl/audio_levels',{rms:Math.random()}),100);return 1})()`);
    const names = await p.ev(`[...document.querySelectorAll('#tabs > *')].map(t=>t.textContent.trim())`);
    for (let i = 0; i < names.length; i++) {
      await p.ev(`document.querySelectorAll('#tabs > *')[${i}].click();1`);
      await sleep(500);
      await p.ev(`Object.assign(window.__perf,{ms:0,calls:0,repaints:0,frames:0,by:{}});1`);
      await sleep(3000);
      const r = await p.ev(`window.__perf`);
      console.log(`${names[i].padEnd(14)} ${String(r.frames).padStart(4)} fotogrammi  tick ${(r.ms / r.frames).toFixed(2).padStart(6)} ms/fotogramma  ridisegni ${(r.repaints / Math.max(1, r.calls) * 100).toFixed(0).padStart(3)}% dei tick  ${Object.entries(r.by||{}).filter(([,v])=>v/r.frames>=0.01).map(([k,v])=>k+' '+(v/r.frames).toFixed(2)).join(' · ')}`);
    }
  } finally { p.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
