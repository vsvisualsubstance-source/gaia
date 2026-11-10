// import SVG: gli spigoli veri restano, i tratti dritti si riducono
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../src/99-laser-scenes.js'), 'utf8');
const a = src.indexOf('// --- calcolo puro'), b = src.indexOf('// --- fine calcolo puro');
const c = {}; vm.createContext(c); vm.runInContext(src.slice(a, b), c);
// quadrato di lato 100 percorso a lunghezza (spigoli a 100, 200, 300, che non cadono sui campioni)
const square = l => { const s = Math.min(3.9999, l / 100), k = Math.floor(s), t = (s - k) * 100, X = [[0, 0], [100, 0], [100, 100], [0, 100]], D = [[1, 0], [0, 1], [-1, 0], [0, -1]]; return { x: X[k][0] + D[k][0] * t, y: X[k][1] + D[k][1] * t }; };

test('gli spigoli del quadrato vengono trovati anche fra due campioni', () => {
  const lens = c.lzsCornerLens(400, square, 13);
  for (const v of [100, 200, 300]) assert.ok(lens.some(l => Math.abs(l - v) < 0.01), 'spigolo a ' + v);
});

test('un quadrato resta di 4 punti esatti e chiuso', () => {
  const pts = c.lzsCornerLens(400, square, 13).map(l => { const p = square(Math.min(399.9999, l)); return [p.x / 100, p.y / 100]; });
  const r = c.lzsSimplify(pts);
  assert.equal(r.closed, true);
  assert.equal(r.pts.length, 4);
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) assert.ok(r.pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 0.002), x + ',' + y);
});

test('una curva non viene appiattita', () => {
  const pts = Array.from({ length: 41 }, (_, i) => [Math.cos(i / 40 * 3), Math.sin(i / 40 * 3)]);
  assert.ok(c.lzsSimplify(pts).pts.length > 20);
});

test('una linea dritta resta di due punti, un andata e ritorno no', () => {
  assert.equal(c.lzsSimplify([[0, 0], [.5, 0], [1, 0]]).pts.length, 2);
  assert.ok(c.lzsSimplify([[0, 0], [1, 0], [.5, 0]]).pts.length >= 3);
});

test('Adatta: basta la Dimensione, oppure si propone di togliere le linee piu corte', () => {
  const ringA = r => ({ closed: true, pts: Array.from({ length: 96 }, (_, i) => [r * Math.cos(i / 96 * 6.2832), r * Math.sin(i / 96 * 6.2832)]) });
  const S = (strokes, scale, extra) => ({ strokes, anim: { scale }, ...extra });
  assert.equal(c.lzsAutoFit(S([ringA(.3)], .5)).kind, 'ok');
  const two = [ringA(.95), ringA(.7)];
  const g = c.lzsAutoFit(S(two, 1));
  assert.equal(g.kind, 'scale');
  assert.ok(g.scale >= .5);
  assert.equal(c.lzsWeight(S(two, g.scale)).level, 'leggera');
  // poche linee lunghe piu' tanti trattini: senza trattini torna leggera, le lunghe restano
  const ticks = Array.from({ length: 30 }, (_, i) => ({ pts: [[-.9 + i * .06, (i % 2 ? .9 : -.9)], [-.88 + i * .06, (i % 2 ? .9 : -.9)]] }));
  const big = [ringA(.7), ringA(.4)];
  const mix = S([...big, ...ticks], .8), r = c.lzsAutoFit(mix);
  assert.equal(r.kind, 'choice');
  assert.ok(r.removed > 0 && r.removed <= 30, 'linee tolte ' + r.removed);
  assert.equal(r.scale, .5);
  assert.ok(r.strokes.includes(big[0]) && r.strokes.includes(big[1]));
  assert.equal(c.lzsWeight(S(r.strokes, r.scale)).level, 'leggera');
  // animazione: non si tolgono linee, al massimo la Dimensione
  const anim = c.lzsAutoFit(S([], .8, { frames: [{ strokes: [...big, ...ticks] }] }));
  assert.equal(anim.strokes, undefined);
});

