'use strict';
// Controller MIDI della Plancia (17/11): cosa fa ogni porta in ingresso e quale porta MIDI usa
// in uscita. Prima era tutto per nome (Z1, LPD8) e la prima uscita libera (al riavvio con la Z1
// staccata era finita sull'LPD8). Scelte salvate in data/devices.json accanto a state.json.
//   ruolo di una porta in ingresso:
//     z1      Console Audio, Traktor Kontrol Z1 (deck, mixer, LED)
//     lpd8    Console Audio, Akai LPD8 (hot cue, play, CUE, FINE)
//     generic Impara MIDI: widget e azioni PANIC/GO/BACK del layout
//     off     non si apre
//   Z1 e LPD8 valgono anche per Impara MIDI, come prima.
// Le schede audio non stanno qui: le sceglie e le ricorda il motore (out.set, <cache>/devices.json).

const fs = require('fs');
const path = require('path');

const ROLES = {
  generic: 'Impara MIDI (widget, PANIC/GO/BACK)',
  z1: 'Console Audio · Traktor Kontrol Z1',
  lpd8: 'Console Audio · Akai LPD8',
  off: 'Spento (non si apre)',
};

function autoRole(name) {
  if (/kontrol z1/i.test(name)) return 'z1';
  if (/lpd8/i.test(name)) return 'lpd8';
  return 'generic';
}

function roleOf(name, cfg) {
  const r = cfg?.midi?.roles?.[name];
  return ROLES[r] ? r : autoRole(name);
}

// porta MIDI in uscita: quella scelta, se c'e'; altrimenti la prima che non e' il sintetizzatore
// di Windows (suonerebbe dagli altoparlanti) ne' un controller della Console o una porta spenta
function pickOut(outputs, cfg) {
  const want = cfg?.midi?.out;
  if (want === 'none') return null;
  if (want) return outputs.includes(want) ? want : null;
  return outputs.find(n => !/GS Wavetable/i.test(n) && roleOf(n, cfg) === 'generic') || null;
}

function clean(cfg) {
  const roles = {};
  for (const [k, v] of Object.entries(cfg?.midi?.roles || {})) if (typeof k === 'string' && k && ROLES[v] && v !== autoRole(k)) roles[k] = v;
  const out = typeof cfg?.midi?.out === 'string' ? cfg.midi.out : '';
  return { midi: { roles, out } };
}

function load(file) {
  try { return clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return clean({}); }
}

function save(file, cfg) {
  const c = clean(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(c, null, 2));
  fs.renameSync(file + '.tmp', file);
  return c;
}

module.exports = { ROLES, autoRole, roleOf, pickOut, clean, load, save };
