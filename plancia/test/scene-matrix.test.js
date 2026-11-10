// scene come tabella: colonne del progetto, caselle, piano della modifica
const test = require('node:test'), assert = require('node:assert/strict');
const { smColumns, smCell, smRelevant, smPlanEdit, smPaletteParam } = require('../src/63-scene-matrix.js');

const groups = [{ group: 'front', kind: 'chase', label: 'Front', bind: 'rig_a' }, { group: 'mh', kind: 'heads', label: 'Teste', bind: 'heads' },
  { group: 'ledbar', kind: 'chase', label: 'LED bar' }, { group: 'consolle', kind: 'chase', label: 'Consolle' }, { group: 'haze', kind: 'level', label: 'Haze' }];
const fixtures = [{ group: 'ledbar' }, { group: 'consolle' }, { group: 'haze' }];
const red = { palette: 'Red', colors: [[1, 0, 0]] };
const SG = ['rig_a', 'rig_b', 'ledbar', 'haze', 'blinder', 'consolle', 'heads'];

test('scaletta del progetto: ordine suo, scene sparite ignorate, senza scaletta tutte tranne le nascoste', () => {
  const { projSceneList } = require('../src/63-scene-matrix.js');
  const sc = ['a', 'b', 'c'].map((id, index) => ({ id, index }));
  assert.deepEqual(projSceneList(sc, ['c', 'zzz', 'a'], ['c']).map(s => s.id), ['c', 'a']);
  assert.deepEqual(projSceneList(sc, undefined, ['b']).map(s => s.id), ['a', 'c']);
  assert.deepEqual(projSceneList(sc, [], []), []);
});

test('BACK: la riga sopra la scena attiva; fuori scaletta la riga sopra NEXT', () => {
  const { csBackPos } = require('../src/63-scene-matrix.js');
  const l = [{ index: 7 }, { index: 2 }, { index: 5 }];
  assert.equal(csBackPos(l, 2, 7), 1);
  assert.equal(csBackPos(l, 0, 2), -1);
  assert.equal(csBackPos(l, -1, 5), 1);
  assert.equal(csBackPos(l, -1, 7), 2);
  assert.equal(csBackPos([], -1, null), -1);
});

test('colonne: solo i gruppi a colori con luci nel progetto, strobo se serve', () => {
  const cols = smColumns(groups, fixtures, [{ categories: ['strobe'] }]);
  assert.deepEqual(cols.map(c => c.key), ['ledbar', 'consolle', 'strobe']);
  assert.equal(smPaletteParam('rig_a'), 'dmx_a_palette');
  assert.equal(smPaletteParam('consolle'), 'dmx_consolle_palette');
});

test('casella: colore se la scena lo tocca, null se no', () => {
  const [ledbar, consolle] = smColumns(groups, fixtures);
  const vecchia = { categories: ['rigs', 'palette'], only: [], preview: { rig_a: red, ledbar: { palette: 'Fire', colors: [[1, .4, 0]] } } };
  assert.equal(smCell(vecchia, ledbar).palette, 'Fire');
  assert.equal(smCell(vecchia, consolle), null, 'catturata prima che la consolle esistesse');
  const solo = { categories: ['palette'], only: ['consolle'], preview: { ledbar: red, consolle: red } };
  assert.equal(smCell(solo, ledbar), null, 'fuori da only');
  assert.equal(smCell(solo, consolle).palette, 'Red');
  assert.equal(smCell({ categories: ['heads'], preview: { heads: [] } }, ledbar), null);
  assert.ok(smRelevant(vecchia, [ledbar, consolle]));
  assert.ok(!smRelevant({ categories: ['heads'] }, [ledbar, consolle]));
});

test('piano: aggiungo la consolle a una scena vecchia', () => {
  const vecchia = { categories: ['rigs', 'palette'], only: [], preview: { rig_a: red, rig_b: red, ledbar: { palette: 'Fire' }, haze: {} } };
  const p = smPlanEdit(vecchia, 'consolle', 'Forest', SG);
  assert.deepEqual(p.set, { dmx_a_palette: 'Red', dmx_b_palette: 'Red', dmx_ledbar_palette: 'Fire', dmx_consolle_palette: 'Forest' });
  assert.deepEqual(p.only, [], 'una scena su tutto resta su tutto (haze, blinder compresi)');
  assert.deepEqual(p.categories, ['rigs', 'palette']);
});

test('piano: tolgo un gruppo, e non si toglie l\'ultimo', () => {
  const s = { categories: ['palette'], only: ['ledbar', 'consolle'], preview: { ledbar: red, consolle: red } };
  const p = smPlanEdit(s, 'consolle', null, SG);
  assert.deepEqual(p.only, ['ledbar']);
  assert.deepEqual(p.set, { dmx_ledbar_palette: 'Red' });
  assert.ok(smPlanEdit({ categories: ['palette'], only: ['ledbar'], preview: { ledbar: red } }, 'ledbar', null, SG).error);
});

test('piano: aggiungo a una scena limitata, tolgo da una su tutto', () => {
  const lim = { categories: ['palette'], only: ['ledbar'], preview: { ledbar: red } };
  assert.deepEqual(smPlanEdit(lim, 'consolle', 'Red', SG).only, ['ledbar', 'consolle']);
  const tutto = { categories: ['rigs'], only: [], preview: { rig_a: red, ledbar: red } };
  const p = smPlanEdit(tutto, 'ledbar', null, SG);
  assert.deepEqual(p.only, ['rig_a', 'rig_b', 'haze', 'blinder', 'consolle']);
  assert.deepEqual(p.set, { dmx_a_palette: 'Red' });
});
