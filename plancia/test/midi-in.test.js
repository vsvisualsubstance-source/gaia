'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalize, matches, midiActions } = require('../midi-in');

const W = (type, extra) => ({ id: type + (extra.id || ''), type, x: 0, y: 0, w: 2, h: 2, addr: '/x/' + type, min: 0, max: 1, value: 0, ...extra });
const layout = (widgets, midiActionsMap) => ({ pages: [{ name: 'P', widgets }], midiActions: midiActionsMap });

test('normalize: CC, note on/off, velocity 0 = note off, channels 1..16', () => {
  assert.deepEqual(normalize('cc', { channel: 1, controller: 7, value: 100 }), { kind: 'cc', ch: 2, n: 7, v: 100, on: true });
  assert.deepEqual(normalize('noteon', { channel: 9, note: 36, velocity: 90 }), { kind: 'note', ch: 10, n: 36, v: 90, on: true });
  assert.equal(normalize('noteon', { channel: 0, note: 36, velocity: 0 }).on, false);
  assert.equal(normalize('noteoff', { channel: 0, note: 36, velocity: 64 }).on, false);
  assert.equal(normalize('program', { number: 3 }), null);
});

test('matches: channel and CC or note; CC "" means not mapped', () => {
  const cc = normalize('cc', { channel: 0, controller: 7, value: 1 });
  assert.equal(matches({ ch: 1, cc: 7 }, cc), true);
  assert.equal(matches({ ch: 2, cc: 7 }, cc), false);
  assert.equal(matches({ ch: 1, cc: '' }, cc), false);
  assert.equal(matches({ cc: 7 }, cc), true);   // canale assente = 1
  assert.equal(matches({ ch: 1, cc: '', note: 7 }, cc), false);
  assert.equal(matches({ ch: 1, cc: '', note: 36 }, normalize('noteon', { channel: 0, note: 36, velocity: 1 })), true);
});

test('fader and knob: CC 0..127 scaled into min..max, on the widget OSC channel', () => {
  const L = layout([W('fader', { min: 0, max: 255, midi: { ch: 1, cc: 7 }, oscChannel: 'dmx' }), W('knob', { min: -1, max: 1, midi: { ch: 1, cc: 8 } })]);
  const st = {};
  assert.deepEqual(midiActions(normalize('cc', { channel: 0, controller: 7, value: 127 }), L, st).osc, [{ address: '/x/fader', args: [255], channel: 'dmx' }]);
  assert.deepEqual(midiActions(normalize('cc', { channel: 0, controller: 8, value: 0 }), L, st).osc, [{ address: '/x/knob', args: [-1], channel: 'default' }]);
  // una nota non muove un fader
  assert.deepEqual(midiActions(normalize('noteon', { channel: 0, note: 7, velocity: 100 }), layout([W('fader', { midi: { ch: 1, cc: '', note: 7 } })]), {}).osc, []);
});

test('buttons: momentary follows press/release, toggle flips on each press only', () => {
  const st = {};
  const push = layout([W('button', { min: 0, max: 1, midi: { ch: 10, cc: '', note: 36 } })]);
  const on = normalize('noteon', { channel: 9, note: 36, velocity: 100 }), off = normalize('noteoff', { channel: 9, note: 36, velocity: 0 });
  assert.deepEqual(midiActions(on, push, st).osc[0].args, [1]);
  assert.deepEqual(midiActions(on, push, st).osc, []);          // stessa pressione ripetuta
  assert.deepEqual(midiActions(off, push, st).osc[0].args, [0]);

  const st2 = {};
  const tog = layout([W('button', { mode: 'toggle', min: 0, max: 255, value: 0, midi: { ch: 1, cc: 20 } })]);
  const press = normalize('cc', { channel: 0, controller: 20, value: 127 }), release = normalize('cc', { channel: 0, controller: 20, value: 0 });
  assert.deepEqual(midiActions(press, tog, st2).osc[0].args, [255]);
  assert.deepEqual(midiActions(release, tog, st2).osc, []);
  assert.deepEqual(midiActions(press, tog, st2).osc[0].args, [0]);
});

test('PANIC: lights blackout over OSC + laser blackout over MQTT, once per press; GO/BACK on the show clock', () => {
  const L = layout([], { panic: { ch: 1, cc: '', note: 60 }, go: { ch: 1, cc: 64 }, back: { ch: 1, cc: 65 } });
  const st = {};
  const p = midiActions(normalize('noteon', { channel: 0, note: 60, velocity: 127 }), L, st, { laserId: 'laser-x' });
  assert.deepEqual(p.osc, [{ address: '/dmx/blackout', args: [1], channel: 'default' }]);
  assert.deepEqual(p.mqtt, [{ topic: 'gaia/device/laser-x/command', payload: { action: 'blackout' } }]);
  assert.deepEqual(midiActions(normalize('noteon', { channel: 0, note: 60, velocity: 127 }), L, st).osc, []);   // tenuto premuto
  midiActions(normalize('noteoff', { channel: 0, note: 60, velocity: 0 }), L, st);
  assert.equal(midiActions(normalize('noteon', { channel: 0, note: 60, velocity: 127 }), L, st).osc.length, 1);  // di nuovo
  assert.deepEqual(midiActions(normalize('cc', { channel: 0, controller: 64, value: 127 }), L, st).mqtt, [{ topic: 'gaia/show/clock/command', payload: { action: 'go' } }]);
  assert.deepEqual(midiActions(normalize('cc', { channel: 0, controller: 65, value: 127 }), L, st).mqtt, [{ topic: 'gaia/show/clock/command', payload: { action: 'back' } }]);
});

test('no layout or unmapped message: nothing happens', () => {
  assert.deepEqual(midiActions(normalize('cc', { channel: 0, controller: 1, value: 1 }), null, {}), { osc: [], mqtt: [], hits: [] });
  assert.deepEqual(midiActions(normalize('cc', { channel: 0, controller: 1, value: 1 }), layout([W('fader', {})]), {}).osc, []);
});
