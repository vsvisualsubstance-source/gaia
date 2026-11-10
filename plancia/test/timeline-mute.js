'use strict';
// Pulsante M delle tracce EFFETTI e SEQUENZE: nella Timeline e nella pagina Show (sola lettura).
// DMX Master finto: nessun messaggio esce verso TD.
//   node test/timeline-mute.js   (incluso in npm run check)

const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const press = k => p.ev(`document.querySelector('[data-act="mute-${k}"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))`);
  const state = k => p.ev(`(()=>{const b=document.querySelector('[data-act="mute-${k}"]');return JSON.stringify({on:b.classList.contains('on'),muted:b.closest('.tl-trk').classList.contains('muted'),st:b.closest('.tl-trk').querySelector('.tl-vst')?.textContent||''})})()`);
  const svc = (fx, ch) => p.ev(`(()=>{const T=window.__planciaTest;T.G.sim=true;const d=T.G.devices['td-dmx-win']=T.G.devices['td-dmx-win']||{};d.ts=Date.now();d.params=d.params||{};d.services={show_active:'active',${fx ? `show_mute_effects:'${fx}',` : ''}${ch ? `show_mute_chases:'${ch}'` : ''}};return 1})()`);
  const open = name => p.ev(`(()=>{const T=window.__planciaTest,i=[...document.querySelectorAll('#tabs > *')].find(x=>x.textContent.trim()===${JSON.stringify(name)});if(i){i.click();return 1}const g=[...document.querySelectorAll('#groups > *')].find(x=>x.textContent==='Show');g.click();[...document.querySelectorAll('#tabs > *')].find(x=>x.textContent.trim()===${JSON.stringify(name)}).click();return 1})()`);
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const T=window.__planciaTest;T.L=T.demoProjectLayout();T.render();return 1})()`);
    await sleep(800);
    await svc('inactive', 'inactive');
    await open('Timeline');
    await sleep(1800);
    let s = JSON.parse(await state('fx'));
    check(!s.on && !s.muted, 'a riposo il pulsante è spento');
    await press('fx');
    await sleep(500);
    s = JSON.parse(await state('fx'));
    check(s.on && s.muted && s.st === 'MUTE', `M acceso: traccia attenuata e MUTE (${JSON.stringify(s)})`);
    check(!JSON.parse(await state('chase')).on, 'l\'altra traccia non cambia');
    await sleep(3200);
    await svc('active', 'inactive');
    await sleep(600);
    check(JSON.parse(await state('fx')).on, 'segue lo stato di DMX Master');
    await svc('inactive', 'inactive');
    await sleep(600);
    check(!JSON.parse(await state('fx')).on, 'si spegne quando DMX Master lo spegne');
    await open('Show');
    await sleep(1800);
    check(await p.ev(`!!document.querySelector('[data-act="mute-chase"]')`), 'il pulsante c\'è anche nella pagina Show');
    await svc(null, null);
    await sleep(300);
    await press('chase');
    await sleep(300);
    check(/aggiornato/.test(await p.ev(`document.querySelector('#toast').textContent`)), 'DMX Master vecchio: avviso invece di un mute finto');
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('mute: prova fallita:', e.message); process.exitCode = 2; });
