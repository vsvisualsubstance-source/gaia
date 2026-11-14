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
//     1° ▶/❚❚, 2° CUE (stile CDJ, tenuto = preascolto), 3° FINE −1 ms, 4° FINE +1 ms
//     (14/11: al posto di SYNC e STOP, che restano in Plancia). FINE = fase del deck
//     spostata di poco, come col piatto: la velocita' non cambia e il SYNC la tiene;
//     tenuto continua (dopo 0,45 s, ogni 90 ms). Fino a ±50 ms.
//   pad modo CC (canale 10, CC 16-19 sopra, 12-15 sotto; valore = forza, 0 = rilascio):
//     hot cue 1-4 del deck (vuoto = salva, pieno = salta)
//   manopole K1-K8 (canale 1, CC 70-77): K1 tempo A, K3 tempo B, K5 volume cuffia,
//     K6 master; K2 K4 K7 K8 libere (14/11). Prima K2/K4 erano un nudge assoluto:
//     lasciata fuori centro, la manopola teneva il deck spinto (anche del 2%) e
//     sospendeva l'aggancio -> il mix perdeva il tempo. Mai piu' nudge da manopola.
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
      case 1: case 2: { // cuffia A / B
        // La Z1 ha questi tasti a INTERRUTTORE: a ogni pressione manda il suo stato nuovo
        // (127 acceso, 0 spento), niente al rilascio (visto nel registro diag il 14/11).
        // Prima lo 0 si scartava come "rilascio" e il 127 invertiva: pressioni perse,
        // doppio tocco e LED sfasato. Ora il valore e' lo stato voluto; il LED si
        // riallinea dopo ogni pressione (startAudioMidi), cosi' Z1 e motore restano pari.
        const k = m.n === 1 ? 'A' : 'B';
        return [{ cmd: 'mix.set', ch: k, values: { cue: m.v >= 64 } }];
      }
      case 5: return st.timeline ? [] : [{ cmd: 'mix.set', values: { xfader: round(bipolar(m.v)) } }];
    }
  }
  return [];
}

const LPD8_PORT = /lpd8/i;
const LPD_ROWS = { 40: ['A', 0], 41: ['A', 1], 42: ['A', 2], 43: ['A', 3], 36: ['B', 0], 37: ['B', 1], 38: ['B', 2], 39: ['B', 3] };
const LPD_CC_PADS = { 16: ['A', 0], 17: ['A', 1], 18: ['A', 2], 19: ['A', 3], 12: ['B', 0], 13: ['B', 1], 14: ['B', 2], 15: ['B', 3] };

// FINE: sposta la fase fine del deck di `step` ms. Si parte dal valore del motore, salvo un passo
// appena fatto (lo stato del motore puo' essere di prima: col pad tenuto si perderebbero passi).
function lpdTrimStep(deck, step, st) {
  st.trim = st.trim || {};
  const now = st.now ?? Date.now(), mine = st.trim[deck];
  const cur = mine && now - mine.at < 600 ? mine.ms : +st.eng?.decks?.[deck]?.trim_ms || 0;
  const ms = Math.max(-50, Math.min(50, Math.round((cur + step) * 100) / 100));
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
    if (!down && st.hold?.key === key) st.hold = null;   // sempre, anche con la timeline
    if (st.timeline) return [];
    const [mode, deck, i] = pad;
    if (down === was) return [];      // forza che cambia mentre il pad e' tenuto
    if (mode === 'c') return down ? [{ cmd: 'deck.hotcue', deck, n: i, op: 'go' }] : [];
    if (i === 1) return [{ cmd: down ? 'deck.cue_down' : 'deck.cue_up', deck }];
    // FINE −/+: st.hold = pad tenuto, per la ripetizione (startAudioMidi)
    if (i >= 2) {
      const step = i === 2 ? -1 : 1;
      if (!down) return [];
      st.hold = { key, deck, step };
      return lpdTrimStep(deck, step, st);
    }
    if (!down) return [];
    return [{ cmd: 'deck.play', deck }];
  }
  if (m.kind === 'cc' && m.ch === 1 && m.n >= 70 && m.n <= 77) {
    const k = m.n - 69, x = m.v / 127;
    switch (k) {
      case 1: case 3: return st.timeline ? [] : [{ cmd: 'deck.tempo', deck: k === 1 ? 'A' : 'B', value: round(bipolar(m.v)) }];
      case 5: return [{ cmd: 'mix.set', values: { cue_level: round(x) } }];
      case 6: return [{ cmd: 'mix.set', values: { master: round(x) } }];
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

function startAudioMidi({ engine, isTimeline = () => false, log = console.log, timed = (w, f) => f() }) {
  const st = { fx: { A: true, B: true }, filter: { A: 0, B: 0 }, cue: { A: false, B: false }, timeline: false };
  const lpd = { timeline: false, eng: null, pads: {} };
  let holdT = null;   // ripetizione del pad FINE tenuto
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
    if (!timed('MIDI apertura uscita Z1', openOut)) return;
    const want = z1Leds(s, st);
    try {
      for (const [k, v] of Object.entries(want)) {
        if (sent[k] === v) continue;
        const [ch, cc] = k.split(':').map(Number);
        timed('MIDI LED Z1', () => out.send('cc', { controller: cc, value: v, channel: ch - 1 }));
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
        // tasto cuffia: la Z1 ha gia' cambiato il suo LED da sola; si rimanda lo stato vero
        // del motore al prossimo giro dei LED (anche se per noi "non e' cambiato")
        if (m.kind === 'cc' && m.ch === 3 && (m.n === 1 || m.n === 2)) delete sent[`3:${m.n}`];
        return true;
      }
      if (LPD8_PORT.test(port || '')) {
        lpd.timeline = !!isTimeline();
        lpd.eng = engine.state();
        const was = lpd.hold;
        for (const c of lpd8Commands(m, lpd)) engine.send(c);
        // pad FINE tenuto: ripete dopo 0,45 s ogni 90 ms, finche' non si rilascia
        if (lpd.hold !== was) {
          clearTimeout(holdT); clearInterval(holdT); holdT = null;
          const h = lpd.hold;
          if (h) holdT = setTimeout(() => { holdT = setInterval(() => {
            if (lpd.hold !== h || isTimeline()) { clearInterval(holdT); return; }
            lpd.eng = engine.state();
            for (const c of lpdTrimStep(h.deck, h.step, lpd)) engine.send(c);
          }, 90); }, 450);
        }
        return true;
      }
      return false;
    },
    stop() { clearInterval(leds); clearTimeout(holdT); clearInterval(holdT); try { out?.close(); } catch { /* niente */ } },
  };
}

module.exports = { z1Commands, z1Leds, meterLed, lpd8Commands, startAudioMidi };
