'use strict';
// Timeline LASER eseguita dal bridge della Plancia, come quella video: segue
// l'orologio dello show (gaia/show/clock/state) e, ai tempi delle cue, manda
// al laser gateway (ops/laser) la sorgente e la scena di ogni cubo.
// Documento nel layout condiviso:
//   layout.laserTimeline = {active, cues: [{time, label, cube: 'all'|'c1'..,
//                           mode: ''|'off'|'scene'|'dmx'|'patchdeck'|'yolo'|'test',
//                           scene: ''|<id di layout.laserScenes>}]}
//   layout.laserScenes   = [{id, name, strokes, color, anim, audio}] (laser_scene.py)
// A strati: per ogni cubo vale l'ultima cue <= t che ne imposta modo o scena
// (una cue 'all' vale per tutti i cubi), quindi seek e loop si ricalcolano da
// soli. ARMARE resta sempre manuale: la timeline sceglie solo cosa proiettare.

const { clockPosition } = require('./video-timeline');

// stato per cubo al tempo t: {c1: {mode, scene}, ...}, cue = indice dell'ultima cue <= t
function layeredLaserState(cues, t, cubeIds) {
  const st = {}; let cue = -1;
  for (const id of cubeIds) st[id] = { mode: null, scene: null };
  const sorted = (cues || []).map((c, i) => ({ ...c, _i: i })).filter(c => Number.isFinite(+c.time)).sort((a, b) => a.time - b.time);
  for (const c of sorted) {
    if (c.time > t) break;
    cue = c._i;
    const targets = !c.cube || c.cube === 'all' ? cubeIds : cubeIds.filter(id => id === c.cube);
    for (const id of targets) {
      if (c.mode) st[id].mode = c.mode;
      if (c.scene) st[id].scene = c.scene;
    }
  }
  return { cubes: st, cue };
}

// comandi per passare da prev a next: prima la scena (cosi' passando a "scene"
// il contenuto e' gia' pronto), poi la modalita'. Scene sconosciute: saltate.
function laserCommands(prev, next, scenes) {
  const out = [], byId = new Map((scenes || []).map(s => [s.id, s]));
  for (const [id, n] of Object.entries(next.cubes)) {
    const p = prev[id] || {};
    if (n.scene && n.scene !== p.scene && byId.has(n.scene)) out.push({ action: 'scene', cube: id, scene: byId.get(n.scene), mode: false });
    if (n.mode && n.mode !== p.mode) out.push({ action: 'mode', cube: id, value: n.mode });
  }
  return out;
}

// LASER_ID / SHOW_CLOCK_TOPIC: solo per le prove (gateway di prova, orologio simulato)
function startLaserTimeline({ getDoc, getScenes, broadcast, url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', deviceId = process.env.LASER_ID || 'laser-ops', clockTopic = process.env.SHOW_CLOCK_TOPIC || 'gaia/show/clock/state', log = console.log }) {
  let mqtt;
  try { mqtt = require('mqtt'); } catch { log('Timeline laser: pacchetto mqtt mancante (npm install), disattivata'); return null; }
  const client = mqtt.connect(url, { clientId: `plancia-bridge-laser-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
  const statusTopic = `gaia/device/${deviceId}/status`;
  let clock = null, cubeIds = [], sent = {}, wasActive = false, status = {}, lastKey = '', lastSentAt = 0;
  client.on('connect', () => { log(`Timeline laser: MQTT ${url} collegato, gateway = ${deviceId}`); client.subscribe([clockTopic, statusTopic]); });
  client.on('error', e => log('Timeline laser MQTT:', e.message));
  client.on('message', (topic, payload) => {
    try {
      const p = JSON.parse(payload);
      if (topic === statusTopic) { cubeIds = (p.laser?.cubes || []).map(c => c.id); return; }
      if (topic === clockTopic && Number.isFinite(+p.pos)) clock = { ...p, receivedAt: Date.now() };
    } catch { /* ignora */ }
  });
  const send = o => client.publish(`gaia/device/${deviceId}/command`, JSON.stringify(o));
  const timer = setInterval(() => {
    const doc = getDoc() || {}, active = !!doc.active, now = Date.now();
    const fresh = !!clock && now - clock.receivedAt < 5000;
    const t = fresh ? clockPosition(clock, now) : null;
    let st = null, cmds = [];
    if (active && t != null && cubeIds.length) {
      if (!wasActive) sent = {};                   // riaccesa: si rimanda tutto
      st = layeredLaserState(doc.cues, t, cubeIds);
      cmds = laserCommands(sent, st, getScenes());
      if (cmds.length && client.connected) {
        cmds.forEach(send);
        for (const [id, n] of Object.entries(st.cubes)) sent[id] = { mode: n.mode ?? sent[id]?.mode ?? null, scene: n.scene ?? sent[id]?.scene ?? null };
      }
    }
    wasActive = active && t != null && cubeIds.length > 0;
    const cue = st && st.cue >= 0 ? doc.cues[st.cue] : null;
    status = { active, mqtt: client.connected, clock: fresh, gateway: cubeIds.length > 0, t: t == null ? null : +t.toFixed(2), cue: st ? st.cue : -1, label: cue?.label || '', cubes: sent };
    const key = JSON.stringify({ ...status, t: null });
    if (key !== lastKey || cmds.length || now - lastSentAt > 500) { lastKey = key; lastSentAt = now; broadcast({ type: 'laser', state: status, sent: cmds.map(c => ({ ...c, scene: c.scene?.name })) }); }
  }, 100);
  return { stop: () => { clearInterval(timer); client.end(true); }, status: () => status };
}

module.exports = { layeredLaserState, laserCommands, startLaserTimeline };
