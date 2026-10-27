'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { layeredVideoState, videoCommands, clockPosition } = require('../video-timeline');

const CUES = [
  { time: 0, label: 'Intro', deck: 'A', patch: 10, show: 'A', fx: { edge: 0.2 } },
  { time: 10, label: 'B pronto', deck: 'B', patch: 5 },                // carica su B senza mostrarlo
  { time: 20, label: 'Stacco su B', show: 'B', fx: { mirror: 0.8 } },
  { time: 30, label: 'Entrambi', deck: 'A', patch: 12, show: 'AB', fx: { edge: 1 } }
];

test('layered state: each field from the last cue that sets it', () => {
  assert.deepEqual(layeredVideoState(CUES, -1), { patchA: null, patchB: null, showA: null, showB: null, fx: {}, cue: -1, mix: null });
  const s15 = layeredVideoState(CUES, 15);
  assert.deepEqual([s15.patchA, s15.patchB, s15.showA, s15.showB, s15.cue], [10, 5, true, false, 1]);
  assert.deepEqual(s15.fx, { edge: 0.2 });
  const s25 = layeredVideoState(CUES, 25);
  assert.deepEqual([s25.patchA, s25.patchB, s25.showA, s25.showB], [10, 5, false, true]);
  assert.deepEqual(s25.fx, { edge: 0.2, mirror: 0.8 });                  // gli effetti si sommano
  const s35 = layeredVideoState(CUES, 35);
  assert.deepEqual([s35.patchA, s35.showA, s35.showB, s35.fx.edge, s35.fx.mirror], [12, true, true, 1, 0.8]);
});

test('commands: only what changes, in the PatchDeck form the tablet uses', () => {
  const none = { patchA: null, patchB: null, showA: null, showB: null, fx: {} };
  assert.deepEqual(videoCommands(none, layeredVideoState(CUES, 0)), [
    { action: 'enable', service: 'load_x10_a' }, { action: 'enable', service: 'deck_a' }, { action: 'disable', service: 'deck_b' }, // "solo A" spegne anche B
    { action: 'set', param: 'edge', value: 0.2 }]);
  const at15 = layeredVideoState(CUES, 15), at25 = layeredVideoState(CUES, 25);
  assert.deepEqual(videoCommands(at15, at25), [
    { action: 'disable', service: 'deck_a' }, { action: 'enable', service: 'deck_b' }, { action: 'set', param: 'mirror', value: 0.8 }]);
  assert.deepEqual(videoCommands(at25, at25), []);
  // dopo un seek all'indietro si ricalcola: da 35 a 15 tornano patch A 10 e solo A visibile
  assert.deepEqual(videoCommands(layeredVideoState(CUES, 35), at15).map(c => c.service || c.param), ['load_x10_a', 'deck_b', 'edge']);
});

test('fx clamped to 0-1, bad cues ignored', () => {
  const s = layeredVideoState([{ time: 0, deck: 'C', patch: 3, fx: { edge: 7, blur: 1 } }, { time: 'x', show: 'A' }], 5);
  assert.deepEqual([s.patchA, s.patchB, s.showA], [null, null, null]);
  assert.deepEqual(s.fx, { edge: 1 });
});

test('clock follower: extrapolates while playing, wraps on loop, holds when paused', () => {
  const c = { pos: 10, playing: true, rate: 1, length: 70, loop: true, receivedAt: 1000 };
  assert.equal(clockPosition(c, 3500), 12.5);
  assert.equal(clockPosition({ ...c, pos: 69 }, 3000), 1);
  assert.equal(clockPosition({ ...c, loop: false, pos: 69 }, 3000), 70);
  assert.equal(clockPosition({ ...c, playing: false }, 9000), 10);
  assert.equal(clockPosition(null, 0), null);
});

test('crossfade with deck_mix: both decks on during the fade, mix computed from time (seek-safe)', () => {
  const FADE = [
    { time: 0, deck: 'A', patch: 1, show: 'A' },
    { time: 5, deck: 'B', patch: 2 },
    { time: 10, show: 'B', fade: 4 },          // dissolvenza A -> B in 4 s
    { time: 20, show: 'A' },                   // stacco netto su A
  ];
  const s9 = layeredVideoState(FADE, 9);
  assert.deepEqual([s9.showA, s9.showB, s9.mix], [true, false, 0]);
  const s12 = layeredVideoState(FADE, 12);
  assert.deepEqual([s12.showA, s12.showB, s12.mix], [true, true, 0.5]);  // a meta' fade
  const s15 = layeredVideoState(FADE, 15);
  assert.deepEqual([s15.showA, s15.showB, s15.mix], [false, true, 1]);   // finita: solo B
  assert.equal(layeredVideoState(FADE, 21).mix, 0);
  // comandi: deck_mix solo se PatchDeck lo pubblica, e solo se cambia
  assert.deepEqual(videoCommands(s9, s12, { mix: true }), [{ action: 'enable', service: 'deck_b' }, { action: 'set', param: 'deck_mix', value: 0.5 }]);
  assert.deepEqual(videoCommands(s9, s12), [{ action: 'enable', service: 'deck_b' }]);
  assert.deepEqual(videoCommands(s12, s15, { mix: true }), [{ action: 'disable', service: 'deck_a' }, { action: 'set', param: 'deck_mix', value: 1 }]);
  assert.deepEqual(videoCommands(s12, { ...s12, mix: 0.502 }, { mix: true }), []); // sotto la soglia: niente messaggio
});
