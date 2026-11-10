#!/usr/bin/env node
'use strict';
// Costruisce la libreria laser da una cartella di file ILDA (data/laser-lib, fuori da git):
//   node laser-lib-build.js "<cartella>"   (variabile LASER_LIB_DIR per un'altra destinazione)
// Usa lo stesso lettore e lo stesso calcolo del peso della Plancia. I file si leggono come dati.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadParser() {
  const src = n => fs.readFileSync(path.join(__dirname, 'src', n), 'utf8');
  const scenes = src('99-laser-scenes.js');
  const pure = scenes.slice(scenes.indexOf('// --- calcolo puro'), scenes.indexOf('// --- fine calcolo puro'));
  const context = { uid: () => 'lib' };
  vm.createContext(context);
  vm.runInContext(`${src('99-laser-import.js')};\n${pure}`, context);
  return context;
}

// miniatura leggera: il primo frame con al massimo `budget` punti
function preview(strokes, budget = 160) {
  const total = strokes.reduce((n, s) => n + s.pts.length, 0), step = Math.max(1, Math.ceil(total / budget));
  return strokes.map(s => {
    const pts = s.pts.filter((_, i) => i % step === 0 || i === s.pts.length - 1);
    return { pts: (pts.length > 1 ? pts : [s.pts[0], s.pts[0]]).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]), rgb: s.rgb };
  });
}

function build(input, output) {
  const c = loadParser(), items = [], failed = [];
  fs.mkdirSync(output, { recursive: true });
  for (const file of fs.readdirSync(input).filter(f => /\.ilda?$/i.test(f)).sort()) {
    const base = file.replace(/\.ilda?$/i, ''), id = base.replace(/[^\w-]+/g, '_').slice(0, 60);
    try {
      const b = fs.readFileSync(path.join(input, file));
      const sc = c.lzsParseIlda(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), `ILDA ${base}`);
      sc.id = `ildalib-${id}`;
      sc.libId = id;
      const fit = c.lzsAutoFit(sc);
      if (fit.kind === 'scale') sc.anim.scale = fit.scale;
      const json = JSON.stringify(sc), frames = sc.frames || [sc], w = c.lzsWeight(sc);
      fs.writeFileSync(path.join(output, `${id}.json`), json);
      items.push({ id, name: sc.name, frames: frames.length, points: frames.reduce((n, f) => n + f.strokes.reduce((t, s) => t + s.pts.length, 0), 0),
        k: w.k, level: w.level, beam: !!sc.beam, bytes: json.length, preview: preview(sc.strokes) });
    } catch (error) { failed.push(`${file}: ${error.message}`); }
  }
  fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify({ built: new Date().toISOString(), items }));
  return { items, failed };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) { console.error('uso: node laser-lib-build.js "<cartella con i file .ild>"'); process.exit(2); }
  const output = process.env.LASER_LIB_DIR || path.join(__dirname, 'data', 'laser-lib');
  const { items, failed } = build(input, output);
  const n = k => items.filter(k).length;
  console.log(`${items.length} scene in ${output}: ${n(i => i.frames > 1)} animate, ${n(i => i.beam)} fasci, ${n(i => i.level === 'leggera')} leggere, ${n(i => i.level === 'media')} medie, ${n(i => i.level === 'pesante')} pesanti, ${(items.reduce((a, i) => a + i.bytes, 0) / 1048576).toFixed(1)} MB`);
  for (const f of failed) console.log(`scartato ${f}`);
}

module.exports = { build, preview };
