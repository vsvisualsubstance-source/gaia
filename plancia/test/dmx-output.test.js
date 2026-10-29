'use strict';

const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const {
  DMX_OUTPUT,
  dmxOutputApplySnapshot,
  dmxOutputApplySource,
  dmxOutputApplyOsc,
  dmxOutputFresh,
  dmxOutputForFixture,
  dmxOutputSummary,
  fixtureOutput,
  dmxHeadAngles,
  dmxGroupColor,
  dmxPaletteGroup,
  tdSceneList,
  tdActiveScene
} = require('../src/49-dmx-output');

beforeEach(() => {
  Object.assign(DMX_OUTPUT, {
    source: 'unknown', sourceAt: 0, lastAt: 0, deviceId: null, seq: null,
    master: null, blackout: null, strobe: null, scene: null, fixtures: new Map(), rigs: {}, rigsAt: 0, v2At: 0
  });
});

test('MQTT output snapshot maps actual fixture state and expires after missed heartbeats', () => {
  const receivedAt = 10000;
  assert.equal(dmxOutputApplySnapshot({
    v: 1, device_id: 'td-dmx-win', seq: 12, master: 0.75, blackout: false, strobe: true,
    scene: { index: 2 },
    fixtures: [{ uid: 'p-head-1', id: 7, sent: true, intensity: 0.6, rgb_out: [0.4, 0.2, 0.1], pan: 45, tilt: -12 }]
  }, 'topic-device', receivedAt), true);

  const record = dmxOutputForFixture({ id: 'p-head-1' });
  assert.equal(DMX_OUTPUT.source, 'mqtt');
  assert.equal(DMX_OUTPUT.deviceId, 'td-dmx-win');
  assert.equal(DMX_OUTPUT.seq, 12);
  assert.equal(DMX_OUTPUT.master, 0.75);
  assert.deepEqual(record.rgbOut, [0.4, 0.2, 0.1]);
  assert.equal(record.pan, 45);
  assert.equal(dmxOutputFresh(receivedAt + 6000), true);
  assert.equal(dmxOutputFresh(receivedAt + 6001), false);
});

test('MQTT snapshot accepts a numeric active-scene value', () => {
  assert.equal(dmxOutputApplySnapshot({ v: 1, scene: 3, fixtures: [] }, 'td-dmx-win', 15000), true);
  assert.equal(DMX_OUTPUT.scene, 3);
});

test('invalid MQTT snapshots are rejected without replacing the current state', () => {
  const original = DMX_OUTPUT.fixtures;
  assert.equal(dmxOutputApplySnapshot({ v: 2, fixtures: [] }, 'td-dmx-win', 20000), false);
  assert.equal(dmxOutputApplySnapshot({ v: 1, fixtures: {} }, 'td-dmx-win', 20000), false);
  assert.equal(DMX_OUTPUT.fixtures, original);
});

test('OSC fallback updates source, fixture values, head parameters and identity aliases', () => {
  assert.equal(dmxOutputApplySource(['osc'], 30000), true);
  assert.equal(dmxOutputApplyOsc('/dmx/fixture/p-head-2', [1, 0.8, 0.6, 0.3, 0.1], 30001), true);
  assert.equal(dmxOutputApplyOsc('/dmx/fixture/p-head-2/head', [90, -20, 3, 2, 255], 30002), true);
  const record = dmxOutputForFixture({ uid: 'p-head-2', id: 8 });
  assert.equal(DMX_OUTPUT.source, 'osc');
  assert.deepEqual(record.rgbOut, [0.6, 0.3, 0.1]);
  assert.equal(record.intensity, 0.8);
  assert.equal(record.pan, 90);
  assert.equal(record.gobo, 3);
  assert.equal(dmxOutputFresh(42002), true);
  assert.equal(dmxOutputFresh(42003), false);
  assert.match(dmxOutputSummary(30002), /OSC · 1\/1 fixture inviate/);
});

test('OSC sentinel values represent absent channels instead of zero', () => {
  assert.equal(dmxOutputApplyOsc('/dmx/fixture/id19', [0, -1, -1, -1, -1], 50000), true);
  const record = dmxOutputForFixture({ id: 19 });
  assert.equal(record.sent, false);
  assert.equal(record.intensity, null);
  assert.equal(record.rgbOut, null);
});

