#!/usr/bin/env node
// Plancia bridge: serve l'interfaccia e traduce WebSocket <-> OSC (UDP) e, se disponibile, MIDI.
//
//   PORT=8080        porta http/websocket (il tablet apre http://<ip-del-pc>:8080)
//   OSC_HOST=192.168.1.73 OSC_PORT=7020   destinazione di default dell'OSC in uscita
//     (DMX Master -- teste mobili/LED/show, vedi plancia/GAIA_PLANCIA_INTEGRATION.md)
//   OSC_IN=9000      porta UDP su cui ricevere OSC (per il feedback verso l'interfaccia)
//   MIDI_OUT="nome"  porta MIDI in uscita (richiede il pacchetto opzionale easymidi)
//   GAIA_OSC_HOST=192.168.1.142 GAIA_OSC_PORT=9008   ingresso OSC di Gaia: gli indirizzi /gaia/... vanno lì

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const net = require('net');
const { WebSocketServer } = require('ws');
const stageAI = require('./stage-ai');
const { createLibrary } = require('./fixture-lib');

const PORT = +process.env.PORT || 8080;
const OSC_IN = +process.env.OSC_IN || 9000;
const STATE_FILE = process.env.PLANCIA_STATE_FILE || path.join(__dirname, 'data', 'state.json');
const fixtureLib = createLibrary({ dir: path.join(path.dirname(STATE_FILE), 'fixture-lib') });
const audioLib = require('./audio-lib');
const STATIC_ASSETS = {
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/plancia.css': { file: 'plancia.css', contentType: 'text/css; charset=utf-8' }
};
let target = { host: process.env.OSC_HOST || '192.168.1.73', port: +process.env.OSC_PORT || 7020 };
// Gaia: osc_bridge.py sul Core ascolta /gaia/td/... sulla 9008 e lo ripubblica su MQTT gaia/touchdesigner/...
let gaiaOsc = { host: process.env.GAIA_OSC_HOST || '192.168.1.142', port: +process.env.GAIA_OSC_PORT || 9008 };
let oscChannels = new Map();
function validSharedState(value) {
  return value && typeof value === 'object' &&
    (value.layout === null || (value.layout && Array.isArray(value.layout.pages) && value.layout.pages.length > 0)) &&
    Array.isArray(value.projects) &&
    value.projectData && typeof value.projectData === 'object' && !Array.isArray(value.projectData);
}
function loadSharedState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!validSharedState(saved.state) || !Number.isSafeInteger(saved.revision) || saved.revision < 0) {
      throw new Error(`Invalid Plancia state file: ${STATE_FILE}`);
    }
    return { state: saved.state, revision: saved.revision };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: { layout: null, projects: [], projectData: {} }, revision: 0 };
    throw error;
  }
}
const loadedState = loadSharedState();
let sharedState = loadedState.state;
let sharedRevision = loadedState.revision;
let persistedState = loadedState.state;
let persistedRevision = loadedState.revision;
let stateWriteQueue = Promise.resolve();
const encodeForScript = value => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function saveSharedState(state, ws, clientRevision) {
  sharedState = JSON.parse(JSON.stringify(state));
  const revision = ++sharedRevision;
  const stateSnapshot = sharedState;
  const snapshot = JSON.stringify({ revision, state: stateSnapshot }, null, 2);
  stateWriteQueue = stateWriteQueue.catch(() => {}).then(async () => {
    await fs.promises.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const tempFile = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tempFile, snapshot, 'utf8');
    await fs.promises.rename(tempFile, STATE_FILE);
  }).then(() => {
    persistedState = stateSnapshot;
    persistedRevision = revision;
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'shared_saved', revision, clientRevision }));
    broadcast({ type: 'shared_update', state: stateSnapshot, revision }, ws);
  }).catch(error => {
    console.error(`Plancia state save failed (${STATE_FILE}):`, error.message);
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'shared_error', message: `Salvataggio condiviso fallito: ${error.message}` }));
  });
}
const routeOf = (address, channel) => {
  if (address.startsWith('/gaia/')) return gaiaOsc;
  if (!channel || channel === 'default') return target;
  return oscChannels.get(channel) || null;
};
const validPort = port => Number.isInteger(port) && port > 0 && port <= 65535;
function channelsFromConfig(channels) {
  if (!Array.isArray(channels)) return new Map();
  return new Map(channels
    .filter(c => c && typeof c.id === 'string' && c.id && typeof c.host === 'string' && c.host.trim() && validPort(+c.port))
    .map(c => [c.id, { host: c.host.trim(), port: +c.port }]));
}
function channelFromSource(address) {
  const matches = [];
  if (target.host === address) matches.push('default');
  for (const [id, channel] of oscChannels) if (channel.host === address) matches.push(id);
  return matches.length > 1 ? null : matches[0];
}

