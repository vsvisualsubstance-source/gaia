# Pi — contratto dei moduli e moduli futuri (AV Herbarium, LiveStream)

Definito 2026-07-06. Il Pi oggi ha 4 servizi gestiti (yolo, mediapipe, voice, camera come
dipendenza) + agent + provisioning. Questo documento fissa **il contratto per aggiungerne
di nuovi** senza reinventare nulla, e definisce i primi due moduli futuri.

## Contratto di un modulo Pi (checklist, ricavata dai moduli esistenti)

Un modulo = una directory sotto `pi/` con questa forma. In pratica esistono DUE varianti,
a seconda che il modulo abbia dipendenze pip pesanti (torch/mediapipe/openwakeword) o
solo `paho-mqtt` di sistema — aggiornato 2026-08-14 dopo aver notato che herbarium/
mediaplayer/screen/kiosk (tutti "leggeri") non seguivano mai il contratto completo
sotto, non per dimenticanza ma perché non ne avevano bisogno:

```
pi/<modulo>/
├── main.py            # servizio long-running, MQTT verso il broker Core — SEMPRE
├── config.py          # env > /etc/gaia/<modulo>.conf > default — SEMPRE
├── <modulo>.conf.example                                        # SEMPRE
├── gaia-<modulo>.service                                        # SEMPRE
├── ota.py             # copia byte-per-byte da yolo/ — SEMPRE (costa poco, utile ovunque)
├── install.sh         # SOLO se servono pacchetti apt (venv locale o system, es. icecast2/ffmpeg)
├── requirements.txt   # SOLO se il modulo ha un venv dedicato (pip pesante)
└── start.sh           # SOLO se ha senso un avvio manuale fuori da systemd (supporto
                        # <MODULO>_VENV esterno se c'è un venv, altrimenti solo
                        # `source /etc/gaia/<modulo>.conf && exec python3 main.py`)
```

Moduli "pesanti" (venv dedicato): `yolo/`, `mediapipe/`, `voice/` — hanno tutti gli 8 file.
Moduli "leggeri" (solo system python3 + paho-mqtt): `herbarium/`, `mediaplayer/`,
`screen/`, `kiosk/`, `livestream/` — main.py, config.py, .conf.example, .service sempre;
install.sh solo se il modulo installa pacchetti di sistema (livestream sì: icecast2/
ffmpeg/pipewire-alsa; herbarium/mediaplayer/screen/kiosk no, presumono l'ambiente già
pronto). requirements.txt/start.sh omessi quando non c'è un venv da gestire. `ota.py`
manca ancora in herbarium/mediaplayer/screen/kiosk (mai stato necessario finora, non
un principio) — `livestream/` invece ce l'ha (copiato byte-per-byte da yolo/, come da
convenzione), primo modulo leggero a farlo: se torna utile aggiornare un modulo leggero
da remoto senza SSH, vale la pena aggiungerlo anche agli altri quattro.

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
- **GOTCHA ProcessMode**: con `ProcessMode=3` (patchbay) in Carla2.conf le
  connessioni interne del progetto NON vengono ripristinate sotto `--no-gui`
  → silenzio totale con note che fluiscono. Serve `ProcessMode=2` (rack):
  concatena i plugin nell'ordine del progetto, che per questa catena seriale
  è esattamente giusto. Il segnale dei 3 Yoshimi sommati può clippare
  (picco a fondo scala a velocity 90) — se distorce, abbassare i Main volume.
- **Test E2E senza piante**: `sudo modprobe snd-virmidi midi_devs=1` crea un
  client kernel che il modulo aggancia da solo; scrivere byte MIDI raw su
  /dev/snd/midiC*D0 suona Yoshimi e pubblica le note (10/10 verificate).

### V2 — Motore musicale (2026-07-21): da "note a caso" a musica vera