// Valori reali letti da DMX Master (td-dmx-win) il 2026-10-20
const LIVE = {
  v: 1, device_id: 'td-dmx-win', master: 1, blackout: false, strobe: false,
  scene: { scene: 'TestScene1', index: 0, source: 'cue', fade: 3.5, cue: 1 },
  fixtures: [
    { uid: 'p-fslozhy', group: 'heads', sent: true, intensity: 0.423, rgb_out: [0.423, 0.423, 0.423], color_source: 'wheel', pan: 76, tilt: -55.8 },
    { uid: 'p-p75dqtd', group: 'rig_a', sent: true, intensity: 0.603, rgb_out: [0.603, 0, 0], color_source: 'rgb' },
    { uid: 'p-6sbj0ql', group: 'rig_a', sent: true, intensity: 0.603, rgb_out: [0, 0, 0.426], color_source: 'rgb' },
    { uid: 'p-wblmjiz', group: 'rig_a', sent: true, intensity: 0.603, rgb_out: [0.603, 0, 0], color_source: 'rgb' },
    { uid: 'p-nvef9lh', group: 'ledbar', sent: true, intensity: 0.451, rgb_out: [0.451, 0, 0], color_source: 'rgb' },
    { uid: 'p-3pkies2', group: 'haze', sent: true, intensity: 0.833, rgb_out: null, color_source: null }
  ]
};

test('real DMX Master snapshot keeps group and color source per fixture', () => {
  assert.equal(dmxOutputApplySnapshot(LIVE, 'td-dmx-win', 1000), true);
  const head = dmxOutputForFixture({ id: 'p-fslozhy' });
  assert.equal(head.group, 'heads');
  assert.equal(head.colorSource, 'wheel');
  const haze = dmxOutputForFixture({ id: 'p-3pkies2' });
  assert.equal(haze.rgbOut, null);
  assert.equal(haze.intensity, 0.833);
});

test('head pan/tilt degrees become render units using the catalog range', () => {
  dmxOutputApplySnapshot(LIVE, 'td-dmx-win', 1000);
  const head = dmxOutputForFixture({ id: 'p-fslozhy' });
  const [pan, tilt] = dmxHeadAngles(head, { pan_range: 540, tilt_range: 270 });
  assert.ok(Math.abs(pan - 76 / 270) < 1e-9);
  assert.ok(Math.abs(tilt - -55.8 / 135) < 1e-9);
  assert.deepEqual(dmxHeadAngles(head, null), [pan, tilt]); // default 540/270
  assert.equal(dmxHeadAngles({ pan: null, tilt: 3 }, null), null);
  assert.deepEqual(dmxHeadAngles({ pan: 9999, tilt: -9999 }, null), [1, -1]);
});

test('group colour is the hue the rig actually emits, at full brightness', () => {
  dmxOutputApplySnapshot(LIVE, 'td-dmx-win', 1000);
  const rigA = dmxGroupColor('rig_a');
  // 2 rossi pieni + 1 blu: tinta rosso-viola, normalizzata a 1
  assert.equal(rigA[0], 1);
  assert.equal(rigA[1], 0);
  assert.ok(Math.abs(rigA[2] - 0.426 / 1.206) < 1e-9);
  assert.deepEqual(dmxGroupColor('ledbar'), [1, 0, 0]);
  assert.equal(dmxGroupColor('haze'), null); // nessun colore
  assert.equal(dmxGroupColor('rig_b'), null); // nessuna fixture
});

test('group colour falls back to a uid->group map for OSC records', () => {
  dmxOutputApplyOsc('/dmx/fixture/p-x', [1, 0.5, 0, 0.5, 0], 1000);
  assert.equal(dmxGroupColor('rig_b'), null);
  assert.deepEqual(dmxGroupColor('rig_b', uid => uid === 'p-x' ? 'rig_b' : null), [0, 1, 0]);
});

