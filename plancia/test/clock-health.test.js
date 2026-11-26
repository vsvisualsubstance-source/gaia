'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHealth, onState, onRtt, report, grade } = require('../clock-health');

const st = (seq, pos, playing = true, master = 'ops-audio') => ({ v: 1, master, prio: 2, seq, pos, playing, rate: 1 });

test('scarto: stati puntuali = 0, uno in ritardo di 30 ms = 30', () => {
  const h = makeHealth();
  onState(h, st(1, 10), 1000);
  onState(h, st(2, 11), 2000);
  onState(h, st(3, 12), 3030);   // arriva 30 ms tardi: il follower aveva contato 12,03
  const r = report(h, 3040);
  assert.equal(r.n, 2);
  assert.equal(r.err_max_ms, 30);
  assert.equal(r.err_ms, 15);
  assert.equal(r.gap_max_ms, 1030);
});

test('seek e pausa non contano come scarto', () => {
  const h = makeHealth();
  onState(h, st(1, 10), 1000);
  onState(h, st(2, 200), 2000);           // seek
  onState(h, st(3, 201, false), 3000);    // pausa
  onState(h, st(4, 201, true), 4000);
  assert.equal(report(h, 4000).n, 0);
});

test('ritardo e giudizio', () => {
  const h = makeHealth();
  for (const r of [300, 200, 100, 12, 10, 11, 14, 10]) onRtt(h, r);   // i primi 3 non contano
  onState(h, st(1, 10), 1000); onState(h, st(2, 11), 2000);
  const r = report(h, 2100);
  assert.equal(r.rtt_min_ms, 10);
  assert.equal(r.jitter_ms, 4);
  assert.equal(grade(r), 'ok');
  assert.equal(grade(report(h, 8000)), 'bad');   // nessuno stato da 6 s
  onState(h, st(3, 12), 3060);
  assert.equal(grade(report(h, 3100)), 'warn');  // un salto di 60 ms: medio 30
});
