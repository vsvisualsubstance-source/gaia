'use strict';
// /laser/... dalla Plancia o dal MIDI -> comandi del laser gateway (laser-live.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { laserLiveCommand } = require('../laser-live');

const SCENES = [{ id: 'tpl-cerchio', name: 'Cerchio', strokes: [] }];

test('other addresses are not laser commands', () => {
  assert.equal(laserLiveCommand('/dmx/scene', [1], SCENES), null);
  assert.equal(laserLiveCommand('/laserx/fx/zoom', [1], SCENES), null);
});

test('fx faders, reset and blackout only on press', () => {
  assert.deepEqual(laserLiveCommand('/laser/fx/zoom', [1.5], SCENES), { action: 'fx', values: { zoom: 1.5 } });
  assert.deepEqual(laserLiveCommand('/laser/fx/reset', [1], SCENES), { action: 'fx', reset: true });
  assert.deepEqual(laserLiveCommand('/laser/fx/reset', [0], SCENES), { skip: true });
  assert.deepEqual(laserLiveCommand('/laser/blackout', [], SCENES), { action: 'blackout' });
  assert.deepEqual(laserLiveCommand('/laser/fx/boh', [1], SCENES), { skip: true });
});

test('flash: press sends the whole scene, release ends it, unknown scene does nothing', () => {
  assert.deepEqual(laserLiveCommand('/laser/flash/tpl-cerchio', [1], SCENES), { action: 'flash', on: true, scene: SCENES[0] });
  assert.deepEqual(laserLiveCommand('/laser/flash/tpl-cerchio', [0], SCENES), { action: 'flash', on: false });
  assert.deepEqual(laserLiveCommand('/laser/flash/nessuna', [1], SCENES), { skip: true });
});