test('palette params map to TD groups', () => {
  assert.equal(dmxPaletteGroup('dmx_a_palette'), 'rig_a');
  assert.equal(dmxPaletteGroup('dmx_b_palette'), 'rig_b');
  assert.equal(dmxPaletteGroup('dmx_ledbar_palette'), 'ledbar');
  assert.equal(dmxPaletteGroup('dmx_a_color_speed'), null);
});

test('TD scenes come from the catalog in /dmx/scene order, active from dmx_output', () => {
  const params = { show_scene_catalog: [
    { id: 'Finale', index: 1, label: 'Finale' }, { id: 'TestScene1', index: 0, label: 'TestScene1' }, { bad: true }
  ], show_active_scene: { scene: 'Finale', index: 1 } };
  assert.deepEqual(tdSceneList(params).map(s => s.id), ['TestScene1', 'Finale']);
  assert.deepEqual(tdSceneList({}), []);
  dmxOutputApplySnapshot(LIVE, 'td-dmx-win', 1000);
  assert.deepEqual(tdActiveScene(params), { index: 0, id: 'TestScene1' }); // dmx_output vince
  assert.deepEqual(tdActiveScene(params, { scene: null }), { index: 1, id: 'Finale' });
});

// Colori di palette e scene come li pubblica DMX Master (nota TD 37)
const { dmxHex, dmxPaletteColors, dmxGradient, tdScenePreview } = require('../src/49-dmx-output');
const WARM = [[1, 0, 0], [1, 0.353, 0], [1, 0.667, 0], [1, 0.863, 0], [1, 0.353, 0]];
const MATRIX = { rigs: { a: { params: { dmx_palette: { options: ['Warm', 'Basic 2', 'Custom'],
  colors: { Warm: WARM, 'Basic 2': [[1, 0, 0], [0, 0, 1]] }, stepped: ['Basic 2'] } } }, haze: { params: {} } } };

test('palette colours are read per rig from dmx_matrix', () => {
  assert.deepEqual(dmxPaletteColors(MATRIX, 'dmx_a_palette').colors.Warm, WARM);
  assert.equal(dmxPaletteColors(MATRIX, 'dmx_a_palette').stepped.has('Basic 2'), true);
  assert.equal(dmxPaletteColors(MATRIX, 'dmx_b_palette'), null);
  assert.equal(dmxPaletteColors(MATRIX, 'dmx_a_level'), null);
  assert.equal(dmxPaletteColors(null, 'dmx_a_palette'), null);
  assert.equal(dmxHex([1, 0.353, 0]), '#ff5a00');
});

test('gradient blends smooth palettes and hard-steps stepped ones', () => {
  assert.equal(dmxGradient([[[[1, 0, 0]], false]]), 'linear-gradient(90deg,#ff0000 0%,#ff0000 100%)');
  assert.equal(dmxGradient([[[[1, 0, 0], [0, 0, 1]], false]]), 'linear-gradient(90deg,#ff0000 0%,#0000ff 100%)');
  assert.equal(dmxGradient([[[[1, 0, 0], [0, 0, 1]], true]]),
    'linear-gradient(90deg,#ff0000 0%,#ff0000 50%,#0000ff 50%,#0000ff 100%)');
  // due segmenti (front | back): bordo netto a meta'
  assert.equal(dmxGradient([[[[1, 0, 0]], false], [[[0, 0, 1]], false]]),
    'linear-gradient(90deg,#ff0000 0%,#ff0000 50%,#0000ff 50%,#0000ff 100%)');
  assert.equal(dmxGradient([]), '');
  assert.equal(dmxGradient([[[], false]]), '');
});

test('scene preview gives front and back palettes, stepped from the matrix', () => {
  const scene = { id: 'sc1', preview: { rig_a: { palette: 'Warm', colors: WARM },
    rig_b: { palette: 'Basic 2', colors: [[1, 0, 0], [0, 0, 1]] }, heads: [{ uid: 'p-fslozhy', rgb: [1, 1, 1] }] } };
  const segs = tdScenePreview(scene, dmxPaletteColors(MATRIX, 'dmx_a_palette').stepped);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], [WARM, false]);
  assert.equal(segs[1][1], true);
  assert.deepEqual(tdScenePreview({ id: 'x' }), []);
  assert.deepEqual(tdScenePreview({ preview: { heads: [] } }), []); // scena senza "rigs"
});

