'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SCENE_CATEGORIES, sceneCategoriesFrom, validateSceneName, sceneCategoryText } = require('../src/63-dmx-scenes');

test('categories come from dmx_matrix show.categories, with a fallback', () => {
  const live = { show: { categories: [{ id: 'rigs', label: 'Look dei rig' }, { id: 'strobe', label: 'Strobo generale' }, {}] } };
  assert.deepEqual(sceneCategoriesFrom(live), [{ id: 'rigs', label: 'Look dei rig' }, { id: 'strobe', label: 'Strobo generale' }]);
  assert.deepEqual(sceneCategoriesFrom({}), SCENE_CATEGORIES);
  assert.deepEqual(SCENE_CATEGORIES.map(c => c.id), ['rigs', 'heads', 'groups', 'audio', 'strobe']);
});

test('scene names: required, short, no cue separators, unique (case-insensitive)', () => {
  assert.equal(validateSceneName('rosso_caldo', ['sc1']), '');
  assert.equal(validateSceneName('Teste pubblico', ['sc1']), '');
  assert.notEqual(validateSceneName('  ', []), '');
  assert.notEqual(validateSceneName('a>b', []), '');
  assert.notEqual(validateSceneName('a;b', []), '');
  assert.notEqual(validateSceneName('x'.repeat(33), []), '');
  assert.notEqual(validateSceneName('SC1', ['sc1']), '');
  assert.equal(validateSceneName('sc1', ['sc1', 'b'], 'sc1'), ''); // rinominare tenendo lo stesso nome
});

test('category summary uses the labels', () => {
  assert.equal(sceneCategoryText(['heads', 'strobe']), 'Teste mobili · Strobo generale');
  assert.equal(sceneCategoryText([]), 'nessuna categoria');
});