/* ---------- codec OSC minimale ---------- */
const pad4 = n => Math.ceil(n / 4) * 4;
function oscStr(s) {
  const b = Buffer.from(String(s), 'utf8');
  const out = Buffer.alloc(pad4(b.length + 1));
  b.copy(out);
  return out;
}
function encode(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b);
    } else if (typeof a === 'boolean') {
      tags += a ? 'T' : 'F';
    } else {
      tags += 's'; parts.push(oscStr(a));
    }
  }
  return Buffer.concat([oscStr(address), oscStr(tags), ...parts]);
}
function readStr(buf, o) {
  const end = buf.indexOf(0, o);
  return [buf.toString('utf8', o, end), pad4(end + 1)];
}
function decode(buf, out = []) {
  if (buf.length >= 8 && buf.toString('ascii', 0, 7) === '#bundle') {
    let o = 16;
    while (o + 4 <= buf.length) {
      const size = buf.readInt32BE(o); o += 4;
      decode(buf.subarray(o, o + size), out); o += size;
    }
    return out;
  }
  let [address, o] = readStr(buf, 0);
  let tags = '';
  if (o < buf.length && buf[o] === 44) [tags, o] = readStr(buf, o);
  const args = [];
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i': args.push(buf.readInt32BE(o)); o += 4; break;
      case 'f': args.push(buf.readFloatBE(o)); o += 4; break;
      case 'd': args.push(buf.readDoubleBE(o)); o += 8; break;
      case 'h': args.push(Number(buf.readBigInt64BE(o))); o += 8; break;
      case 's': case 'S': { const [s, n] = readStr(buf, o); args.push(s); o = n; break; }
      case 'b': { const n = buf.readInt32BE(o); o += 4 + pad4(n); break; }
      case 'T': args.push(1); break;
      case 'F': case 'N': args.push(0); break;
      default: break;
    }
  }
  out.push({ address, args });
  return out;
}

