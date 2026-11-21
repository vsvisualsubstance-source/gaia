'use strict';
// Scene dello show Lowtopic (28/11/2026) in DMX Master: palette senza viola ne' verde,
// luci reattive all'audio (la scena fotografa il "look dei rig": palette, livelli, audio, kick).
// Le scene di TD sono di ogni macchina: questo script le ricrea uguali su OPS e sulla touring.
//   node tools/lt-scenes.js [device_id] [mqtt://host:porta] [--dry]
// Durante la cattura le luci cambiano dal vivo; alla fine si rimettono le palette di prima.
const mqtt = require('mqtt');

const DEV = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'td-dmx-win';
const URL = process.argv.find(a => a.startsWith('mqtt://')) || 'mqtt://127.0.0.1:11883';
const DRY = process.argv.includes('--dry');
const RIGS = ['ledbar', 'consolle', 'fronte'];   // colonne, consolle, fronte consolle

// [id, etichetta, palette colonne, consolle, fronte]
const SCENES = [
  ['lt_fuoco', 'LT Fuoco', 'Fire', 'Fire', 'Warm'],
  ['lt_ghiaccio', 'LT Ghiaccio', 'Fire Inverted', 'Blue', 'Fire Inverted'],
  ['lt_rosso_blu', 'LT Rosso Blu', 'Red', 'Blue', 'Red'],
  ['lt_oro', 'LT Oro', 'Amber', 'Yellow', 'Warm'],
  ['lt_caldo_freddo', 'LT Caldo Freddo', 'Warm', 'Fire Inverted', 'Amber'],
  ['lt_blu', 'LT Blu', 'Blue', 'Fire Inverted', 'Blue'],
  ['lt_rosso', 'LT Rosso', 'Red', 'Fire', 'Red'],
  ['lt_fuoco_ghiaccio', 'LT Fuoco Ghiaccio', 'Fire', 'Fire Inverted', 'Fire Inverted'],
];

// viola = tinta 255-320 gradi, verde = 75-165 (con saturazione): nessun colore delle palette ci deve cadere
function hue([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.2) return null;   // quasi bianco/grigio
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const forbidden = c => { const h = hue(c); return h != null && ((h >= 255 && h <= 320) || (h >= 75 && h <= 165)); };

const T = { rig: null, cat: null, services: {}, err: null };
const c = mqtt.connect(URL);
c.on('message', (t, m) => {
  let v; try { v = JSON.parse(m.toString()); } catch { return; }
  if (t.endsWith('/dmx_rig_config')) T.rig = v.params?.dmx_rig_config;
  else if (t.endsWith('/show_scenes')) T.cat = v.params?.show_scene_catalog;
  else if (t.endsWith('/dmx_palettes')) T.pal = v.params?.dmx_palette_catalog?.palettes;
  else if (t.endsWith('/status')) { T.services = v.services || {}; if (v.last_error !== T.err0) T.err = v.last_error; }
});
const cmd = o => new Promise(r => c.publish(`gaia/device/${DEV}/command`, JSON.stringify(o), r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(what, ok, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (ok()) return; if (T.err) throw new Error(`${what}: TD risponde "${T.err}"`); await sleep(250); }
  throw new Error(`${what}: nessuna conferma da ${DEV} entro ${ms / 1000} s`);
}
const pals = () => Object.fromEntries(RIGS.map(r => [r, T.rig?.[r]?.palette]));

async function main() {
  await new Promise((r, j) => { c.on('connect', r); c.on('error', j); });
  c.subscribe([`gaia/devices/${DEV}/#`, `gaia/device/${DEV}/status`]);
  await until('stato iniziale', () => T.rig && T.cat && T.pal);
  T.err0 = T.err; T.err = null;
  // controllo dei colori prima di tutto
  for (const [id, , ...p] of SCENES) for (const name of p) {
    const pal = T.pal.find(x => x.name === name);
    if (!pal) throw new Error(`${id}: palette "${name}" non esiste in ${DEV}`);
    const bad = pal.colors.filter(forbidden);
    if (bad.length) throw new Error(`${id}: la palette "${name}" ha viola o verde: ${JSON.stringify(bad)}`);
  }
  const before = pals(), wasActive = T.services.show_active === 'active';
  console.log(`${DEV}: palette adesso ${JSON.stringify(before)}, timeline ${wasActive ? 'attiva' : 'ferma'}`);
  for (const r of RIGS) console.log(`  ${r}: audio ${T.rig[r]?.audio_amount}, kick ${T.rig[r]?.kick_enable}, livello ${T.rig[r]?.level}`);
  if (DRY) { console.log('prova (--dry): colori a posto, nessun comando inviato'); return; }
  try {
    if (wasActive) { await cmd({ action: 'disable', service: 'show_active' }); await until('timeline ferma', () => T.services.show_active === 'inactive'); }
    for (const r of RIGS) if (!T.rig[r]?.kick_enable) await cmd({ action: 'enable', service: `dmx_${r}_kick_enable` });
    for (const [id, label, ...p] of SCENES) {
      const want = Object.fromEntries(RIGS.map((r, i) => [r, p[i]]));
      for (const r of RIGS) if (T.rig[r]?.palette !== want[r]) await cmd({ action: 'set', param: `dmx_${r}_palette`, value: want[r] });
      await until(`${id}: palette`, () => RIGS.every(r => T.rig[r]?.palette === want[r]));
      await sleep(600);
      const old = JSON.stringify(T.cat.find(s => s.id === id) || null);
      await cmd({ action: 'set', param: 'show_scene_capture', value: { name: id, label, categories: ['rigs', 'palette'], only: RIGS } });
      await until(`${id}: cattura`, () => { const s = T.cat.find(x => x.id === id); return s && JSON.stringify(s) !== old && RIGS.every(r => s.preview?.[r]?.palette === want[r]); });
      console.log(`ok ${id} (${label}): ${RIGS.map(r => `${r} ${want[r]}`).join(', ')}`);
    }
  } finally {
    for (const r of RIGS) if (before[r] && T.rig[r]?.palette !== before[r]) await cmd({ action: 'set', param: `dmx_${r}_palette`, value: before[r] });
    if (wasActive) await cmd({ action: 'enable', service: 'show_active' });
  }
}
main().then(() => { c.end(); }, e => { console.error('ERRORE', e.message); c.end(); process.exitCode = 1; });
