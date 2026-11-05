'use strict';
// Controller DJ per la Console Audio, eseguiti dal bridge (funzionano anche a
// tablet spenti): i controlli diventano comandi del motore gaia-audio e lo
// stato del motore torna sui LED del controller.
//
// Traktor Kontrol Z1, mappa "Default" del Controller Editor NI (porta
// "Traktor Kontrol Z1 MIDI"), letta dal vivo il 2026-11-05:
//   canale 1 = deck A, canale 2 = deck B: CC0 GAIN, CC1 HI, CC2 MID, CC3 LOW,
//     CC4 FILTER, CC5 pulsante FX (filtro acceso/spento, LED), CC6 fader
//   canale 3 = centro: CC0 CUE MIX, CC1/CC2 pulsanti cuffia A/B (LED),
//     CC5 crossfader; CC3/CC4 = LED del livello A/B (solo in uscita)
//   MASTER e HP VOLUME della Z1 sono analogici: non mandano MIDI.
// Con la traccia AUDIO in TIMELINE fader e crossfader li comanda la timeline:
// quelli della Z1 si ignorano (gain, EQ, filtro e cuffia restano a mano).

const Z1_PORT = /kontrol z1/i;
const DECK_CH = { 1: 'A', 2: 'B' };

// 0..127 con centro a 64 -> -1..1 (0 esatto al centro)
const bipolar = v => (v >= 64 ? (v - 64) / 63 : (v - 64) / 64);
// gain: 0..64..127 -> 0..1..2
const gain = v => (v <= 64 ? v / 64 : 1 + (v - 64) / 63);
const round = x => Math.round(x * 1000) / 1000;

// messaggio MIDI della Z1 -> comandi del motore. st: {fx:{A,B}, filter:{A,B}, cue:{A,B}, timeline}
// (st.fx e st.filter vengono aggiornati qui)
function z1Commands(m, st) {
  if (m.kind !== 'cc') return [];
  const deck = DECK_CH[m.ch];
  if (deck) {
    const set = values => [{ cmd: 'mix.set', ch: deck, values }];
    switch (m.n) {
      case 0: return set({ gain: round(gain(m.v)) });
      case 1: return set({ hi: round(bipolar(m.v)) });
      case 2: return set({ mid: round(bipolar(m.v)) });
      case 3: return set({ lo: round(bipolar(m.v)) });
      case 4: st.filter[deck] = round(bipolar(m.v)); return st.fx[deck] ? set({ filter: st.filter[deck] }) : [];
      case 5: // FX: filtro acceso/spento (alla pressione)
        if (m.v < 64) return [];
        st.fx[deck] = !st.fx[deck];
        return set({ filter: st.fx[deck] ? st.filter[deck] : 0 });
      case 6: return st.timeline ? [] : set({ fader: round(m.v / 127) });
    }
    return [];
  }
  if (m.ch === 3) {
    switch (m.n) {
      case 0: return [{ cmd: 'mix.set', values: { cue_mix: round(m.v / 127) } }];
      case 1: case 2: { // cuffia A / B (alla pressione): inverte lo stato che ha il motore
        if (m.v < 64) return [];
        const k = m.n === 1 ? 'A' : 'B';
        return [{ cmd: 'mix.set', ch: k, values: { cue: !st.cue[k] } }];
      }
      case 5: return st.timeline ? [] : [{ cmd: 'mix.set', values: { xfader: round(bipolar(m.v)) } }];
    }
  }
  return [];
}

// livello (picco lineare) -> 0..127 per i LED: scala in dB da -36 a 0
const meterLed = p => { const db = 20 * Math.log10(Math.max(1e-6, +p || 0)); return Math.max(0, Math.min(127, Math.round((db + 36) / 36 * 127))); };

// LED attesi dallo stato del motore: chiave "ch:cc" -> valore
function z1Leds(state, st) {
  const out = {};
  if (!state) return out;
  out['1:5'] = st.fx.A ? 127 : 0;
  out['2:5'] = st.fx.B ? 127 : 0;
  out['3:1'] = state.mix?.A?.cue ? 127 : 0;
  out['3:2'] = state.mix?.B?.cue ? 127 : 0;
  out['3:3'] = meterLed(state.mix?.A?.meter);
  out['3:4'] = meterLed(state.mix?.B?.meter);
  return out;
}

function startAudioMidi({ engine, isTimeline = () => false, log = console.log }) {
  const st = { fx: { A: true, B: true }, filter: { A: 0, B: 0 }, cue: { A: false, B: false }, timeline: false };
  let out = null, outTried = 0, sent = {};
  const openOut = () => {
    if (out || Date.now() - outTried < 10000) return out;
    outTried = Date.now();
    try {
      const easymidi = require('easymidi');
      const name = easymidi.getOutputs().find(n => Z1_PORT.test(n));
      if (name) { out = new easymidi.Output(name); sent = {}; log(`Console Audio: LED su ${name}`); }
    } catch { out = null; }
    return out;
  };
  // LED: solo i cambiamenti, al ritmo dello stato del motore
  const leds = setInterval(() => {
    const s = engine.state();
    if (!s) return;
    st.cue = { A: !!s.mix?.A?.cue, B: !!s.mix?.B?.cue };
    if (!openOut()) return;
    const want = z1Leds(s, st);
    try {
      for (const [k, v] of Object.entries(want)) {
        if (sent[k] === v) continue;
        const [ch, cc] = k.split(':').map(Number);
        out.send('cc', { controller: cc, value: v, channel: ch - 1 });
        sent[k] = v;
      }
    } catch { try { out.close(); } catch { /* gia' chiusa */ } out = null; }
  }, 66);
  return {
    // messaggio MIDI normalizzato (midi-in.js) dalla porta `port`; true = era della Z1
    onMidi(m, port) {
      if (!Z1_PORT.test(port || '')) return false;
      st.timeline = !!isTimeline();
      for (const c of z1Commands(m, st)) engine.send(c);
      return true;
    },
    stop() { clearInterval(leds); try { out?.close(); } catch { /* niente */ } },
  };
}

module.exports = { z1Commands, z1Leds, meterLed, startAudioMidi };