/* ---------- MIDI opzionale ---------- */
let midiOut = null, midiOutName = null, midiLib = false;
try {
  const easymidi = require('easymidi');
  midiLib = true;
  const outs = easymidi.getOutputs();
  // mai il sintetizzatore di Windows come predefinito: suonerebbe dagli
  // altoparlanti di OPS (MIDI_OUT="Microsoft GS Wavetable Synth" se lo si vuole)
  const name = process.env.MIDI_OUT || outs.find(n => !/GS Wavetable/i.test(n));
  if (name) { midiOut = new easymidi.Output(name); midiOutName = name; }
} catch { /* easymidi non installato: MIDI disattivato */ }

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?')) {
    fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8').then(html => {
      const bootstrap = `window.__PLANCIA_SHARED__=${encodeForScript({ state: persistedState, revision: persistedRevision })};`;
      const scriptTag = '<script>';
      const scriptIndex = html.indexOf(scriptTag);
      if (scriptIndex < 0) throw new Error('Plancia bootstrap script tag not found.');
      const page = `${html.slice(0, scriptIndex + scriptTag.length)}${bootstrap}${html.slice(scriptIndex + scriptTag.length)}`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page);
    }).catch(error => {
      console.error('Plancia page load failed:', error.message);
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Plancia page could not be loaded.');
    });
  } else if (STATIC_ASSETS[req.url.split('?')[0]]) {
    const asset = STATIC_ASSETS[req.url.split('?')[0]];
    fs.promises.readFile(path.join(__dirname, asset.file)).then(content => {
      res.writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'no-store' });
      res.end(content);
    }).catch(error => {
      console.error(`Plancia asset load failed (${asset.file}):`, error.message);
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Plancia asset could not be loaded.');
    });
  } else if (req.url.split('?')[0] === '/api/stage-ai' && req.method === 'POST') {
    // "Palco da descrizione": i tablet non possono chiamare Ollama (gira su
    // OPS, origini limitate), quindi passa dal bridge. Vedi stage-ai.js.
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let prompt = '';
      try { prompt = String(JSON.parse(body).prompt || '').trim(); } catch { /* sotto */ }
      const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
      if (!prompt) return reply(400, { ok: false, error: 'Descrizione del palco mancante.' });
      stageAI.generatePlan(prompt, (err, out) => err ? reply(502, { ok: false, error: err.message }) : reply(200, { ok: true, ...out }));
    });
  } else if (req.url.split('?')[0] === '/api/fixture-lib' || req.url.split('?')[0] === '/api/fixture-lib/fixture') {
    // Libreria fixture (Open Fixture Library + DMXControl DDF): il bridge
    // scarica e tiene in cache, i tablet chiedono solo ricerca e conversione.
    const u = new URL(req.url, 'http://plancia'), q = u.searchParams;
    const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    const job = u.pathname === '/api/fixture-lib' ? fixtureLib.search(q.get('q') || '', q.get('refresh') === '1') : fixtureLib.fixture(q.get('src') || '', q.get('id') || '').then(models => ({ models }));
    job.then(out => reply(200, { ok: true, ...out }), err => reply(502, { ok: false, error: err.message }));
  } else if (req.url.split('?')[0] === '/api/audio/library' || req.url.split('?')[0] === '/api/audio/track') {
    // Console Audio: tracce analizzate da gaia-audio (audio-lib.js)
    const u = new URL(req.url, 'http://plancia'), q = u.searchParams;
    const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    const job = u.pathname === '/api/audio/library' ? audioLib.library(q.get('refresh') === '1').then(tracks => ({ tracks })) : audioLib.track(q.get('id') || '').then(track => ({ track }));
    job.then(out => reply(200, { ok: true, ...out }), err => reply(404, { ok: false, error: err.message }));
  } else if (req.url.split('?')[0] === '/vendor/mqtt.min.js') {
    // stesso mqtt.js che usano le pagine web di Gaia: niente CDN, funziona anche senza internet
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=86400' });
    fs.createReadStream(path.join(__dirname, 'vendor', 'mqtt.min.js')).pipe(res);
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ noServer: true });
// /mqtt: ponte verso il broker MQTT WebSocket di OPS (Docker, 127.0.0.1:19001).
// Serve alle pagine aperte da un indirizzo di OPS dove le porte di Docker non si
// vedono (hotspot di Windows 192.168.137.1, Tailscale): la 8080 si', quindi
// passano da qui (70-gaia-mqtt.js, netLocalize). Si inoltra la richiesta cosi'
// com'e' e poi i byte nei due sensi.
const MQTT_WS = { host: process.env.MQTT_WS_HOST || '127.0.0.1', port: +process.env.MQTT_WS_PORT || 19001 };
const CRLF = '\r\n';
function proxyMqtt(req, sock, head) {
  const up = net.connect(MQTT_WS.port, MQTT_WS.host);
  const end = () => { sock.destroy(); up.destroy(); };
  up.on('error', end); sock.on('error', end); up.on('close', end); sock.on('close', end);
  up.on('connect', () => {
    const lines = [`${req.method} / HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join(CRLF) + CRLF + CRLF);
    if (head && head.length) up.write(head);
    sock.pipe(up).pipe(sock);
  });
}
server.on('upgrade', (req, sock, head) => {
  if (req.url === '/mqtt' || req.url.startsWith('/mqtt?')) return proxyMqtt(req, sock, head);
  wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req));
});
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

const hello = () => JSON.stringify({ type: 'hello', target, gaia: gaiaOsc, channels: [...oscChannels].map(([id, endpoint]) => ({ id, ...endpoint })), listen: OSC_IN, midi: midiOut ? midiOut.name || true : false, sharedState: persistedState, sharedRevision: persistedRevision });
const broadcast = (msg, except) => {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(s);
};
// Timeline video di PatchDeck: la esegue il bridge (sempre acceso su OPS),
// seguendo l'orologio dello show. Documento in layout.videoTimeline.
const videoTimeline = require('./video-timeline').startVideoTimeline({ getDoc: () => persistedState?.layout?.videoTimeline, broadcast });
// Timeline laser (ops/laser): stessa idea, verso il laser gateway. Scene in layout.laserScenes.
const laserTimeline = require('./laser-timeline').startLaserTimeline({ getDoc: () => persistedState?.layout?.laserTimeline, getScenes: () => persistedState?.layout?.laserScenes || [], broadcast });

// MIDI in ingresso (midi-in.js): i comandi si eseguono qui, una volta sola,
// anche senza tablet aperti; le pagine ricevono il ritorno OSC e il messaggio
// grezzo (per "Impara MIDI")
const midiIn = require('./midi-in');
const midiState = {};
let midiMqtt = null;
try {
  midiMqtt = require('mqtt').connect(process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883',
    { clientId: `plancia-bridge-midi-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
  midiMqtt.on('error', () => { /* riprova da solo */ });
} catch { /* pacchetto mqtt mancante: PANIC/GO/BACK solo OSC */ }
function onMidi(m, port) {
  broadcast({ type: 'midi_in', port, ...m });
  const r = midiIn.midiActions(m, persistedState?.layout, midiState, { laserId: process.env.LASER_ID || 'laser-ops' });
  for (const o of r.osc) {
    const to = routeOf(o.address, o.channel);
    if (to) udp.send(encode(o.address, o.args), to.port, to.host, () => {});
    broadcast({ type: 'osc', address: o.address, args: o.args, channel: o.channel, echo: true });
  }
  for (const q of r.mqtt) if (midiMqtt) midiMqtt.publish(q.topic, JSON.stringify(q.payload));
  const acts = r.hits.filter(h => midiIn.ACTIONS.includes(h));
  if (acts.length) console.log(`MIDI ${acts.join(', ').toUpperCase()} da "${port}"`);
}
// nessuna esclusione automatica: un controller (es. APC40) ha lo stesso nome in
// ingresso e in uscita, e la Plancia non rimanda in MIDI cio' che arriva dal MIDI
// (niente anelli). Con una porta virtuale di loopback limitare con MIDI_IN.
const midiPorts = midiIn.startMidiIn({ onMessage: onMidi, onPorts: inputs => broadcast({ type: 'midi_ports', inputs }) });

wss.on('connection', ws => {
  ws.send(hello());
  ws.send(JSON.stringify({ type: 'midi_ports', inputs: midiPorts.ports() }));
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'shared_state') {
      if (!validSharedState(m.state) || !Number.isSafeInteger(m.clientRevision) || m.clientRevision < 0) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'shared_error', message: 'Stato Plancia condiviso non valido.' }));
        return;
      }
      saveSharedState(m.state, ws, m.clientRevision);
    } else if (m.type === 'osc' && typeof m.address === 'string' && m.address.startsWith('/')) {
      const args = Array.isArray(m.args) ? m.args : [];
      const channel = typeof m.channel === 'string' ? m.channel : 'default';
      const to = routeOf(m.address, channel);
      if (!to) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: `Canale OSC "${channel}" non configurato.` }));
        return;
      }
      udp.send(encode(m.address, args), to.port, to.host, error => {
        if (error && ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: `Invio OSC fallito su ${to.host}:${to.port}: ${error.message}` }));
      });
      broadcast({ type: 'osc', address: m.address, args, channel, echo: true }, ws); // altri tablet restano allineati
    } else if (m.type === 'config' && m.host && m.port) {
      if (!validPort(+m.port)) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: 'Porta OSC predefinita non valida.' }));
        return;
      }
      target = { host: String(m.host), port: +m.port };
      if (m.gaiaHost && validPort(+m.gaiaPort)) gaiaOsc = { host: String(m.gaiaHost), port: +m.gaiaPort };
      if (Array.isArray(m.channels)) oscChannels = channelsFromConfig(m.channels);
      console.log(`OSC in uscita → ${target.host}:${target.port} · /gaia/... → ${gaiaOsc.host}:${gaiaOsc.port}`);
      for (const c of wss.clients) if (c.readyState === 1) c.send(hello());
    } else if (m.type === 'midi_fake' && process.env.PLANCIA_MIDI_FAKE === '1') {
      // solo per i test (test/midi-learn.js): un messaggio come da un controller
      const n = midiIn.normalize(m.midiType, m.msg || {});
      if (n) onMidi(n, 'finto');
    } else if (m.type === 'midi' && midiOut) {
      midiOut.send('cc', { controller: m.cc & 127, value: m.value & 127, channel: ((m.ch || 1) - 1) & 15 });
    }
  });
});

