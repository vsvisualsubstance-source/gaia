'use strict';
// Libreria video per Regia (plancia/regia, docs/regia.md): i file stanno in una cartella su disco
// (VIDEO_DIR, di default C:\gaia\media\video, sottocartelle comprese) e il bridge li serve con le
// richieste a pezzi (Range), cosi' il browser salta nel video senza scaricarlo tutto.
//   list()          -> [{ rel, name, folder, type, size, mtime }]  (rel con "/" come separatore)
//   resolve(rel)    -> percorso assoluto, solo dentro la cartella (niente "..")
//   serve(req,res,rel) risposta HTTP 200/206/404/416

const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.env.VIDEO_DIR || path.join(__dirname, '..', 'media', 'video'));
const TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp'
};
const MAX_FILES = 5000, MAX_DEPTH = 6;

const typeOf = name => TYPES[(name.split('.').pop() || '').toLowerCase()] || null;

async function list(dir = DIR) {
  await fs.promises.mkdir(dir, { recursive: true });
  const out = [];
  async function walk(abs, rel, depth) {
    let entries = [];
    try { entries = await fs.promises.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES || e.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (depth < MAX_DEPTH) await walk(path.join(abs, e.name), r, depth + 1); continue; }
      const type = typeOf(e.name);
      if (!e.isFile() || !type) continue;
      try {
        const st = await fs.promises.stat(path.join(abs, e.name));
        out.push({ rel: r, name: e.name, folder: rel, type: type.startsWith('image/') ? 'image' : 'video', size: st.size, mtime: Math.round(st.mtimeMs) });
      } catch { /* sparito nel frattempo */ }
    }
  }
  await walk(dir, '', 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, 'it', { numeric: true }));
}

function resolve(rel, dir = DIR) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const abs = path.resolve(dir, ...rel.split('/'));
  if (!abs.startsWith(dir + path.sep) || !typeOf(abs)) return null;
  return abs;
}

function serve(req, res, rel, dir = DIR) {
  const file = resolve(rel, dir);
  const notFound = () => { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('File video non trovato'); };
  if (!file) return notFound();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound();
    const size = st.size, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || ''), ranged = !!(m && (m[1] || m[2]));
    let start = 0, end = size - 1;
    if (ranged) {
      start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
      end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
    }
    const head = { 'content-type': typeOf(file), 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'last-modified': st.mtime.toUTCString() };
    res.writeHead(ranged ? 206 : 200, ranged ? { ...head, 'content-range': `bytes ${start}-${end}/${size}` } : head);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

module.exports = { DIR, list, resolve, serve, typeOf };
