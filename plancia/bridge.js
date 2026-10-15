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
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const OSC_IN = +process.env.OSC_IN || 9000;
let target = { host: process.env.OSC_HOST || '192.168.1.73', port: +process.env.OSC_PORT || 7020 };
// Gaia: osc_bridge.py sul Core ascolta /gaia/td/... sulla 9008 e lo ripubblica su MQTT gaia/touchdesigner/...
let gaiaOsc = { host: process.env.GAIA_OSC_HOST || '192.168.1.142', port: +process.env.GAIA_OSC_PORT || 9008 };
const routeOf = address => address.startsWith('/gaia/') ? gaiaOsc : target;

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
let midiOut = null;
try {
  const easymidi = require('easymidi');
  const outs = easymidi.getOutputs();
  const name = process.env.MIDI_OUT || outs[0];
  if (name) midiOut = new easymidi.Output(name);
} catch { /* easymidi non installato: MIDI disattivato */ }

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  } else if (req.url.split('?')[0] === '/vendor/mqtt.min.js') {
    // stesso mqtt.js che usano le pagine web di Gaia: niente CDN, funziona anche senza internet
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=86400' });
    fs.createReadStream(path.join(__dirname, 'vendor', 'mqtt.min.js')).pipe(res);
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server });
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

const hello = () => JSON.stringify({ type: 'hello', target, gaia: gaiaOsc, listen: OSC_IN, midi: midiOut ? midiOut.name || true : false });
const broadcast = (msg, except) => {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(s);
};

wss.on('connection', ws => {
  ws.send(hello());
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'osc' && typeof m.address === 'string' && m.address.startsWith('/')) {
      const args = Array.isArray(m.args) ? m.args : [];
      const to = routeOf(m.address);
      udp.send(encode(m.address, args), to.port, to.host);
      broadcast({ type: 'osc', address: m.address, args, echo: true }, ws); // altri tablet restano allineati
    } else if (m.type === 'config' && m.host && m.port) {
      target = { host: String(m.host), port: +m.port };
      if (m.gaiaHost && m.gaiaPort) gaiaOsc = { host: String(m.gaiaHost), port: +m.gaiaPort };
      console.log(`OSC in uscita → ${target.host}:${target.port} · /gaia/... → ${gaiaOsc.host}:${gaiaOsc.port}`);
      for (const c of wss.clients) if (c.readyState === 1) c.send(hello());
    } else if (m.type === 'midi' && midiOut) {
      midiOut.send('cc', { controller: m.cc & 127, value: m.value & 127, channel: ((m.ch || 1) - 1) & 15 });
    }
  });
});

udp.on('message', buf => {
  try { for (const msg of decode(buf)) broadcast({ type: 'osc', ...msg }); } catch { /* pacchetto non valido */ }
});
udp.on('error', e => console.error('UDP:', e.message));
udp.bind(OSC_IN, () => udp.setBroadcast(true));

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\nPlancia bridge attivo');
  console.log(`  Apri sul tablet:  ${ips.map(ip => `http://${ip}:${PORT}`).join('  ') || `http://localhost:${PORT}`}`);
  console.log(`  OSC in uscita →  ${target.host}:${target.port}`);
  console.log(`  OSC /gaia/... →  ${gaiaOsc.host}:${gaiaOsc.port} (Gaia, osc_bridge)`);
  console.log(`  OSC in ingresso: porta UDP ${OSC_IN}`);
  console.log(`  MIDI:            ${midiOut ? 'attivo' : 'disattivato (npm i easymidi per abilitarlo)'}\n`);
});

module.exports = { encode, decode };