I sensori mandano numeri casuali — la musicalità la decide `music_engine.py`
(puro Python, zero dipendenze, testabile senza hardware): scala (cromatica,
maggiore, minore, pentatoniche, blues, dorica, misolidia — nomi delle
fondamentali in solfeggio, stesso vocabolario di pi/screen NOTE_WORDS),
accordo costruito impilando GRADI della scala (1-3-5 diatonico, resta
consonante sia in maggiore che in minore, non semitoni fissi), preset che
fissano scala+accordo+registro+dinamica in un colpo ("il tipo di musica").
6 preset pronti: `pentatonica_calma` (default — pentatonica è "a prova di
errore" con input casuale), `accordi_maggiori`, `drone_modale`,
`arpeggio_arioso` (accordo strimpellato con delay crescente),
`blues_notturno`, `cromatico_libero` (comportamento pre-v2, nessun filtro).

**Architettura del bus MIDI** (permanente da `/etc/modprobe.d/gaia-herbarium-virmidi.conf`,
`snd-virmidi midi_devs=2` — sopravvive al reboot): due porte VirMIDI, quella
con l'indice sub-device PIÙ ALTO è sempre il "bus verso Carla" (`engine_out`,
`_find_engine_out` in main.py — trovato per nome, non per numero di card:
robusto ai cambi di numerazione tra un boot e l'altro), collegata a Carla
SEMPRE appena scoperta (non hotplug, fissa). Qualsiasi ALTRO client kernel
(indice più basso del simulatore, o in futuro la scheda USB reale) è un
"sensore": osservato con aseqdump per MQTT/XP **ma MAI collegato
direttamente a Carla** — il grezzo passa SEMPRE dal motore prima di
suonare. `_dump_reader` per ogni nota osservata chiama anche
`music_engine.voice()` e scrive il risultato (nota/e trasformate, con delay
per l'arpeggio) sul device raw del bus (`_write_note`/`_write_note_off`,
stessa tecnica byte-a-byte dei test originali, `threading.Timer` per la
durata fissa — non quella reale del sensore: un trigger casuale non ha un
"note-off" musicalmente significativo).

**Preset a caldo**: `gaia/herbarium/{stanza}/music {"preset":"..."}`.
**Simulatore** (`plant_simulator.py`, zero dipendenze): scrive note/velocity/
tempo A CASO sulla porta a indice più basso — l'hotplug lo vede come un
sensore qualsiasi, utile per sviluppare/ascoltare senza aspettare la scheda.

Verificato dal vivo 2026-07-21: cablaggio bus→Carla al primo colpo (pw-link,
matching per nome "Virtual Raw MIDI {card}-{dev}"), segnale confermato via
registrazione RMS, **preset pentatonica_calma e drone_modale confermati
all'orecchio dall'utente**. Quando arriva la scheda USB reale: si collega da
sola come sensore (stesso hotplug generico), zero modifiche al codice.

**GOTCHA trovato 2026-07-22** (cambio periferiche sul Pi — webcam+Polycom
aggiunti — ha spostato snd-virmidi da card 4 a card 0): il matching MIDI
sopra descritto era **fragile e falliva silenziosamente**. PipeWire espone
i client VirMIDI via `pw-link` con un'etichetta PROPRIA generica e
incrementale ("Virtual MIDI Card N", scollegata dal numero di card/device
ALSA) — il nome ALSA completo ("Virtual Raw MIDI {card}-{dev}") non compare
MAI in quella riga; ha "funzionato" la prima volta solo per coincidenza del
contatore N. Fix: matching sul suffisso di porta stabile ("VirMIDI
{card}-{dev}", sempre presente) invece del nome client completo —
`_find_engine_out` ora espone anche `pw_name` per questo. Sintomo tipico se
si ripresenta: Carla attivo, note osservate su MQTT, **nessun suono e
nessun errore** — controllare i log per "Bus motore collegato": se manca,
è questo.

### V2.1 — Sorgenti alternative selezionabili (2026-07-21)

In attesa della scheda vera (o come modalità permanente), due "sorgenti di
note" ALTERNATIVE, mutuamente esclusive (Conflicts= reciproco, stesso schema
di screen/kiosk), entrambe registrate nell'agent (`herbsim`/`herbmp` in
`pi/agent/config.py` SERVICE_MAP) → attivabili da Pi Manager/Telegram come
ogni altro servizio:

- **`plant_simulator.py`** (`gaia-herbarium-sim`): note/velocity/tempo A CASO
  sulla porta VirMIDI a indice più basso — il "rumore puro" che il motore
  musicale deve rendere musica.
- **`mediapipe_source.py`** (`gaia-herbarium-mediapipe`): "la stanza suona in
  risposta a chi la abita" — legge `gaia/mediapipe/pose` (person_detected,
  gesture, emotion, smile_score, attention, pose, people_count — SOLO segnali
  categorici/derivati, niente coordinate mano) e mappa: attention→registro
  base (sinistra grave/destra acuta), gesture→scostamento fisso (stesso
  spirito del vocabolario GESTURE_WORDS asemico), smile_score→più acuto+più
  energico, pose sitting→un'ottava sotto, people_count→più energia. Una nota
  per ogni CAMBIO di stato (non a ogni tick, mediapipe pubblica ogni ~1s
  anche da fermo), intervallo minimo 1.5s anti-raffica. NESSUNA logica di
  scala/accordo qui: quella resta sempre di music_engine.py lato herbarium
  principale — questo script decide solo "cosa succede → quale nota grezza".

