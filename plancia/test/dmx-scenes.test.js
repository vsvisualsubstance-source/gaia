'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SCENE_CATEGORIES, sceneCategoriesFrom, validateSceneName, sceneCategoryText, sceneKind, paletteSceneId } = require('../src/63-dmx-scenes');

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

test('scene kind from categories: colour, heads, strobe, complete, mixed', () => {
  const k = c => sceneKind(c).id;
  assert.equal(k(['rigs']), 'color');
  assert.equal(k(['palette']), 'color');          // categoria solo palette, se TD la aggiunge
  assert.equal(k(['heads']), 'heads');
  assert.equal(k(['strobe']), 'strobe');
  assert.equal(k(['rigs', 'heads']), 'full');
  assert.equal(k(['rigs', 'heads', 'groups', 'audio', 'strobe']), 'full');
  assert.equal(k(['groups', 'strobe']), 'mixed');
  assert.equal(k([]), 'mixed');
  assert.equal(sceneKind(['rigs']).label, 'Colore');
});

test('palette scene ids are valid scene names, one per palette', () => {
  assert.equal(paletteSceneId('Warm'), 'pal_warm');
  assert.equal(paletteSceneId('Neon Party'), 'pal_neon_party');
  assert.equal(paletteSceneId('Rainbow (Daslight)'), 'pal_rainbow_daslight');
  assert.equal(paletteSceneId('Magenta-Cyan'), 'pal_magenta_cyan');
  assert.equal(paletteSceneId('Città'), 'pal_citta');
  assert.ok(paletteSceneId('x'.repeat(60)).length <= 32);
  for (const n of ['Warm', 'Neon Party', 'Rainbow (Daslight)']) assert.equal(validateSceneName(paletteSceneId(n)), '');
});
