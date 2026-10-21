'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { appModules, buildAppBundle } = require('../build-app');

test('app bundle preserves module order and parses as one client scope', () => {
  const bundle = buildAppBundle();
  const positions = [
    '/* ---------- vocabolario dello show ---------- */',
    '/* ---------- template ---------- */',
    '/* ---------- motore dello show (simulazione locale del rig) ---------- */',
    '/* ---------- disegno widget ---------- */',
    '/* ---------- interazione ---------- */',
    'const DMX_OUTPUT=',
    '/* ---------- connessione al bridge ---------- */',
    '/* ---------- render del palco ---------- */',
    '/* ---------- interazione pianta/patch',
    '/* ---------- Gaia: MQTT',
    '/* ---------- disegno dei widget Gaia ---------- */',
    '/* ---------- interazione widget Gaia ---------- */',
    '/* ---------- simulazione:',
    '/* ---------- ciclo principale ---------- */',
    '/* ---------- impostazioni e template ---------- */',
    'migrateLegacyHeadSelectors();migrateHeadPresetWidgets();migrateUiShowTimeline();render();'
  ].map(marker => bundle.indexOf(marker));

  assert.equal(bundle.startsWith('(()=>{\n'), true);
  assert.equal(bundle.endsWith('\n})();\n'), true);
  assert.equal(appModules.length, 26);
  assert.equal(positions.every(position => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotThrow(() => new vm.Script(bundle));
});

test('missing source modules fail the build explicitly', () => {
  assert.throws(() => buildAppBundle('missing-source-directory'));
});
