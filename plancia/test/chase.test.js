'use strict';
// Chase a step (src/63-chase.js) e motore del bridge (chase-engine.js) con un
// catalogo finto e un invio OSC finto: niente arriva a DMX Master.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tapBpm, chaseExpand, chaseTimelineCues, isChaseCue } = require('../src/63-chase');
const { startChase } = require('../chase-engine');

const CH = { id: 'ch1', name: 'Rosso blu', steps: [{ scene: 'rosso' }, { scene: 'blu' }, { scene: 'verde', hold: { value: 2, unit: 'beats' } }],
  hold: { value: 4, unit: 'beats' }, fadePct: 50, pingpong: false };

test('TAP: average of steady taps, too few or too slow taps give nothing', () => {
  assert.equal(tapBpm([0, 500, 1000, 1500]), 120);
  assert.equal(tapBpm([0, 469, 938, 1407]), 128);
  assert.equal(tapBpm([0, 500]), null);
  assert.equal(tapBpm([0, 3000, 6000]), null);
});

test('steps follow hold and BPM, fade is a share of the step', () => {
  const s = chaseExpand(CH, 10, 30, 120);            // 4 battiti = 2 s, step 3 = 1 s
  assert.deepEqual(s.slice(0, 4).map(x => [x.time, x.scene, x.fade]), [[10, 'rosso', 1], [12, 'blu', 1], [14, 'verde', 0.5], [15, 'rosso', 1]]);
  assert.ok(s.every(x => x.time < 30));
  const pp = chaseExpand({ ...CH, pingpong: true, steps: CH.steps.map(x => ({ scene: x.scene })) }, 0, 10, 120);
  assert.deepEqual(pp.map(x => x.scene).slice(0, 5), ['rosso', 'blu', 'verde', 'blu', 'rosso']);
});

test('timeline: a chase cue becomes TD cues up to the next chase cue, marked ⟳', () => {
  const doc = { cues: [{ time: 0, chase: 'ch1' }, { time: 6, chase: 'off' }] };
  const out = chaseTimelineCues(doc, [CH], 60, 120);
  assert.deepEqual(out.map(c => c.time), [0, 2, 4, 5]);
  assert.ok(out.every(isChaseCue));
  assert.equal(out[0].label, '⟳ Rosso blu 1');
  assert.ok(!isChaseCue({ label: 'Intro' }));
});

test('engine: each step sends /dmx/fade then /dmx/scene with the catalog index, stop ends it', async () => {
  const sent = [];
  const eng = startChase({ sendOsc: (a, args) => sent.push([a, ...args]), broadcast: () => {}, log: () => {},
    catalog: [{ id: 'blu', index: 3 }, { id: 'rosso', index: 1 }, { id: 'verde', index: 2 }] });
  try {
    eng.play({ ...CH, hold: { value: 0.1, unit: 's' }, steps: CH.steps.map(x => ({ scene: x.scene })) }, 120);
    await new Promise(r => setTimeout(r, 250));
    const scenes = sent.filter(m => m[0] === '/dmx/scene').map(m => m[1]);
    assert.deepEqual(scenes.slice(0, 3), [1, 3, 2]);
    assert.deepEqual(sent[0], ['/dmx/fade', 0.05]);
    eng.stop();
    const n = sent.length;
    await new Promise(r => setTimeout(r, 150));
    assert.equal(sent.length, n);
    assert.equal(eng.status().chase, null);
  } finally { eng.close(); }
});
