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

async function track(id) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new Error('id non valido');
  const t = JSON.parse(await fs.promises.readFile(path.join(CACHE, id + '.json'), 'utf8'));
  return { ...summary(t, id), wave: t.wave, wave_rate: 50 };
}

module.exports = { CACHE, library, track, fromFilename };
