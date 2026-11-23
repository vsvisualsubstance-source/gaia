'use strict';
// Brani gia' suonati nella sessione (23/11/2026): la libreria della Console Audio li segna.
// Un brano e' "suonato" quando e' rimasto in onda almeno PLAYED_S secondi: deck in play, fader del
// canale aperto e crossfader non tutto dall'altra parte. La sessione dura finche' non si tocca
// "Nuova sessione" (o dopo IDLE_H ore senza brani suonati). Salvata in data/audio-played.json:
// resta anche se il bridge si riavvia. Alle pagine: {type:'audio_played', state:{since, played:{id:ms}}}.

const fs = require('fs');
const path = require('path');

const PLAYED_S = 30, IDLE_H = 12;

// il deck si sente in uscita? (stato del motore: decks.X.playing, mix.X.fader 0..1, mix.xfader -1..1)
function onAir(s, d) {
  const dk = s?.decks?.[d], ch = s?.mix?.[d], xf = +s?.mix?.xfader || 0;
  if (!dk?.playing || !dk.track || !(+ch?.fader > 0.05)) return false;
  return d === 'A' ? xf < 0.95 : xf > -0.95;
}

function startAudioPlayed({ engine, broadcast, file, log = console.log, now = () => Date.now() }) {
  let st = { since: now(), played: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j.played === 'object') st = { since: +j.since || now(), played: j.played }; } catch { /* nuova */ }
  const acc = {};   // secondi in onda del brano nei deck, dall'ultimo caricamento
  let lastTick = now(), saveT = null;
  const send = () => broadcast({ type: 'audio_played', state: st });
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.promises.mkdir(path.dirname(file), { recursive: true }).then(() => fs.promises.writeFile(file, JSON.stringify(st))).catch(e => log('Brani suonati non salvati: ' + e.message)), 500); };
  function reset() { st = { since: now(), played: {} }; for (const k in acc) delete acc[k]; save(); send(); }
  // sessione vecchia (piu' di IDLE_H ore dall'ultimo brano): se ne apre una nuova
  const last = Math.max(st.since, ...Object.values(st.played).map(Number));
  if (now() - last > IDLE_H * 3600e3) { st = { since: now(), played: {} }; save(); }
  function tick() {
    const t = now(), dt = Math.min(5, (t - lastTick) / 1000); lastTick = t;
    const s = engine.state();
    if (!s) return;
    for (const d of ['A', 'B']) {
      const id = s.decks?.[d]?.track;
      if (!id) { delete acc[d]; continue; }
      if (acc[d]?.id !== id) acc[d] = { id, s: 0 };
      if (onAir(s, d)) acc[d].s += dt;
      if (acc[d].s >= PLAYED_S && !st.played[id]) { st.played[id] = t; save(); send(); }
    }
  }
  const timer = setInterval(tick, 1000);
  return { state: () => st, reset, tick, stop: () => clearInterval(timer) };
}

module.exports = { startAudioPlayed, onAir, PLAYED_S };
