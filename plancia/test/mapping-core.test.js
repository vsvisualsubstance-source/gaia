'use strict';
// mapping/mapping-core.js: corner pin e mesh (portati da Regia), formato condiviso Plancia / Render 3D / Regia.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../mapping/mapping-core');

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('mapping di base: identita\'', () => {
  const m = M.defMap();
  for (const [u, v] of [[0, 0], [1, 0], [0.3, 0.7], [1, 1]]) { const p = M.warpPt(m, u, v); assert.ok(near(p[0], u) && near(p[1], v)); }
});

test('corner pin: gli angoli vanno dove detto, il centro segue la prospettiva', () => {
  const m = M.defMap(); m.corners = [[0.1, 0.2], [0.8, 0.1], [0.9, 0.95], [0.05, 0.8]];
  const c = [[0, 0], [1, 0], [1, 1], [0, 1]];
  c.forEach(([u, v], k) => { const p = M.warpPt(m, u, v); assert.ok(near(p[0], m.corners[k][0]) && near(p[1], m.corners[k][1]), `angolo ${k}`); });
  // inversa: dal punto sull'uscita torna alla sorgente
  const H = M.homog(m.corners), Hi = M.inv3(H), p = M.applyH(H, 0.37, 0.61), q = M.applyH(Hi, p[0], p[1]);
  assert.ok(near(q[0], 0.37) && near(q[1], 0.61));
});

test('mesh: un punto spostato muove l\'uscita, gli angoli restano; densita\' cambiata tiene la forma', () => {
  const m = M.defMap(); m.mode = 'mesh';
  const hs = M.handles(m); assert.strictEqual(hs.length, 16);
  M.moveHandle(m, 5, hs[5][0] + 0.05, hs[5][1] - 0.03);
  assert.ok(near(M.handles(m)[5][0], hs[5][0] + 0.05) && near(M.handles(m)[5][1], hs[5][1] - 0.03));
  assert.ok(near(M.warpPt(m, 0, 0)[0], 0) && near(M.warpPt(m, 1, 1)[1], 1));
  const before = M.warpPt(m, 0.33, 0.33);
  M.setMeshN(m, 6); assert.strictEqual(m.off.length, 36);
  const after = M.warpPt(m, 0.33, 0.33);
  assert.ok(near(before[0], after[0], 0.01) && near(before[1], after[1], 0.01), `forma tenuta: ${before} ${after}`);
});

test('fixMap: dati sbagliati o di Regia diventano un mapping valido', () => {
  assert.deepStrictEqual(M.fixMap(null), M.defMap());
  const r = M.fixMap({ mode: 'mesh', corners: [[0, 0], [1, 0]], n: 99, off: 'x', show: true });
  assert.strictEqual(r.mode, 'mesh'); assert.strictEqual(r.n, 8); assert.strictEqual(r.off.length, 64); assert.deepStrictEqual(r.corners, M.defMap().corners); assert.ok(!('show' in r));
  const g = M.fixMap({ corners: [[0.1, 0.1], [0.9, 0], [1, 1], [0, 0.9]] });
  assert.strictEqual(g.mode, 'corners'); assert.deepStrictEqual(g.corners[0], [0.1, 0.1]);
});

test('griglia per il renderer: punti deformati coerenti con warpPt; punto toccato', () => {
  const m = M.defMap(); m.corners = [[0.1, 0.2], [0.8, 0.1], [0.9, 0.95], [0.05, 0.8]];
  const g = M.meshGrid(m, 4), N = 5, k = 2 * N + 3, p = M.warpPt(m, 3 / 4, 2 / 4);
  assert.ok(near(g.pts[k * 2], p[0]) && near(g.pts[k * 2 + 1], p[1]));
  assert.strictEqual(g.idx.length, 4 * 4 * 6);
  assert.strictEqual(M.hitHandle(m, 0.81, 0.11, 1000, 1000), 1);
  assert.strictEqual(M.hitHandle(m, 0.5, 0.5, 1000, 1000), -1);
});
