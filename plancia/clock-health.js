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

// follower del bridge: un client MQTT suo, ping ogni 2 s, rapporto ogni 2 s. udpPort: ascolta anche lo
// stato in UDP del motore (50/s, clock.rs UDP_DEFAULT: 127.0.0.1 e multicast 239.255.42.99) e ne manda
// un rapporto a parte (<id>-udp, "Bridge · UDP"): si confronta subito con la strada MQTT.
const UDP_GROUP = '239.255.42.99';
function startClockReport({ url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', topic = process.env.SHOW_CLOCK_TOPIC || 'gaia/show/clock', id, name, kind = 'bridge', udpPort = +(process.env.SHOW_CLOCK_UDP_PORT || 47810), log = console.log } = {}) {
  const mqtt = require('mqtt');
  const now = () => performance.now();
  const h = makeHealth(), hu = makeHealth(), pings = new Map();
  let n = 0, udp = null;
  const c = mqtt.connect(url, { reconnectPeriod: 3000 });
  c.on('connect', () => c.subscribe([`${topic}/state`, `${topic}/pong/${id}`]));
  c.on('error', () => { /* si riprova */ });
  c.on('message', (t, m) => {
    const at = now();
    let p; try { p = JSON.parse(m.toString()); } catch { return; }
    if (t === `${topic}/state`) { if (p.v === 1) onState(h, p, at); }
    else if (p.from === id) { const s = pings.get(+p.n); if (s && s.t0 === p.t0) { pings.delete(+p.n); const rtt = at - s.at; onRtt(h, rtt); onRtt(hu, rtt); } }
  });
  if (udpPort > 0) {
    const dgram = require('dgram');
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('error', e => { log(`Orologio UDP: ${e.message}`); try { udp.close(); } catch { /* chiuso */ } udp = null; });
    // u = contatore dei pacchetti: per la misura conta come seq (lo stato MQTT cambia seq solo 1 volta al s)
    udp.on('message', m => { const at = now(); let p; try { p = JSON.parse(m.toString()); } catch { return; } if (p.v !== 1 || p.via !== 'udp') return;
      // sulla stessa macchina arriva due volte (unicast 127.0.0.1 e multicast): conta il primo
      if (hu.last && hu.last.master === p.master && +p.u <= +hu.last.seq && +hu.last.seq - +p.u < 1000) return;
      onState(hu, { ...p, seq: p.u }, at); });
    udp.bind(udpPort, () => { try { udp.addMembership(UDP_GROUP); } catch { /* solo locale */ } log(`Orologio: ascolto lo stato UDP sulla porta ${udpPort}`); });
  }
  const timer = setInterval(() => {
    if (!c.connected) return;
    const at = now(), k = ++n;
    pings.set(k, { at, t0: Date.now() }); for (const [j, s] of pings) if (at - s.at > 30000) pings.delete(j);
    c.publish(`${topic}/ping`, JSON.stringify({ from: id, n: k, t0: pings.get(k).t0 }));
    c.publish(`${topic}/report/${id}`, JSON.stringify({ ...report(h, at, { id, name, kind }), ts: Date.now() }));
    if (hu.lastAt) c.publish(`${topic}/report/${id}-udp`, JSON.stringify({ ...report(hu, at, { id: id + '-udp', name: name + ' · UDP', kind: kind + ' udp' }), ts: Date.now() }));
  }, 2000);
  return { health: h, udpHealth: hu, report: () => report(h, now(), { id, name, kind }), stop() { clearInterval(timer); c.end(true); try { udp?.close(); } catch { /* chiuso */ } } };
}

module.exports = { makeHealth, onState, onRtt, report, grade, startClockReport };
