'use strict';
// Autoplay della Console Audio, eseguito dal bridge (suona anche a tablet chiusi).
// Indipendente dalla timeline: ha un suo orologio, parte da Play e va avanti da solo.
//   sorgente: una playlist (source = id) o tutta la libreria (source = '')
//   ordine:   'order' = nell'ordine della playlist, poi ricomincia; 'shuffle' = a caso,
//             senza ripetere finche' non sono passati quasi tutti i brani
//   fade:     dissolvenza incrociata tra un brano e il successivo (s)
// Come la timeline AUDIO i brani si alternano sui deck A e B, il successivo si carica
// prima (fermo, fader giu') e ogni 100 ms il bridge confronta cosa deve suonare con lo
// stato del motore e corregge (audioDesired/audioCommands di audio-timeline.js).
// Se la traccia AUDIO della timeline e' attiva comanda lei: l'autoplay aspetta, col suo
// orologio fermo, e riprende da dove era quando la timeline si spegne.
//   pagine -> bridge  {type:'audio_auto', action:'start', source, mode, fade} | 'next' | 'stop'
//   bridge -> pagine  {type:'audio_auto', state:{...}}

const { audioDesired, audioCommands } = require('./audio-timeline');

const AHEAD_S = 45;       // il brano dopo entra in coda quando alla fine dell'ultimo mancano meno di 45 s
const MAX_FADE = 30;
const RECENT = 50;        // a caso: brani recenti da non ripetere

const clampFade = f => Math.max(0, Math.min(MAX_FADE, Number.isFinite(+f) ? +f : 8));

// prossimo brano dalla sorgente. st: {mode, idx, recent}; pool: [id] gia' filtrati (durata nota)
function pickNext(st, pool, rnd = Math.random) {
  if (!pool.length) return null;
  if (st.mode !== 'shuffle') { const id = pool[st.idx % pool.length]; st.idx = (st.idx + 1) % pool.length; return id; }
  const avoid = new Set(st.recent.slice(-Math.min(pool.length - 1, RECENT)));
  const cand = pool.filter(id => !avoid.has(id));
  const list = cand.length ? cand : pool;
  return list[Math.floor(rnd() * list.length) % list.length];
}

// coda: segmenti come quelli di audioSegments ({start, track, len, fade, deck, end, cue})
// aggiunti finche' l'ultimo finisce a meno di AHEAD_S da t
function extendQueue(st, t, lens, pool, rnd) {
  for (let guard = 0; guard < 20; guard++) {
    const last = st.segs[st.segs.length - 1];
    if (last && (last.stop || last.start + last.len - t > AHEAD_S)) return;
    const id = pickNext(st, pool, rnd);
    if (!id) return;
    const len = lens.get(id);
    st.recent.push(id); if (st.recent.length > RECENT * 2) st.recent.splice(0, RECENT);
    let start, fade;
    if (!last) { start = t; fade = 0; }                                  // il primo parte subito, pieno
    else if (st.nextAt != null) { start = st.nextAt; fade = st.nextFade; st.nextAt = null; }   // dopo "avanti"
    else { fade = Math.min(st.fade, last.len / 2, len / 2); start = last.start + last.len - fade; }
    st.segs.push({ start, track: id, len, fade, deck: last ? (last.deck === 'A' ? 'B' : 'A') : (st.firstDeck || 'A'), cue: 0, end: start + len });
  }
}

// "avanti": il brano in onda sfuma adesso e il prossimo entra con la dissolvenza
function skip(st, t) {
  let cur = -1;
  for (let i = 0; i < st.segs.length; i++) if (st.segs[i].start <= t && !st.segs[i].stop) cur = i;
  if (cur < 0) return false;
  const s = st.segs[cur], f = Math.min(st.fade, 8);
  s.len = Math.max(0.05, t - s.start + f); s.end = s.start + s.len;
  st.segs.length = cur + 1;
  st.nextAt = t; st.nextFade = f;
  return true;
}

// segmenti finiti da un pezzo: fuori dalla coda (resta il precedente per la dissolvenza)
function prune(st, t) {
  while (st.segs.length > 2 && st.segs[1].start + st.segs[1].len < t - 5) st.segs.shift();
}

