// Autoplay della Console Audio: coda, dissolvenze, deck alternati, avanti, a caso senza ripetere
const test = require('node:test'), assert = require('node:assert/strict');
const { pickNext, extendQueue, skip, startAudioAuto } = require('../audio-auto');
const { audioDesired } = require('../audio-timeline');

const lens = new Map([['a', 200], ['b', 180], ['c', 240], ['d', 10]]);
const fresh = (o = {}) => ({ mode: 'order', fade: 8, segs: [], idx: 0, recent: [], nextAt: null, nextFade: 0, ...o });

test('in ordine: coda di brani, il primo pieno, poi dissolvenze e deck alternati', () => {
  const st = fresh();
  extendQueue(st, 0, lens, ['a', 'b', 'c']);
  assert.deepEqual(st.segs.map(s => [s.track, s.start, s.fade, s.deck]), [['a', 0, 0, 'A']]);
  extendQueue(st, 160, lens, ['a', 'b', 'c']);                 // a 40 s dalla fine entra il prossimo
  assert.deepEqual(st.segs.map(s => [s.track, s.start, s.fade, s.deck]), [['a', 0, 0, 'A'], ['b', 192, 8, 'B']]);
  const mid = audioDesired(st.segs, 196, true).want;           // a meta' dissolvenza: a scende, b sale
  assert.equal(mid.A.track, 'a'); assert.equal(mid.B.track, 'b');
  assert.ok(Math.abs(mid.A.fader - 0.5) < 1e-9 && Math.abs(mid.B.fader - 0.5) < 1e-9);
  extendQueue(st, 340, lens, ['a', 'b', 'c']);
  assert.equal(st.segs[2].track, 'c'); assert.equal(st.segs[2].deck, 'A');
  extendQueue(st, 600, lens, ['a', 'b', 'c']);
  assert.equal(st.segs[3].track, 'a', 'finita la playlist ricomincia');
});

test('brano corto: la dissolvenza non supera meta\' brano', () => {
  const st = fresh();
  extendQueue(st, 0, lens, ['d', 'a']);
  assert.equal(st.segs[1].fade, 5);
  assert.equal(st.segs[1].start, 5);
});

test('avanti: il brano in onda sfuma adesso, il prossimo entra sull\'altro deck', () => {
  const st = fresh();
  extendQueue(st, 0, lens, ['a', 'b']);
  assert.ok(skip(st, 50));
  assert.equal(st.segs[0].start + st.segs[0].len, 58);
  extendQueue(st, 50, lens, ['a', 'b']);
  assert.deepEqual([st.segs[1].track, st.segs[1].start, st.segs[1].deck], ['b', 50, 'B']);
  const w = audioDesired(st.segs, 54, true).want;
  assert.ok(w.A.fader < 1 && w.B.fader > 0 && w.A.playing && w.B.playing);
  assert.equal(audioDesired(st.segs, 59, true).want.A, null, 'dopo la dissolvenza il primo deck e\' libero');
});

test('a caso: niente ripetizioni finche\' non sono passati quasi tutti', () => {
  const st = fresh({ mode: 'shuffle' }), pool = ['a', 'b', 'c', 'x', 'y', 'z'];
  let r = 0; const rnd = () => (r = (r * 7 + 3) % 11) / 11;
  const got = [];
  for (let i = 0; i < 6; i++) { const id = pickNext(st, pool, rnd); st.recent.push(id); got.push(id); }
  assert.equal(new Set(got.slice(0, 5)).size, 5);
  assert.equal(pickNext(fresh({ mode: 'shuffle' }), []), null);
});

test('modulo: start, stato, stop con dissolvenza e timeline che ha la precedenza', async () => {
  const sent = [], states = [];
  let tl = false;
  const engine = { up: () => true, stateAt: () => Date.now(), send: c => sent.push(c),
    state: () => ({ decks: { A: { track: null, pos: 0, playing: false }, B: { track: null, pos: 0, playing: false } }, mix: { A: { fader: 1 }, B: { fader: 1 }, xfader: 0 } }) };
  const lib = { library: async () => [{ id: 'a', seconds: 200, title: 'Alfa', artist: 'X' }, { id: 'b', seconds: 180, title: 'Beta', artist: 'Y' }], playlists: async () => [{ id: 'pl', name: 'Sera', tracks: ['b', 'a'] }] };
  const au = startAudioAuto({ engine, lib, broadcast: m => states.push(m.state), timelineActive: () => tl, log: () => {} });
  try {
    await new Promise(r => setTimeout(r, 50));
    assert.equal(au.command({ action: 'start', source: 'nessuna', mode: 'order' }), 'La playlist è vuota.');
    assert.equal(au.command({ action: 'start', source: 'pl', mode: 'order', fade: 6 }), null);
    await new Promise(r => setTimeout(r, 250));
    assert.ok(sent.some(c => c.cmd === 'deck.load' && c.track === 'b' && c.deck === 'A' && c.play), 'carica e suona il primo della playlist');
    const s = au.state();
    assert.equal(s.sourceName, 'Sera'); assert.equal(s.now.title, 'Beta'); assert.ok(au.active());
    tl = true; sent.length = 0;
    await new Promise(r => setTimeout(r, 250));
    assert.equal(sent.length, 0, 'timeline AUDIO attiva: l\'autoplay non manda comandi');
    assert.ok(au.state().waiting && !au.active());
    tl = false;
    au.command({ action: 'stop' });
    assert.ok(au.state().stopping);
  } finally { au.stop(); }
});
