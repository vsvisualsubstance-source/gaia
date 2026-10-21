'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createLibrary, oflToModels, ddfToModels, roleFromName } = require('../fixture-lib');

const OFL = {
  name: 'Test Spot',
  physical: { focus: { panMax: 540, tiltMax: 250 } },
  wheels: { 'Color Wheel': { slots: [{ type: 'Open' }, { type: 'Color', name: 'Red', colors: ['#ff0000'] }, { type: 'Color' }] } },
  availableChannels: {
    Pan: { fineChannelAliases: ['Pan fine'], capability: { type: 'Pan' } },
    Tilt: { capability: { type: 'Tilt' } },
    Dimmer: { capability: { type: 'Intensity' } },
    'Shutter / Strobe': { capabilities: [{ type: 'ShutterStrobe' }, { type: 'ShutterStrobe' }] },
    'Color Wheel': { capabilities: [
      { dmxRange: [0, 9], type: 'WheelSlot', slotNumber: 1 },
      { dmxRange: [10, 19], type: 'WheelSlot', slotNumber: 2 },
      { dmxRange: [20, 29], type: 'WheelSlot', slotNumber: 3 },
      { dmxRange: [30, 39], type: 'WheelSlot', slotNumber: 1.5 },
      { dmxRange: [128, 255], type: 'WheelRotation' }] },
    Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
  },
  modes: [
    { name: 'Standard', shortName: 'std', channels: ['Pan', 'Pan fine', 'Tilt', 'Dimmer', 'Shutter / Strobe', 'Color Wheel', null] },
    { name: 'Basic', shortName: 'bas', channels: ['Pan', 'Tilt', 'Dimmer', 'Shutter / Strobe', 'Color Wheel', 'Red', null] },
    { name: 'Matrix', channels: ['Dimmer', { insert: 'matrixChannels' }] },
  ],
};

test('OFL: roles, fine channels, wheel slots, one model per mode (matrix modes skipped)', () => {
  const [std, bas, ...rest] = oflToModels(OFL, 'Acme', 'acme/test-spot');
  assert.equal(rest.length, 0);
  assert.equal(std.model, 'Acme Test Spot 7ch std');
  assert.equal(bas.model, 'Acme Test Spot 7ch bas');
  assert.deepEqual(std.channels, ['pan', 'pan_fine', 'tilt', 'dimmer', 'shutter', 'color', 'ch_7']);
  assert.deepEqual(bas.channels, ['pan', 'tilt', 'dimmer', 'shutter', 'color', 'red', 'ch_7']);
  assert.equal(std.kind, 'heads');
  assert.equal(std.tilt_range, 250);
  assert.deepEqual(std.colors, [{ name: 'White', value: 0, rgb: [1, 1, 1] }, { name: 'Red', value: 10, rgb: [1, 0, 0] }, { name: 'Colore_3', value: 20 }]);
  assert.match(std.notes, /MIT/);
});

const DDF3 = `<?xml version="1.0"?><device type="DMXDevice" dmxcversion="3.0.0"><information><ddf-library-id>857</ddf-library-id>
<model>Alpha Spot</model><vendor>Clay Paky</vendor><author>P &amp; G</author></information><functions>
<colorwheel dmxchannel="0"><step type="color" val="#ffffff" mindmx="0" maxdmx="0" caption="White"/><step type="color" val="#e21d26" mindmx="14" maxdmx="14" caption="Red"/>
<wheelrotation><range type="cw" mindmx="128" maxdmx="255"/></wheelrotation></colorwheel>
<strobe dmxchannel="1"><range type="pulse" mindmx="108" maxdmx="207"/></strobe><shutter dmxchannel="1"><step type="open" mindmx="252" maxdmx="255"/></shutter>
<dimmer dmxchannel="2"/><gobowheel dmxchannel="3"><step type="open" mindmx="0" maxdmx="7" caption="Open"/><step type="gobo" mindmx="8" maxdmx="15" caption="Gobo 1"/></gobowheel>
<position><pan dmxchannel="5" finedmxchannel="6" range="540"/><tilt dmxchannel="7" finedmxchannel="8" range="270"/></position></functions></device>`;