udp.on('message', (buf, rinfo) => {
  try {
    for (const msg of decode(buf)) {
      const channel = channelFromSource(rinfo.address);
      broadcast({ type: 'osc', ...msg, ...(channel !== undefined ? { channel } : {}) });
    }
  } catch { /* pacchetto non valido */ }
});
udp.on('error', e => console.error('UDP:', e.message));
udp.bind(OSC_IN, () => udp.setBroadcast(true));

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\nPlancia bridge attivo');
  console.log(`  Apri sul tablet:  ${ips.map(ip => `http://${ip}:${PORT}`).join('  ') || `http://localhost:${PORT}`}`);
  console.log(`  OSC in uscita →  ${target.host}:${target.port}`);
  console.log(`  OSC /gaia/... →  ${gaiaOsc.host}:${gaiaOsc.port} (Gaia, osc_bridge)`);
  console.log(`  Stato Plancia:   ${STATE_FILE}`);
  console.log(`  OSC in ingresso: porta UDP ${OSC_IN}`);
  console.log(`  MIDI out:        ${midiOut ? midiOutName : midiLib ? 'nessuna porta in uscita (MIDI_OUT per sceglierla)' : 'disattivato (npm i easymidi per abilitarlo)'}`);
  console.log(`  MIDI in:         ${midiPorts.ports().join(', ') || 'nessuna porta (si aprono da sole quando compaiono)'}\n`);
});

module.exports = { encode, decode };
