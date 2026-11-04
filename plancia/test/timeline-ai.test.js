'use strict';
// Controlli sui piani di Ollama (stage-ai.js) e timeline (src/65-timeline-ai.js), senza Ollama.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPlan, checkTimeline, countsInText, timelineSchema } = require('../stage-ai');
const { auditTimeline, expandTimelinePlan } = require('../src/65-timeline-ai');
const { expandStagePlan } = require('../src/65-stage-ai');

test('counts in the text: words, digits, sums, "con schermo"', () => {
  assert.deepEqual(countsInText('sei par e due teste'), { par: 6, mh: 2 });
  assert.deepEqual(countsInText('Quattro PAR davanti, quattro PAR dietro, 2 barre LED'), { par: 8, bar: 2 });
  assert.deepEqual(countsInText('una strobo, un proiettore con schermo'), { blinder: 1, projector: 1, screen: 1 });
  assert.deepEqual(countsInText('palco 10 per 6'), {});
  assert.deepEqual(countsInText('Palco 10 per 6. Otto PAR, una haze e due blinder'), { par: 8, haze: 1, blinder: 2 });
  assert.deepEqual(countsInText('un led wall e due grandi casse'), { wall: 1, speaker: 2 });
});

test('the plan is corrected against the text and what is uncertain is reported', () => {
  const r = checkPlan('sei par e due teste', { groups: [{ type: 'par', count: 1, row: 'front' }, { type: 'mh', count: 2, row: 'truss' }] });
  assert.equal(r.plan.groups[0].count, 6); assert.equal(r.corrections.length, 1);
  const m = checkPlan('una strobo e un proiettore', { groups: [] });
  assert.deepEqual(m.plan.groups.map(g => g.type).sort(), ['blinder', 'projector']);
  const two = checkPlan('due casse', { groups: [{ type: 'speaker', count: 2, row: 'side_left' }, { type: 'speaker', count: 2, row: 'side_right' }] });
  assert.deepEqual(two.plan.groups.map(g => g.count), [1, 1]);
  const odd = checkPlan('sette par', { groups: [{ type: 'par', count: 2, row: 'front' }, { type: 'par', count: 2, row: 'back' }] });
  assert.equal(odd.plan.groups[0].count, 2); assert.match(odd.corrections[0], /controlla/);
  assert.match(checkPlan('due par', { groups: [{ type: 'par', count: 2, row: 'front' }, { type: 'haze', count: 1, row: 'back' }] }).corrections[0], /haze/);
});

test('objects are configured: model, units, mirror, projector and screen without DMX', () => {
  const r = expandStagePlan({ stage: { width: 12, depth: 8 }, groups: [{ type: 'par', count: 3, row: 'front', group: 'front' }, { type: 'par', count: 2, row: 'back', group: 'back', mirror: true },
    { type: 'mh', count: 1, row: 'truss', model: 'X 11ch' }, { type: 'projector', count: 1, row: 'audience' }, { type: 'screen', count: 1, row: 'back' }] },
  { footprint: t => (typeof t === 'object' ? 11 : ({ par: 4 })[t] || 0), knownGroups: ['front', 'back', 'mh'] });
  assert.deepEqual(r.fixtures.filter(f => f.group === 'front').map(f => f.unit), [1, 2, 3]);
  assert.deepEqual(r.fixtures.filter(f => f.group === 'back').map(f => f.unit), [1, 1]);
  const mh = r.fixtures.find(f => f.type === 'mh'); assert.equal(mh.model, 'X 11ch'); assert.equal(mh.unit, undefined); assert.equal(mh.address, 21);
  assert.equal(r.fixtures.find(f => f.type === 'screen').address, 0);
});

test('LED wall and screen go to the back unless the text says otherwise', () => {
  const g = (p, row) => checkPlan(p, { groups: [{ type: 'wall', count: 1, row }] }).plan.groups[0].row;
  assert.equal(g('un led wall', 'front'), 'back');
  assert.equal(g('un led wall davanti', 'front'), 'front');
});

