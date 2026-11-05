'use strict';
// Collegamento bridge <-> motore audio gaia-audio (Rust, docs/console-audio.md).
// Il motore ascolta solo su 127.0.0.1:8790; il bridge e' il suo unico client:
// inoltra al motore i comandi {type:'audio', cmd, ...} delle pagine e rimanda
// a tutte le pagine stato ed errori del motore (audio_state, audio_error)
// cosi' come arrivano. Se il motore non c'e' riprova ogni 3 s; le pagine,
// senza stato fresco, tornano al motore simulato.

const { WebSocket } = require('ws');

function startAudioEngineLink({ url = process.env.AUDIO_ENGINE_URL || 'ws://127.0.0.1:8790', onMessage, log = console.log } = {}) {
  let ws = null, up = false, timer = null, stopped = false;
  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.on('open', () => { up = true; log(`Motore audio collegato (${url})`); });
    ws.on('message', data => onMessage(String(data)));
    ws.on('close', () => {
      if (up) log('Motore audio scollegato');
      up = false; ws = null;
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
    stop() { stopped = true; clearTimeout(timer); ws?.close(); },
  };
}

module.exports = { startAudioEngineLink };
