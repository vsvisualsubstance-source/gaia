'use strict';
// Chase dal vivo nel bridge della Plancia (su OPS): a ogni step /dmx/fade s +
// /dmx/scene i verso DMX Master, anche a tablet chiuso. Indice della scena dal
// catalogo retained di DMX Master (show_scenes), cosi' vale anche se in TD si
// cancella una scena che sta prima. In timeline i chase li esegue TD (cue).
//   WS {type:'chase', action:'play', chase, bpm} / {action:'stop'}; {type:'tempo', bpm}

const { chaseOrder, chaseSec } = require('./src/63-chase');

function startChase({ sendOsc, broadcast, url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', tdId = 'td-dmx-win', log = console.log, catalog = null }) {
  let client = null, scenes = catalog || [];
  if (!catalog) {
    let mqtt = null;
    try { mqtt = require('mqtt'); } catch { log('Chase: pacchetto mqtt mancante, catalogo scene assente'); }
    if (mqtt) {
      client = mqtt.connect(url, { clientId: `plancia-bridge-chase-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
      client.on('connect', () => client.subscribe(`gaia/devices/${tdId}/show_scenes`));
      client.on('error', e => log('Chase MQTT:', e.message));
      client.on('message', (t, p) => { try { const c = JSON.parse(p)?.params?.show_scene_catalog; if (Array.isArray(c)) scenes = c; } catch { /* ignora */ } });
    }
  }
  let run = null, status = {}, lastStatus = '';
  const indexOf = id => scenes.find(s => s.id === id)?.index;
  const tick = () => {
    if (run) {
      const now = Date.now(), order = chaseOrder(run.chase);
      if (now >= run.nextAt && order.length) {
        const i = order[run.k % order.length], st = run.chase.steps[i], dur = chaseSec(st.hold || run.chase.hold, run.bpm);
        const idx = indexOf(st.scene);
        if (Number.isFinite(+idx)) { sendOsc('/dmx/fade', [+(dur * Math.max(0, Math.min(100, run.chase.fadePct ?? 0)) / 100).toFixed(2)]); sendOsc('/dmx/scene', [+idx]); }
        run.step = i; run.missing = Number.isFinite(+idx) ? null : st.scene; run.k++;
        run.nextAt = Math.max(run.nextAt + dur * 1000, now);   // senza deriva, ma niente raffiche dopo una pausa
      }
    }
    status = run ? { chase: { id: run.chase.id, name: run.chase.name }, step: run.step, steps: run.chase.steps.length, bpm: run.bpm, missing: run.missing } : { chase: null };
    const k = JSON.stringify(status);
    if (k !== lastStatus) { lastStatus = k; broadcast({ type: 'chase', state: status }); }
  };
  const timer = setInterval(tick, 10);
  return {
    play: (chase, bpm) => { if (chase && Array.isArray(chase.steps) && chase.steps.length) { run = { chase, bpm: +bpm || 120, k: 0, step: -1, nextAt: Date.now() }; tick(); } },
    stop: () => { run = null; tick(); },
    tempo: bpm => { if (run && +bpm > 0) run.bpm = +bpm; },
    status: () => status,
    close: () => { clearInterval(timer); client?.end(true); }
  };
}

module.exports = { startChase };
