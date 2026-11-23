'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startAudioPlayed, onAir } = require('../audio-played');

test('in onda: play, fader aperto, crossfader dalla sua parte', () => {
  const s = { decks: { A: { playing: true, track: 'a' }, B: { playing: true, track: 'b' } }, mix: { A: { fader: 1 }, B: { fader: 0 }, xfader: 0 } };
  assert.equal(onAir(s, 'A'), true);
  assert.equal(onAir(s, 'B'), false);
  s.mix.xfader = 1;
  assert.equal(onAir(s, 'A'), false);
});

test('suonato dopo 30 s in onda; nuova sessione azzera', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'played-')), 'p.json');
  let t = 1e12, st = null;
  const p = startAudioPlayed({ engine: { state: () => st }, broadcast: () => {}, file, now: () => t, log: () => {} });
  p.stop();
  st = { decks: { A: { playing: true, track: 'x1' }, B: { playing: true, track: 'x2' } }, mix: { A: { fader: 1 }, B: { fader: 0 }, xfader: 0 } };
  for (let i = 0; i < 29; i++) { t += 1000; p.tick(); }
  assert.equal(p.state().played.x1, undefined);
  t += 1000; p.tick(); t += 1000; p.tick();
  assert.ok(p.state().played.x1);
  assert.equal(p.state().played.x2, undefined);
  p.reset();
  assert.deepEqual(p.state().played, {});
});