function startAudioAuto({ engine, lib, broadcast, timelineActive = () => false, log = console.log }) {
  const st = { active: false, stopping: null, source: '', mode: 'shuffle', fade: 8, segs: [], idx: 0, recent: [], nextAt: null, nextFade: 0,
    t0: 0, waiting: false, error: '' };
  let lens = new Map(), titles = new Map(), lists = new Map(), pend = {}, lastKey = '', lastSentAt = 0, lastTick = Date.now();
  const refresh = async () => {
    try {
      const [tracks, pls] = await Promise.all([lib.library(), lib.playlists()]);
      lens = new Map(tracks.filter(x => x.seconds > 0).map(x => [x.id, x.seconds]));
      titles = new Map(tracks.map(x => [x.id, { title: x.title, artist: x.artist }]));
      lists = new Map(pls.map(p => [p.id, { name: p.name, tracks: p.tracks }]));
    } catch { /* riprova */ }
  };
  refresh();
  const libTimer = setInterval(refresh, 5000);
  const pool = () => (st.source ? (lists.get(st.source)?.tracks || []) : [...lens.keys()]).filter(id => lens.get(id) > 0);
  const clock = now => (now - st.t0) / 1000;

  const state = () => {
    const now = Date.now(), t = clock(now);
    let cur = -1;
    for (let i = 0; i < st.segs.length; i++) if (st.segs[i].start <= t) cur = i;
    const s = cur >= 0 && !st.segs[cur].stop ? st.segs[cur] : null, nx = st.segs.slice(cur + 1).find(x => !x.stop);
    const info = x => x && { id: x.track, ...(titles.get(x.track) || { title: x.track, artist: '' }), deck: x.deck, len: +x.len.toFixed(1) };
    return { active: st.active, stopping: st.stopping != null, waiting: st.waiting, source: st.source, sourceName: st.source ? (lists.get(st.source)?.name || '(playlist sparita)') : 'Tutta la libreria',
      mode: st.mode, fade: st.fade, error: st.error, now: s ? { ...info(s), pos: +(t - s.start).toFixed(1) } : null, next: info(nx), count: st.active ? pool().length : 0 };
  };
  const send = force => {
    const s = state(), key = JSON.stringify({ ...s, now: s.now && { ...s.now, pos: null } });
    if (force || key !== lastKey || Date.now() - lastSentAt > 1000) { lastKey = key; lastSentAt = Date.now(); broadcast({ type: 'audio_auto', state: s }); }
  };

  const timer = setInterval(() => {
    const now = Date.now(), dt = now - lastTick; lastTick = now;
    if (!st.active) return;
    // la timeline AUDIO comanda: orologio fermo, nessun comando
    if (timelineActive()) { st.t0 += dt; st.waiting = true; pend = {}; send(); return; }
    st.waiting = false;
    const eng = engine.state();
    if (!engine.up() || !eng) {
      // senza motore non c'e' niente da sfumare: lo stop e' subito
      if (st.stopping != null) { st.active = false; st.stopping = null; st.segs = []; st.error = ''; send(true); return; }
      st.t0 += dt; st.error = 'motore audio non collegato'; send(); return;
    }
    st.error = '';
    const t = clock(now);
    if (st.stopping == null) extendQueue(st, t, lens, pool());
    if (!st.segs.length) { st.error = st.source ? 'playlist vuota' : 'libreria vuota'; send(); return; }
    prune(st, t);
    let want = audioDesired(st.segs, t, true).want;
    const done = st.stopping != null && t >= st.stopping;
    if (done) want = { A: null, B: null };
    for (const c of audioCommands(want, eng, now, pend, now - engine.stateAt())) engine.send({ type: 'audio', ...c });
    if (done) { st.active = false; st.stopping = null; st.segs = []; log('Autoplay audio: fermo'); }
    send();
  }, 100);

  return {
    active: () => st.active && !st.waiting,
    state,
    command(m) {
      const now = Date.now();
      if (m.action === 'start') {
        st.source = typeof m.source === 'string' ? m.source : '';
        st.mode = m.mode === 'order' ? 'order' : 'shuffle';
        st.fade = clampFade(m.fade);
        if (!pool().length) return st.source ? 'La playlist è vuota.' : 'Libreria vuota.';
        // primo brano sul deck libero: se uno sta suonando a mano non lo si interrompe
        const e = engine.state()?.decks;
        Object.assign(st, { active: true, stopping: null, segs: [], idx: 0, nextAt: null, t0: now, error: '',
          firstDeck: e?.A?.playing && !e?.B?.playing ? 'B' : 'A' });
        pend = {};
        log(`Autoplay audio: ${st.mode === 'order' ? 'in ordine' : 'a caso'} da ${state().sourceName}, dissolvenza ${st.fade} s`);
      } else if (m.action === 'next') {
        if (!st.active || st.stopping != null) return 'Autoplay non attivo.';
        if (!skip(st, clock(now))) return 'Nessun brano in onda.';
      } else if (m.action === 'stop') {
        if (!st.active || st.stopping != null) return null;
        const t = clock(now), f = Math.min(st.fade || 2, 6);
        let cur = -1;
        for (let i = 0; i < st.segs.length; i++) if (st.segs[i].start <= t) cur = i;
        st.segs.length = cur + 1;   // via il brano gia' in coda: sfuma solo quello in onda
        st.segs.push({ start: t, stop: true, fade: f, cue: 0, len: 0, end: t });
        st.stopping = t + f + 0.3;
      } else return 'Comando autoplay sconosciuto.';
      send(true);
      return null;
    },
    stop: () => { clearInterval(timer); clearInterval(libTimer); },
  };
}

module.exports = { startAudioAuto, pickNext, extendQueue, skip, prune };
