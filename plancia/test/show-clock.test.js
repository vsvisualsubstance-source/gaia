'use strict';
// Orologio dello show nei follower del bridge (docs/show-clock.md): stato vivo, volano, retained vecchio.
const test = require('node:test');
const assert = require('node:assert');
const { clockReceive, clockAlive, clockUsable, clockPosition, CLOCK_FLYWHEEL_MS } = require('../video-timeline');

test('il primo stato (anche retained) non e\' vivo: vale solo 5 s', () => {
  const c = clockReceive(null, { master: 'ops-audio', seq: 7, pos: 100, playing: true }, 1000);
  assert.equal(c.live, false);
  assert.ok(clockUsable(c, 5900));
  assert.ok(!clockUsable(c, 6100), 'retained di ore fa: non guida lo show oltre i 5 s');
});

test('due seq dallo stesso master: vivo, il volano continua a contare se tace', () => {
  let c = clockReceive(null, { master: 'ops-audio', seq: 7, pos: 100, playing: true, rate: 1 }, 0);
  c = clockReceive(c, { master: 'ops-audio', seq: 8, pos: 101, playing: true, rate: 1 }, 1000);
  assert.equal(c.live, true);
  const now = 1000 + 60000;   // un minuto di silenzio
  assert.ok(!clockAlive(c, now));
  assert.ok(clockUsable(c, now));
  assert.equal(clockPosition(c, now), 161);
  assert.ok(!clockUsable(c, 1000 + CLOCK_FLYWHEEL_MS + 1));
  // resta vivo con gli stati seguenti
  c = clockReceive(c, { master: 'ops-audio', seq: 9, pos: 102, playing: true }, 2000);
  assert.equal(c.live, true);
});

test('cambio di master: si riparte da non vivo', () => {
  let c = clockReceive(null, { master: 'ops-audio', seq: 1, pos: 0, playing: true }, 0);
  c = clockReceive(c, { master: 'ops-audio', seq: 2, pos: 1, playing: true }, 1000);
  c = clockReceive(c, { master: 'td-dmx-ops', seq: 50, pos: 4, playing: true }, 4000);
  assert.equal(c.live, false);
  c = clockReceive(c, { master: 'td-dmx-ops', seq: 50, pos: 4, playing: true }, 4100);
  assert.equal(c.live, false, 'stesso seq ripetuto (retained ridato) non conta');
});
