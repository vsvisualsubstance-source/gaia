'use strict';
// Pagina "Test canali" (src/96-channel-test.js, nota TD 71): porta, luce in patch,
// nomi dei canali dal modello, comandi dmx_channel_test. In simulazione, con un
// client MQTT finto che raccoglie i comandi.
const { startPlancia } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const shot = process.argv[2];
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const r = JSON.parse(await p.ev(`(async()=>{const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms)),pub=[];
      const d=T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{})};
      d.params={...(d.params||{}),dmx_channel_test:null,
        dmx_fixtures:[{name:'PAR1',uid:'u1',profile:'D+RGB 4CH',port_id:'2.1.1.2:1',address:1},{name:'BAR1',uid:'u2',profile:'ZQ006018 8CH',port_id:'2.1.1.2:1',address:10}],
        dmx_models:[{model:'D+RGB 4CH',channels:['dimmer','red','green','blue'],footprint:4},{model:'ZQ006018 8CH',channels:['dimmer','strobe','mode','speed','red','green','blue','white'],footprint:8}]};
      T.G.dxm['td-dmx-win']={...(T.G.dxm['td-dmx-win']||{}),patch:{ports:[{port_id:'2.1.1.2:1',label:'Node 2 porta 1',online:'1',kind:'artnet'},{port_id:'2.1.1.2:2',label:'Node 2 porta 2',online:'1',kind:'artnet'}],channel_test:{ttl_default_s:120,ttl_max_s:600}}};
      const was={ok:T.G.ok,client:T.G.client};T.G.ok=true;T.G.client={publish:(t,b)=>{const m=JSON.parse(b);if(m.param==='dmx_channel_test')pub.push(m.value)}};
      const page=T.L.pages.find(x=>x.widgets.some(w=>w.type==='chtest'));
      [...document.querySelectorAll('#groups > *')].find(b=>b.textContent==='Sistema').click();await z(200);
      [...document.querySelectorAll('#tabs > *')].find(b=>b.textContent===page.name).click();await z(1200);
      const box=()=>document.querySelector('.ct'),out={page:page.name};
      out.ports=[...box().querySelectorAll('[data-ct="port"] option')].map(o=>o.value);
      const fx=box().querySelector('[data-ct="fix"]');fx.value='u2';fx.dispatchEvent(new Event('change',{bubbles:true}));await z(300);
      out.chans=[...box().querySelectorAll('.ct-ch')].map(c=>c.querySelector('b').textContent+':'+c.querySelector('small').textContent);
      const f=box().querySelector('[data-ct-ch="14"]');f.value=200;f.dispatchEvent(new Event('input',{bubbles:true}));await z(300);
      out.one=JSON.parse(JSON.stringify(pub));pub.length=0;
      box().querySelector('[data-ct-act="all"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(300);out.all=JSON.parse(JSON.stringify(pub));pub.length=0;
      d.params.dmx_channel_test={port_id:'2.1.1.2:1',values:{10:255},until_ms:Date.now()+90000};T.G.dirty=true;await z(500);out.status=box().querySelector('.ct-st').textContent;
      box().querySelector('[data-ct-act="off"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await z(200);out.off=JSON.parse(JSON.stringify(pub));
      T.G.ok=was.ok;T.G.client=was.client;return JSON.stringify(out)})()`));
    check(r.page === 'Test canali' && r.ports.join() === '2.1.1.2:1,2.1.1.2:2', `pagina e porte: ${r.ports.join(', ')}`);
    check(r.chans.join() === '10:dimmer,11:strobe,12:mode,13:speed,14:red,15:green,16:blue,17:white', `BAR1 scelta: canali 10-17 con i nomi del modello (${r.chans.join(' ')})`);
    check(r.one.length === 1 && r.one[0].port_id === '2.1.1.2:1' && r.one[0].ttl === 120 && JSON.stringify(r.one[0].values) === '{"14":200}', `un canale: ${JSON.stringify(r.one[0])}`);
    check(r.all.length === 1 && Object.keys(r.all[0].values).length === 8 && Object.values(r.all[0].values).every(v => v === 255), 'Tutti 255: gli 8 canali della luce');
    check(/^▶ attivo su 2\.1\.1\.2:1: 1 canale forzato, scade tra (89|90) s$/.test(r.status), `stato da DMX Master: ${r.status}`);
    check(r.off.length === 1 && r.off[0] === null, 'Spegni test: dmx_channel_test null');
    if (shot) { await p.shot(shot); console.log('screenshot: ' + shot); }
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`channel-test: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
