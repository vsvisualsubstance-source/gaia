'use strict';
// Lettore ILDA (src/99-laser-import.js) su file costruiti qui byte per byte.
const test = require('node:test');
const assert = require('node:assert/strict');
global.uid = () => 'x';
const { lzsParseIlda, ildaStrokes } = require('../src/99-laser-import');

test('libreria laser: rifiuta id che escono dalla cartella, miniatura leggera', async () => {
  const lib = require('../laser-lib'), { preview } = require('../laser-lib-build');
  for (const id of ['../state', 'a/b', 'index', '']) await assert.rejects(lib.scene(id), /non valida/);
  const long = { pts: Array.from({ length: 1000 }, (_, i) => [i / 1000, 0]), rgb: [1, 0, 0] }, dot = { pts: [[.1, .2], [.1, .2]], rgb: [1, 1, 1] };
  const p = preview([long, dot]);
  assert.ok(p.reduce((n, s) => n + s.pts.length, 0) <= 180);
  assert.equal(p[1].pts.length, 2);
});

test('punti fermi accesi: restano come fascio, un campione isolato no', () => {
  const P = (x, lit) => ({ x, y: 0, lit, rgb: [1, 1, 1] });
  const st = ildaStrokes([P(.5, false), P(.5, true), P(.5, true), P(.5, true), P(.9, false), P(.2, false), P(.2, true)]);
  assert.equal(st.length, 1);
  assert.equal(st[0].pts.length, 3);
  assert.deepEqual(st[0].pts[0], [.5, 0]);
  assert.equal('n' in st[0], false);
});

// sezione ILDA: intestazione di 32 byte + record
function section(fmt, records, size, write) {
  const b = Buffer.alloc(32 + records.length * size);
  b.write('ILDA', 0, 'ascii'); b[7] = fmt; b.writeUInt16BE(records.length, 24);
  records.forEach((r, i) => write(b, 32 + i * size, r));
  return b;
}
const truecolor2d = pts => section(5, pts, 8, (b, o, [x, y, st, r, g, bl]) => { b.writeInt16BE(x, o); b.writeInt16BE(y, o + 2); b[o + 4] = st; b[o + 5] = bl; b[o + 6] = g; b[o + 7] = r; });
const end = () => section(5, [], 8, () => {});
const buf = (...parts) => { const b = Buffer.concat(parts); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

test('true colour frames: blanked point splits strokes, colours are BGR in the file', () => {
  const f1 = truecolor2d([[-32767, 0, 0x40, 0, 0, 0], [0, 0, 0, 255, 0, 0], [32767, 0, 0, 255, 0, 0], [0, 32767, 0x40, 0, 0, 0], [0, -32767, 0x80, 0, 0, 255]]);
  const f2 = truecolor2d([[0, 0, 0x40, 0, 0, 0], [16383, 16383, 0x80, 0, 255, 0]]);
  const sc = lzsParseIlda(buf(f1, f2, end()), 'prova');
  assert.equal(sc.frames.length, 2);
  assert.deepEqual(sc.frames[0].strokes.map(s => s.rgb), [[1, 0, 0], [0, 0, 1]]);
  assert.deepEqual(sc.frames[0].strokes[0].pts, [[-1, 0], [0, 0], [1, 0]]);         // parte dal punto spento precedente
  assert.deepEqual(sc.frames[1].strokes[0].pts, [[0, 0], [0.5, 0.5]]);
  assert.equal(sc.color.mode, 'stroke');
});

test('indexed colours use the palette section, a single frame is a plain scene', () => {
  const pal = section(2, [[0, 255, 0]], 3, (b, o, rgb) => rgb.forEach((v, k) => { b[o + k] = v; }));
  const idx = section(1, [[0, 0, 0x40, 0], [32767, 0, 0, 0]], 6, (b, o, [x, y, st, c]) => { b.writeInt16BE(x, o); b.writeInt16BE(y, o + 2); b[o + 4] = st; b[o + 5] = c; });
  const sc = lzsParseIlda(buf(pal, idx, end()));
  assert.equal(sc.frames, undefined);
  assert.deepEqual(sc.strokes[0].rgb, [0, 1, 0]);
});

test('not ILDA or truncated: clear errors', () => {
  assert.throws(() => lzsParseIlda(buf(Buffer.from('PK\u0003\u0004'.padEnd(40, 'x')))), /non è un file ILDA/);
  const f = truecolor2d([[0, 0, 0, 255, 0, 0], [1, 1, 0, 255, 0, 0]]);
  assert.throws(() => lzsParseIlda(buf(f.subarray(0, 40))), /troncato/);
});
