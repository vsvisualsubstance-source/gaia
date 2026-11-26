'use strict';
// Salute dell'orologio dello show (docs/show-clock.md, 26/11/2026). Ogni follower misura:
//  - ritardo verso il broker (ping/pong: ultimo, minimo, jitter = 90° percentile - minimo)
//  - SCARTO: a ogni nuovo stato del master, quanto la posizione che il follower stava contando
//    (stato precedente + tempo passato) si discosta da quella nuova. E' il salto che il follower
//    fa a ogni correzione: viene dal ritardo variabile della rete e del broker (Wi-Fi!), non dalla
//    deriva. Solo fra due stati in play dello stesso master, senza salti voluti (seek, > 1 s).
//  - pause fra due stati (il master ne manda almeno uno al secondo) ed eta' dell'ultimo.
// e lo pubblica ogni 2 s su gaia/show/clock/report/<id> (non retained). La Plancia li mostra
// nel pannello ⏱ Orologio.

// la misura e' la stessa dei tablet: src/31-clock-health.js
const { chMake: makeHealth, chOnState: onState, chOnRtt: onRtt, chReport: report, chGrade: grade } = require('./src/31-clock-health.js');

// follower del bridge: un client MQTT suo, ping ogni 2 s, rapporto ogni 2 s
function startClockReport({ url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', topic = process.env.SHOW_CLOCK_TOPIC || 'gaia/show/clock', id, name, kind = 'bridge', log = console.log } = {}) {
  const mqtt = require('mqtt');
  const h = makeHealth(), pings = new Map();
  let n = 0;
  const c = mqtt.connect(url, { reconnectPeriod: 3000 });
  c.on('connect', () => c.subscribe([`${topic}/state`, `${topic}/pong/${id}`]));
  c.on('error', () => { /* si riprova */ });
  c.on('message', (t, m) => {
    let p; try { p = JSON.parse(m.toString()); } catch { return; }
    const now = Date.now();
    if (t === `${topic}/state`) { if (p.v === 1) onState(h, p, now); }
    else if (p.from === id) { const s = pings.get(+p.n); if (s && s === p.t0) { pings.delete(+p.n); onRtt(h, now - s); } }
  });
  const timer = setInterval(() => {
    if (!c.connected) return;
    const now = Date.now(), k = ++n;
    pings.set(k, now); for (const [j, t] of pings) if (now - t > 30000) pings.delete(j);
    c.publish(`${topic}/ping`, JSON.stringify({ from: id, n: k, t0: now }));
    c.publish(`${topic}/report/${id}`, JSON.stringify(report(h, now, { id, name, kind })));
  }, 2000);
  return { health: h, report: () => report(h, Date.now(), { id, name, kind }), stop() { clearInterval(timer); c.end(true); } };
}

module.exports = { makeHealth, onState, onRtt, report, grade, startClockReport };