// peso delle figure
const scene = (strokes, scale = 1) => ({ strokes, anim: { scale } });
const ring = r => ({ closed: true, pts: Array.from({ length: 96 }, (_, i) => [r * Math.cos(i / 96 * 6.2832), r * Math.sin(i / 96 * 6.2832)]) });
const gridLines = [-.6, -.2, .2, .6].flatMap(v => [{ pts: [[-.8, v], [.8, v]] }, { pts: [[v, -.8], [v, .8]] }]);

test('peso: un cerchio piccolo e leggero, la griglia e pesante', () => {
  assert.equal(c.lzsWeight(scene([ring(1)], .5)).level, 'leggera');
  assert.equal(c.lzsWeight(scene(gridLines, 1)).level, 'pesante');
});

test('peso: la dimensione consigliata rientra davvero nel pulito', () => {
  const w = c.lzsWeight(scene(gridLines, 1));
  assert.ok(w.scale > 0 && w.scale < 1);
  assert.ok(c.lzsWeight(scene(gridLines, w.scale)).level === 'leggera');
});

test('peso: se dipende dai tratti e non dalla dimensione non consiglia la scala', () => {
  const dots = Array.from({ length: 300 }, (_, i) => ({ pts: Array(4).fill([(i % 20) / 20, (i % 15) / 15]) }));
  assert.equal(c.lzsWeight(scene(dots, 1), 30000).scale, null);
  assert.match(c.lzsWeightText(c.lzsWeight(scene(dots, 1), 30000), scene(dots, 1)), /Togli/);
});

test('figure di taratura: pulite e dentro i bordi', () => {
  const ids = [];
  for (const s of c.lzsCalScenes()) {
    ids.push(s.id);
    assert.notEqual(c.lzsWeight(s).level, 'pesante', s.id);
    for (const st of s.strokes) for (const [x, y] of st.pts) assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, s.id);
  }
  assert.equal(new Set(ids).size, 5);
});

test('disegno a mano: tratto dritto a due punti, curva conservata', () => {
  const line = Array.from({ length: 50 }, (_, i) => [-.5 + i / 49, .2]);
  assert.equal(c.lzsInk(line).pts.length, 2);
  const curve = Array.from({ length: 80 }, (_, i) => [Math.cos(i / 80 * 3) * .8, Math.sin(i / 80 * 3) * .8]);
  const n = c.lzsInk(curve).pts.length;
  assert.ok(n > 8 && n < 40, 'punti della curva: ' + n);
});

test('disegno a mano: un tocco e un giro chiuso', () => {
  const dot = c.lzsInk([[.1, .1], [.1005, .1]], [1, 0, 0]);
  assert.equal(dot.pts.length, 4);
  assert.deepEqual(Array.from(dot.rgb), [1, 0, 0]);
  const ring = Array.from({ length: 60 }, (_, i) => [Math.cos(i / 59 * 6.2) * .5, Math.sin(i / 59 * 6.2) * .5]);
  assert.equal(c.lzsInk(ring).closed, true);
  assert.equal(c.lzsInk([]), null);
});

test('il foglio da disegno e le figure di fascio sono leggere', () => {
  const ink = [c.lzsInk([[-.8, -.8], [.8, -.8], [.8, .8]], [0, 1, 0])];
  assert.equal(c.lzsWeight(c.lzsInkScene(ink, 'x', 'y')).level, 'leggera');
  assert.equal(c.lzsInkScene(ink, 'x', 'y').anim.scale, 1);
  for (const k of ['ventaglio', 'onda-fasci', 'stella-fasci', 'foglio', 'cono', 'tunnel-fasci']) {
    const st = c.lzsBeamStrokes(k);
    assert.ok(st.length, k);
    assert.equal(c.lzsWeight({ strokes: st, anim: { scale: { cono: .5, 'tunnel-fasci': .55 }[k] || .9 } }).level, 'leggera', k);
  }
  assert.equal(c.lzsBeamStrokes('ventaglio').length, 8);
  assert.equal(c.lzsBeamStrokes('cono')[0].closed, true);
  assert.equal(c.lzsBeamStrokes('tunnel-fasci')[0].closed, false);
});
