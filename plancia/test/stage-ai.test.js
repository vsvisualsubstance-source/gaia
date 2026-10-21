'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { expandStagePlan } = require('../src/65-stage-ai');
const { SCHEMA, ROWS, TYPES } = require('../stage-ai');

const FP = { par: 4, bar: 4, mh: 11, blinder: 1, haze: 2, wall: 0, laser: 0, speaker: 0 };
const footprint = t => FP[t] || 0;
// piano reale prodotto da qwen2.5-coder:7b il 2026-10-21
const CLUB = { stage: { width: 10, depth: 6 }, groups: [
  { type: 'par', count: 8, row: 'truss' }, { type: 'mh', count: 4, row: 'truss' }, { type: 'bar', count: 2, row: 'back' },
  { type: 'haze', count: 1, row: 'back' }, { type: 'blinder', count: 2, row: 'front' }] };

test('schema and rows agree between bridge and Plancia', () => {
  assert.deepEqual(SCHEMA.properties.groups.items.properties.row.enum, ROWS);
  assert.deepEqual(SCHEMA.properties.groups.items.properties.type.enum, TYPES);
});

test('club plan expands to 17 fixtures with groups, names and non-overlapping addresses', () => {
  const r = expandStagePlan(CLUB, { stage: { trussHeight: 7 }, footprint, knownGroups: ['front', 'back', 'mh', 'ledbar', 'haze', 'blinder'] });
  assert.deepEqual(r.stage, { width: 10, depth: 6 });
  assert.equal(r.fixtures.length, 17);
  assert.deepEqual(r.newGroups, []);
  assert.deepEqual([...new Set(r.fixtures.map(f => f.group))], ['front', 'mh', 'ledbar', 'haze', 'blinder']);
  assert.deepEqual(r.fixtures.filter(f => f.type === 'par').map(f => f.name).slice(0, 3), ['PAR1', 'PAR2', 'PAR3']);
  const pars = r.fixtures.filter(f => f.type === 'par');
  assert.ok(pars.every(f => f.z === 7 && f.mountToTruss));            // americana
  assert.equal(pars[0].x, -4.2); assert.equal(pars[7].x, 4.2);         // larghezza 10, margine 0.8
  let end = 0;                                                         // indirizzi consecutivi, senza sovrapposizioni
  for (const f of r.fixtures) { assert.equal(f.universe, 1); assert.ok(f.address > end); end = f.address + FP[f.type] - 1; }
  assert.equal(end, 8 * 4 + 4 * 11 + 2 * 4 + 2 + 2);
});

test('custom groups become new groups; heads always in mh; sides and speakers', () => {
  const r = expandStagePlan({ stage: { width: 14, depth: 9 }, groups: [
    { type: 'par', count: 4, row: 'side_left', group: 'floor' }, { type: 'mh', count: 2, row: 'side_right', group: 'spot2' },
    { type: 'speaker', count: 2, row: 'front' }, { type: 'wall', count: 1, row: 'back' }] },
  { footprint, knownGroups: ['front', 'mh'] });
  assert.deepEqual(r.newGroups, [{ group: 'floor', kind: 'chase', label: '' }]);
  assert.ok(r.fixtures.filter(f => f.type === 'mh').every(f => f.group === 'mh'));
  assert.ok(r.warnings.some(w => w.includes('spot2')));
  assert.ok(r.fixtures.filter(f => f.group === 'floor').every(f => f.x === -7.5));
  assert.deepEqual(r.fixtures.filter(f => f.type === 'speaker').map(f => f.x), [-8.2, 8.2]);
  assert.deepEqual(r.fixtures.find(f => f.type === 'wall').universe, 0); // non DMX: niente indirizzo
});

test('add mode continues names and addresses after existing fixtures; universes roll over', () => {
  const existing = [{ type: 'par', name: 'PAR4', universe: 1, address: 500 }];
  const r = expandStagePlan({ stage: { width: 12, depth: 8 }, groups: [{ type: 'par', count: 4, row: 'front' }] },
    { mode: 'add', existing, footprint, knownGroups: ['front'] });
  assert.deepEqual(r.fixtures.map(f => f.name), ['PAR5', 'PAR6', 'PAR7', 'PAR8']);
  assert.deepEqual(r.fixtures.map(f => [f.universe, f.address]), [[1, 504], [1, 508], [2, 1], [2, 5]]);
});

test('limits: stage clamped, unknown types ignored, at most 200 fixtures', () => {
  const r = expandStagePlan({ stage: { width: 999, depth: 1 }, groups: [{ type: 'smoke', count: 3, row: 'back' },
    ...Array.from({ length: 5 }, () => ({ type: 'par', count: 48, row: 'mid' }))] }, { footprint });
  assert.deepEqual(r.stage, { width: 40, depth: 3 });
  assert.equal(r.fixtures.length, 200);
  assert.ok(r.warnings.some(w => w.includes('200')));
  assert.ok(expandStagePlan({ groups: [] }).warnings.length);
});
