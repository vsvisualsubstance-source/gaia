'use strict';
// Stato delle luci registrato col video del Render (src/62-light-frames.js), per il Render 3D.
// File JSON in data/light-frames/ accanto a state.json (fuori da git, come le planimetrie).
//   save(name, body) -> nome del file   list() -> [{file, size, mtime}]   path(file) -> percorso o null
//   saveMedia(name, ext, body) -> video del contenuto di LED wall e proiettori (mp4/webm, 20/11)
const fs = require('fs');
const path = require('path');

const MAX = 300 * 1024 * 1024;   // ~10 min di uno show grande

function create(dir) {
  const safe = n => /^[\w.-]{1,160}\.json$/.test(n) && !n.startsWith('.');
  const safeMedia = n => /^[\w.-]{1,160}\.(mp4|webm)$/.test(n) && !n.startsWith('.');
  const baseOf = name => String(name || 'render').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'render';
  return {
    MAX,
    dir,
    async save(name, buf) {
      let doc;
      try { doc = JSON.parse(buf); } catch { throw new Error('JSON non valido'); }
      if (doc?.app !== 'plancia-light-frames' || !Array.isArray(doc.frames) || !Array.isArray(doc.fixtures)) throw new Error('non e\' uno stato luci della Plancia');
      const base = baseOf(name);
      await fs.promises.mkdir(dir, { recursive: true });
      let file = base + '.json', n = 1;
      while (fs.existsSync(path.join(dir, file))) file = `${base}_${++n}.json`;
      await fs.promises.writeFile(path.join(dir, file), buf);
      return file;
    },
    async list() {
      let names = [];
      try { names = await fs.promises.readdir(dir); } catch { return []; }
      const out = [];
      for (const file of names.filter(safe)) {
        try { const st = await fs.promises.stat(path.join(dir, file)); out.push({ file, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch { /* sparito */ }
      }
      return out.sort((a, b) => b.mtime - a.mtime);
    },
    async saveMedia(name, ext, buf) {
      if (!['mp4', 'webm'].includes(ext)) throw new Error('formato video non ammesso');
      if (!buf.length) throw new Error('video vuoto');
      const base = baseOf(name) + '_contenuto';
      await fs.promises.mkdir(dir, { recursive: true });
      let file = `${base}.${ext}`, n = 1;
      while (fs.existsSync(path.join(dir, file))) file = `${base}_${++n}.${ext}`;
      await fs.promises.writeFile(path.join(dir, file), buf);
      return file;
    },
    path(file) { return safe(file) || safeMedia(file) ? path.join(dir, file) : null; },
  };
}

module.exports = { create };
