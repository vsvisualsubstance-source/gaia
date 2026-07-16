# Pi — contratto dei moduli e moduli futuri (AV Herbarium, LiveStream)

Definito 2026-07-06. Il Pi oggi ha 4 servizi gestiti (yolo, mediapipe, voice, camera come
dipendenza) + agent + provisioning. Questo documento fissa **il contratto per aggiungerne
di nuovi** senza reinventare nulla, e definisce i primi due moduli futuri.

## Contratto di un modulo Pi (checklist, ricavata dai moduli esistenti)

Un modulo = una directory sotto `pi/` con questa forma:

```
pi/<modulo>/
├── main.py            # servizio long-running, MQTT verso il broker Core
├── config.py          # env > /etc/gaia/<modulo>.conf > default (pattern comune)
├── <modulo>.conf.example
├── requirements.txt
├── install.sh         # venv locale + dipendenze apt
├── start.sh           # supporto <MODULO>_VENV esterno (pattern comune)
├── ota.py             # copia byte-per-byte da yolo/ (convenzione esistente)
└── gaia-<modulo>.service
```

Regole non negoziabili (fonte: CLAUDE.md di pi/ + esperienza sui 4 moduli):
1. `DEVICE_ID = os.getenv("DEVICE_ID", socket.gethostname())` — mai hardcodare, altrimenti
   device fantasma nel Device Registry.
2. Unit systemd con `EnvironmentFile=/etc/gaia/device.conf` (stanza/device_id dall'agent).
3. Callback paho con `properties=None` (i Pi hanno paho-mqtt 2.x).
4. Registrazione nell'agent: entry in `SERVICE_MAP` + `SERVICE_DIRS` (`pi/agent/config.py`)
   → enable/disable/OTA/Telegram (`/attiva <modulo>`) funzionano gratis.
5. Announce al Device Registry (`gaia/devices/{id}/announce`) se il modulo ha una "stanza".
6. Payload MQTT: pubblicare ANCHE lo stato negativo/idle a intervallo fisso (pattern
   mediapipe `person_detected:false`) così Node-RED non ha bisogno di timeout propri.
7. Node-RED: normalizzatore dedicato (pattern `MediaPipeNorm`) che deduplica e produce
   `msg.event {source, category, value, person}` per GAIA Brain.

Con la proposta manifest (`docs/core-distribuito.md`), i punti 4 diventano una riga in
`/etc/gaia/services.json` invece che una modifica al codice dell'agent.

---

## Modulo 1 — AV Herbarium (le piante suonano) — V1 FATTA 2026-07-16

**Implementata** (`pi/herbarium/`, servizio a contratto gaia-herbarium) partendo
dai test originali dell'utente ritrovati sul Pi (`t1.carxp`, ora versionato come
`patch.carxp`: MIDI Enforce Scale → Quantization → 3× Yoshimi):
- **Carla headless** (`--no-gui`) con **pipewire-jack**: RtAudio/pulse falliva
  sotto systemd ("Unable to create stream: Timeout"), col driver JACK sopra
  pipewire convive col mediaplayer sulla stessa uscita. Richiede:
  `AudioDriver=JACK` in ~/.config/falkTX/Carla2.conf e
  `CARLA_BIN=pw-jack carla` in /etc/gaia/herbarium.conf.
- **Hotplug MIDI**: qualsiasi sorgente hardware (kernel client ALSA seq ≠
  System/Through) viene collegata da sola — via aconnect se Carla è in ALSA,
  via pw-link (Midi-Bridge → Carla:events-in) quando è in JACK. Anche le
  uscite audio (Carla:audio-outN → sink ALSA) si cablano da sole: JACK non
  auto-collega. Riprova finché Carla non è pronto (~25s per i 3 Yoshimi).
- **MQTT**: aseqdump osserva le stesse sorgenti → `gaia/herbarium/{stanza}/note`
  {note, velocity, channel}; heartbeat retained su `/state` {sources, notes_1m}.
- **Brain**: evento normalizzato source=herbarium → `_award('natura')` (XP
  Druido) + curiosity/calm con cooldown 30s. Telegram: /attiva herbarium.
- **Test E2E senza piante**: `sudo modprobe snd-virmidi midi_devs=1` crea un
  client kernel che il modulo aggancia da solo; scrivere byte MIDI raw su
  /dev/snd/midiC*D0 suona Yoshimi e pubblica le note (10/10 verificate).

