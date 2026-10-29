'use strict';
// MIDI in ingresso: controller fisici (fader, pad, pedale) e MIDI in rete
// (rtpMIDI) verso la Plancia.
//
// I comandi li esegue il BRIDGE, una volta sola e anche con tutti i tablet
// chiusi: se ogni pagina aperta eseguisse il MIDI, lo stesso fader partirebbe
// N volte e ogni pagina salverebbe il layout. Le pagine ricevono il ritorno
// (lo stesso OSC, come da un altro tablet) e il messaggio grezzo per
// "Impara MIDI".
//
// Mappature, tutte nel layout condiviso (state.json):
//   widget fader/knob/button: w.midi = {ch, cc} oppure {ch, note} (pulsanti)
//   azioni: layout.midiActions = {panic, go, back}: {ch, cc} o {ch, note}
//     panic = /dmx/blackout 1 a DMX Master + blackout del laser gateway
//     go/back = gaia/show/clock/command (come i pulsanti della timeline)
//
// Porte: MIDI_IN non impostata = tutte; "off" = nessuna; altrimenti nomi
// (anche parziali) separati da virgola. Con una porta virtuale di loopback
// (loopMIDI usata anche come MIDI_OUT) limitare MIDI_IN per non rientrare. Le porte collegate dopo si aprono da sole (controllo
// ogni 3 s), quelle scollegate si chiudono.

const ACTIONS = ['panic', 'go', 'back'];

// evento easymidi -> {kind:'cc'|'note', ch:1..16, n, v:0..127, on}
function normalize(type, msg) {
  const ch = ((msg.channel | 0) & 15) + 1;
  if (type === 'cc') return { kind: 'cc', ch, n: msg.controller & 127, v: msg.value & 127, on: (msg.value & 127) >= 64 };
  if (type === 'noteon') return { kind: 'note', ch, n: msg.note & 127, v: msg.velocity & 127, on: (msg.velocity & 127) > 0 };
  if (type === 'noteoff') return { kind: 'note', ch, n: msg.note & 127, v: 0, on: false };
  return null;
}

// mappatura {ch, cc} o {ch, note}: cc '' o assente = nessuna
function matches(map, m) {
  if (!map || typeof map !== 'object' || (+map.ch || 1) !== m.ch) return false;
  if (m.kind === 'cc') return map.cc !== '' && map.cc != null && +map.cc === m.n;
  return map.note !== '' && map.note != null && +map.note === m.n;
}

const MIDI_TYPES = new Set(['fader', 'knob', 'button']);
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

// Un messaggio MIDI -> cosa fare. state ricorda pulsanti premuti e
// interruttori (id -> bool) tra un messaggio e l'altro.
//   {osc: [{address, args, channel}], mqtt: [{topic, payload}], hits: [...]}
function midiActions(m, layout, state, { laserId = 'laser-ops', clockTopic = 'gaia/show/clock/command' } = {}) {
  const out = { osc: [], mqtt: [], hits: [] };
  if (!m || !layout) return out;
  const pressed = state.pressed || (state.pressed = {});
  const toggles = state.toggles || (state.toggles = {});
  // fronte di salita per pulsanti e azioni: premuto adesso e non prima
  const rising = key => { const was = !!pressed[key]; pressed[key] = m.on; return m.on && !was; };

  for (const page of layout.pages || []) for (const w of page.widgets || []) {
    if (!MIDI_TYPES.has(w.type) || !w.addr || !matches(w.midi, m)) continue;
    const min = num(w.min, 0), max = num(w.max, 1), channel = w.oscChannel || 'default';
    if (w.type === 'button') {
      let on;
      if (w.mode === 'toggle') {
        if (!rising('w:' + w.id)) continue;
        if (!(w.id in toggles)) toggles[w.id] = !!w.value;
        on = toggles[w.id] = !toggles[w.id];
      } else {
        const before = !!pressed['w:' + w.id];
        pressed['w:' + w.id] = m.on;
        if (before === m.on) continue;   // ripetizioni dello stesso stato
        on = m.on;
      }
      out.osc.push({ address: w.addr, args: [on ? max : min], channel });
      out.hits.push(w.id);
    } else if (m.kind === 'cc') {   // fader e manopole: solo CC, 0..127 nel range
      out.osc.push({ address: w.addr, args: [+(min + (m.v / 127) * (max - min)).toFixed(4)], channel });
      out.hits.push(w.id);
    }
  }

  const acts = layout.midiActions || {};
  for (const a of ACTIONS) {
    if (!matches(acts[a], m) || !rising('a:' + a)) continue;
    out.hits.push(a);
    if (a === 'panic') {
      out.osc.push({ address: '/dmx/blackout', args: [1], channel: 'default' });
      out.mqtt.push({ topic: `gaia/device/${laserId}/command`, payload: { action: 'blackout' } });
    } else out.mqtt.push({ topic: clockTopic, payload: { action: a } });
  }
  return out;
}

// Parte viva: apre le porte e chiama onMessage(m, porta). Senza easymidi
// (pacchetto opzionale) non fa niente.
function startMidiIn({ onMessage, onPorts = () => {}, exclude = [], log = console.log, pollMs = 3000 }) {
  let easymidi;
  try { easymidi = require('easymidi'); } catch { return { ports: () => [], stop() {} }; }
  const want = (process.env.MIDI_IN ?? '').trim();
  if (want.toLowerCase() === 'off') return { ports: () => [], stop() {} };
  const names = want ? want.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
  const ex = exclude.filter(Boolean).map(s => s.toLowerCase());
  const open = new Map();
  const wanted = name => !ex.includes(name.toLowerCase()) && (!names || names.some(n => name.toLowerCase().includes(n)));
  const scan = () => {
    let list = [];
    try { list = easymidi.getInputs(); } catch { /* nessun dispositivo */ }
    let changed = false;
    for (const name of list) if (!open.has(name) && wanted(name)) {
      try {
        const input = new easymidi.Input(name);
        for (const type of ['cc', 'noteon', 'noteoff']) input.on(type, msg => { const m = normalize(type, msg); if (m) onMessage(m, name); });
        open.set(name, input); changed = true; log(`MIDI in: aperta "${name}"`);
      } catch (e) { log(`MIDI in: "${name}" non si apre (${e.message})`); }
    }
    for (const [name, input] of open) if (!list.includes(name)) {
      try { input.close(); } catch { /* gia' chiusa */ }
      open.delete(name); changed = true; log(`MIDI in: "${name}" scollegata`);
    }
    if (changed) onPorts([...open.keys()]);
  };
  scan();
  const timer = setInterval(scan, pollMs);
  return { ports: () => [...open.keys()], stop() { clearInterval(timer); for (const i of open.values()) try { i.close(); } catch { /* */ } } };
}

module.exports = { ACTIONS, normalize, matches, midiActions, startMidiIn };
