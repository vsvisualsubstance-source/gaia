'use strict';
// Analisi dei brani dalla Plancia (20/11/2026, docs/console-audio.md).
// Il bridge lancia "gaia-audio analyze" (lo stesso programma del motore, in un processo a parte):
// priorita' sotto il normale e meta' dei core, cosi' audio, TD e Plancia non ne risentono.
// Si analizzano solo i brani nuovi o cambiati (il resto e' in cache), oppure tutto da capo.
// Cartelle: quella principale della musica (nel docker) e quelle aggiunte (USB, altri dischi,
// audio-lib musicRoots). Una analisi alla volta; l'avanzamento va a tutte le pagine
// ({type:'audio_analyze', state}).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const lib = require('./audio-lib');

const EXE = process.env.GAIA_AUDIO_EXE || path.join(__dirname, '..', 'audio-engine', 'target', 'release', 'gaia-audio.exe');
const AUDIO = /\.(mp3|flac|wav)$/i;   // gli stessi del motore (library.rs EXTS)

// id dell'analisi = FNV-1a del percorso (library.rs track_id): relativo alla cartella principale, se no assoluto
function trackId(rel) {
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(rel, 'utf8')) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}
function relOf(file) {
  const main = lib.normDir(lib.ROOT);
  if (file.toLowerCase().startsWith(main.toLowerCase() + path.sep)) return file.slice(main.length + 1).split(path.sep).join('/');
  return file.split(path.sep).join('/');
}

// file audio sotto una cartella (come library.rs scan: ricorsivo, niente nomi che iniziano col punto)
async function scan(dir, out = [], limit = 50000) {
  let ents = [];
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (out.length >= limit) break;
    if (e.name.startsWith('.') || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await scan(p, out, limit);
    else if (AUDIO.test(e.name)) out.push(p);
  }
  return out;
}

// quanti brani ci sono e quanti hanno gia' un'analisi
async function count(dir) {
  const files = await scan(dir);
  let done = 0;
  for (const f of files) { try { await fs.promises.access(path.join(lib.CACHE, trackId(relOf(f)) + '.json')); done++; } catch { /* da fare */ } }
  return { files: files.length, analyzed: done };
}
const isDir = async d => { try { return (await fs.promises.stat(d)).isDirectory(); } catch { return false; } };

// cartella dentro la musica principale o una aggiunta (le uniche che si analizzano)
async function allowed(dir) {
  const d = lib.normDir(dir).toLowerCase(), inside = r => { const b = lib.normDir(r).toLowerCase(); return d === b || d.startsWith(b + path.sep); };
  return inside(lib.ROOT) || (await lib.musicRoots()).some(r => inside(r.path));
}

// sfoglia le cartelle di OPS per aggiungerne una: senza percorso i dischi presenti
async function dirs(p) {
  if (!p) {
    const drives = [];
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (await isDir(l + ':\\')) drives.push(l + ':\\');
    return { path: '', parent: null, dirs: drives.map(d => ({ name: d, path: d })) };
  }
  const d = lib.normDir(p);
  const ents = await fs.promises.readdir(d, { withFileTypes: true });
  const sub = ents.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && e.name !== 'System Volume Information')
    .map(e => ({ name: e.name, path: path.join(d, e.name) })).sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
  const audio = ents.filter(e => e.isFile() && !e.name.startsWith('.') && AUDIO.test(e.name)).length;
  const up = path.dirname(d);
  return { path: d, parent: up === d ? '' : up, dirs: sub.slice(0, 1000), audio };
}

