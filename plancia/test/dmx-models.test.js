'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { dmxHexToRgb, parseModelRoles, cleanModelSlots } = require('../src/64-dmx-models');

test('hex colour to 0-1 rgb, as TD wants beam and slot colours', () => {
  assert.deepEqual(dmxHexToRgb('#ffd8a0'), [1, 0.847, 0.627]);
  assert.deepEqual(dmxHexToRgb('ff0000'), [1, 0, 0]);
  assert.equal(dmxHexToRgb('rosso'), null);
});

test('channel roles: spaces or commas, lowercase, validated', () => {
  assert.deepEqual(parseModelRoles('Pan, tilt  dimmer').roles, ['pan', 'tilt', 'dimmer']);
  assert.equal(parseModelRoles('pan tilt').error, '');
  assert.notEqual(parseModelRoles('').error, '');
  assert.match(parseModelRoles('pan 2tilt').error, /2tilt/);
});

test('wheel slots: names, DMX values 0-255, colours, sorted, duplicates refused', () => {
  const r = cleanModelSlots([
    { name: 'Red', value: '16', hex: '#ff0000' }, { name: 'Light blue', value: '96', hex: '#73bfff' },
    { name: 'White', value: '0', hex: '#ffffff' }, { name: '', value: '' }], true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.slots.map(s => [s.name, s.value]), [['White', 0], ['Red', 16], ['Light_blue', 96]]);
  assert.deepEqual(r.slots[1].rgb, [1, 0, 0]);
  assert.equal(cleanModelSlots([{ name: 'A', value: '300' }], false).errors.length, 1);
  assert.equal(cleanModelSlots([{ name: '', value: '5' }], false).errors.length, 1);
  assert.equal(cleanModelSlots([{ name: 'A', value: '5' }, { name: 'B', value: '5' }], false).errors.length, 1);
  assert.equal(cleanModelSlots([{ name: 'Open', value: '0' }], false).slots[0].rgb, undefined); // gobo: niente colore
});
