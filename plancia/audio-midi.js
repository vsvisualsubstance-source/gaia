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
//
// Akai LPD8 mk2 (porta "LPD8 mk2"), programma di fabbrica, letta dal vivo il
// 2026-11-05: riga di sopra = deck A, riga di sotto = deck B.
//   pad modo NOTE (note 40-43 sopra, 36-39 sotto, qualsiasi canale):
//     1° ▶/❚❚, 2° CUE (stile CDJ, tenuto = preascolto), 3° SYNC, 4° STOP (ferma e torna al cue)
//   pad modo CC (canale 10, CC 16-19 sopra, 12-15 sotto; valore = forza, 0 = rilascio):
//     hot cue 1-4 del deck (vuoto = salva, pieno = salta)
//   manopole K1-K8 (canale 1, CC 70-77): K1 tempo A, K2 jog A, K3 tempo B,
//     K4 jog B, K5 volume cuffia, K6 master, K7 jog fine A, K8 jog fine B
//   JOG (14/11, come il piatto): conta di quanto giri, non dove sta la manopola;
//     ogni scatto sposta la fase del deck (FINE) di 1 ms (K2/K4) o 0,25 ms (K7/K8),
//     fino a ±50 ms. La velocita' non cambia mai e il SYNC tiene la nuova posizione.
//     Prima K2/K4 erano un nudge assoluto: lasciata fuori centro, la manopola teneva
//     il deck spinto (anche del 2%) e sospendeva l'aggancio -> il mix perdeva il tempo.
// Con la traccia AUDIO in TIMELINE i comandi dei deck dell'LPD8 si ignorano
// (li comanda la timeline); cuffia e master restano a mano.

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

const LPD8_PORT = /lpd8/i;
const LPD_ROWS = { 40: ['A', 0], 41: ['A', 1], 42: ['A', 2], 43: ['A', 3], 36: ['B', 0], 37: ['B', 1], 38: ['B', 2], 39: ['B', 3] };
const LPD_CC_PADS = { 16: ['A', 0], 17: ['A', 1], 18: ['A', 2], 19: ['A', 3], 12: ['B', 0], 13: ['B', 1], 14: ['B', 2], 15: ['B', 3] };

// jog: lo scatto della manopola (differenza dal valore di prima) sposta la fase fine del deck.
// Il primo messaggio di una manopola fa solo da riferimento. La fase di partenza e' quella del
// motore, salvo un jog appena fatto (lo stato del motore puo' essere di prima: girando svelto
// si perderebbero scatti).
const JOG_MS = { 2: 1, 4: 1, 7: 0.25, 8: 0.25 };
function lpdJog(k, v, st) {
  st.knobs = st.knobs || {}; st.trim = st.trim || {};
  const prev = st.knobs[k]; st.knobs[k] = v;
  if (st.timeline || prev == null || prev === v) return [];
  const deck = k === 2 || k === 7 ? 'A' : 'B', now = st.now ?? Date.now(), mine = st.trim[deck];
  const cur = mine && now - mine.at < 600 ? mine.ms : +st.eng?.decks?.[deck]?.trim_ms || 0;
  const ms = Math.max(-50, Math.min(50, Math.round((cur + (v - prev) * JOG_MS[k]) * 100) / 100));
  st.trim[deck] = { ms, at: now };
  return ms === cur ? [] : [{ cmd: 'deck.trim', deck, ms }];
}

// messaggio dell'LPD8 -> comandi. st: {timeline, eng (stato del motore), pads: {chiave: premuto}}
function lpd8Commands(m, st) {
  // pad: pressione e rilascio (in CC il valore e' la forza, 0 = rilascio)
  let pad = null, down = false;
  if (m.kind === 'note' && LPD_ROWS[m.n]) { pad = ['n', ...LPD_ROWS[m.n]]; down = m.v > 0; }
  else if (m.kind === 'cc' && m.ch === 10 && LPD_CC_PADS[m.n]) { pad = ['c', ...LPD_CC_PADS[m.n]]; down = m.v > 0; }
  if (pad) {
    const key = pad.join(':'), was = !!st.pads[key];
    st.pads[key] = down;
    if (st.timeline) return [];
    const [mode, deck, i] = pad;
    if (down === was) return [];      // forza che cambia mentre il pad e' tenuto
    if (mode === 'c') return down ? [{ cmd: 'deck.hotcue', deck, n: i, op: 'go' }] : [];
    if (i === 1) return [{ cmd: down ? 'deck.cue_down' : 'deck.cue_up', deck }];
    if (!down) return [];
    if (i === 0) return [{ cmd: 'deck.play', deck }];
    if (i === 2) return [{ cmd: 'deck.sync', deck }];
    const cue = st.eng?.decks?.[deck]?.cue;
    return [{ cmd: 'deck.play', deck, value: false }, ...(Number.isFinite(cue) ? [{ cmd: 'deck.seek', deck, pos: cue }] : [])];
  }
  if (m.kind === 'cc' && m.ch === 1 && m.n >= 70 && m.n <= 77) {
    const k = m.n - 69, x = m.v / 127;
    switch (k) {
      case 1: case 3: return st.timeline ? [] : [{ cmd: 'deck.tempo', deck: k === 1 ? 'A' : 'B', value: round(bipolar(m.v)) }];
      case 5: return [{ cmd: 'mix.set', values: { cue_level: round(x) } }];
      case 6: return [{ cmd: 'mix.set', values: { master: round(x) } }];
      case 2: case 4: case 7: case 8: return lpdJog(k, m.v, st);
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
  const lpd = { timeline: false, eng: null, pads: {} };
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
    // messaggio MIDI normalizzato (midi-in.js) dalla porta `port`; true = era di un controller della console
    onMidi(m, port) {
      if (Z1_PORT.test(port || '')) {
        st.timeline = !!isTimeline();
        for (const c of z1Commands(m, st)) engine.send(c);
        return true;
      }
      if (LPD8_PORT.test(port || '')) {
        lpd.timeline = !!isTimeline();
        lpd.eng = engine.state();
        for (const c of lpd8Commands(m, lpd)) engine.send(c);
        return true;
      }
      return false;
    },
    stop() { clearInterval(leds); try { out?.close(); } catch { /* niente */ } },
  };
}

module.exports = { z1Commands, z1Leds, meterLed, lpd8Commands, startAudioMidi };
