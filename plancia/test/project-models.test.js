'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { modelPayload, modelSig, projectModelNames, projectModelDiff } = require('../src/69-project-models');

const SPOT = {
  model: 'Coemar iSpot 575 EB 22ch', kind: 'heads', channels: ['pan', 'tilt', 'dimmer', 'color'], footprint: 4,
  colors: [{ name: 'white', value: 0, rgb: [1, 1, 1] }, { name: 'orange', value: 8, rgb: [1, 0.502, 0] }],
  gobos: [], pan_range: 540, tilt_range: 270, notes: 'DDF #100',
};

test('payload keeps only the fields DMX Master accepts', () => {
  const v = modelPayload({ ...SPOT, source: 'plancia', complete: true, color_mix: ['wheel'], defaults: '' });
  assert.deepEqual(Object.keys(v), ['model', 'kind', 'channels', 'footprint', 'notes', 'colors', 'gobos', 'pan_range', 'tilt_range']);
  v.colors[0].name = 'x';
  assert.equal(SPOT.colors[0].name, 'white'); // copia, non riferimento
});

test('signature ignores notes, manufacturer, slot rgb rounding; sees channels and slot values', () => {
  const td = { ...SPOT, notes: 'altro', manufacturer: 'Coemar', source: 'plancia', colors: [{ name: 'white', value: 0, rgb: [1, 1, 1] }, { name: 'orange', value: 8, rgb: [1, 0.50196, 0] }] };
  assert.equal(modelSig(td), modelSig(SPOT));
  assert.notEqual(modelSig({ ...SPOT, channels: ['pan', 'tilt', 'dimmer', 'shutter'] }), modelSig(SPOT));
  assert.notEqual(modelSig({ ...SPOT, colors: [{ name: 'white', value: 0 }, { name: 'orange', value: 10 }] }), modelSig(SPOT));
  assert.equal(modelSig({ model: 'Dimmer 1CH', kind: 'level', channels: 1 }), modelSig({ model: 'Dimmer 1CH', kind: 'level', footprint: 1 }));
});

test('used models: fixture model or the type default, only patchable fixtures', () => {
  const fixtures = [{ type: 'mh', model: SPOT.model }, { type: 'mh', model: SPOT.model }, { type: 'par' }, { type: 'wall' }];
  const names = projectModelNames(fixtures, t => ({ par: 'D+RGB 4CH', wall: 'Wall' })[t], f => f.type !== 'wall');
  assert.deepEqual(names, [SPOT.model, 'D+RGB 4CH']);
});

test('diff against the DMX Master catalogue: missing, different, ok, unknown', () => {
  const saved = { [SPOT.model]: SPOT, 'D+RGB 4CH': { model: 'D+RGB 4CH', kind: 'chase', channels: ['dimmer', 'red', 'green', 'blue'] } };
  const names = [SPOT.model, 'D+RGB 4CH', 'Haze 2CH', 'Mistero 3CH'];
  const td = [{ model: 'D+RGB 4CH', kind: 'chase', channels: ['dimmer', 'red', 'green', 'blue'] }, { model: 'Haze 2CH', kind: 'level', channels: ['haze', 'fan'] }];
  assert.deepEqual(projectModelDiff(saved, td, names).map(x => [x.name, x.state]),
    [[SPOT.model, 'missing'], ['D+RGB 4CH', 'ok'], ['Haze 2CH', 'ok'], ['Mistero 3CH', 'unknown']]);
  const td2 = [...td, { ...SPOT, channels: ['pan', 'tilt', 'dimmer', 'shutter'] }];
  assert.equal(projectModelDiff(saved, td2, names)[0].state, 'different');
});
