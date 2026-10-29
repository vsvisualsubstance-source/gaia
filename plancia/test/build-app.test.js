'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { appModules, buildAppBundle } = require('../build-app');

test('app bundle preserves module order and parses as one client scope', () => {
  const bundle = buildAppBundle();
  const positions = [
    '/* ---------- bus dei messaggi MQTT ---------- */',
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
    'migrateLegacyHeadSelectors();migrateHeadPresetWidgets();migrateUiShowTimeline();migrateUiConsolePages();migrateUiAudioPage();migrateUiNoChase();migrateUiOneDmxV8();migrateUiLaserPage();migrateUiLaserScenes();render();',
    '/* ---------- avvio ---------- */'
  ].map(marker => bundle.indexOf(marker));

  assert.equal(bundle.startsWith('(()=>{\n'), true);
  assert.equal(bundle.endsWith('\n})();\n'), true);
  assert.equal(appModules.length, 40);
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
  const netLocalize = new Function('OPS_LAN_IP', 'LOCAL_HOSTS', 'location', fn + 'return netLocalize;')(
    '192.168.1.240', ['localhost', '127.0.0.1', '::1', '[::1]'], { hostname: '192.168.1.240' });
  const ops = { broker: '192.168.1.240', wsPort: 19001, nodered: '192.168.1.240', admin: '192.168.1.240', video: '192.168.1.240', osc: '192.168.1.240' };
  const local = netLocalize(ops, 'localhost');
  assert.equal(local.broker, 'localhost');
  assert.equal(local.nodered, 'localhost');
  assert.equal(local.video, '192.168.1.240');   // servizi Windows: l'IP di LAN funziona
  assert.deepEqual(netLocalize(ops, '192.168.1.240'), ops);   // tablet in rete: invariato
  assert.deepEqual(netLocalize(ops), ops);                    // default: l'indirizzo della pagina
  assert.equal(netLocalize({ broker: '192.168.1.142' }, 'localhost').broker, '192.168.1.142');
});

test('Plancia opened from another OPS address (Windows hotspot, Tailscale) finds the services there', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', '70-gaia-mqtt.js'), 'utf8');
  const fn = src.slice(src.indexOf('function netLocalize'), src.indexOf('const net=()'));
  const netLocalize = new Function('OPS_LAN_IP', 'LOCAL_HOSTS', 'location', fn + 'return netLocalize;')(
    '192.168.1.240', ['localhost', '127.0.0.1', '::1', '[::1]'], { hostname: '192.168.1.240' });
  const ops = { broker: '192.168.1.240', wsPort: 19001, nodered: '192.168.1.240', admin: '192.168.1.240', video: '192.168.1.240', osc: '192.168.1.240' };
  // broker attraverso il bridge della Plancia (stessa porta della pagina, /mqtt)
  assert.deepEqual(netLocalize(ops, '192.168.137.1', '8080'),
    { broker: '192.168.137.1', wsPort: 8080, wsPath: '/mqtt', nodered: '192.168.137.1', admin: '192.168.137.1', video: '192.168.137.1', osc: '192.168.137.1' });
  assert.equal(netLocalize(ops, '100.91.251.83', '8092').wsPort, 8092);
  assert.equal(netLocalize(ops, 'localhost', '8080').wsPort, 19001);   // su OPS: broker diretto
  // profilo Casa: il broker non e' OPS e resta quello scritto
  assert.equal(netLocalize({ broker: '192.168.1.142', nodered: '192.168.1.240' }, '192.168.137.1').broker, '192.168.1.142');
});

test('the app starts only from the last module, after every module has been evaluated', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.equal(appModules[appModules.length - 1], '999-start.js');
  assert.match(src('999-start.js'), /^init\(\);$/m);
  // nessuna chiamata di avvio a livello di modulo nel vecchio punto di partenza
  assert.doesNotMatch(src('90-settings-and-bootstrap.js'), /^migrateLegacyHeadSelectors\(\);/m);
});

test('registered widget types live only in their module, not in the old dispatch switches', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, '..', 'src');
  const all = appModules.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const registered = [...all.matchAll(/registerWidget\('([^']+)'/g)].map(m => m[1]);
  for (const t of ['laser', 'fixgrid', 'cuestack', 'audiorigs', 'fader', 'knob', 'xy', 'button', 'meter', 'color', 'label', 'clock', 'gaia', 'patchdeck', 'tddevice', 'gaiadmx', 'stage', 'timeline', 'scenes']) assert.ok(registered.includes(t), t);
  const dispatch = ['00-core-state.js', '40-widget-rendering.js', '41-widget-interactions.js', '80-animation-loop.js', '95-help-tour.js'];
  // in 41: bind() (tocco) e renderInsp() (ispettore di Modifica griglia)
  const only41 = s => s.slice(s.indexOf('function bind('), s.indexOf('function editDown(')) + s.slice(s.indexOf('function renderInsp('), s.indexOf('function removeW('));
  for (const type of registered) for (const f of dispatch) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    // usato come tipo di widget: ==='x', case 'x', elemento di un elenco ['x', ...] (non createElement('button'))
    const asType = new RegExp(`(===\s*|case\s+|[\[,]\s*)'${type}'`);
    assert.ok(!asType.test(f.startsWith('41') ? only41(s) : s), `${type} compare ancora in ${f}`);
  }
});
