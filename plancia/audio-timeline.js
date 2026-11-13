'use strict';
// Timeline AUDIO eseguita dal bridge della Plancia, come quelle laser e video:
// segue l'orologio dello show (gaia/show/clock/state) e guida il motore
// gaia-audio (audio-engine-link.js) sui deck A e B.
// Documento nel layout condiviso:
//   layout.audioTimeline = {active, cues: [{time, label, fade,
//                           src: {kind: 'track'|'playlist'|'stop', id}}]}
// Una cue "track" suona un brano, una "playlist" i suoi brani uno dopo l'altro
// (dissolvenza incrociata di `fade` secondi tra un brano e il successivo), "stop"
// sfuma e ferma. Una cue nuova interrompe quella prima, con la sua dissolvenza.
// I brani si alternano sui deck A e B. Il bridge non manda una sequenza di
// comandi: a ogni passo confronta cosa dovrebbe suonare adesso con lo stato del
// motore e corregge, quindi salti avanti/indietro, pausa dello show e motore
// riavviato si sistemano da soli. Con la timeline in TIMELINE il bridge comanda
// deck e fader (tempo naturale, niente sync, crossfader al centro).

const { clockPosition, clockReceive, clockAlive, clockUsable } = require('./video-timeline');

const DECKS = ['A', 'B'];
const PRELOAD_S = 30;        // il brano successivo si carica (fermo) sull'altro deck
const SEEK_TOL_S = 0.3;      // scarto oltre il quale si riposiziona il deck
const LOAD_WAIT_MS = 4000;   // dopo un caricamento non si rimanda per questo tempo

// cue -> segmenti in ordine: {start, end, track, len, fade, deck, cue, stop}
// lens: Map id -> secondi; lists: Map id playlist -> [id brano]
function audioSegments(cues, lens, lists) {
  const sorted = (cues || []).map((c, i) => ({ ...c, _i: i })).filter(c => Number.isFinite(+c.time) && c.src && c.src.kind).sort((a, b) => a.time - b.time);
  const segs = [];
  sorted.forEach((c, ci) => {
    const until = ci + 1 < sorted.length ? +sorted[ci + 1].time : Infinity;
    const fade = Math.max(0, Math.min(30, +c.fade || 0));
    if (c.src.kind === 'stop') { segs.push({ start: +c.time, stop: true, fade, cue: c._i, len: 0 }); return; }
    const ids = c.src.kind === 'playlist' ? (lists.get(c.src.id) || []) : [c.src.id];
    let at = +c.time;
    ids.forEach((id, k) => {
      const len = lens.get(id);
      if (!(len > 0) || at >= until) return;
      // dentro una playlist la dissolvenza tra i brani non supera meta' brano
      const f = k === 0 ? fade : Math.min(fade, len / 2);
      if (k > 0) at -= f;
      segs.push({ start: at, track: id, len, fade: f, cue: c._i, item: k });
      at += len;
    });
  });
  // fine: il brano finisce, oppure il segmento dopo lo sostituisce dopo la sua dissolvenza
  let d = 0;
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    s.end = Math.min(s.start + s.len, next ? next.start + next.fade : Infinity);
    if (!s.stop) { s.deck = DECKS[d % 2]; d++; }
  });
  return segs;
}

// cosa deve suonare al tempo t: per deck {track, pos, playing, fader} (null = non usato)
function audioDesired(segs, t, running) {
  const want = { A: null, B: null };
  let cur = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].start <= t) cur = i;
  const set = (s, fader) => { want[s.deck] = { track: s.track, pos: t - s.start, playing: running, fader: Math.max(0, Math.min(1, fader)) }; };
  if (cur >= 0) {
    const s = segs[cur], prev = segs[cur - 1];
    const x = s.fade > 0 ? (t - s.start) / s.fade : 1;
    if (!s.stop && t < s.start + s.len) set(s, x < 1 ? x : 1);
    // dissolvenza in corso: il precedente scende (anche verso uno stop)
    if (prev && !prev.stop && x < 1 && t < prev.start + prev.len && prev.deck !== (s.stop ? null : s.deck)) set(prev, 1 - x);
  }
  // il prossimo brano, fermo all'inizio, sull'altro deck (si carica prima: parte senza attese)
  const next = segs.slice(cur + 1).find(s => !s.stop);
  if (next && next.start - t < PRELOAD_S && !want[next.deck]) want[next.deck] = { track: next.track, pos: 0, playing: false, fader: 0 };
  return { want, seg: cur };
}

