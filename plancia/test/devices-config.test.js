'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const d = require('../devices-config');

test('ruolo: scelto, altrimenti dal nome', () => {
  assert.strictEqual(d.roleOf('Traktor Kontrol Z1 MIDI', {}), 'z1');
  assert.strictEqual(d.roleOf('LPD8 mk2', {}), 'lpd8');
  assert.strictEqual(d.roleOf('APC40 mkII', {}), 'generic');
  assert.strictEqual(d.roleOf('APC40 mkII', { midi: { roles: { 'APC40 mkII': 'off' } } }), 'off');
  assert.strictEqual(d.roleOf('X', { midi: { roles: { X: 'boh' } } }), 'generic');
});

test('uscita MIDI: mai GS, mai Z1/LPD8 in automatico; scelta o nessuna', () => {
  const outs = ['Microsoft GS Wavetable Synth', 'LPD8 mk2', 'Traktor Kontrol Z1 MIDI', 'loopMIDI Port'];
  assert.strictEqual(d.pickOut(outs, {}), 'loopMIDI Port');
  assert.strictEqual(d.pickOut(outs.slice(0, 3), {}), null);
  assert.strictEqual(d.pickOut(outs, { midi: { out: 'LPD8 mk2' } }), 'LPD8 mk2');
  assert.strictEqual(d.pickOut(outs, { midi: { out: 'none' } }), null);
  assert.strictEqual(d.pickOut(outs, { midi: { out: 'Staccata' } }), null);
});

test('salvataggio: solo ruoli diversi dall automatico', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-cfg-')), 'devices.json');
  d.save(f, { midi: { roles: { 'LPD8 mk2': 'lpd8', 'APC40': 'off', bad: 'x' }, out: 'loopMIDI Port' } });
  assert.deepStrictEqual(d.load(f), { midi: { roles: { APC40: 'off' }, out: 'loopMIDI Port' } });
  assert.deepStrictEqual(d.load(f + '.manca'), { midi: { roles: {}, out: '' } });
});