test('timeline plan against the text: what is refused goes away, what is asked is reported', () => {
  const lib = { effects: [{ id: 'fx-a', name: 'Strobo' }, { id: 'fx-b', name: 'Onda' }] };
  const sec = o => ({ sections: [{ name: 'A', seconds: 10, ...o }] }), run = (p, o) => checkTimeline(p, sec(o), lib);
  assert.equal(run('intro blu', { laser: 'l' }).plan.sections[0].laser, '');
  assert.equal(run('drop con laser', { laser: 'l' }).plan.sections[0].laser, 'l');
  assert.equal(run('niente laser ma laser spento', { laser: 'l' }).plan.sections[0].laser, '');
  assert.equal(run('niente movimento, niente effetti', { motion: 'm' }).plan.sections[0].motion, '');
  assert.deepEqual(run('senza strobo', { effects: ['fx-a', 'fx-b'] }).plan.sections[0].effects, ['fx-b']);
  assert.match(run('finale con strobo', { effects: ['fx-b'] }).corrections.join(), /strobo: chiesta/);
  assert.equal(run('finale con strobo', { effects: ['fx-a'] }).corrections.length, 0);
  assert.match(run('drop con chase', {}).corrections.join(), /chase: chiesto/);
  assert.equal(run('a 128 bpm', {}).plan.bpm, 128);
});

test('timeline schema allows only what exists', () => {
  const s = timelineSchema({ scenes: [{ id: 'rosso' }], chases: [], effects: [{ id: 'onda' }] }).properties.sections.items.properties;
  assert.deepEqual(s.scene.enum, ['', 'rosso']); assert.deepEqual(s.chase.enum, ['']); assert.deepEqual(s.effects.items.enum, ['onda', '']);
});

test('a plan becomes cues only when something changes, scaled to the duration', () => {
  const x = expandTimelinePlan({ sections: [{ name: 'Intro', seconds: 30, scene: 'blu', motion: 'cerchio', effects: ['onda'] }, { name: 'Strofa', seconds: 30, scene: 'blu', heads: 'pub', chase: 'c1', effects: ['onda'] }, { name: 'Fine', seconds: 60, scene: 'rosso', effects: [] }] }, { duration: 60 });
  assert.equal(x.duration, 60); assert.ok(x.warnings.length);
  assert.deepEqual(x.cues.map(c => [c.t, c.targets]), [[0, '@blu'], [15.5, '@pub'], [30, '@rosso']]);
  assert.deepEqual(x.chaseCues.map(c => [c.time, c.chase]), [[15, 'c1'], [30, 'off']]);
  assert.deepEqual(x.fxCues.map(c => [c.time, c.effects.length]), [[0, 1], [30, 0]]);
  assert.deepEqual(x.motionCues.map(c => [c.time, c.scene]), [[0, 'cerchio'], [15, 'off']]);
  assert.equal(expandTimelinePlan({ sections: [] }).warnings.length, 1);
  assert.equal(expandTimelinePlan({ sections: [{ name: 'A', seconds: 10, heads: 'pub', motion: 'm' }] }).cues.length, 0);
});

const BASE = { duration: 60, bpm: 120, scenes: [{ id: 'rosso', categories: ['rigs'] }, { id: 'blu', categories: ['rigs'] }, { id: 'pos', categories: ['heads'] }], groups: [{ group: 'front', kind: 'chase' }, { group: 'mh', kind: 'heads' }, { group: 'hz', kind: 'level' }],
  fixtures: [{ name: 'P1', type: 'par', group: 'front', address: 1, universe: 1 }, { name: 'M1', type: 'mh', group: 'mh', address: 9, universe: 1 }] };
const msgs = d => auditTimeline({ ...BASE, ...d }).map(x => x.level + ': ' + x.msg).join(' | ');

