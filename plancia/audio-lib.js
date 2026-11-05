'use strict';
// Libreria della Console Audio per le pagine: legge la cache dell'analisi di
// gaia-audio (audio-engine/cache, un JSON per traccia: BPM, griglia, forma
// d'onda) e la serve al bridge (docs/console-audio.md).
//   library()  -> elenco tracce senza forma d'onda di dettaglio (per la tabella)
//   track(id)  -> una traccia intera (griglia, panoramica, dettaglio a 3 bande)
// Finche' il motore Rust non gira e' anche l'unica fonte delle forme d'onda
// per il motore simulato della pagina.

const fs = require('fs');
const path = require('path');

const CACHE = process.env.AUDIO_CACHE || path.join(__dirname, '..', 'audio-engine', 'cache');
const RESCAN_MS = 30000;

let index = null;   // { at, list }

// "Artista - Titolo myfreemp3.vip .mp3" / "12345678_Titolo_(Remix).mp3" -> artista, titolo
function fromFilename(rel) {
  let base = rel.split('/').pop().replace(/\.(mp3|flac|wav)$/i, '');
  // firma del sito e "(1)" delle copie scaricate due volte
  base = base.replace(/\s*myfreemp3\.vip\s*/gi, ' ').replace(/\s*\(\d+\)\s*$/, '').replace(/^\d+_/, '').replace(/_/g, ' ').trim();
  const i = base.indexOf(' - ');
  return i > 0 ? { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() } : { artist: '', title: base };
}

function summary(t, id) {
  const f = fromFilename(t.path);
  const artist = t.artist || f.artist;
  let title = (t.title || '').replace(/\s*myfreemp3\.vip.*$/i, '').trim();
  // firma del sito nel tag, anche tagliata a meta' ("… m", "… myfreemp3.")
  const tail = title.match(/\s(\S+)$/);
  if (tail && 'myfreemp3.vip'.startsWith(tail[1].toLowerCase())) title = title.slice(0, tail.index).trim();
  title = title || f.title;
  // tag "Artista - Titolo" nel titolo: l'artista sta gia' nella sua colonna
  if (artist && title.toLowerCase().startsWith(artist.toLowerCase() + ' - ')) title = title.slice(artist.length + 3);
  // tag ID3v1 tagliato a 30 caratteri: se e' l'inizio del titolo del nome file, vale quello intero
  if (f.title.toLowerCase().startsWith(title.toLowerCase()) && f.title.length > title.length) title = f.title;
  return {
    id, path: t.path, folder: t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')) : '',
    title, artist, seconds: t.seconds,
    bpm: t.grid?.bpm || 0, first_beat: t.grid?.first_beat || 0, confidence: t.grid?.confidence || 0,
    locked: !!t.locked, rms_db: t.rms_db,
  };
}

async function library(force) {
  if (!force && index && Date.now() - index.at < RESCAN_MS) return index.list;
  let names = [];
  try { names = (await fs.promises.readdir(CACHE)).filter(n => n.endsWith('.json')); } catch { /* nessuna analisi ancora */ }
  const list = [];
  for (const n of names) {
    try { list.push(summary(JSON.parse(await fs.promises.readFile(path.join(CACHE, n), 'utf8')), n.slice(0, -5))); } catch { /* file a meta' scrittura */ }
  }
  list.sort((a, b) => a.folder.localeCompare(b.folder) || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  index = { at: Date.now(), list };
  return list;
}

const validId = id => { if (!/^[0-9a-f]{16}$/.test(id)) throw new Error('id non valido'); return id; };

async function track(id) {
  validId(id);
  const t = JSON.parse(await fs.promises.readFile(path.join(CACHE, id + '.json'), 'utf8'));
  return { ...summary(t, id), wave: t.wave, wave_rate: 50, cues: await cues(id) };
}

// Punti salvati con la traccia (come la collezione di Traktor): cue e hot cue
// in <id>.cues.json accanto all'analisi, cosi' una nuova analisi non li tocca
// e li legge anche il motore.
const HOT = 8;
async function cues(id) {
  try { return JSON.parse(await fs.promises.readFile(path.join(CACHE, validId(id) + '.cues.json'), 'utf8')); } catch { return null; }
}
async function saveCues(id, c) {
  validId(id);
  await fs.promises.access(path.join(CACHE, id + '.json'));   // solo tracce analizzate
  const num = v => (Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 10000) / 10000 : null);
  const clean = { cue: num(c?.cue) ?? 0, hot: Array.from({ length: HOT }, (_, i) => num(c?.hot?.[i])), updated: new Date().toISOString() };
  const p = path.join(CACHE, id + '.cues.json');
  await fs.promises.writeFile(p + '.tmp', JSON.stringify(clean));
  await fs.promises.rename(p + '.tmp', p);
  return clean;
}

// Playlist: globali (come la collezione di Traktor), non del progetto. Un file
// accanto all'analisi: <cache>/playlists.json = {playlists: [{id, name, tracks: [id...], updated}]}
const PL_FILE = () => path.join(CACHE, 'playlists.json');
const MAX_PL = 200, MAX_PL_TRACKS = 2000;
function cleanPlaylists(list) {
  if (!Array.isArray(list) || list.length > MAX_PL) throw new Error('playlist: elenco non valido');
  const seen = new Set();
  return list.map(p => {
    const id = String(p?.id || '');
    if (!/^pl-[a-z0-9]{3,24}$/.test(id) || seen.has(id)) throw new Error('playlist: id non valido');
    seen.add(id);
    const name = String(p.name || '').trim().slice(0, 80) || 'Playlist';
    const tracks = Array.isArray(p.tracks) ? p.tracks.filter(t => typeof t === 'string' && /^[0-9a-f]{16}$/.test(t)).slice(0, MAX_PL_TRACKS) : [];
    return { id, name, tracks, updated: typeof p.updated === 'string' ? p.updated.slice(0, 30) : new Date().toISOString() };
  });
}
async function playlists() {
  try { return cleanPlaylists(JSON.parse(await fs.promises.readFile(PL_FILE(), 'utf8')).playlists || []); } catch { return []; }
}
async function savePlaylists(list) {
  const clean = cleanPlaylists(list);
  await fs.promises.mkdir(CACHE, { recursive: true });
  await fs.promises.writeFile(PL_FILE() + '.tmp', JSON.stringify({ playlists: clean }, null, 1));
  await fs.promises.rename(PL_FILE() + '.tmp', PL_FILE());
  return clean;
}

module.exports = { CACHE, library, track, cues, saveCues, fromFilename, playlists, savePlaylists, cleanPlaylists };