test('scene preview includes ledbar and created rigs after front/back, skips level rigs', () => {
  const scene = { preview: { ledbar: { palette: 'Basic 2', colors: [[0, 1, 0]] }, rig_b: { palette: 'Red', colors: [[1, 0, 0]] },
    haze: { level: 0.8 }, blinder: { level: 0.3 }, rig_a: { palette: 'Blue', colors: [[0, 0, 1]] }, side: { palette: 'Red', colors: [[1, 0, 0]] } } };
  assert.deepEqual(tdScenePreview(scene).map(s => s[0][0]), [[0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 0, 0]]);
});

test('quick patch params are the four destructive ones (nota TD 38)', () => {
  const { DMX_QUICK_PATCH } = require('../src/49-dmx-output');
  assert.deepEqual(DMX_QUICK_PATCH, ['fixture_count', 'start_address', 'output_port', 'fixture_profile']);
});

test('rig meters (nota TD 45): level, amount and a kick when the counter changes', () => {
  const { dmxRigMeters } = require('../src/49-dmx-output');
  const first = dmxRigMeters({ rig_a: { level: 0.42, kicks: 65, amount: 1, kick_enable: true } }, {}, 1000);
  assert.deepEqual(first.rig_a, { level: 0.42, kicks: 65, amount: 1, kickEnable: true, kickAt: 0 });
  const same = dmxRigMeters({ rig_a: { level: 0.5, kicks: 65, amount: 1 } }, first, 1100);
  assert.equal(same.rig_a.kickAt, 0);
  const kick = dmxRigMeters({ rig_a: { level: 0.9, kicks: 66, amount: 1 } }, same, 1200);
  assert.equal(kick.rig_a.kickAt, 1200);
  const restart = dmxRigMeters({ rig_a: { level: 0.1, kicks: 0, amount: 0.5 } }, kick, 1300); // motore ricaricato
  assert.equal(restart.rig_a.kickAt, 1300);
  assert.equal(restart.rig_a.amount, 0.5);
  assert.deepEqual(dmxRigMeters(null, kick, 1400), {});
});


test('dmx_output v2 (nota TD 47): layout + live become the same records as v1; v1 ignored while v2 is fresh', () => {
  const m = require('../src/49-dmx-output');
  m.DMX_LAYOUT.rev = null; m.DMX_LAYOUT.fixtures = null;
  assert.equal(m.dmxLiveApply({ v: 2, fixtures: {} }, 'td', 1000), false); // senza layout si aspetta
  assert.equal(m.dmxLayoutApply({ v: 2, rev: 'r1', fixtures: [{ uid: 'p-a', id: 3, group: 'rig_a', sent: true, color_source: 'rgb', audio: 'bass', audio_gain: 1.5 }, { uid: 'p-h', id: 9, group: 'heads', sent: true }] }), true);
  assert.equal(m.dmxLiveApply({ v: 2, seq: 7, layout_rev: 'r1', master: 0.8, scene: { index: 2 }, fixtures: { 'p-a': { intensity: 0.5, rgb_out: [0.5, 0, 0] }, 'p-h': { pan: 90, tilt: 45, color_wheel: 16 } } }, 'td', 1000), true);
  const a = m.dmxOutputForFixture({ id: 'p-a' }), h = m.dmxOutputForFixture({ id: 'p-h' });
  assert.deepEqual([a.intensity, a.rgbOut, a.group, a.colorSource, a.audio, a.audioGain, a.pan], [0.5, [0.5, 0, 0], 'rig_a', 'rgb', 'bass', 1.5, null]);
  assert.deepEqual([h.pan, h.tilt, h.colorWheel, h.intensity], [90, 45, 16, null]); // campi omessi = null
  assert.equal(m.DMX_OUTPUT.master, 0.8);
  // un v1 che arriva mentre la v2 e' fresca non sovrascrive
  assert.equal(m.dmxOutputApplySnapshot({ v: 1, fixtures: [{ uid: 'p-a', sent: true, intensity: 0.1 }] }, 'td', 1500), false);
  assert.equal(m.dmxOutputForFixture({ id: 'p-a' }).intensity, 0.5);
  // v2 ferma da oltre 1,5 s: il v1 torna buono
  assert.equal(m.dmxOutputApplySnapshot({ v: 1, fixtures: [{ uid: 'p-a', sent: true, intensity: 0.1 }] }, 'td', 2600), true);
});