### Design originale (per riferimento)


**Idea**: sensori sulle piante (tocco capacitivo / biopotenziali) → note ed eventi →
synth in tempo reale → audio dal Pi. La pianta diventa uno strumento e una presenza.

**Catena tecnica proposta** (tutta roba che gira su Pi 4/5 aarch64):
```
sensore → lettura → mapping nota/scala → MIDI/OSC → host synth → ALSA out
```
- **Sensori**: MPR121 (12 canali touch capacitivo, I²C, ben supportato) per iniziare;
  in prospettiva elettrodi biopotenziale (stile PlantWave) via ADC (ADS1115).
- **Lettura+mapping**: `main.py` Python — legge i canali, mappa su scala musicale
  configurabile (`HERBARIUM_SCALE=pentatonica`, root note, ottave), genera eventi.
- **Synth**: due livelli, si parte dal semplice:
  - v1: **FluidSynth** (soundfont, headless, leggerissimo, `pyfluidsynth`) — zero routing.
  - v2: **Carla** come plugin-host (LV2/VST, patch salvabili) + **jackd**, quando serve
    un suono "da installazione". Carla gira headless con `carla-single`/OSC ma è più
    esigente: dipendenze pesanti, JACK da configurare — per questo NON è la v1.
- **MQTT** (il modulo è anche un sensore per il brain!):
  - `gaia/herbarium/{stanza}/note` — {channel, note, velocity, plant} a ogni tocco/evento
  - `gaia/herbarium/{stanza}/state` — heartbeat con canali attivi (anche tutti idle)
  - ascolta `gaia/herbarium/{stanza}/config` — scala, volume, mute (retained dal registry)
- **Integrazione GAIA** (gratis una volta nel brain): eventi herbarium → `MediaPipeNorm`-
  style normalizer → XP Druido (motore RPG già pronto), mood.curiosity, pensieri
  ("qualcuno sta suonando il ficus"), Arte Visiva/asemico che reagiscono alle note.
- **Hardware per Pi**: MPR121 (~5€), DAC/ampli o casse USB (il jack del Pi è rumoroso).

## Modulo 2 — LiveStream (icecast)

**Idea**: la casa trasmette — flussi audio (herbarium, ambienti, radio di Gaia con TTS e
pensieri) ascoltabili in LAN e volendo fuori.

**Architettura** (due metà, ruoli diversi — vedi matrice in `docs/core-distribuito.md`):
- **Server icecast2**: NON sul Pi — sul Core o sulla futura macchina Media (pacchetto
  `icecast2`, config mount `/gaia/<stanza>.ogg`, porta 8000). Un server, N mount.
- **Modulo Pi `livestream`**: solo il *source client* che spinge audio al server:
  - v1: **ffmpeg** da ALSA (`ffmpeg -f alsa -i <dev> -c:a libopus icecast://source:pass@core:8000/<stanza>.ogg`)
    — o **darkice** (più leggero, nato per questo).
  - v2: **liquidsoap** se serve playlist/mixaggio/fallback (es. radio di Gaia: pensieri
    TTS mixati su musica).
  - Config: `/etc/gaia/livestream.conf` (ICECAST_HOST/PORT/PASS, MOUNT, SOURCE_DEV).
  - MQTT: `gaia/livestream/{stanza}/state` (streaming on/off, bitrate, ascoltatori se
    esposti dal server) + comando enable/disable via agent come ogni modulo.
- **Sinergie**: l'herbarium può essere la sorgente del mount (`herbarium.ogg`) — cavo
  virtuale ALSA loopback (`snd-aloop`) tra synth e source client. Il mediaplayer delle
  altre stanze può riprodurre il mount → le piante dell'ingresso suonano in salotto.

## Ordine consigliato quando si parte

1. Manifest agent (Fase 0 di `core-distribuito.md`) — rende i moduli "solo config".
2. `livestream` v1 (ffmpeg/darkice): il più semplice, si valida il contratto moduli.
3. `herbarium` v1 (MPR121 + FluidSynth): richiede hardware, dà subito soddisfazione.
4. icecast server su Core (apt, mezz'ora) quando esiste il primo source.
5. Carla/liquidsoap solo quando v1 stanno strette.
