const test = require('node:test');
const assert = require('node:assert/strict');
const { layeredLaserState, laserCommands } = require('../laser-timeline');

const cues = [
  { time: 0, cube: 'all', mode: 'scene', scene: 'cerchio' },
  { time: 10, cube: 'c2', mode: 'patchdeck' },
  { time: 20, cube: 'all', scene: 'spirale' },
  { time: 30, cube: 'c1', mode: 'off' },
];
const scenes = [{ id: 'cerchio', name: 'Cerchio' }, { id: 'spirale', name: 'Spirale' }];

test('a strati: ogni cubo prende l\'ultima cue che lo riguarda, anche dopo un seek', () => {
  assert.deepEqual(layeredLaserState(cues, 5, ['c1', 'c2']).cubes, { c1: { mode: 'scene', scene: 'cerchio' }, c2: { mode: 'scene', scene: 'cerchio' } });
  const at25 = layeredLaserState(cues, 25, ['c1', 'c2']);
  assert.equal(at25.cue, 2);
  assert.deepEqual(at25.cubes.c2, { mode: 'patchdeck', scene: 'spirale' });
  assert.deepEqual(layeredLaserState(cues, 35, ['c1', 'c2']).cubes.c1, { mode: 'off', scene: 'spirale' });
  assert.equal(layeredLaserState(cues, -1, ['c1']).cue, -1);
});

test('comandi: scena prima della modalita\', solo cio\' che cambia, scene sconosciute saltate', () => {
  const next = layeredLaserState(cues, 5, ['c1']);
  assert.deepEqual(laserCommands({}, next, scenes), [
    { action: 'scene', cube: 'c1', scene: scenes[0], mode: false },
    { action: 'mode', cube: 'c1', value: 'scene' },
  ]);
  assert.deepEqual(laserCommands({ c1: { mode: 'scene', scene: 'cerchio' } }, next, scenes), []);
  const ghost = { cubes: { c1: { mode: null, scene: 'sparita' } } };
  assert.deepEqual(laserCommands({}, ghost, scenes), []);
});
