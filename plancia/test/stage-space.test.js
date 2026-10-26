'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { showFootprint, venueRect } = require('../src/97-stage-space');

const BASE = { width: 6, depth: 4, trussHeight: 4.4, audience: { x: 0, y: 6, width: 12, depth: 4 }, foh: { x: -1, y: 10.5, width: 2, depth: 1 } };

test('show footprint = stage + audience + FOH', () => {
  const fp = showFootprint(BASE);
  assert.deepEqual([fp.minX, fp.maxX, fp.minY, fp.maxY], [-6, 6, 0, 11.5]);
  assert.equal(fp.width, 12);
  assert.equal(fp.depth, 11.5);
});

test('room: automatic = footprint + 2 m around, or the measured room', () => {
  const auto = venueRect(BASE);
  assert.deepEqual([auto.x0, auto.y0, auto.width, auto.depth, auto.auto], [-8, -2, 16, 15.5, true]);
  assert.equal(auto.height, 6.4); // americana + 2 m
  const real = venueRect({ ...BASE, venue: { auto: false, width: 20, depth: 32, height: 9, back: 3 } });
  assert.deepEqual([real.x0, real.y0, real.width, real.depth, real.height, real.auto], [-10, -3, 20, 32, 9, false]);
});

test('projector beam outline = convex hull of lens + screen corners', () => {
  const { convexHull } = require('../src/97-stage-space');
  const hull = convexHull([[50, 90], [10, 10], [90, 10], [90, 40], [10, 40]]); // obiettivo sotto lo schermo
  assert.equal(hull.length, 5);
  assert.deepEqual(convexHull([[50, 20], [10, 10], [90, 10], [90, 40], [10, 40]]).length, 4); // obiettivo dentro: solo lo schermo
});
