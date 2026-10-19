'use strict';

const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const {
  DMX_OUTPUT,
  dmxOutputApplySnapshot,
  dmxOutputApplySource,
  dmxOutputApplyOsc,
  dmxOutputFresh,
  dmxOutputForFixture,
  dmxOutputSummary
} = require('../src/49-dmx-output');

beforeEach(() => {
  Object.assign(DMX_OUTPUT, {
    source: 'unknown', sourceAt: 0, lastAt: 0, deviceId: null, seq: null,
    master: null, blackout: null, strobe: null, scene: null, fixtures: new Map()
  });
});

test('MQTT output snapshot maps actual fixture state and expires after missed heartbeats', () => {
  const receivedAt = 10000;
  assert.equal(dmxOutputApplySnapshot({
    v: 1, device_id: 'td-dmx-win', seq: 12, master: 0.75, blackout: false, strobe: true,
    scene: { index: 2 },
    fixtures: [{ uid: 'p-head-1', id: 7, sent: true, intensity: 0.6, rgb_out: [0.4, 0.2, 0.1], pan: 45, tilt: -12 }]
  }, 'topic-device', receivedAt), true);

  const record = dmxOutputForFixture({ id: 'p-head-1' });
  assert.equal(DMX_OUTPUT.source, 'mqtt');
  assert.equal(DMX_OUTPUT.deviceId, 'td-dmx-win');
  assert.equal(DMX_OUTPUT.seq, 12);
  assert.equal(DMX_OUTPUT.master, 0.75);
  assert.deepEqual(record.rgbOut, [0.4, 0.2, 0.1]);
  assert.equal(record.pan, 45);
  assert.equal(dmxOutputFresh(receivedAt + 6000), true);
  assert.equal(dmxOutputFresh(receivedAt + 6001), false);
});

test('MQTT snapshot accepts a numeric active-scene value', () => {
  assert.equal(dmxOutputApplySnapshot({ v: 1, scene: 3, fixtures: [] }, 'td-dmx-win', 15000), true);
  assert.equal(DMX_OUTPUT.scene, 3);
});

test('invalid MQTT snapshots are rejected without replacing the current state', () => {
  const original = DMX_OUTPUT.fixtures;
  assert.equal(dmxOutputApplySnapshot({ v: 2, fixtures: [] }, 'td-dmx-win', 20000), false);
  assert.equal(dmxOutputApplySnapshot({ v: 1, fixtures: {} }, 'td-dmx-win', 20000), false);
  assert.equal(DMX_OUTPUT.fixtures, original);
});

test('OSC fallback updates source, fixture values, head parameters and identity aliases', () => {
  assert.equal(dmxOutputApplySource(['osc'], 30000), true);
  assert.equal(dmxOutputApplyOsc('/dmx/fixture/p-head-2', [1, 0.8, 0.6, 0.3, 0.1], 30001), true);
  assert.equal(dmxOutputApplyOsc('/dmx/fixture/p-head-2/head', [90, -20, 3, 2, 255], 30002), true);
  const record = dmxOutputForFixture({ uid: 'p-head-2', id: 8 });
  assert.equal(DMX_OUTPUT.source, 'osc');
  assert.deepEqual(record.rgbOut, [0.6, 0.3, 0.1]);
  assert.equal(record.intensity, 0.8);
  assert.equal(record.pan, 90);
  assert.equal(record.gobo, 3);
  assert.equal(dmxOutputFresh(42002), true);
  assert.equal(dmxOutputFresh(42003), false);
  assert.match(dmxOutputSummary(30002), /OSC · 1\/1 fixture inviate/);
});

test('OSC sentinel values represent absent channels instead of zero', () => {
  assert.equal(dmxOutputApplyOsc('/dmx/fixture/id19', [0, -1, -1, -1, -1], 50000), true);
  const record = dmxOutputForFixture({ id: 19 });
  assert.equal(record.sent, false);
  assert.equal(record.intensity, null);
  assert.equal(record.rgbOut, null);
});
