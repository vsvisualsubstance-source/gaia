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
    'migrateLegacyHeadSelectors();migrateHeadPresetWidgets();migrateUiShowTimeline();migrateUiConsolePages();migrateUiAudioPage();migrateUiNoChase();migrateUiOneDmxV8();migrateUiLaserPage();migrateUiLaserScenes();render();'
  ].map(marker => bundle.indexOf(marker));

  assert.equal(bundle.startsWith('(()=>{\n'), true);
  assert.equal(bundle.endsWith('\n})();\n'), true);
  assert.equal(appModules.length, 33);
  assert.equal(positions.every(position => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotThrow(() => new vm.Script(bundle));
});

test('missing source modules fail the build explicitly', () => {
  assert.throws(() => buildAppBundle('missing-source-directory'));
});

test('Plancia opened on OPS itself talks to localhost (no hairpin on its own LAN IP)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', '70-gaia-mqtt.js'), 'utf8');
  const fn = src.slice(src.indexOf('function netLocalize'), src.indexOf('const net=()'));
  const netLocalize = new Function('OPS_LAN_IP', 'pageIsLocal', fn + 'return netLocalize;')('192.168.1.240', () => false);
  const ops = { broker: '192.168.1.240', nodered: '192.168.1.240', admin: '192.168.1.240', video: '192.168.1.240', osc: '192.168.1.240' };
  const local = netLocalize(ops, true);
  assert.equal(local.broker, 'localhost');
  assert.equal(local.nodered, 'localhost');
  assert.equal(local.video, '192.168.1.240');   // servizi Windows: l'IP di LAN funziona
  assert.equal(netLocalize(ops, false).broker, '192.168.1.240');   // tablet in rete: invariato
  assert.equal(netLocalize({ broker: '192.168.1.142' }, true).broker, '192.168.1.142');
});
