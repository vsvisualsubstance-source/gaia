'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickDmx } = require('../dmx-master');

const now = 2_000_000_000_000;
const dev = (seen, params, ip = '') => ({ seen, params, ip, tailscale: '' });

test('DMX Master: vince quella accesa, anche se lo status vecchio dell\'altra e\' retained', () => {
  const m = new Map([['td-dmx-win', dev(now - 43 * 60000, 300)], ['td-dmx-ops', dev(now - 5000, 290, '192.168.1.240')]]);
  assert.equal(pickDmx(m, now), 'td-dmx-ops');
});

test('DMX Master: due accese, quella con piu\' parametri; PD_DMX fuori', () => {
  const m = new Map([['td-dmx-win', dev(now - 1000, 300)], ['td-dmx-ops', dev(now - 500, 120)], ['td-pddmx-win', dev(now, 900)]]);
  assert.equal(pickDmx(m, now), 'td-dmx-win');
});

test('DMX Master: nessuna accesa, la piu\' recente vista; nessuna = null', () => {
  const m = new Map([['td-dmx-win', dev(now - 600000, 300)], ['td-dmx-ops', dev(now - 300000, 10)]]);
  assert.equal(pickDmx(m, now), 'td-dmx-ops');
  assert.equal(pickDmx(new Map(), now), null);
});