test('audit finds what would go wrong', () => {
  assert.match(msgs({ cues: [{ t: 70, name: 'Tardi', sceneId: 'rosso' }] }), /errore: "Tardi": oltre la fine/);
  assert.match(msgs({ cues: [{ t: 0, name: 'A', sceneId: 'manca' }] }), /errore: .*"manca" non esiste/);
  assert.match(msgs({ cues: [{ t: 0, name: 'A', sceneId: 'rosso', fade: 5 }, { t: 2, name: 'B', sceneId: 'blu' }] }), /il fade di 5 s non finisce/);
  assert.doesNotMatch(msgs({ cues: [{ t: 0, name: 'A', sceneId: 'rosso', fade: 5 }, { t: 2, name: 'B', sceneId: 'pos' }] }), /non finisce/);
  assert.match(msgs({ chases: [{ id: 'c', name: 'C', steps: [{ scene: 'rosso' }, { scene: 'manca' }], hold: { value: .1, unit: 's' } }], chaseCues: [{ time: 0, chase: 'c' }] }), /scene che non esistono: manca.*|step di 0.10/);
  assert.match(msgs({ cues: [{ t: 5, name: 'L', sceneId: 'rosso' }], chases: [{ id: 'c', name: 'C', steps: [{ scene: 'blu' }], hold: { value: 4, unit: 'beats' } }], chaseCues: [{ time: 0, chase: 'c' }] }), /si sovrappongono: "L"/);
  assert.match(msgs({ fx: [{ id: 'f', name: 'F', target: { group: 'mh' }, channel: 'color', colors: [[1, 0, 0]] }], fxCues: [{ time: 0, effects: ['f'] }] }), /sulle teste funziona il dimmer/);
  assert.match(msgs({ fx: [{ id: 'f', name: 'F', target: { group: 'hz' } }], fxCues: [{ time: 0, effects: ['f'] }] }), /non ha luci/);
  assert.match(msgs({ cues: [{ t: 5, name: 'Pos', sceneId: 'pos' }], motions: [{ id: 'm', name: 'M' }], motionCues: [{ time: 0, scene: 'm' }] }), /il movimento vince.*"Pos"/);
  assert.match(msgs({ motions: [{ id: 'm', name: 'M' }], motionCues: [{ time: 0, scene: 'm' }] }), /manca un Fermo/);
  assert.match(msgs({ chases: [{ id: 'c', name: 'C', steps: [{ scene: 'rosso' }], hold: { value: .25, unit: 's' } }], chaseCues: [{ time: 0, chase: 'c' }] }), /Circa 240 cue/);
  assert.doesNotMatch(msgs({ chasesInTd: true, chases: [{ id: 'c', name: 'C', steps: [{ scene: 'rosso' }], hold: { value: .25, unit: 's' } }], chaseCues: [{ time: 0, chase: 'c' }] }), /Circa/);
  assert.match(msgs({ cues: [{ t: 40, name: 'Dopo', sceneId: 'blu' }], chases: [{ id: 'c', name: 'C', steps: [{ scene: 'rosso' }], hold: { value: 4, unit: 'beats' } }], chaseCues: [{ time: 0, chase: 'c' }, { time: 10, chase: 'off' }] }), /resta acceso il suo ultimo step per 30 s, fino a "Dopo"/);
  assert.doesNotMatch(msgs({ cues: [{ t: 12, name: 'Dopo', sceneId: 'blu' }], chases: [{ id: 'c', name: 'C', steps: [{ scene: 'rosso' }], hold: { value: 4, unit: 'beats' } }], chaseCues: [{ time: 0, chase: 'c' }, { time: 10, chase: 'off' }] }), /ultimo step/);
  assert.match(msgs({ footprint: () => 10 }), /si sovrappongono nell'universo 1/);
});

test('audit stays quiet on a clean timeline', () => {
  assert.equal(auditTimeline({ ...BASE, footprint: () => 4, cues: [{ t: 0, name: 'A', sceneId: 'rosso', fade: 2 }, { t: 10, name: 'B', sceneId: 'blu', fade: 2 }] }).length, 0);
});
