'use strict';
// Diagnostica dei blocchi della Console Audio (14/11/2026): Z1 e LPD8 smettono di
// rispondere insieme per un po', poi riprendono. Per capire dove si ferma:
//  - ogni messaggio MIDI in data/diag/midi-AAAA-MM-GG.log (ora al ms): se nel blocco
//    non c'e' niente, il MIDI non e' arrivato al bridge (driver / servizio MIDI di Windows)
//  - "bridge fermo N ms": il bridge stesso era bloccato (anche nel log della Plancia)
//  - chiamate MIDI sincrone (elenco porte, LED della Z1) oltre 100 ms
//  - "motore: nessuno stato": il motore audio non rispondeva
// I file piu' vecchi di 7 giorni si cancellano all'avvio.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data', 'diag');
const stamp = (d = new Date()) => `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function startDiag({ log = console.log, engineStateAt = () => 0, dir = DIR } = {}) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* resta senza file */ }
  try {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.rmSync(p, { force: true });
    }
  } catch { /* niente da pulire */ }
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const s = buf.join('\n') + '\n'; buf = [];
    fs.appendFile(path.join(dir, `midi-${day()}.log`), s, () => {});
  };
  const line = s => { buf.push(`${stamp()} ${s}`); if (buf.length > 5000) buf.splice(0, buf.length - 5000); };
  const warn = s => { log(`DIAG ${stamp()} ${s}`); line(s); };
  const flushT = setInterval(flush, 1000);

  // bridge bloccato: il timer da 100 ms arriva in ritardo
  let expect = Date.now() + 100;
  const lagT = setInterval(() => {
    const now = Date.now(), late = now - expect; expect = now + 100;
    if (late > 250) warn(`bridge fermo ${late} ms`);
  }, 100);

  // motore muto (lo stato arriva a ~10 Hz)
  let mute = false;
  const engT = setInterval(() => {
    const at = engineStateAt(); if (!at) return;
    const gap = Date.now() - at;
    if (gap > 1000 && !mute) { mute = true; warn(`motore: nessuno stato da ${gap} ms`); }
    else if (gap <= 1000 && mute) { mute = false; line('motore: stato di nuovo'); }
  }, 250);

  return {
    midi(port, m) { line(`${port} ${m.kind} ch${m.ch} ${m.n} ${m.v}`); },
    // chiamata sincrona misurata: oltre 100 ms si segnala
    timed(what, fn) {
      const t = process.hrtime.bigint();
      try { return fn(); } finally {
        const ms = Number(process.hrtime.bigint() - t) / 1e6;
        if (ms > 100) warn(`${what}: ${ms.toFixed(0)} ms`);
      }
    },
    note: line,
    stop() { clearInterval(flushT); clearInterval(lagT); clearInterval(engT); flush(); },
  };
}

module.exports = { startDiag };