// stato del motore (audio_state) -> comandi per arrivare a `want`.
// pend: {A: {loadAt, track, seekAt}, B: ...} (modificato), now in ms
function audioCommands(want, eng, now, pend, ageMs = 0) {
  const out = [];
  for (const k of DECKS) {
    const w = want[k], e = eng?.decks?.[k], m = eng?.mix?.[k], p = pend[k] || (pend[k] = {});
    if (!w) {
      // deck non usato dalla timeline: si ferma (era un brano della timeline finito o interrotto)
      if (e?.playing && p.owned) out.push({ cmd: 'deck.play', deck: k, value: false });
      continue;
    }
    p.owned = true;
    if (!e) continue;
    if (e.track !== w.track) {
      if (p.track === w.track && now - p.loadAt < LOAD_WAIT_MS) continue;   // caricamento in corso
      p.track = w.track; p.loadAt = now; p.seekAt = now;
      out.push({ cmd: 'deck.load', deck: k, track: w.track, pos: w.pos + (w.playing ? 0.25 : 0), play: w.playing, force: true });
      out.push({ cmd: 'mix.ramp', ch: k, fader: w.fader, seconds: 0.05 });
      continue;
    }
    // tempo naturale: la timeline e' scritta in secondi del brano
    if (e.sync) out.push({ cmd: 'deck.sync', deck: k, value: false });
    if (Math.abs(e.tempo || 0) > 1e-6) out.push({ cmd: 'deck.tempo', deck: k, value: 0 });
    if (Math.abs(e.nudge || 0) > 1e-6) out.push({ cmd: 'deck.nudge', deck: k, value: 0 });
    const epos = e.pos + (e.playing ? ageMs / 1000 * (e.rate || 1) : 0);
    if (Math.abs(epos - w.pos) > SEEK_TOL_S && now - (p.seekAt || 0) > 500) { p.seekAt = now; out.push({ cmd: 'deck.seek', deck: k, pos: w.pos }); }
    if (!!e.playing !== w.playing) out.push({ cmd: 'deck.play', deck: k, value: w.playing });
    if (m && Math.abs((m.fader ?? 1) - w.fader) > 0.005) out.push({ cmd: 'mix.ramp', ch: k, fader: w.fader, seconds: 0.12 });
  }
  if (eng?.mix && Math.abs(eng.mix.xfader || 0) > 0.005 && (want.A || want.B)) out.push({ cmd: 'mix.set', values: { xfader: 0 } });
  return out;
}

// getDoc: layout.audioTimeline; engine: audio-engine-link; lib: audio-lib
function startAudioTimeline({ getDoc, engine, lib, broadcast, url = process.env.AUDIO_TL_MQTT || process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', clockTopic = process.env.SHOW_CLOCK_TOPIC || 'gaia/show/clock/state', log = console.log }) {
  let mqtt;
  try { mqtt = require('mqtt'); } catch { log('Timeline audio: pacchetto mqtt mancante (npm install), disattivata'); return null; }
  const client = mqtt.connect(url, { clientId: `plancia-bridge-audio-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
  let clock = null, lens = new Map(), lists = new Map(), titles = new Map(), pend = {}, status = {}, lastKey = '', lastSentAt = 0, wasActive = false;
  client.on('connect', () => client.subscribe(clockTopic));
  client.on('error', e => log('Timeline audio MQTT:', e.message));
  client.on('message', (topic, payload) => {
    try { const p = JSON.parse(payload); if (topic === clockTopic && Number.isFinite(+p.pos)) clock = clockReceive(clock, p); } catch { /* ignora */ }
  });
  // durate e playlist: dalla cache dell'analisi, ogni 2 s (sono in memoria nel modulo)
  const refresh = async () => {
    try {
      const [tracks, pls] = await Promise.all([lib.library(), lib.playlists()]);
      lens = new Map(tracks.map(t => [t.id, t.seconds]));
      titles = new Map(tracks.map(t => [t.id, t.title]));
      lists = new Map(pls.map(p => [p.id, p.tracks]));
    } catch { /* riprova */ }
  };
  refresh();
  const libTimer = setInterval(refresh, 2000);
  const timer = setInterval(() => {
    const doc = getDoc() || {}, active = !!doc.active, now = Date.now();
    const fresh = clockAlive(clock, now);
    const t = clockUsable(clock, now) ? clockPosition(clock, now) : null;
    const eng = engine.state(), up = engine.up() && !!eng;
    let cmds = [], seg = -1, segs = null;
    if (active && t != null && up) {
      if (!wasActive) pend = {};
      segs = audioSegments(doc.cues, lens, lists);
      const d = audioDesired(segs, t, !!clock.playing);
      seg = d.seg;
      cmds = audioCommands(d.want, eng, now, pend, now - engine.stateAt());
      for (const c of cmds) engine.send(c);
    }
    wasActive = active && t != null && up;
    const s = seg >= 0 ? segs[seg] : null;
    status = { active, engine: up, clock: fresh, t: t == null ? null : +t.toFixed(2), seg, cue: s ? s.cue : -1,
      label: s ? (s.stop ? 'stop' : `${s.deck} · ${titles.get(s.track) || s.track}`) : '', segments: segs ? segs.length : 0 };
    const key = JSON.stringify({ ...status, t: null });
    if (key !== lastKey || cmds.length || now - lastSentAt > 500) { lastKey = key; lastSentAt = now; broadcast({ type: 'audio_tl', state: status }); }
  }, 100);
  return { stop: () => { clearInterval(timer); clearInterval(libTimer); client.end(true); }, status: () => status };
}

module.exports = { audioSegments, audioDesired, audioCommands, startAudioTimeline };
