'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audioSegments, audioDesired, audioCommands } = require('../audio-timeline');

const lens = new Map([['a'.repeat(16), 100], ['b'.repeat(16), 60], ['c'.repeat(16), 80]]);
const [A, B, C] = ['a', 'b', 'c'].map(x => x.repeat(16));
const lists = new Map([['pl-x', [A, B, C]]]);

test('playlist: brani in fila con dissolvenza, deck alternati', () => {
  const s = audioSegments([{ time: 10, fade: 4, src: { kind: 'playlist', id: 'pl-x' } }], lens, lists);
  assert.deepEqual(s.map(x => [x.track, x.start, x.deck, x.fade]), [[A, 10, 'A', 4], [B, 106, 'B', 4], [C, 162, 'A', 4]]);
  assert.deepEqual(s.map(x => x.end), [110, 166, 242]);
});

test('una cue nuova taglia la playlist; stop sfuma', () => {
  const s = audioSegments([
    { time: 0, fade: 0, src: { kind: 'playlist', id: 'pl-x' } },
    { time: 120, fade: 8, src: { kind: 'track', id: C } },
    { time: 150, fade: 5, src: { kind: 'stop' } },
  ], lens, lists);
  // A (0-100), B da 96 (dissolvenza 0: da 100), C della cue a 120; C della playlist (da 156) non c'e'
  assert.deepEqual(s.map(x => x.stop ? 'stop' : x.track), [A, B, C, 'stop']);
  assert.equal(s[1].start, 100);
  assert.equal(s[1].end, 128, 'B finisce dopo la dissolvenza della cue a 120');
  assert.equal(s[2].deck, 'A');
  const at = t => audioDesired(s, t, true).want;
  assert.deepEqual(at(50).A, { track: A, pos: 50, playing: true, fader: 1 });
  const mid = at(124);   // dissolvenza B -> C a meta'
  assert.equal(mid.A.track, C); assert.equal(mid.A.fader, 0.5);
  assert.equal(mid.B.track, B); assert.equal(mid.B.fader, 0.5); assert.equal(mid.B.pos, 24);
  const stop = at(152);  // stop: C scende
  assert.equal(stop.A.track, C); assert.ok(Math.abs(stop.A.fader - 0.6) < 1e-9);
  assert.equal(at(160).A, null, 'dopo lo stop niente');
});

test('il brano dopo si prepara fermo sull\'altro deck', () => {
  const s = audioSegments([{ time: 0, src: { kind: 'track', id: A } }, { time: 90, src: { kind: 'track', id: B } }], lens, lists);
  const w = audioDesired(s, 70, true).want;
  assert.equal(w.A.track, A);
  assert.deepEqual(w.B, { track: B, pos: 0, playing: false, fader: 0 });
});

test('comandi: carica, riposiziona, play/pausa, fader, tempo naturale', () => {
  const pend = {};
  const want = { A: { track: A, pos: 30, playing: true, fader: 1 }, B: null };
  const eng = { decks: { A: { track: null, pos: 0, playing: false }, B: { track: null } }, mix: { A: { fader: 1 }, B: { fader: 1 }, xfader: 0 } };
  let c = audioCommands(want, eng, 1000, pend);
  assert.equal(c[0].cmd, 'deck.load'); assert.equal(c[0].force, true); assert.equal(c[0].play, true);
  assert.equal(audioCommands(want, eng, 1500, pend).length, 0, 'caricamento in corso: non si rimanda');
  // caricato ma 2 s indietro, in sync e a +4%: si sistema tutto
  eng.decks.A = { track: A, pos: 28, playing: true, sync: true, tempo: 0.5, rate: 1.04 };
  eng.mix.xfader = -1;
  c = audioCommands(want, eng, 9000, pend);
  assert.deepEqual(c.map(x => x.cmd).sort(), ['deck.seek', 'deck.sync', 'deck.tempo', 'mix.set'].sort());
  // show in pausa
  c = audioCommands({ A: { ...want.A, playing: false }, B: null }, { ...eng, decks: { A: { track: A, pos: 30, playing: true } }, mix: { A: { fader: 1 }, xfader: 0 } }, 9600, pend);
  assert.deepEqual(c, [{ cmd: 'deck.play', deck: 'A', value: false }]);
});
