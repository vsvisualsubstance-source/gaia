'use strict';
// Quale DMX Master e' accesa: td-dmx-win (PC dedicato, oggi la .73) oppure
// td-dmx-ops (lo stesso progetto su OPS o sulla touring, una macchina sola).
// Il device_id lo sceglie TD dal nome della macchina: qui si guarda chi
// pubblica lo status (gaia/device/td-dmx-*/status) ed e' vivo. PD_DMX
// (td-pddmx-win) e' un'altra cosa e resta fuori.
// Scelta: tra i vivi (status < 2 min) quello con piu' parametri (la DMX
// Master vera), a parita' il piu' recente; nessuno vivo = l'ultimo visto.
// host(): l'IP da usare per l'OSC; se e' questa macchina, 127.0.0.1
// (stessa macchina via IP esterno non e' affidabile su Windows con Docker/HNS).

const os = require('os');

const DMX_RE = /^td-dmx-/;
const ONLINE_MS = 120000;
const FALLBACK = 'td-dmx-win';

function localAddresses() {
  const out = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) out.add(a.address);
  return out;
}

// devs: Map id -> {ip, tailscale, params, seen}
function pickDmx(devs, now = Date.now()) {
  const all = [...devs.entries()].filter(([id]) => DMX_RE.test(id));
  if (!all.length) return null;
  const live = all.filter(([, d]) => now - d.seen < ONLINE_MS);
  const pool = live.length ? live : all;
  pool.sort(([, a], [, b]) => (live.length ? b.params - a.params : 0) || b.seen - a.seen);
  return pool[0][0];
}

function startDmxMaster({ url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', log = console.log, fixed = process.env.DMX_MASTER_ID || '' } = {}) {
  const devs = new Map();
  const listeners = [];
  let current = fixed || null, client = null;
  const local = localAddresses();
  const recompute = () => {
    if (fixed) return;
    const next = pickDmx(devs);
    if (next && next !== current) {
      const prev = current; current = next;
      log(`DMX Master: ${next}${devs.get(next)?.ip ? ' su ' + devs.get(next).ip : ''}${prev ? ` (prima ${prev})` : ''}`);
      for (const fn of listeners) { try { fn(next, prev); } catch { /* listener */ } }
    }
  };
  try {
    client = require('mqtt').connect(url, { clientId: `plancia-dmx-master-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
    client.on('connect', () => client.subscribe('gaia/device/+/status'));
    client.on('error', () => {});
    client.on('message', (topic, payload) => {
      const id = topic.split('/')[2];
      if (!DMX_RE.test(id)) return;
      let j; try { j = JSON.parse(payload); } catch { return; }
      // lo status retained di una DMX spenta porta il suo ts vecchio: vale quello
      const ts = +j.ts || +j.timestamp || 0, seen = ts > 1e12 ? Math.min(ts, Date.now()) : Date.now();
      devs.set(id, { ip: /^\d+\.\d+\.\d+\.\d+$/.test(j.ip || '') ? j.ip : '', tailscale: j.tailscale_ip || '', params: Object.keys(j.params || {}).length, seen });
      recompute();
    });
    setInterval(recompute, 15000).unref?.();
  } catch (e) { log(`DMX Master: MQTT non disponibile (${e.message}), uso ${fixed || FALLBACK}`); }
  return {
    id: () => current || FALLBACK,
    // IP per l'OSC verso la DMX Master; '' = non noto
    host() {
      const d = devs.get(current || FALLBACK); if (!d) return '';
      const ip = d.ip || d.tailscale;
      if (!ip) return '';
      return local.has(ip) ? '127.0.0.1' : ip;
    },
    onChange(fn) { listeners.push(fn); },
    close() { try { client?.end(true); } catch { /* chiuso */ } },
  };
}

module.exports = { startDmxMaster, pickDmx };
