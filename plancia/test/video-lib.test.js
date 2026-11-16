'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { list, resolve, serve } = require('../video-lib');

function tmpLib() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regia-lib-'));
  fs.mkdirSync(path.join(dir, 'Atto 1'));
  fs.writeFileSync(path.join(dir, 'Atto 1', 'scena 10.mp4'), Buffer.alloc(1000, 1));
  fs.writeFileSync(path.join(dir, 'Atto 1', 'scena 2.mp4'), Buffer.alloc(10));
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.alloc(5));
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
  fs.writeFileSync(path.join(dir, '.nascosto.mp4'), 'x');
  return dir;
}

function fakeRes() {
  const r = { code: 0, head: null, body: [] };
  r.writeHead = (c, h) => { r.code = c; r.head = h || {}; };
  r.end = b => { if (b) r.body.push(Buffer.from(b)); r.done(); };
  r.write = b => { r.body.push(Buffer.from(b)); return true; };
  r.on = r.once = r.emit = () => r; r.removeListener = () => r;
  return r;
}
const run = (dir, rel, headers = {}) => new Promise(done => { const res = fakeRes(); res.done = () => done(res); serve({ headers, method: 'GET' }, res, rel, dir); });

test('elenco: solo video e immagini, sottocartelle, ordine naturale', async () => {
  const dir = tmpLib();
  const l = await list(dir);
  assert.deepStrictEqual(l.map(f => f.rel), ['Atto 1/scena 2.mp4', 'Atto 1/scena 10.mp4', 'logo.png']);
  assert.strictEqual(l[0].folder, 'Atto 1');
  assert.strictEqual(l[2].type, 'image');
});

test('niente file fuori dalla cartella', () => {
  const dir = tmpLib();
  assert.strictEqual(resolve('../segreto.mp4', dir), null);
  assert.strictEqual(resolve('Atto 1/../../x.mp4', dir), null);
  assert.strictEqual(resolve('note.txt', dir), null);
  assert.ok(resolve('Atto 1/scena 2.mp4', dir));
});

test('Range: 206 con il pezzo chiesto, 416 fuori misura, 404 se manca', async () => {
  const dir = tmpLib();
  const part = await new Promise(done => {
    const res = fakeRes(), chunks = [];
    const { Writable } = require('stream');
    const w = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); }, final(cb) { done({ res, data: Buffer.concat(chunks) }); cb(); } });
    w.writeHead = res.writeHead; Object.defineProperty(w, 'code', { get: () => res.code }); w.head = null;
    w.writeHead = (c, h) => { res.writeHead(c, h); w.head = h; };
    serve({ headers: { range: 'bytes=100-199' }, method: 'GET' }, w, 'Atto 1/scena 10.mp4', dir);
  });
  assert.strictEqual(part.res.code, 206);
  assert.strictEqual(part.res.head['content-range'], 'bytes 100-199/1000');
  assert.strictEqual(part.data.length, 100);
  assert.strictEqual((await run(dir, 'Atto 1/scena 10.mp4', { range: 'bytes=5000-' })).code, 416);
  assert.strictEqual((await run(dir, 'manca.mp4')).code, 404);
});