test('dmx_rigs at 30 Hz wins over dmx_output.rigs while fresh', () => {
  const m = require('../src/49-dmx-output');
  assert.equal(m.dmxRigsApply({ rigs: { rig_a: { level: 0.9, kicks: 5, amount: 1 } } }, 1000), true);
  m.dmxOutputApplySnapshot({ v: 1, fixtures: [], rigs: { rig_a: { level: 0.1, kicks: 5 } } }, 'td', 1200);
  assert.equal(m.DMX_OUTPUT.rigs.rig_a.level, 0.9);  // dmx_rigs fresco: si tiene quello
  m.dmxOutputApplySnapshot({ v: 1, fixtures: [], rigs: { rig_a: { level: 0.2, kicks: 5 } } }, 'td', 2500);
  assert.equal(m.DMX_OUTPUT.rigs.rig_a.level, 0.2);  // dmx_rigs fermo da >1 s: vale dmx_output
});

test('switching MQTT <-> OSC keeps the last real head position (static heads are not re-sent over OSC)', () => {
  dmxOutputApplyOsc('/dmx/output/source', ['mqtt'], 1000);
  dmxOutputApplyOsc('/dmx/fixture/p-h/head', [81, 27, 0, 0, 245], 1000);
  dmxOutputApplyOsc('/dmx/output/source', ['osc'], 2000);
  const head = dmxOutputForFixture({ uid: 'p-h' });
  assert.equal(head.pan, 81);
  assert.equal(head.tilt, 27);
});

test('fixtureOutput: real output only while DMX Master is fresh and knows the fixture', () => {
  const at = 50000;
  dmxOutputApplySnapshot({ v: 1, fixtures: [
    { uid: 'par-1', id: 1, sent: true, rgb_out: [0.8, 0.4, 0] },
    { uid: 'par-2', id: 2, sent: false, rgb_out: [0.8, 0.4, 0] },
    { uid: 'dim-1', id: 3, sent: true, intensity: 0.35 },
    { uid: 'dark', id: 4, sent: true, rgb_out: [0, 0, 0] },
    { uid: 'head-1', id: 5, sent: true, rgb_out: [0, 0, 1], pan: 135, tilt: -45 }
  ] }, 'td-dmx-win', at);

  const lit = fixtureOutput({ uid: 'par-1' }, { at });
  assert.deepEqual(lit.color, [1, 0.5, 0]);          // tinta a luminosita' piena
  assert.equal(lit.level, 0.8);                      // livello = picco di rgb_out
  assert.equal(lit.record.uid, 'par-1');
  assert.equal(fixtureOutput({ uid: 'par-2' }, { at }).level, 0);       // non inviata: spenta, ma reale
  assert.equal(fixtureOutput({ uid: 'dim-1' }, { at }).level, 0.35);    // senza colore: intensity
  assert.deepEqual(fixtureOutput({ uid: 'dim-1' }, { at }).color, [1, 1, 1]);
  assert.deepEqual(fixtureOutput({ uid: 'dark' }, { at }), { record: dmxOutputForFixture({ uid: 'dark' }), color: [1, 1, 1], level: 0, angles: null });
  assert.equal(fixtureOutput({ uid: 'sconosciuta' }, { at }), null);   // DMX Master non la conosce: simulazione

  assert.deepEqual(fixtureOutput({ uid: 'head-1' }, { at, model: { pan_range: 540, tilt_range: 270 } }).angles, [0.5, -1 / 3]);
  assert.deepEqual(fixtureOutput({ uid: 'head-1' }, { at, model: { pan_range: 270, tilt_range: 90 } }).angles, [1, -1]);

  assert.equal(fixtureOutput({ uid: 'par-1' }, { at: at + 6001 }), null); // heartbeat perso: simulazione
});
