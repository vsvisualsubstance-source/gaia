'use strict';
// Timeline a colori per il Raspberry DMX (servizio pi/dmx): 30 minuti, un cambio al minuto, in loop,
// colori come lo show Lowtopic ma senza viola/magenta ne' verde (23/11/2026).
// Il Raspberry fa un colore pieno per passo (una luce RGB): qui i colori sono pieni, alternati caldo/freddo.
// Usato da tools/pi-loop-project.js (progetto nella Plancia) e da tools/pi-loop-send.js (invio al Pi).
const NAME = 'Lowtopic loop 30 min', STEP = 60, FADE = 4, N = 30;
// [nome, rgb, scena LT di DMX Master piu' vicina]
const COLORS = [
  ['LT Rosso fuoco', [255, 40, 0], 'lt_fuoco'],
  ['LT Azzurro ghiaccio', [0, 150, 255], 'lt_ghiaccio'],
  ['LT Arancio', [255, 110, 0], 'lt_caldo_freddo'],
  ['LT Blu', [0, 30, 255], 'lt_blu'],
  ['LT Oro', [255, 200, 40], 'lt_oro'],
  ['LT Ciano', [0, 220, 255], 'lt_fuoco_ghiaccio'],
  ['LT Rosso', [255, 0, 0], 'lt_rosso'],
  ['LT Blu notte', [0, 0, 200], 'lt_rosso_blu'],
  ['LT Ambra', [255, 150, 20], 'lt_oro'],
  ['LT Bianco caldo', [255, 190, 110], 'lt_fuoco'],
];
// tinta in gradi (null = quasi bianco); vietati: verde 75-165, viola/magenta 255-340
function hue([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.2 * 255) return null;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const forbidden = c => { const h = hue(c); return h != null && ((h >= 75 && h <= 165) || (h >= 255 && h <= 340)); };
for (const [n, c] of COLORS) if (forbidden(c)) throw new Error(`${n}: colore vietato (tinta ${Math.round(hue(c))})`);

const steps = Array.from({ length: N }, (_, k) => ({ palette: COLORS[k % COLORS.length][0], duration: STEP, fade: FADE }));
const palettes = Object.fromEntries(COLORS.map(([n, c]) => [n, c]));
module.exports = { NAME, STEP, FADE, N, COLORS, steps, palettes, loop: true, hue, forbidden };