function startAudioAnalyze({ broadcast, onDone, log = console.log }) {
  let child = null, gen = 0;
  let state = { running: false };
  const send = () => broadcast({ type: 'audio_analyze', state });

  async function roots() {
    const list = [{ path: lib.normDir(lib.ROOT), name: 'Musica (principale)', main: true }, ...(await lib.musicRoots())];
    for (const r of list) {
      r.online = await isDir(r.path);
      Object.assign(r, r.online ? await count(r.path) : { files: 0, analyzed: 0 });
    }
    return list;
  }

  // file: un brano solo (rianalisi avanzata, 23/11): sempre da capo, con la gamma di BPM scelta
  // (range 'MIN-MAX', es. dub 60-100 invece del 168 doppio); unlock = toglie prima la griglia a mano
  async function start({ folder, force, file, range, unlock }) {
    if (child) throw new Error('analisi gia\' in corso');
    const one = typeof file === 'string' && file ? path.resolve(path.isAbsolute(file) ? file : path.join(lib.normDir(lib.ROOT), file)) : null;
    const dir = one || lib.normDir(folder || lib.ROOT);
    if (!(await allowed(one ? path.dirname(one) : dir))) throw new Error('cartella fuori dalla musica: aggiungila prima come cartella musica');
    if (one ? !(AUDIO.test(one) && fs.existsSync(one)) : !(await isDir(dir))) throw new Error((one ? 'brano' : 'cartella') + ' non trovato (disco scollegato?): ' + dir);
    if (!fs.existsSync(EXE)) throw new Error('motore non trovato: ' + EXE);
    const rm = one && typeof range === 'string' ? range.match(/^(\d{2,3})-(\d{2,3})$/) : null;
    const rg = rm && +rm[1] < +rm[2] ? range : null;
    if (one && unlock) await new Promise(res => { const g = spawn(EXE, ['grid', '--root', lib.normDir(lib.ROOT), '--cache', lib.CACHE, one, '--unlock'], { cwd: path.dirname(EXE), windowsHide: true }); g.on('exit', res); g.on('error', res); });
    if (one) force = true;
    const threads = Math.max(1, Math.floor(os.cpus().length / 2));
    const args = ['analyze', '--root', lib.normDir(lib.ROOT), '--cache', lib.CACHE, ...(force ? ['--force'] : []), ...(rg ? ['--range', rg] : []), dir];
    child = spawn(EXE, args, { cwd: path.dirname(EXE), windowsHide: true, env: { ...process.env, RAYON_NUM_THREADS: String(threads) } });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* resta normale */ }
    gen++;
    state = { running: true, gen, folder: dir, force: !!force, ...(one ? { file: path.basename(one), range: rg || '' } : {}), n: 0, tot: 0, analyzed: 0, cached: 0, failed: 0, errors: [], last: '', started: Date.now() };
    log(`Analisi brani: ${dir}${force ? ' (da capo)' : ''}${rg ? ' BPM ' + rg : ''}, ${threads} core`);
    send();
    let buf = '', lastSend = 0;
    const line = l => {
      const m = l.match(/^\[(\d+)\/(\d+)\]\s+(.*)$/);
      if (m) {
        state.n = +m[1]; state.tot = +m[2];
        if (/^ERRORE /.test(m[3])) { state.failed++; state.errors = [...state.errors, m[3].slice(7, 200)].slice(-5); }
        else if (/\(cache\)/.test(m[3])) state.cached++;
        else { state.analyzed++; state.last = m[3].replace(/^.*?BPM\s+conf\s+[\d.]+(\s+bloccata)?\s+/, '').replace(/\s+tag .*$/, '').slice(0, 160); }
        if (Date.now() - lastSend > 500) { lastSend = Date.now(); send(); }
      }
    };
    child.stdout.on('data', d => { buf += d; const ls = buf.split(/\r?\n/); buf = ls.pop(); ls.forEach(line); });
    child.stderr.on('data', d => { const t = String(d).trim(); if (t) state.errors = [...state.errors, t.slice(0, 200)].slice(-5); });
    const finish = (code, why) => {
      if (!child) return;
      child = null;
      state = { ...state, running: false, finished: Date.now(), stopped: !!state.stopping, code, ...(why ? { error: why } : {}) };
      delete state.stopping;
      log(`Analisi brani finita: ${state.analyzed} nuove, ${state.cached} gia' fatte, ${state.failed} errori${state.stopped ? ' (fermata)' : ''}`);
      Promise.resolve(onDone?.()).finally(send);
    };
    child.on('exit', code => { if (buf) line(buf); finish(code); });
    child.on('error', e => finish(-1, e.message));
    return state;
  }

  function stop() {
    if (!child) return false;
    state.stopping = true;
    child.kill();
    return true;
  }

  return { state: () => state, start, stop, roots, dirs, running: () => !!child };
}

module.exports = { startAudioAnalyze, trackId, relOf, scan, count, dirs, allowed, EXE };
