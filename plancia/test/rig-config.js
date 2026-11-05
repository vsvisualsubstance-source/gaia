'use strict';
// Pagina "Config rig" (src/96-rig-config.js, nota TD 68) con struttura e valori
// presi da DMX Master il 2026-11-05 (test/fixtures/rig-config.json). La pagina gira
// in simulazione: i comandi si raccolgono da un client MQTT finto.
const path = require('path');
const fs = require('fs');
const { startPlancia, sleep } = require('./browser-harness');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rig-config.json'), 'utf8'));

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const shot = process.argv[2];
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const r = JSON.parse(await p.ev(`(async()=>{const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms)),pub=[];
      new MutationObserver(()=>{const b=document.querySelector('.ui-confirm [data-v="1"]');if(b)b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}).observe(document.body,{childList:true,subtree:true});
      const d=T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{})};d.params={...(d.params||{}),dmx_rig_config:${JSON.stringify(data.values)}};
      T.G.dxm['td-dmx-win']={...(T.G.dxm['td-dmx-win']||{}),rig_config:${JSON.stringify(data.rig_config)}};
      const was={ok:T.G.ok,client:T.G.client};T.G.ok=true;T.G.client={publish:(t,b)=>{const m=JSON.parse(b);if(m.param==='dmx_rig_config'){pub.push(m.value);d.params.dmx_rig_config_result={request_id:m.value.request_id,ok:true,applied:{}}}}};
      const page=T.L.pages.find(x=>x.widgets.some(w=>w.type==='rigconfig'));
      [...document.querySelectorAll('#groups > *')].find(b=>b.textContent==='Luci').click();await z(200);
      [...document.querySelectorAll('#tabs > *')].find(b=>b.textContent===page.name).click();await z(1200);
      const box=()=>document.querySelector('.rc'),out={page:page.name};
      out.groups=[...box().querySelectorAll('.rc-g b')].map(b=>b.textContent);out.sel=box().querySelector('.rc-g.on b')?.textContent;
      out.sections=[...box().querySelectorAll('.rc-sec h4')].map(h=>h.textContent.replace(/[▾▸↺]/g,'').trim());
      out.palette=box().querySelector('[data-rc="palette"]')?.value;
      // Back: gamma dimmer in grigio con il motivo
      box().querySelector('[data-rc-g="rig_b"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(300);
      const gam=box().querySelector('[data-rc="dimmer_gamma"]').closest('.rc-f');out.gammaNa=gam.classList.contains('na')&&/dimmer/.test(gam.title);
      // fader: arriva un solo comando con l'ultimo valore
      const sl=box().querySelector('[data-rc="max_dimmer"]');for(const v of [200,210,220]){sl.value=v;sl.dispatchEvent(new Event('input',{bubbles:true}))}
      await z(400);out.slider=JSON.parse(JSON.stringify(pub));pub.length=0;out.status=box().querySelector('.rc-st').textContent;
      // palette (menu) e kick (interruttore)
      const sel=box().querySelector('[data-rc="palette"]');sel.value='Forest';sel.dispatchEvent(new Event('change',{bubbles:true}));
      box().querySelector('[data-rc-bool="kick_enable"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(400);
      out.two=JSON.parse(JSON.stringify(pub));pub.length=0;
      // copia su LED bar
      box().querySelector('[data-rc-act="copy"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(300);
      const lb=[...document.querySelectorAll('.ui-choose button')].find(b=>b.textContent.startsWith('LED bar'));lb?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(100);
      document.querySelector('.ui-confirm [data-ok]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(400);
      out.copy=pub.map(v=>Object.keys(v.groups).join()+':'+Object.keys(Object.values(v.groups)[0]).length);pub.length=0;
      // un valore nuovo da DMX Master aggiorna il fader senza ridisegnare
      const node=box().querySelector('[data-rc="min_dimmer"]');d.params.dmx_rig_config.rig_b.min_dimmer=99;await z(700);
      out.live=box().querySelector('[data-rc="min_dimmer"]')===node&&+node.value===99;
      T.G.ok=was.ok;T.G.client=was.client;return JSON.stringify(out)})()`));
    check(r.page === 'Config rig' && r.groups.join() === 'Front,Back,LED bar,Haze,Blinder,side,truss', `pagina e gruppi: ${r.groups.join(', ')}`);
    check(r.sel === 'Back' && r.sections.join() === 'Livello e dimmer,Colore,Audio,Kick', `scelto il primo gruppo con luci (${r.sel}); sezioni ${r.sections.join(', ')}`);
    check(r.gammaNa, 'Back: "Gamma dimmer" in grigio con il motivo di DMX Master');
    check(r.slider.length === 1 && r.slider[0].groups.rig_b.max_dimmer === 220 && r.slider[0].request_id, `fader: un comando con l'ultimo valore (${JSON.stringify(r.slider[0]?.groups)})`);
    check(r.status === '✓ applicato', `esito letto da dmx_rig_config_result: ${r.status}`);
    check(r.two.length === 1 && r.two[0].groups.rig_b.palette === 'Forest' && r.two[0].groups.rig_b.kick_enable === !data.values.rig_b.kick_enable, `palette e kick insieme: ${JSON.stringify(r.two[0]?.groups)}`);
    check(r.copy.length === 1 && /^ledbar:\d+$/.test(r.copy[0]) && +r.copy[0].split(':')[1] > 20, `copia su LED bar: ${r.copy.join()}`);
    check(r.live, 'valore nuovo da DMX Master: il fader si aggiorna da solo');
    if (shot) { await p.shot(shot); console.log('screenshot: ' + shot); }
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`rig-config: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
