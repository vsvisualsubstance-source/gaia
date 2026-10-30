# Console Audio — motore `gaia-audio` (Rust) + sezione in Plancia

Stato: **progetto** (2026-10-30). Niente di questo e' in esercizio; non va
in produzione in un giorno di show.

## Cosa serve

Una console stile Traktor/Serato per la libreria musicale di Gaia:

- **due deck** (A/B): forma d'onda, play/pausa, cue, hot cue, loop, tempo
  con keylock, BPM e sync;
- **mixer**: gain, EQ a 3 bande e filtro per canale, fader, crossfader,
  preascolto in cuffia (cue), master;
- **libreria e playlist**: ricerca, ordinamento (BPM, titolo, cartella),
  carica su A o B, preferiti (gia' in Node-RED);
- **timeline**: clip audio nella timeline dello show ("brano X parte a 2:10
  sul deck A, dissolvenza 8 s"), insieme a cue luci, video e laser;
- **uscite**: qualsiasi uscita disponibile — Dante (Dante Virtual
  Soundcard), scheda audio della macchina, NDI — anche piu' d'una insieme;
- uso **sia dal vivo** (operatore che mixa) **sia preparato** (timeline).

Il motore gira su OPS o sulla touring (non sul tablet): il mix continua con
i tablet chiusi e l'audio esce dall'impianto.

## Scelta: motore nativo in Rust

| Requisito | Web Audio (browser) | Rust nativo |
|---|---|---|
| Scheda audio / Dante via WASAPI | si' | si' (cpal) |
| Dante a bassa latenza, molti canali (ASIO) | no | si' (cpal + SDK ASIO) |
| Uscita NDI audio | no | si' (grafton-ndi, SDK NDI 6) |
| Ableton Link | no | si' (rusty_link) |
| MTC / LTC | no (MTC solo via Web MIDI) | si' |
| Keylock | AudioWorklet da scrivere | signalsmith-stretch |
| Senza schermo, come servizio dell'agent | fragile (autoplay, tab in background) | si' |

Costo: piu' lavoro iniziale e una toolchain (Rust + MSVC + LLVM) su OPS.
La touring non compila: riceve il binario gia' fatto.

Librerie previste: `cpal` (uscite), `symphonia` (mp3, poi flac/wav/aac),
`signalsmith-stretch` (keylock), `grafton-ndi` (NDI), `rusty_link` (Link,
GPLv2+: va bene per uso interno, da rivedere se il codice venisse
distribuito), `tokio-tungstenite` (WebSocket di controllo), `rumqttc` (stato
su MQTT).

## Architettura

```
 tablet (Plancia)  ──WS──►  bridge.js (Plancia, :8080)  ──WS 127.0.0.1:8790──►  gaia-audio (Rust)
   console audio              inoltra comandi/stato                              deck, mixer, uscite
   Impara MIDI                MIDI in → comandi audio                            analisi, clock
                                                                                   │
                         MQTT gaia/device/audio-ops/status  ◄──────────────────────┤ (Admin, agent)
                         gaia/show/clock/state  ───────────────────────────────────► (timeline)
                                                                                   │
                                                     WASAPI/ASIO (scheda, Dante) ◄─┤
                                                                       NDI audio ◄─┘
```

- **Il motore e' l'unica fonte di verita'**: le pagine mostrano lo stato
  che ricevono, non tengono un loro stato del mix (evita il ping-pong del
  layout condiviso, vedi plancia/REFACTOR.md).
- **Il bridge** fa da ponte come per MIDI e OSC: le pagine non parlano
  direttamente col motore (stesso indirizzo da hotspot, Tailscale, LAN).
- **I comandi MIDI** (Impara MIDI) li esegue il bridge, una volta sola,
  come gli altri.
- **L'agent** avvia e ferma il motore (servizio `audio` in services.json,
  `kill_tree`), come laser e video gateway.

## Motore

### Clock

Il clock di riferimento e' quello del **dispositivo d'uscita master**
(campioni contati dalla callback audio). I due deck vivono nella stessa
callback: sync e crossfade sono esatti al campione.

- Posizione deck = campioni del file (a velocita' 1), con `rate` corrente.
- Ogni stato inviato porta `t` = clock del motore (secondi) + posizione +
  rate: la pagina **interpola** la testina a 60 fps senza ricevere 60
  messaggi al secondo.
- Uscite secondarie su un altro dispositivo (es. NDI mentre il master e'
  Dante) hanno un clock diverso: ricampionamento adattivo per non derivare.
- Sync esterno (fase 3, dipende dalla nota OPS 38 a TD): Ableton Link
  (tempo/fase), MTC/LTC (posizione). La timeline segue
  `gaia/show/clock/state` come fa gia' quella video.

### Deck

`load(track)`, `play`, `pause`, `cue` (stile CDJ: tenuto = preascolto dal
punto di cue), `seek`, `tempo` (±8/16/50%), `keylock`, `sync` (tempo e fase
sull'altro deck o su Link), `hotcue set/go/clear` (8), `loop` (in/out,
1/4…32 battute), `nudge`.

### Mixer

Per canale: `gain`, `eq_low/mid/high` (kill a −∞), `filter` (−1 passa
basso … 0 neutro … +1 passa alto), `fader`, `cue` (in cuffia).
`xfader` con curva (morbida / taglio DJ), `master`, `cue_mix` (cuffia:
cue ↔ master), `cue_level`. Limitatore sul master.

### Uscite

Configurazione salvata dal motore (file JSON accanto al binario):

```json
{
  "master": [{"kind": "wasapi", "device": "Dante Virtual Soundcard", "channels": [1, 2]},
             {"kind": "ndi", "name": "GAIA Audio Master"}],
  "cue":    [{"kind": "wasapi", "device": "Altoparlanti (Realtek)", "channels": [1, 2]}]
}
```

`kind`: `wasapi` | `asio` | `ndi`. Il motore elenca i dispositivi visti
(`outputs.list`) e la Plancia li offre in un menu: "qualsiasi uscita
disponibile". Se un dispositivo sparisce (Dante spento) il motore continua
sulle altre uscite e lo segnala nello stato.

### Libreria e analisi

- Cartella: `C:\gaia-docker-cfg\core-node-0\musica` (la stessa che Node-RED
  serve come `/media/core/D/musica`), letta direttamente dal disco.
- Analisi in background, una volta per traccia (chiave: percorso +
  dimensione + data): BPM, griglia dei battiti (offset del primo battito),
  forma d'onda a due risoluzioni (panoramica ~1000 punti, dettaglio ~150
  punti/s con 3 bande per i colori), durata, guadagno per normalizzare.
  Cache in `audio-engine/cache/`.
- Preferiti: restano in Node-RED (`/gaia/music/favorites`).

## Protocollo pagina ↔ bridge ↔ motore

JSON su WebSocket. La pagina manda `{"type":"audio", ...comando}` al
bridge, che lo inoltra al motore; il motore risponde con stato e eventi che
il bridge rimanda a tutte le pagine.

Comandi (esempi):

```json
{"cmd": "deck.load",  "deck": "A", "track": "BEAT 0225/brano.mp3"}
{"cmd": "deck.play",  "deck": "A"}
{"cmd": "deck.tempo", "deck": "B", "value": 0.025}
{"cmd": "deck.sync",  "deck": "B", "to": "A"}
{"cmd": "deck.hotcue","deck": "A", "n": 1, "op": "go"}
{"cmd": "mix.set",    "ch": "A", "eq_low": 0.0, "fader": 0.8}
{"cmd": "mix.set",    "xfader": -1.0}
{"cmd": "outputs.set","config": {...}}
{"cmd": "library.scan"}
{"cmd": "clip.schedule", "id": "c12", "deck": "A", "track": "…", "at_show": 130.0, "fade_in": 8}
```

Stato (dal motore, ~10 Hz; la testina si interpola):

```json
{"type": "audio_state", "t": 1234.567,
 "decks": {"A": {"track": "…", "pos": 61.20, "rate": 1.025, "playing": true,
                 "bpm": 124.0, "beat_phase": 0.31, "keylock": true, "loop": null}},
 "mix": {"A": {"gain": 1, "eq_low": 0, "eq_mid": 0, "eq_high": 0, "filter": 0, "fader": 0.8, "cue": false},
         "xfader": -1, "master": 0.9},
 "meters": {"A": [-12.1, -11.8], "B": [-60, -60], "master": [-9.5, -9.7]},
 "outputs": [{"kind": "wasapi", "device": "Dante…", "ok": true}]}
```

Eventi: `audio_track_analyzed` (forma d'onda, BPM, griglia),
`audio_library` (elenco), `audio_error`. La forma d'onda viaggia una volta
per traccia, non nello stato.

MQTT (per Admin e agent, non per la console): `gaia/device/audio-ops/status`
retained con servizi, uscite e deck in onda.

## Plancia: sezione Console Audio

Pagina operativa nuova (template "Console Audio"):

```
┌─────────────── forme d'onda A e B, allineate sulla griglia ───────────────┐
├── DECK A ──────────┬──────── MIXER ────────┬────────── DECK B ────────────┤
│ titolo, BPM, tempo │ gain  EQ  filtro  cue │ titolo, BPM, tempo           │
│ play cue sync      │ fader A     fader B   │ play cue sync                │
│ hot cue 1-8, loop  │ ───── crossfader ──── │ hot cue 1-8, loop            │
├────────────────────┴───────────────────────┴──────────────────────────────┤
│ LIBRERIA: cerca, cartelle, BPM, preferiti — trascina su A/B o in timeline │
└───────────────────────────────────────────────────────────────────────────┘
```

- Widget del registro (`registerWidget`) per deck, mixer, forma d'onda,
  libreria: si possono anche mettere in altre pagine.
- Ogni controllo ha "Impara MIDI" (APC40 o altro controller) come i fader.
- Timeline: traccia **Audio** con clip (brano, deck, inizio, dissolvenze),
  stesso orologio delle cue.
- Senza motore la pagina usa un **motore simulato** (come
  `73-gaia-simulation.js`): si sviluppa e si prova la UI anche senza Rust.

## Fasi

1. **Protocollo + prototipo**: motore con 2 deck, EQ, filtro, crossfader,
   uscita WASAPI (scheda e Dante Virtual Soundcard); console in Plancia con
   motore simulato e poi vero; libreria dalla cartella.
   Fatto quando: si mixano due brani dalla Plancia e l'audio esce da Dante.
2. **DJ vero**: forme d'onda, BPM e griglia, sync, keylock, hot cue, loop,
   cuffia su seconda uscita, NDI.
3. **Show**: clip in timeline, Link / MTC / LTC (risposta TD alla nota 38),
   ASIO, mappature MIDI pronte per APC40.

## Da decidere / rischi

- **SDK**: NDI 6 SDK (licenza NDI, scaricato a mano dal sito NDI) e SDK
  ASIO Steinberg (licenza Steinberg): installati a mano su OPS, mai nel repo.
- **Keylock**: CPU su Ryzen 8745H da misurare con due deck + analisi.
- **Dante**: con DVS in WASAPI la latenza e' alta ma per la musica va bene;
  ASIO solo se serve il cue in cuffia via Dante.
- **Build**: compilato su OPS (macchina di sviluppo), binario copiato sulla
  touring con l'aggiornamento; il binario non va nel repo.
- **Audio-reattivita' delle luci**: DMX Master analizza il suo ingresso
  audio; il master del motore va mandato anche li' (Dante o cavo).
