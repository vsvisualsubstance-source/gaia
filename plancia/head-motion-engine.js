'use strict';
// Motore del movimento teste nel bridge della Plancia (su OPS), come le
// timeline video e laser: gira anche a tablet chiuso. Manda /mh/pantilt a
// DMX Master ~30 volte al secondo, quindi tutte le teste selezionate fanno lo
// stesso movimento (testa 0 della scena): ventaglio, onda e specchio per testa
// arrivano quando il motore sara' in DMX Master, con le stesse scene.
//   prova dal vivo: messaggio WS {type:'head_motion', action:'play', scene, bpm} / {action:'stop'}
//   timeline: layout.headTimeline = {engine: 'ops', active, bpm, cues: [{time, label, scene: <id>|'off'}]}
//             (con engine 'td' o assente la traccia va in show_timeline e la esegue DMX Master, nota TD 57)
// La prova dal vivo ha la precedenza sulla timeline finche' non si ferma.

const { hmPoint } = require('./src/63-head-motion');
const { clockPosition } = require('./video-timeline');

// scena attiva al tempo t: l'ultima cue <= t ('off' = fermo), -1 prima della prima
function headMotionAt(cues, t) {
  let cue = -1, scene = null;
  (cues || []).map((c, i) => ({ ...c, _i: i })).filter(c => Number.isFinite(+c.time)).sort((a, b) => a.time - b.time)
    .forEach(c => { if (c.time <= t) { cue = c._i; scene = c.scene && c.scene !== 'off' ? c.scene : null; } });
  return { cue, scene };
}

function startHeadMotion({ getDoc, getScenes, sendOsc, broadcast, rate = 30, url = process.env.PLANCIA_MQTT || 'mqtt://127.0.0.1:11883', tdId = 'td-dmx-win', clockTopic = process.env.SHOW_CLOCK_TOPIC || 'gaia/show/clock/state', log = console.log }) {
  let mqtt = null, client = null, clock = null;
  try { mqtt = require('mqtt'); } catch { log('Movimento teste: pacchetto mqtt mancante, solo prova dal vivo'); }
  if (mqtt) {
    client = mqtt.connect(url, { clientId: `plancia-bridge-heads-${process.pid}`, reconnectPeriod: 3000, connectTimeout: 5000 });
    client.on('connect', () => client.subscribe(clockTopic));
    client.on('error', e => log('Movimento teste MQTT:', e.message));
    client.on('message', (topic, payload) => { try { const p = JSON.parse(payload); if (Number.isFinite(+p.pos)) clock = { ...p, receivedAt: Date.now() }; } catch { /* ignora */ } });
  }
  let live = null, current = null, lastSent = '', lastEcho = 0, status = {}, lastStatus = '', lastStatusAt = 0;
  // all'avvio di una scena: tutte le teste selezionate e velocita' dei motori
  const begin = sc => {
    sendOsc('/mh/select/all', []);
    if (sc.motor != null && client?.connected) client.publish(`gaia/device/${tdId}/command`, JSON.stringify({ action: 'set', param: 'heads_speed', value: +sc.motor }));
  };
  const timer = setInterval(() => {
    const now = Date.now(), doc = getDoc() || {}, scenes = getScenes() || [];
    const fresh = !!clock && now - clock.receivedAt < 5000, tClock = fresh ? clockPosition(clock, now) : null;
    let sc = null, t = 0, bpm = +doc.bpm || 120, cue = -1, source = 'off';
    if (live) { sc = live.scene; t = (now - live.startedAt) / 1000; bpm = live.bpm || bpm; source = 'live'; }
    else if (doc.active && doc.engine === 'ops' && tClock != null) {   // col motore di DMX Master la traccia la esegue TD
      const at = headMotionAt(doc.cues, tClock); cue = at.cue;
      sc = at.scene ? scenes.find(s => s.id === at.scene) || null : null; t = tClock; source = 'timeline';
    }
    const key = sc ? `${source}:${sc.id}:${live?.startedAt || ''}` : '';
    if (key !== current) { current = key; lastSent = ''; if (sc) begin(sc); }
    if (sc) {
      const [x, y] = hmPoint(sc, t, 0, bpm), msg = `${x},${y}`;
      if (msg !== lastSent) {
        lastSent = msg; sendOsc('/mh/pantilt', [x, y]);
        // i tablet vedono il movimento nel Render anche senza ritorno da TD (10/s)
        if (now - lastEcho > 100) { lastEcho = now; broadcast({ type: 'osc', address: '/mh/pantilt', args: [x, y], channel: 'default', echo: true }); }
      }
    }
    status = { source, scene: sc ? { id: sc.id, name: sc.name } : null, active: !!doc.active, clock: fresh, mqtt: !!client?.connected, cue, label: cue >= 0 ? doc.cues[cue]?.label || '' : '' };
    const sk = JSON.stringify(status);
    if (sk !== lastStatus || now - lastStatusAt > 1000) { lastStatus = sk; lastStatusAt = now; broadcast({ type: 'head_motion', state: status }); }
  }, Math.round(1000 / rate));
  return {
    play: (scene, bpm) => { if (scene && scene.path) live = { scene, bpm: +bpm || null, startedAt: Date.now() }; },
    stop: () => { live = null; },
    // TAP: il giro cambia durata senza saltare (stessa fase al nuovo tempo)
    tempo: bpm => { if (live && +bpm > 0) { const now = Date.now(), old = live.bpm || 120; live.startedAt = now - (now - live.startedAt) * old / +bpm; live.bpm = +bpm; } },
    status: () => status,
    close: () => { clearInterval(timer); client?.end(true); }
  };
}

module.exports = { headMotionAt, startHeadMotion };
