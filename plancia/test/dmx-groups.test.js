'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DEFAULT_GROUPS, normGroupName, validateGroups, groupsPayload, groupsFromTD } = require('../src/62-dmx-groups');

test('invio gruppi: i rig degli altri show restano, tolti solo quelli eliminati a mano', () => {
  const { groupsToSend } = require('../src/62-dmx-groups');
  const list = [{ group: 'front', kind: 'chase', label: 'Front', bind: 'rig_a' }, { group: 'consolle', kind: 'chase', label: 'Consolle' }];
  const td = [{ group: 'front', td_group: 'rig_a', kind: 'chase', label: 'Front', builtin: true },
    { group: 'consolle', td_group: 'consolle', kind: 'chase', label: 'Consolle' },
    { group: 'side', td_group: 'side', kind: 'chase', label: 'side' }, { group: 'truss', td_group: 'truss', kind: 'chase', label: 'truss' }];
  assert.deepEqual(groupsToSend(list, td).map(g => g.group), ['front', 'consolle', 'side', 'truss']);
  assert.deepEqual(groupsToSend(list, td, ['truss']).map(g => g.group), ['front', 'consolle', 'side']);
});

test('progetto contro DMX Master: mancanti, in piu, spostate, senza rig', () => {
  const { projectPatchIssues, patchIssuesText } = require('../src/62-dmx-groups');
  const local = [{ id: 'p-a', name: 'A', address: 1, group: 'ledbar' }, { id: 'p-b', name: 'B', address: 15, group: 'consolle' }, { id: 'p-c', name: 'C', address: 29, group: 'ledbar' }];
  const td = [{ uid: 'p-a', address: 1, group: 'ledbar' }, { uid: 'p-b', address: 20, group: 'consolle' }, { uid: 'p-x', address: 99, group: 'ledbar' }];
  const r = projectPatchIssues(local, td, [{ uid: 'p-b', name: 'B', status: 'missing' }, { uid: 'p-a', status: 'ok' }]);
  assert.deepEqual([r.missing, r.extra, r.changed, r.noRig], [['C'], ['p-x'], ['B'], ['B']]);
  assert.match(patchIssuesText(r), /1 luce non è in DMX Master.*1 luce c.è solo.*1 luce ha indirizzo.*1 luce non ha il rig/);
  assert.equal(patchIssuesText({ missing: [], extra: [], changed: [], noRig: [] }), '');
});

// dmx_groups come lo pubblica DMX Master il 2026-10-20
const TD = [
  { group: 'front', td_group: 'rig_a', kind: 'chase', label: 'Front', builtin: true, fixtures: 2 },
  { group: 'back', td_group: 'rig_b', kind: 'chase', label: 'Back', builtin: true, fixtures: 2 },
  { group: 'mh', td_group: 'heads', kind: 'heads', label: 'Teste', builtin: true, fixtures: 2 },
  { group: 'ledbar', td_group: 'ledbar', kind: 'chase', label: 'LED bar', builtin: false, fixtures: 2 },
  { group: 'haze', td_group: 'haze', kind: 'level', label: 'Haze', builtin: false, fixtures: 1 },
  { group: 'blinder', td_group: 'blinder', kind: 'level', label: 'Blinder', builtin: false, fixtures: 1 }
];

test('TD group list becomes the Plancia list, with bind only on the fixed engines', () => {
  assert.deepEqual(groupsFromTD(TD), DEFAULT_GROUPS);
  assert.deepEqual(groupsFromTD([{ group: 'ledwall', kind: 'none' }, null]), []);
  assert.deepEqual(groupsFromTD(undefined), []);
});

test('TD engine names in the layout map to Plancia names', () => {
  assert.equal(normGroupName('rig_a'), 'front');
  assert.equal(normGroupName('rig_b'), 'back');
  assert.equal(normGroupName('heads'), 'mh');
  assert.equal(normGroupName('ledbar'), 'ledbar');
  assert.equal(normGroupName(' side '), 'side');
});

test('payload is the full list TD expects (nota 21)', () => {
  const list = [...DEFAULT_GROUPS, { group: 'side', kind: 'chase', label: '' }];
  const p = groupsPayload(list);
  assert.deepEqual(p[0], { group: 'front', kind: 'chase', label: 'Front', bind: 'rig_a' });
  assert.deepEqual(p[6], { group: 'side', kind: 'chase', label: 'side' });
  assert.equal(p.some(g => g.group === 'ledwall'), false);
});

test('validation: names, reserved, duplicates, kinds and the three fixed engines', () => {
  assert.deepEqual(validateGroups(DEFAULT_GROUPS), []);
  const add = g => validateGroups([...DEFAULT_GROUPS, g]);
  assert.deepEqual(add({ group: 'side', kind: 'chase' }), []);
  assert.deepEqual(add({ group: 'floor_2', kind: 'level' }), []);
  assert.equal(add({ group: 'Side', kind: 'chase' }).length, 1);
  assert.equal(add({ group: 'x', kind: 'chase' }).length, 1);
  assert.equal(add({ group: 'ledwall', kind: 'chase' }).length, 1);
  assert.equal(add({ group: 'patch', kind: 'chase' }).length, 1);
  assert.equal(add({ group: 'ledbar', kind: 'chase' }).length, 1); // doppio
  assert.equal(add({ group: 'spot2', kind: 'heads' }).length, 1);  // teste = un motore solo
  assert.equal(add({ group: 'side', kind: 'wash' }).length, 1);
  assert.ok(validateGroups(DEFAULT_GROUPS.filter(g => g.group !== 'back')).some(e => e.includes('rig_b')));
});
