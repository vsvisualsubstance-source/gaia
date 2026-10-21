'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { parseMagicQShow, mqRole } = require('../src/67-magicq-import');

const SAMPLE = "V,0091,\"MagicQ 1\",01090703,0000,0002,;\nP,0007,\"Test_Spot_14\",\"Acme\",\"14ch\",\"Spot14\",\n0006,0006,000a,0006,021a,0104,0001,0001,01f1,80000001,\n\"Pan\",00000036,00000004,\n\"Pan F\",0000003a,00000004,\n\"Tilt\",00000036,00000005,\n\"Dimmer\",00000001,00000000,\n\"Col\",00000022,00000006,\n\"Gobo\",00000022,00000007,\n0006,0000,0080,0001,0000,0002,\n0004,\"White\",0000,0007,1000,06000026,\n0004,\"Red\",0010,001f,1000,06000020,\n0004,\"Col Scroll CW\",0080,00be,3000,0200000c,\n0004,\"Light blue\",0020,002f,1000,06000002,\n0005,\"Open\",0000,0007,0000,0,\n0005,\"Dots\",0008,000f,0000,0,\nP,0008,\"Par_RGB\",\"Acme\",\"3ch\",\"ParRGB\",\n0003,0000,0000,\n\"Red\",00000001,00000001,\n\"Green\",00000001,00000002,\n\"Blue\",00000001,00000003,\n0003,0000,0000,\n";

test('MagicQ channel names become DMX Master roles', () => {
  assert.deepEqual(['Pan', 'Pan F', 'Tilt F', 'Dimmer', 'Shutter', 'Col', 'Cyan', 'M Speed', 'Zap FX', 'C.Mode', '2nd'].map(mqRole),
    ['pan', 'pan_fine', 'tilt_fine', 'dimmer', 'shutter', 'color', 'cyan', 'speed', 'zap_fx', 'c_mode', 'ch_2nd']);
});

test('personalities: channels, kind, wheel and gobo slots (scroll ranges skipped)', () => {
  const [spot, par] = parseMagicQShow(SAMPLE);
  assert.equal(spot.model, 'Acme Spot14 14ch');
  assert.equal(spot.kind, 'heads');
  assert.deepEqual(spot.channels, ['pan', 'pan_fine', 'tilt', 'dimmer', 'color', 'gobo']);
  assert.deepEqual(spot.colors, [{ name: 'White', value: 0, rgb: [1, 1, 1] }, { name: 'Red', value: 16, rgb: [1, 0, 0] }, { name: 'Light_blue', value: 32, rgb: [.4, .75, 1] }]);
  assert.deepEqual(spot.gobos.map(g => g.name), ['Open', 'Dots']);
  assert.equal(par.kind, 'chase');
  assert.deepEqual(par.channels, ['red', 'green', 'blue']);
  assert.deepEqual(par.colors, []);
});

const REAL = 'G:/Il mio Drive/base311026/exportbase.shw';
test('real BASE export: Coemar iWash575 EB, 16 ch, CMY + wheel', { skip: !fs.existsSync(REAL) }, () => {
  const list = parseMagicQShow(fs.readFileSync(REAL, 'latin1'));
  const w = list.find(p => /iWash/i.test(p.model));
  assert.equal(w.model, 'Coemar iWash575 EB');
  assert.ok(w, 'personalita iWash trovata');
  assert.equal(w.kind, 'heads');
  assert.equal(w.channels.length, 16);
  for (const r of ['pan', 'pan_fine', 'tilt', 'tilt_fine', 'speed', 'dimmer', 'shutter', 'color', 'cyan', 'magenta', 'yellow']) assert.ok(w.channels.includes(r), r);
  assert.deepEqual(w.colors.map(c => c.name), ['White', 'Cyan', 'Orange', 'Magenta', 'Green', 'Red', 'Blue']);
});
