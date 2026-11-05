'use strict';
// Pagina "Config rig" (src/96-rig-config.js, note TD 68-70) con struttura e valori
// presi da DMX Master il 2026-11-05 (test/fixtures/rig-config.json). La pagina gira
// in simulazione: i comandi si raccolgono da un client MQTT finto.
const path = require('path');
const fs = require('fs');
const { startPlancia } = require('./browser-harness');
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
      const d=T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{})};
      d.params={...(d.params||{}),dmx_rig_config:${JSON.stringify(data.values)},dmx_rig_presets:[{name:'LED caldi',kind:'chase',label:'LED caldi',source:'ledbar',values:{}}]};
      T.G.dxm['td-dmx-win']={...(T.G.dxm['td-dmx-win']||{}),rig_config:${JSON.stringify(data.rig_config)}};
      const was={ok:T.G.ok,client:T.G.client};T.G.ok=true;
      T.G.client={publish:(t,b)=>{const m=JSON.parse(b);if(/^dmx_rig/.test(m.param||'')){pub.push([m.param,m.value]);d.params.dmx_rig_config_result={request_id:m.value.request_id,ok:true,applied:{}}}}};
      const page=T.L.pages.find(x=>x.widgets.some(w=>w.type==='rigconfig'));delete T.L.rigSeen;
      [...document.querySelectorAll('#groups > *')].find(b=>b.textContent==='Luci').click();await z(200);
      [...document.querySelectorAll('#tabs > *')].find(b=>b.textContent===page.name).click();await z(1200);
      const box=()=>document.querySelector('.rc'),down=s=>box().querySelector(s).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const choose=async t=>{await z(250);const b=[...document.querySelectorAll('.ui-choose button')].find(x=>x.textContent.startsWith(t));b?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(250);return!!b};
      const take=()=>{const x=JSON.parse(JSON.stringify(pub));pub.length=0;return x};
      const out={page:page.name};
      out.groups=[...box().querySelectorAll('.rc-g b')].map(b=>b.firstChild.textContent.trim());out.dots=[...box().querySelectorAll('.rc-g')].filter(g=>g.querySelector('.rc-dot')).map(g=>g.dataset.rcG);
      out.sel=box().querySelector('.rc-g.on').dataset.rcG;
      const blk=t=>[...box().querySelectorAll('.rc-blk')].find(b=>b.querySelector('.rc-bh b').textContent===t);
      out.calFields=[...blk('TARATURA').querySelectorAll('[data-rc],[data-rc-bool]')].map(c=>c.dataset.rc||c.dataset.rcBool);
      out.lookFields=[...blk('LOOK').querySelectorAll('[data-rc],[data-rc-bool]')].map(c=>c.dataset.rc||c.dataset.rcBool);
      out.srcLabels=[...box().querySelectorAll('[data-rc="audio_source"] option')].map(o=>o.value+'='+o.textContent);
      out.gammaNa=box().querySelector('[data-rc="dimmer_gamma"]').closest('.rc-f').classList.contains('na');
      // fader: un solo comando con l'ultimo valore
      const sl=box().querySelector('[data-rc="max_dimmer"]');for(const v of [200,210,220]){sl.value=v;sl.dispatchEvent(new Event('input',{bubbles:true}))}
      await z(400);out.slider=take();out.status=box().querySelector('.rc-st').textContent;
      // LED bar: avviso di partenza "senza dimmer", poi applica
      down('[data-rc-g="ledbar"]');await z(300);out.banner=!!box().querySelector('.rc-banner');out.bannerText=box().querySelector('.rc-banner')?.textContent||'';
      down('.rc-banner [data-rc-act="starter"]');await z(500);out.starter=take();out.bannerAfter=!!box().querySelector('.rc-banner');out.seen=!!T.L.rigSeen?.ledbar;
      // salva, richiama, copia solo taratura
      down('[data-rc-act="store"]');await z(300);const inp=document.querySelector('.ui-confirm input');if(inp){inp.value='Barra prova';document.querySelector('.ui-confirm [data-v="1"],.ui-confirm [data-ok]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}await z(400);out.store=take();
      down('[data-rc-act="recall"]');await choose('LED caldi');await z(200);out.recall=take();
      down('[data-rc-act="copy"]');await choose('Solo la taratura');await choose('truss');document.querySelector('.ui-confirm [data-ok]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(400);out.copyCal=take();
      down('[data-rc-act="copy"]');await choose('Tutto');await choose('truss');document.querySelector('.ui-confirm [data-ok]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(400);
      out.copyAll=take().map(([p,v])=>p+':'+Object.keys(v.groups||{}).join()+':'+Object.keys(Object.values(v.groups||{})[0]||{}).length);
      // un valore nuovo da DMX Master aggiorna il fader senza ridisegnare
      const node=box().querySelector('[data-rc="min_dimmer"]');d.params.dmx_rig_config.ledbar.min_dimmer=99;T.G.dirty=true;await z(700);
      out.live=box().querySelector('[data-rc="min_dimmer"]')===node&&+node.value===99;
      T.G.ok=was.ok;T.G.client=was.client;return JSON.stringify(out)})()`));
    const cal = data.rig_config.calibration.chase;
    check(r.page === 'Config rig' && r.groups.join() === 'Front,Back,LED bar,Haze,Blinder,side,truss', `pagina e gruppi: ${r.groups.join(', ')}`);
    check(r.dots.join() === 'rig_b,ledbar' && r.sel === 'rig_b', `● sui gruppi con luci da tarare (${r.dots.join(', ')}), scelto ${r.sel}`);
    check(JSON.stringify([...r.calFields].sort()) === JSON.stringify([...cal].sort()) && !r.lookFields.some(f => cal.includes(f)) && r.lookFields.includes('palette'), `TARATURA: ${r.calFields.length} campi di calibrazione, LOOK: ${r.lookFields.length} campi`);
    check(r.srcLabels.join() === 'a=Sorgente A,b=Sorgente B', `sorgente audio con le etichette di TD: ${r.srcLabels.join(', ')}`);
    check(r.gammaNa, 'Back: "Gamma dimmer" in grigio con il motivo di DMX Master');
    check(r.slider.length === 1 && r.slider[0][1].groups.rig_b.max_dimmer === 220, 'fader: un comando con l\'ultimo valore');
    check(r.status === '✓ applicato', `esito letto da dmx_rig_config_result: ${r.status}`);
    check(r.banner && /senza canale dimmer/.test(r.bannerText), 'LED bar: proposta la partenza "senza dimmer"');
    check(r.starter.length === 1 && r.starter[0][0] === 'dmx_rig_preset_recall' && r.starter[0][1].starter === true && r.starter[0][1].group === 'ledbar' && !r.bannerAfter && r.seen, 'partenza applicata, avviso tolto');
    check(r.store.length === 1 && r.store[0][0] === 'dmx_rig_preset_store' && r.store[0][1].name === 'Barra prova' && r.store[0][1].group === 'ledbar', `salva preset: ${JSON.stringify(r.store[0])}`);
    check(r.recall.length === 1 && r.recall[0][0] === 'dmx_rig_preset_recall' && r.recall[0][1].name === 'LED caldi', `richiama: ${JSON.stringify(r.recall[0])}`);
    check(r.copyCal.length === 1 && r.copyCal[0][0] === 'dmx_rig_preset_copy' && r.copyCal[0][1].from === 'ledbar' && JSON.stringify(r.copyCal[0][1].to) === '["truss"]', `copia solo taratura: ${JSON.stringify(r.copyCal[0])}`);
    check(r.copyAll.length === 1 && /^dmx_rig_config:truss:\d+$/.test(r.copyAll[0]) && +r.copyAll[0].split(':')[2] > 20, `copia tutto: ${r.copyAll.join()}`);
    check(r.live, 'valore nuovo da DMX Master: il fader si aggiorna da solo');
    if (shot) { await p.shot(shot); console.log('screenshot: ' + shot); }
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`rig-config: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
