'use strict';
// Manda al Raspberry DMX la timeline di tools/pi-loop.js (prima i colori: il Pi rifiuta una timeline
// con colori che non conosce). Non la avvia: si avvia dallo schermo del Pi (o con --start).
//   node tools/pi-loop-send.js [ws://100.76.11.49:9001] [stanza] [--start]
const mqtt = require('mqtt');
const P = require('./pi-loop');
const URL = process.argv.find(a => /^wss?:|^mqtt:/.test(a)) || 'ws://100.76.11.49:9001';
const ROOM = process.argv.slice(2).find(a => !/^(wss?|mqtt):|^--/.test(a)) || 'ingresso';
const START = process.argv.includes('--start');
const c = mqtt.connect(URL, { connectTimeout: 6000 });
let st = null;
c.on('message', (t, m) => { try { st = JSON.parse(m.toString()); } catch { /* niente */ } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cmd = o => new Promise(r => c.publish(`gaia/dmx/${ROOM}/command`, JSON.stringify(o), { qos: 1 }, r));
c.on('error', e => { console.error('ERRORE', e.message); process.exit(1); });
c.on('connect', async () => {
  c.subscribe(`gaia/dmx/${ROOM}/status`);
  for (let i = 0; i < 20 && !st; i++) await sleep(300);
  if (!st) { console.error(`ERRORE: nessuno stato da ${ROOM}`); process.exit(1); }
  for (const [name, rgb] of Object.entries(P.palettes)) await cmd({ action: 'palette_save', name, rgb });
  await sleep(800);
  await cmd({ action: 'timeline_save', name: P.NAME, steps: P.steps, loop: P.loop });
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    const t = st?.timeline_presets?.[P.NAME];
    if (t?.steps?.length === P.steps.length) {
      console.log(`ok: "${P.NAME}" su ${ROOM} (${st.device_id}): ${t.steps.length} passi, loop ${t.loop}, colori ${Object.keys(P.palettes).filter(n => st.palettes_rgb?.[n]).length}/${Object.keys(P.palettes).length}`);
      if (START) { const f = st.default_fixture || Object.keys(st.fixtures || {})[0]; await cmd({ action: 'timeline_load', fixture: f, name: P.NAME }); await cmd({ action: 'timeline_start', fixture: f }); console.log('avviata sulla luce', f); }
      c.end(); return;
    }
  }
  console.error('ERRORE: il Raspberry non ha confermato la timeline'); c.end(); process.exitCode = 1;
});