Entrambi scrivono sulla STESSA porta "sensore" (mai su engine_out): il resto
della catena (osservazione, music_engine, bus verso Carla) è invariato e
condiviso. Verificato dal vivo: mappatura gesti→note corretta (es. victory +
3 persone + sorriso 60 → nota 72 vel 107), catena end-to-end fino a Carla,
**4 gesti diversi confermati all'orecchio dall'utente**.

**GOTCHA IMPORTANTE trovato durante il test**: dopo un'ora circa di silenzio
(nessuna nota, herbarium acceso ma inattivo) l'audio smette di suonare pur
con la catena tecnicamente intatta (bus wired, note osservate su MQTT,
nessun errore in log) — serve un riavvio di `gaia-herbarium` per farlo
ripartire. Sospetto: sospensione idle di PipeWire/WirePlumber sul sink
(`session.suspend-timeout-seconds`) che non si risveglia correttamente al
primo dato MIDI dopo la sospensione. **NON RISOLTO** — l'utente ha scelto di
limitarsi a documentare per ora (non blocca l'uso, il modulo si usa a sessioni
non 24/7 indefinite). Se ricapita: prima cosa da controllare, riavviare
`gaia-herbarium` — se risolve, conferma la teoria. Possibili fix futuri: nota
heartbeat quasi impercettibile ogni N minuti quando inattivo, o riavvio
periodico via timer systemd.

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

## Modulo 2 — LiveStream (icecast) — V1 FATTA 2026-08-14

**Implementata** (`pi/livestream/`, servizio a contratto gaia-livestream). Architettura
diversa da quella originariamente pianificata sotto — vedi perché nel GOTCHA in fondo.

**Idea**: ogni Pi trasmette (mic/webcam o libreria musicale locale) — chi vuole ascoltare
apre `web/livestream.html` (o il link diretto dello stream) da un qualsiasi device e
preme play: l'audio esce dal jack di QUEL device, dove si può collegare un diffusore
(es. Holosonic). Lo stream è audio-only e la riproduzione è sempre lato client, mai
lato server.

**Architettura AS-BUILT (icecast2 LOCALE su ogni Pi, non centralizzato)**:
- **icecast2**: gira SUL Pi stesso, demone di sistema sempre attivo appena installato
  (come mosquitto su Core) — non gestito dall'agent, non toccato da enable/disable.
  Porta 8000, mount fisso `stream.ogg` (non `<stanza>.ogg`: la stanza può cambiare senza
  spostare l'URL). Password sorgente generata random per device da `install.sh`
  (altrimenti chiunque in LAN potrebbe spingere audio arbitrario in QUALSIASI mount —
  icecast non ha altra autenticazione sulla connessione source).
- **Modulo Pi `livestream`**: il *source client* — ffmpeg via `-f alsa -i default`
  (mic/webcam, passa dal plugin ALSA di PipeWire — stesso motivo del fix in pi/voice:
  un mic USB che PipeWire ha reclamato come sorgente di sistema sparisce dall'accesso
  ALSA diretto) oppure playlist concat in loop dalla libreria musicale LOCALE al Pi
  (`LIVESTREAM_LIBRARY_DIR`, non quella di Core). Cambio sorgente a caldo via MQTT
  `gaia/livestream/{stanza}/command {"source":"mic"|"library"}`, o da captive
  portal/Admin. Stato retained `gaia/livestream/{stanza}/state` con contatore
  ascoltatori letto dal proprio `status-json.xsl` di icecast.
- **web/livestream.html**: griglia di tutti gli stream della casa, scoperta automatica
  via profili semantici (stesso pattern di `cameras.html`) — nessun IP hardcodato.

**GOTCHA — perché icecast locale e non centralizzato**: il piano originale sotto
prevedeva un server icecast2 unico su Core/Media coi Pi come soli source client.
Requisito cambiato 2026-08-14: "non è un servizio server side e non deve girare su
core o ops" — ogni Pi deve restare autosufficiente, senza dipendenza da un server
centrale raggiungibile in rete. Se in futuro serve di nuovo un mount centralizzato
(es. per un vero "server Media" dedicato), il piano originale resta valido come
riferimento, sotto.

<details>
<summary>Piano originale (superato, centralizzato su Core/Media) — riferimento storico</summary>

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

</details>

## Ordine consigliato quando si parte

1. Manifest agent (Fase 0 di `core-distribuito.md`) — rende i moduli "solo config".
2. `livestream` v1 (ffmpeg/darkice): il più semplice, si valida il contratto moduli.
3. `herbarium` v1 (MPR121 + FluidSynth): richiede hardware, dà subito soddisfazione.
4. icecast server su Core (apt, mezz'ora) quando esiste il primo source.
5. Carla/liquidsoap solo quando v1 stanno strette.
