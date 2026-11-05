'use strict';
// Collegamento bridge <-> motore audio gaia-audio (Rust, docs/console-audio.md).
// Il motore ascolta solo su 127.0.0.1:8790; il bridge e' il suo unico client:
// inoltra al motore i comandi {type:'audio', cmd, ...} delle pagine e rimanda
// a tutte le pagine stato ed errori del motore (audio_state, audio_error)
// cosi' come arrivano. Se il motore non c'e' riprova ogni 3 s; le pagine,
// senza stato fresco, tornano al motore simulato.

const { WebSocket } = require('ws');

function startAudioEngineLink({ url = process.env.AUDIO_ENGINE_URL || 'ws://127.0.0.1:8790', onMessage, log = console.log } = {}) {
  let ws = null, up = false, timer = null, stopped = false, last = null, lastAt = 0;
  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.on('open', () => { up = true; log(`Motore audio collegato (${url})`); });
    ws.on('message', data => {
      const s = String(data);
      // ultimo stato del motore: serve alla timeline audio del bridge
      // (le chiavi del JSON del motore sono in ordine alfabetico: "type" non e' in testa)
      try { const m = JSON.parse(s); if (m.type === 'audio_state') { last = m; lastAt = Date.now(); } } catch { /* ignora */ }
      onMessage(s);
    });
    ws.on('close', () => {
      if (up) log('Motore audio scollegato');
      up = false; ws = null; last = null;
      if (!stopped) timer = setTimeout(connect, 3000);
    });
    ws.on('error', () => { /* motore spento: si riprova alla chiusura */ });
  };
  connect();
  return {
    // comando di una pagina; false = motore non collegato
    send(m) {
      if (!up || !ws || ws.readyState !== 1 || typeof m?.cmd !== 'string') return false;
      const { type, ...cmd } = m;
      ws.send(JSON.stringify(cmd));
      return true;
    },
    up: () => up,
    state: () => (up && Date.now() - lastAt < 2000 ? last : null),
    stateAt: () => lastAt,
    stop() { stopped = true; clearTimeout(timer); ws?.close(); },
  };
}

module.exports = { startAudioEngineLink };
