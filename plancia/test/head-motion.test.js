'use strict';
// Scene di movimento delle teste (src/63-head-motion.js) e motore del bridge
// (head-motion-engine.js) con un invio OSC finto: nessuna testa vera si muove.
const test = require('node:test');
const assert = require('node:assert/strict');
const { hmPoint, hmTemplates, hmPathAt } = require('../src/63-head-motion');
const { headMotionAt, startHeadMotion } = require('../head-motion-engine');

const tpl = id => hmTemplates().find(s => s.id === id);

test('a circle takes one period per turn, beats follow the BPM', () => {
  const c = tpl('hm-cerchio');                       // 8 battiti a 120 BPM = 4 s
  assert.deepEqual(hmPoint(c, 0), [0.35, 0]);
  assert.deepEqual(hmPoint(c, 1), [0, 0.25]);
  assert.deepEqual(hmPoint(c, 2), [-0.35, 0]);
  assert.deepEqual(hmPoint(c, 4), hmPoint(c, 0));
  assert.deepEqual(hmPoint(c, 2, 0, 60), [0, 0.25]); // a 60 BPM il giro dura 8 s
});

test('ping-pong goes back and forth, mirror and phase spread heads', () => {
  const s = tpl('hm-scanner');
  assert.deepEqual([0, 1, 2, 3, 4].map(t => hmPoint(s, t)[0] + 0), [-0.45, 0, 0.45, 0, -0.45]);
  const fan = tpl('hm-apri');
  assert.equal(hmPoint(fan, 1, 1)[0], -hmPoint(fan, 1, 0)[0]);
  const wave = tpl('hm-onda-cerchi');
  assert.notDeepEqual(hmPoint(wave, 0, 0), hmPoint(wave, 0, 1));
});

test('path is walked at constant speed and points stay in the pad', () => {
  const sq = { pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]], closed: true };
  assert.deepEqual(hmPathAt(sq, 0.25), [1, -1]);
  assert.deepEqual(hmPathAt(sq, 0.5), [1, 1]);
  const big = { ...tpl('hm-cerchio'), center: [0.9, 0.9], size: [1, 1] };
  for (let t = 0; t < 4; t += 0.1) for (const v of hmPoint(big, t)) assert.ok(v >= -1 && v <= 1);
});

test('timeline: last cue up to t wins, off stops', () => {
  const cues = [{ time: 10, scene: 'b' }, { time: 0, scene: 'a' }, { time: 20, scene: 'off' }];
  assert.deepEqual(headMotionAt(cues, -1), { cue: -1, scene: null });
  assert.deepEqual(headMotionAt(cues, 5), { cue: 1, scene: 'a' });
  assert.deepEqual(headMotionAt(cues, 12), { cue: 0, scene: 'b' });
  assert.deepEqual(headMotionAt(cues, 25), { cue: 2, scene: null });
});

test('engine: live play selects all heads and streams /mh/pantilt, stop ends it', async () => {
  const sent = [], states = [];
  const eng = startHeadMotion({ getDoc: () => null, getScenes: () => [], broadcast: m => { if (m.type === 'head_motion') states.push(m.state); },
    sendOsc: (a, args) => sent.push([a, ...args]), url: 'mqtt://127.0.0.1:9', rate: 50, log: () => {} });
  try {
    eng.play(tpl('hm-cerchio'), 120);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(sent[0][0], '/mh/select/all');
    const pt = sent.filter(m => m[0] === '/mh/pantilt');
    assert.ok(pt.length >= 5, `${pt.length} /mh/pantilt`);
    assert.equal(states.at(-1).source, 'live');
    eng.stop();
    await new Promise(r => setTimeout(r, 100));
    const n = sent.length;
    await new Promise(r => setTimeout(r, 150));
    assert.equal(sent.length, n);
    assert.equal(eng.status().source, 'off');
  } finally { eng.close(); }
});
