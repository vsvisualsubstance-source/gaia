'use strict';
// Analisi dei brani dalla Plancia e cartelle musica in piu' (audio-analyze.js, audio-lib.js; 20/11)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-'));
const MUSIC = path.join(tmp, 'musica'), CACHE = path.join(tmp, 'cache'), USB = path.join(tmp, 'usb');
for (const d of [MUSIC, CACHE, USB, path.join(MUSIC, 'Beat'), path.join(USB, 'Set')]) fs.mkdirSync(d, { recursive: true });
process.env.GAIA_MUSIC = MUSIC;
process.env.AUDIO_CACHE = CACHE;
const lib = require('../audio-lib');
const ana = require('../audio-analyze');

// 8 s di cassa a 120 BPM, wav mono 16 bit
function clickWav(file) {
  const rate = 22050, n = rate * 8, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = (i % (rate / 2)) / rate;
    data.writeInt16LE(Math.round(Math.exp(-t * 40) * Math.sin(2 * Math.PI * 60 * t) * 20000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
clickWav(path.join(MUSIC, 'Beat', 'uno.wav'));
clickWav(path.join(USB, 'Set', 'due.wav'));
fs.writeFileSync(path.join(USB, 'Set', '._due.wav'), 'mac');   // come il motore: ignorato

test('id come il motore (FNV-1a del percorso relativo, o assoluto fuori dalla cartella principale)', () => {
  assert.strictEqual(ana.trackId(''), 'cbf29ce484222325');
  assert.strictEqual(ana.trackId('a'), 'af63dc4c8601ec8c');
  assert.strictEqual(ana.relOf(path.join(lib.normDir(MUSIC), 'Beat', 'uno.wav')), 'Beat/uno.wav');
  assert.strictEqual(ana.relOf(path.join(USB, 'Set', 'due.wav')), path.join(USB, 'Set', 'due.wav').split(path.sep).join('/'));
});

test('cartelle musica: assolute, senza doppioni ne\' la principale', async () => {
  assert.throws(() => lib.cleanRoots([{ path: 'relativa' }]));
  const r = await lib.saveMusicRoots([{ path: USB, name: 'Chiavetta' }, { path: USB + path.sep }, { path: MUSIC }]);
  assert.deepStrictEqual(r, [{ path: lib.normDir(USB), name: 'Chiavetta' }]);
  assert.ok(await ana.allowed(path.join(USB, 'Set')));
  assert.ok(await ana.allowed(path.join(MUSIC, 'Beat')));
  assert.ok(!(await ana.allowed(tmp)));
});

test('sfoglia: dischi, sottocartelle, brani nella cartella', async () => {
  const top = await ana.dirs('');
  assert.ok(top.dirs.some(d => /^C:\\$/i.test(d.name)));
  const d = await ana.dirs(path.join(USB, 'Set'));
  assert.strictEqual(d.audio, 1);
  assert.strictEqual(d.parent, lib.normDir(USB));
});

test('analisi col motore vero: avanzamento, libreria, disco staccato', { skip: !fs.existsSync(ana.EXE) && 'gaia-audio.exe non compilato' }, async () => {
  const msgs = [];
  let done;
  const finished = new Promise(r => { done = r; });
  const a = ana.startAudioAnalyze({ broadcast: m => { msgs.push(m); if (!m.state.running) done(m.state); }, onDone: () => lib.library(true), log: () => {} });
  assert.deepStrictEqual((await a.roots()).map(r => [r.main || false, r.files, r.analyzed]), [[true, 1, 0], [false, 1, 0]]);
  await assert.rejects(a.start({ folder: tmp }), /fuori dalla musica/);
  await a.start({ folder: USB });
  await assert.rejects(a.start({ folder: MUSIC }), /in corso/);
  const st = await finished;
  assert.strictEqual(st.tot, 1);
  assert.strictEqual(st.analyzed + st.failed, 1, JSON.stringify(st));
  await a.start({ folder: MUSIC });
  await new Promise(r => { const iv = setInterval(() => { if (!a.running()) { clearInterval(iv); r(); } }, 50); });
  const roots = await a.roots();
  assert.deepStrictEqual(roots.map(r => r.analyzed), [1, 1]);
  let list = await lib.library(true);
  const ext = list.find(t => t.ext);
  assert.ok(ext && !ext.offline && list.find(t => t.path === 'Beat/uno.wav'));
  assert.strictEqual((await lib.trackFile(ext.id)).file.toLowerCase(), path.join(USB, 'Set', 'due.wav').toLowerCase());
  // disco staccato: in libreria, segnato
  fs.renameSync(USB, USB + '-via');
  list = await lib.library(true);
  assert.strictEqual(list.find(t => t.ext).offline, true);
  assert.strictEqual((await a.roots())[1].online, false);
  fs.renameSync(USB + '-via', USB);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows */ } });
