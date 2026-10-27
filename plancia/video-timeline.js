'use strict';
// Timeline VIDEO di PatchDeck eseguita dal bridge della Plancia (GAIA_INTERFACE
// "OPS, 16"; nota TD 41). Il bridge segue l'orologio dello show di DMX Master
// (gaia/show/clock/state, retained, >=1/s e subito a ogni salto) come follower
// e, ai tempi delle cue, manda a PatchDeck gli stessi comandi del tablet:
// load_x<n>_<a|b> (enable), deck_a/deck_b (enable/disable), FX (set).
// Il documento sta nel layout condiviso: layout.videoTimeline =
//   {active: bool, cues: [{time, label, deck: 'A'|'B', patch: n|null,
//                          show: 'A'|'B'|'AB'|'none'|null, fx: {edge: 0-1, ...}}]}
// A strati come le scene: ogni campo vale l'ultima cue <= t che lo imposta,
// quindi dopo un seek o un loop lo stato si ricalcola da solo. 'active' del
// clock riguarda solo le luci (nota 41): per il video conta videoTimeline.active.
// Dissolvenze (2026-10-27, deck_mix di PatchDeck: 0 = solo A, 1 = solo B): una cue
// con show 'A' o 'B' e fade > 0 tiene accesi entrambi i deck per fade secondi e
// porta deck_mix al deck scelto; il valore si calcola dal tempo, quindi regge seek
// e loop. Senza fade lo stacco porta subito deck_mix sul deck mostrato.

const FX = ['edge', 'feedback', 'fb_scale', 'fb_blur', 'mirror'];
const MIX_OF = { A: 0, B: 1, AB: 0.5 };

// stato video al tempo t: {patchA, patchB, showA, showB, fx: {...}, cue, mix}
function layeredVideoState(cues, t) {
  const st = { patchA: null, patchB: null, showA: null, showB: null, fx: {}, cue: -1, mix: null };
  const list = (Array.isArray(cues) ? cues : []).map((c, i) => ({ ...c, i })).filter(c => Number.isFinite(+c.time))
    .sort((a, b) => a.time - b.time || a.i - b.i);
  for (const c of list) {
    if (+c.time > t + 1e-6) break;
    st.cue = c.i;
    const deck = String(c.deck || '').toUpperCase();
    if (Number.isInteger(+c.patch) && +c.patch > 0 && (deck === 'A' || deck === 'B')) st['patch' + deck] = +c.patch;
    if (['A', 'B', 'AB', 'none'].includes(c.show)) {
      const fade = Number.isFinite(+c.fade) && +c.fade > 0 ? +c.fade : 0, target = MIX_OF[c.show];
      if (fade && (c.show === 'A' || c.show === 'B') && t < +c.time + fade) {
        // in dissolvenza: si parte dal mix di prima (o dal deck che si vedeva)
        const from = st.mix ?? (st.showB && !st.showA ? 1 : st.showA && !st.showB ? 0 : 1 - target);
        const k = Math.max(0, Math.min(1, (t - +c.time) / fade));
        st.showA = true; st.showB = true; st.mix = +(from + (target - from) * k).toFixed(3);
      } else {
        st.showA = c.show === 'A' || c.show === 'AB'; st.showB = c.show === 'B' || c.show === 'AB';
        if (target != null) st.mix = target;
      }
    }
    for (const k of FX) if (c.fx && Number.isFinite(+c.fx[k])) st.fx[k] = Math.max(0, Math.min(1, +c.fx[k]));
  }
  return st;
}

// comandi PatchDeck per passare da 'prev' (gia' mandato) a 'next';
// opts.mix: PatchDeck pubblica deck_mix (altrimenti niente dissolvenze)
function videoCommands(prev, next, opts = {}) {
  const out = [];
  for (const d of ['A', 'B']) {
    const p = next['patch' + d];
    if (p != null && p !== prev['patch' + d]) out.push({ action: 'enable', service: `load_x${p}_${d.toLowerCase()}` });
    const s = next['show' + d];
    if (s != null && s !== prev['show' + d]) out.push({ action: s ? 'enable' : 'disable', service: `deck_${d.toLowerCase()}` });
  }
  if (opts.mix && next.mix != null && (prev.mix == null || Math.abs(next.mix - prev.mix) >= 0.005))
    out.push({ action: 'set', param: 'deck_mix', value: next.mix });
  for (const k of FX) {
    const v = next.fx[k];
    if (v != null && v !== (prev.fx || {})[k]) out.push({ action: 'set', param: k, value: v });
  }
  return out;
}

// posizione stimata del clock: estrapolazione dall'ultimo stato ricevuto
function clockPosition(clock, now) {
  if (!clock) return null;
  let t = +clock.pos || 0;
  if (clock.playing) t += Math.max(0, now - clock.receivedAt) / 1000 * (Number.isFinite(+clock.rate) ? +clock.rate : 1);
  const L = +clock.length;
  if (Number.isFinite(L) && L > 0) t = clock.loop ? t % L : Math.min(t, L);
  return t;
}

// SHOW_CLOCK_TOPIC / PATCHDECK_ID: solo per le prove (orologio simulato, PatchDeck fittizio)
function startVideoTimeline({ getDoc, broadcast, url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', deviceId = process.env.PATCHDECK_ID || 'td-pd-pc-win', clockTopic = process.env.SHOW_CLOCK_TOPIC || 'gaia/show/clock/state', log = console.log }) {
  let mqtt;
  try { mqtt = require('mqtt'); } catch { log('Timeline video: pacchetto mqtt mancante (npm install), disattivata'); return null; }
  const client = mqtt.connect(url, { clientId: `plancia-bridge-video-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
  const empty = () => ({ patchA: null, patchB: null, showA: null, showB: null, fx: {}, mix: null });
  const matrixTopic = `gaia/devices/${deviceId}/patchdeck_matrix`;
  let clock = null, sent = empty(), wasActive = false, status = {}, lastKey = '', lastSentAt = 0, hasMix = false;
  client.on('connect', () => { log(`Timeline video: MQTT ${url} collegato, PatchDeck = ${deviceId}`); client.subscribe([clockTopic, matrixTopic]); });
  client.on('error', e => log('Timeline video MQTT:', e.message));
  client.on('message', (topic, payload) => {
    if (topic === matrixTopic) { try { hasMix = !!JSON.parse(payload).fx_params?.deck_mix; } catch { /* ignora */ } return; }
    if (topic !== clockTopic) return;
    try { const p = JSON.parse(payload); if (Number.isFinite(+p.pos)) clock = { ...p, receivedAt: Date.now() }; } catch { /* ignora */ }
  });
  const send = o => client.publish(`gaia/device/${deviceId}/command`, JSON.stringify(o));
  const timer = setInterval(() => {
    const doc = getDoc() || {}, active = !!doc.active, now = Date.now();
    const fresh = !!clock && now - clock.receivedAt < 5000;
    const t = fresh ? clockPosition(clock, now) : null;
    let st = null, cmds = [];
    if (active && t != null) {
      // riaccendendo la timeline si riparte da zero: si rimanda tutto lo stato
      if (!wasActive) sent = empty();
      st = layeredVideoState(doc.cues, t);
      cmds = videoCommands(sent, st, { mix: hasMix });
      if (cmds.length && client.connected) {
        cmds.forEach(send);
        sent = { patchA: st.patchA ?? sent.patchA, patchB: st.patchB ?? sent.patchB, showA: st.showA ?? sent.showA, showB: st.showB ?? sent.showB, fx: { ...sent.fx, ...st.fx }, mix: hasMix ? (st.mix ?? sent.mix) : sent.mix };
      }
    }
    wasActive = active && t != null;
    const cue = st && st.cue >= 0 ? doc.cues[st.cue] : null;
    status = { active, mqtt: client.connected, clock: fresh, playing: !!clock?.playing, t: t == null ? null : +t.toFixed(2), cue: st ? st.cue : -1, label: cue?.label || '', deck: { a: sent.patchA, b: sent.patchB, showA: sent.showA, showB: sent.showB, mix: sent.mix }, mixReady: hasMix };
    // ai tablet: subito se cambia qualcosa (non il tempo), altrimenti ogni 0,5 s
    const key = JSON.stringify({ ...status, t: null });
    if (key !== lastKey || cmds.length || now - lastSentAt > 500) { lastKey = key; lastSentAt = now; broadcast({ type: 'video', state: status, sent: cmds }); }
  }, 100);
  return { stop: () => { clearInterval(timer); client.end(true); }, status: () => status };
}

module.exports = { FX, MIX_OF, layeredVideoState, videoCommands, clockPosition, startVideoTimeline };
