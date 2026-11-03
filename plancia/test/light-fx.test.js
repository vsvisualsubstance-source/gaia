'use strict';
// Anteprima degli effetti luci (src/63-light-fx.js) con le formule della nota TD 59.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fxWave, fxSample, fxPeriod, fxTemplates } = require('../src/63-light-fx');

test('shapes follow the TD formulas', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(fxWave({ shape: 'sine' }, 0), 0); near(fxWave({ shape: 'sine' }, 0.5), 1);
  near(fxWave({ shape: 'triangle' }, 0.25), 0.5); near(fxWave({ shape: 'saw' }, 0.3), 0.3);
  assert.equal(fxWave({ shape: 'square' }, 0.4), 1); assert.equal(fxWave({ shape: 'square', duty: 0.2 }, 0.4), 0);
  near(fxWave({ shape: 'pulse' }, 0.125), 0.5); assert.equal(fxWave({ shape: 'pulse' }, 0.5), 0);
  assert.equal(fxWave({ channel: 'strobe' }, 0.1), 1);                 // strobo: quadra di default
  const r = fxWave({ shape: 'random' }, 0.3, 2, 7);
  assert.equal(fxWave({ shape: 'random' }, 0.9, 2, 7), r);               // stesso valore per tutto il ciclo
});

test('phase spreads lights, mirror counts from the centre, min/max scale', () => {
  const fx = { shape: 'saw', period: { value: 2, unit: 's' }, spread: { phase: 0.25 }, min: 0.2, max: 0.6 };
  assert.deepEqual(fxSample(fx, 0, 4).map(v => +v.w.toFixed(3)), [0.2, 0.3, 0.4, 0.5]);
  const m = fxSample({ ...fx, spread: { phase: 0.25, mirror: true } }, 0, 4).map(v => v.w);
  assert.equal(m[0], m[3]); assert.equal(m[1], m[2]);
  assert.equal(fxPeriod({ period: { value: 4, unit: 'beats' } }, 120), 2);
});

test('colour: saw cycles through all colours, other shapes blend first to last', () => {
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const saw = { channel: 'color', shape: 'saw', period: { value: 3, unit: 's' }, colors: cols };
  assert.deepEqual(fxSample(saw, 1, 1)[0].rgb, [0, 1, 0]);
  const tri = { channel: 'color', shape: 'triangle', period: { value: 2, unit: 's' }, colors: cols };
  assert.deepEqual(fxSample(tri, 1, 1)[0].rgb, [0, 0, 1]);              // w = 1: l'ultimo colore
  assert.equal(fxTemplates('back').every(f => f.target.group === 'back'), true);
});