test('DDF 3: functions by tag, gaps filled, wheel steps with colours', () => {
  const [m] = ddfToModels(DDF3);
  assert.equal(m.model, 'Clay Paky Alpha Spot 9ch');
  assert.deepEqual(m.channels, ['color', 'shutter', 'dimmer', 'gobo', 'ch_5', 'pan', 'pan_fine', 'tilt', 'tilt_fine']);
  assert.equal(m.kind, 'heads');
  assert.deepEqual(m.colors, [{ name: 'White', value: 0, rgb: [1, 1, 1] }, { name: 'Red', value: 14, rgb: [0.886, 0.114, 0.149] }]);
  assert.deepEqual(m.gobos.map(g => g.name), ['Open', 'Gobo_1']);
  assert.match(m.notes, /DDF #857 di P & G \(CC-BY-SA-4\.0\)/);
});

const DDF2 = `<?xml version="1.0"?><device><information><ddf-library-id>100</ddf-library-id><vendor>Coemar</vendor><name>iSpot 575 EB (Mode 1)</name></information>
<channels><function channel="0" name="pan" type="pan"/><function channel="1" name="pan (fine)" type="panfine"/><function channel="2" name="tilt" type="tilt"/>
<function channel="3" name="movement speed"/><function channel="4" name="dimmer" type="dimmer"/><function channel="5" name="shutter, strobe"/>
<function channel="6" name="color 1" type="color"/><function channel="7" name="color 2" type="color"/></channels>
<form><dropdown name="color1_dropdown" action="SetColor1"><item caption="white" value="0" color="#ffffff"/><item caption="orange" value="8" color="#ff8000"/><item caption="rainbow*" value="-1"/></dropdown></form></device>`;

test('DDF 2: type attribute or channel name, mode from the name, slots from the panel menu', () => {
  const [m] = ddfToModels(DDF2);
  assert.equal(m.model, 'Coemar iSpot 575 EB 8ch');
  assert.equal(m.mode, 'Mode 1');
  assert.deepEqual(m.channels, ['pan', 'pan_fine', 'tilt', 'speed', 'dimmer', 'shutter', 'color', 'color_2']);
  assert.deepEqual(m.colors, [{ name: 'white', value: 0, rgb: [1, 1, 1] }, { name: 'orange', value: 8, rgb: [1, 0.502, 0] }]);
  assert.equal(roleFromName('Tilt (fine)'), 'tilt_fine');
});

test('library: index from both sources, search, fixture cached on disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-'));
  const calls = [];
  const body = url => {
    if (url.includes('git/trees')) return { tree: [{ path: 'fixtures/acme/test-spot.json' }, { path: 'fixtures/manufacturers.json' }] };
    if (url.endsWith('manufacturers.json')) return { acme: { name: 'Acme' } };
    if (url.endsWith('/devices')) return { data: [{ id: 94, name: 'iSpot 575 EB', vendor: { name: 'Coemar' } }] };
    if (url.endsWith('/ddfs')) return { data: [{ id: 100, device_id: 94, mode: null }] };
    if (url.endsWith('/ddfs/100/file')) return DDF2;
    if (url.endsWith('acme/test-spot.json')) return OFL;
    throw new Error('unexpected ' + url);
  };
  const fetchImpl = async url => { calls.push(url); const b = body(url); return { ok: true, status: 200, json: async () => b, text: async () => typeof b === 'string' ? b : JSON.stringify(b) }; };
  const lib = createLibrary({ dir, fetchImpl });
  const r = await lib.search('coemar ispot');
  assert.equal(r.total, 2);
  assert.deepEqual(r.results, [{ src: 'ddf', id: '100', vendor: 'Coemar', name: 'iSpot 575 EB', mode: '' }]);
  assert.equal((await lib.search('acme')).results[0].id, 'acme/test-spot');
  const models = await lib.fixture('ddf', '100');
  assert.equal(models[0].model, 'Coemar iSpot 575 EB 8ch');
  const n = calls.length;
  await createLibrary({ dir, fetchImpl }).fixture('ddf', '100'); // indice e file dalla cache
  assert.equal(calls.length, n);
  await assert.rejects(lib.fixture('ofl', '../../etc'), /non valido/);
});
