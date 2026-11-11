'use strict';
// Controlli dal vivo del laser come indirizzi OSC della Plancia, cosi' fader e
// pulsanti normali (anche assegnati all'APC40 col MIDI learn) comandano il
// laser gateway. Il bridge li trasforma in comandi MQTT e non li manda a TD.
//   /laser/fx/<rotate|rotate_y|zoom|hue|wave|wave_hz|bright> v   effetti sopra alle scene (rotate_y: asse verticale)
//   /laser/fx/tint tinta saturazione                    ruota colore (saturazione 0 = colori della scena)
//   /laser/fx/reset 1                                   effetti a riposo
//   /laser/flash/<id scena> 1|0                         la scena finche' il pulsante e' premuto
//   /laser/blackout 1                                   disarma tutti i cubi
const FX_KEYS = ['rotate', 'rotate_y', 'zoom', 'hue', 'wave', 'wave_hz', 'bright'];

// null = non e' un controllo del laser
function laserLiveCommand(address, args, scenes) {
  if (typeof address !== 'string' || !address.startsWith('/laser/')) return null;
  const v = Number(Array.isArray(args) ? args[0] : args);
  const on = !(v <= 0.5);                       // senza argomento = premuto
  const [, , kind, key] = address.split('/');
  if (kind === 'blackout') return on ? { action: 'blackout' } : { skip: true };
  if (kind === 'fx' && key === 'reset') return on ? { action: 'fx', reset: true } : { skip: true };
  if (kind === 'fx' && key === 'tint') {        // ruota colore: tinta e saturazione (0 = colori della scena)
    const s = Number(args?.[1]);
    return Number.isFinite(v) && Number.isFinite(s) ? { action: 'fx', values: { tint_h: v, tint_s: s, hue: 0 } } : { skip: true };
  }
  if (kind === 'fx' && FX_KEYS.includes(key) && Number.isFinite(v)) return { action: 'fx', values: { [key]: v } };
  if (kind === 'flash' && key) {
    if (!on) return { action: 'flash', on: false };
    const scene = (scenes || []).find(s => s.id === decodeURIComponent(key));
    return scene ? { action: 'flash', on: true, scene } : { skip: true };
  }
  return { skip: true };                        // /laser/... sconosciuto: non va a TD
}

module.exports = { laserLiveCommand, FX_KEYS };
