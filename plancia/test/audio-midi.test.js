'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { z1Commands, z1Leds, meterLed } = require('../audio-midi');

const fresh = () => ({ fx: { A: true, B: true }, filter: { A: 0, B: 0 }, cue: { A: false, B: false }, timeline: false });
const cc = (ch, n, v) => ({ kind: 'cc', ch, n, v, on: v >= 64 });

test('Z1: manopole dei canali con il centro esatto', () => {
  const st = fresh();
  assert.deepEqual(z1Commands(cc(1, 0, 64), st), [{ cmd: 'mix.set', ch: 'A', values: { gain: 1 } }]);
  assert.deepEqual(z1Commands(cc(2, 0, 127), st)[0].values, { gain: 2 });
  assert.deepEqual(z1Commands(cc(1, 3, 0), st)[0].values, { lo: -1 });
  assert.deepEqual(z1Commands(cc(2, 1, 64), st)[0].values, { hi: 0 });
  assert.deepEqual(z1Commands(cc(1, 6, 127), st), [{ cmd: 'mix.set', ch: 'A', values: { fader: 1 } }]);
});

test('Z1: FX accende e spegne il filtro, ricordando la manopola', () => {
  const st = fresh();
  assert.equal(z1Commands(cc(1, 4, 0), st)[0].values.filter, -1);
  assert.deepEqual(z1Commands(cc(1, 5, 127), st)[0].values, { filter: 0 }, 'FX spento: filtro neutro');
  assert.deepEqual(z1Commands(cc(1, 5, 0), st), [], 'rilascio: niente');
  assert.deepEqual(z1Commands(cc(1, 4, 20), st), [], 'manopola con FX spento: ricordata, non mandata');
  assert.ok(Math.abs(z1Commands(cc(1, 5, 127), st)[0].values.filter - (20 - 64) / 64) < 1e-3, 'FX acceso: torna la manopola');
});

test('Z1: centro (cuffia, cue mix, crossfader) e timeline', () => {
  const st = fresh();
  st.cue.B = true;
  assert.deepEqual(z1Commands(cc(3, 2, 127), st), [{ cmd: 'mix.set', ch: 'B', values: { cue: false } }]);
  assert.deepEqual(z1Commands(cc(3, 1, 127), st), [{ cmd: 'mix.set', ch: 'A', values: { cue: true } }]);
  assert.deepEqual(z1Commands(cc(3, 0, 127), st)[0].values, { cue_mix: 1 });
  assert.deepEqual(z1Commands(cc(3, 5, 0), st)[0].values, { xfader: -1 });
  st.timeline = true;
  assert.deepEqual(z1Commands(cc(3, 5, 127), st), [], 'timeline: crossfader della Z1 ignorato');
  assert.deepEqual(z1Commands(cc(2, 6, 100), st), [], 'timeline: fader ignorato');
  assert.equal(z1Commands(cc(2, 2, 0), st).length, 1, 'timeline: EQ a mano');
  assert.deepEqual(z1Commands({ kind: 'note', ch: 1, n: 0, v: 127 }, st), []);
});

test('Z1: LED dallo stato del motore', () => {
  const st = fresh();
  st.fx.B = false;
  const l = z1Leds({ mix: { A: { cue: true, meter: 1 }, B: { cue: false, meter: 0 } } }, st);
  assert.deepEqual(l, { '1:5': 127, '2:5': 0, '3:1': 127, '3:2': 0, '3:3': 127, '3:4': 0 });
  assert.equal(meterLed(10 ** (-18 / 20)), 64, '-18 dB a meta\'');
});
