// il reimport automatico da TD non deve togliere o aggiungere luci se le due patch sono diverse
const test = require('node:test'), assert = require('node:assert/strict');
const { tdPatchDiff } = require('../src/62-dmx-groups.js');

test('patch uguali: nessuna differenza, le fixture native di TD non contano', () => {
  const d = tdPatchDiff([{ id: 'p-a', name: 'A' }], [{ uid: 'p-a' }, { uid: 'nativa' }, { name: 'senza uid' }]);
  assert.deepEqual(d, { missing: [], extra: [] });
});

test('barre del progetto che in TD non ci sono, e barre solo in TD', () => {
  const d = tdPatchDiff([{ id: 'p-col', name: 'COL' }, { id: 'p-cons', name: 'CONS-DX' }], [{ uid: 'p-col' }, { uid: 'p-bar' }]);
  assert.deepEqual(d.missing, ['CONS-DX']);
  assert.deepEqual(d.extra, ['p-bar']);
});

test('TD senza patch', () => {
  assert.deepEqual(tdPatchDiff([{ id: 'p-a', name: 'A' }], undefined).missing, ['A']);
});
