# GAIA – Coscienza Artificiale della Casa

**v1.0.2** — Sistema cognitivo distribuito per domotica intelligente. Discovery/provisioning automatico dei nodi (beacon UDP + captive portal WiFi), welcome kiosk con enrollment. Integra rilevamento visivo (YOLO, MediaPipe), riconoscimento facciale (InsightFace), riconoscimento vocale (Whisper + resemblyzer), automazione (OpenHAB, MQTT), LLM locale (Ollama), memoria vettoriale (Qdrant), notifiche Telegram, controllo TouchDesigner/DMX/MadMapper e interfaccia 3D (Three.js).

> **Questo file è una panoramica.** Per la topologia reale (Core/OPS/Pi/TD,
> aggiornata 2026-09-16), il protocollo agente comune, Gaia VJ, TCC M e le
> macchine "installation" in trasferta, la fonte autorevole è
> **`docs/architettura.md`** — leggilo prima se devi capire come i pezzi si
> parlano davvero, questo README resta a livello di indice.

---

## Struttura repository

```
core-node-0/
├── pi/                    ← codice deployato sui Raspberry Pi (uno per stanza)
│   ├── agent/             gaia-agent: daemon + service files + discovery Gaia Core
│   ├── camera/            camera_server: frame broker shared memory
│   ├── yolo/              rilevamento persone/oggetti (YOLO11)
│   ├── mediapipe/         pose, gesture, emozioni (MediaPipe)
│   ├── voice/             wakeword + STT + TTS (openWakeWord + Whisper + Piper)
│   ├── herbarium/         AV Herbarium: sensore MIDI → music_engine → Carla → audio
│   ├── kiosk/             welcome su display DSI (cage + Chromium kiosk)
│   ├── screen/             superficie asemica su display DSI (Conflicts= con kiosk)
│   ├── livestream/        icecast2 locale + ffmpeg source (mic o libreria)
│   ├── mediaplayer/       musica/radio per stanza (mpv IPC + MQTT)
│   └── provision/         onboarding WiFi (hotspot + captive portal)
├── ops/                   ← agent per la macchina "pre-prod" Windows (visione+voce+TD)
│   └── agent/             ops-agent: stesso protocollo di pi/agent, + TouchDesigner
│                            (DMX/Herbarium/Yolo, mutua esclusione) e Ollama
├── minipc/                ← codice locale al miniPC "Core" (non va sui Pi)
│   ├── script/            voice pipeline (gaia_listener.py), enrollment, gaia_admin
│   ├── beacon/            gaia-beacon: risponditore UDP discovery + annuncio mDNS
│   ├── camera/            camera_server locale (shared memory + stream MJPEG :8766)
│   ├── tccm/              gaia-tccm.service: TCC M Sennheiser (SSCv2 HTTPS/SSE)
│   ├── touchdesigner/     bridge OSC↔MQTT per TouchDesigner (family dmx/patchdeck/controller)
│   ├── tdstudio/          agent macOS per Mac mini TouchDesigner (Herbarium + progetti)
│   ├── installation/      kit agent per macchine Windows touring (ruolo "installation", vedi docs/installation-touring.md)
│   ├── madmapper/         bridge OSC↔MQTT per MadMapper (family madmapper, usato da installation/)
│   ├── local_agent.py     agente locale (emula Pi per test OTA e Pi Manager)
│   ├── gaia-local-agent.service  systemd unit per local_agent
│   ├── wakeword_models/   modelli wakeword (gitignored)
│   ├── say.sh             TTS locale via Piper
│   └── transcribe_audio.sh STT da file audio
├── node-red/              ← flows git-tracked (vive su OPS dall'8 agosto 2026)
│   └── flows.json         flussi principali (copia del live)
├── esp/sim/               ← simulatore "mattone" (Casa Zero), protocollo Pi-compatibile
├── docs/                  ← contratti e protocolli — architettura.md è la mappa
│                            di sistema completa, discovery-protocol.md il dettaglio
│                            fallback rete, installation-touring.md le macchine touring
├── mosquitto/             config broker MQTT (resta sempre su Core)
└── docker-compose.yaml    servizi Docker (mosquitto, openhab, qdrant — Ollama gira
                             solo su OPS dal 10/8, il container su Core resta fermo)
```

**D: drive** (runtime, non in git — modelli, venv, servizi con dati propri):
```
/media/core/D/
├── gaia-web/          web UI live (servita da Node-RED httpStatic)
├── gaia-brain/        memoria a lungo termine (script + venv)
├── gaia-vision/       visione YOLO locale miniPC (con modelli .pt/.onnx)
├── mediapipe-vision/  storage mediapipe locale
├── face-env/          riconoscimento facciale (InsightFace)
├── piper-voices/      modelli TTS Piper (it_IT-paola-medium.onnx)
├── venv/              Python venv miniPC (symlink: ~/core-node-0/venv → qui)
└── Citofono Script/   script citofono
```

---

## Architettura generale

Dall'8 agosto 2026 Node-RED (orchestrazione, brain, Device Registry) gira
su **OPS** (Windows, monitor touch di produzione), non più su Core — il
broker MQTT, Ollama/Qdrant/OpenHAB e la voce locale restano su **Core**.
Pi, OPS e le istanze TouchDesigner sono tutti client alla pari del broker.
Diagramma completo e dettagliato in `docs/architettura.md` §1; qui solo
la vista rapida:

```
┌─────────────────────────────────────────────────────────────────┐
│                     RASPBERRY PI (uno per stanza)                │
│                                                                    │
│  [Camera] → pi/yolo         → gaia/{stanza}/frame                │
│  [Camera] → pi/mediapipe    → gaia/mediapipe/pose                │
│  [Mic]    → pi/voice        → gaia/voice/command/{stanza}        │
│  pi/herbarium · kiosk · livestream · mediaplayer                  │
│                                                                    │
│  pi/agent: gestisce enable/disable servizi via MQTT OTA,           │
│    fallback LAN→Tailscale se fuori dalla LAN di Core               │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ MQTT
┌─────────────────────────────▼──────────────────────────────────────┐
│                     OPS — Windows (192.168.1.240)                   │
│                                                                      │
│  Node-RED :1880 — Device Registry, brain, web statico (gaia-web)    │
│  ops/agent — camera/yolo/mediapipe/voice/kiosk + TouchDesigner       │
│    (DMX/Herbarium/Yolo, un solo progetto alla volta) + Ollama        │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ MQTT
┌─────────────────────────────▼──────────────────────────────────────┐
│                     CORE — miniPC (192.168.1.142)                   │
│                                                                      │
│  mosquitto MQTT :1883/:9001 — broker, sistema nervoso                │
│  [Mic] minipc/script/gaia_listener.py → gaia/voice/command/minipc    │
│  Qdrant: memoria episodica    OpenHAB: luci/sensori Hue              │
│  gaia_admin.py :8765          gaia-tccm.service: TCC M (Sennheiser)  │
│  Piper: TTS italiano          (Ollama: solo su OPS dal 10/8/2026)    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Componenti software

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Node-RED | JavaScript (su OPS dall'8/8/2026) | Orchestrazione flussi (presenza, visione, chat, TTS, memoria, Telegram, Device Registry) |
| pi/yolo | Python (ultralytics YOLO11) | Rilevamento persone/oggetti → `gaia/{stanza}/frame` |
| pi/mediapipe | Python (MediaPipe) | Pose, gesture, emozioni → `gaia/mediapipe/pose` |
| pi/voice | Python (openWakeWord + Whisper + Piper) | Wakeword → STT → `gaia/voice/command/{stanza}` |
| pi/agent | Python (paho-mqtt) | Daemon Pi: gestisce start/stop servizi via MQTT, fallback LAN→Tailscale |
| ops/agent | Python (paho-mqtt) | Daemon OPS: stesso protocollo di pi/agent + TouchDesigner (DMX/Herbarium/Yolo) |
| TouchDesigner (Mac + OPS) | gaia_device_agent nativo | PatchDeck (+DMX integrato) · ControllerV7 · DMX · Herbarium · TD Gaia — `docs/architettura.md` §3 |
| Gaia VJ | Node-RED (`vj_mood_fn`) | Mood → palette DMX / clip PatchDeck in autonomia — `docs/architettura.md` §2.3 |
| gaia-tccm | Python (SSCv2 HTTPS/SSE) | TCC M Sennheiser — mic a soffitto multi-stanza, beam azimuth |
| minipc/local_agent | Python (paho-mqtt) | Agente locale miniPC (test OTA + Pi Manager senza Pi fisico) |
| gaia_listener | Python (Whisper + resemblyzer) | Wakeword miniPC "Gaia" → STT → speaker ID → `gaia/voice/command/minipc` |
| Piper TTS | Binary (it_IT-paola-medium) | Sintesi vocale → `minipc/say.sh` |
| Ollama | LLM locale (qwen2.5:3b) | Risposte e pensieri spontanei — **solo su OPS** dal 10/8/2026 (Core più lento, container fermato apposta) |
| Qdrant | Vector DB (Core) | Memoria episodica a lungo termine |
| OpenHAB | Java (MQTT, Core) | Luci Hue, sensori temperatura/luminosità |
| Telegram Bot | node-red-contrib-telegrambot | Allarmi, comandi `/stato`, chat remota |
| Three.js | JavaScript (WebGL) | Render 3D avatar, piante, luci, device TD/installation |

---

## Topic MQTT principali

| Topic | Direzione | Descrizione |
|---|---|---|
| `gaia/{stanza}/frame` | Pi/miniPC → Node-RED | Frame YOLO (persons_count, oggetti) |
| `gaia/{stanza}/events` | Pi → Node-RED | Eventi (person_entered, person_left) |
| `gaia/{stanza}/heartbeat` | Pi → Node-RED | Heartbeat YOLO (online, ts) |
| `gaia/{stanza}/snapshot` | Pi → Node-RED | Crop persona per face recognition |
| `gaia/mediapipe/pose` | Pi → Node-RED | Pose/gesture/emozione da MediaPipe |
| `gaia/voice/command/{stanza}` | Pi → Node-RED | Comando vocale da Pi `{text, stanza, ts}` |
| `gaia/voice/command/minipc` | miniPC → Node-RED | Comando vocale miniPC `{text, speaker, confidence}` |
| `gaia/voice/tts/{stanza}` | Node-RED → Pi | Testo da sintetizzare sul Pi |
| `gaia/voice/tts/minipc` | Node-RED → miniPC | Testo da sintetizzare sul miniPC |
| `gaia/voice/status/{stanza}` | Pi → Node-RED | Stato pipeline vocale (listening/recording/speaking) |
| `gaia/device/{id}/command` | Node-RED → Pi | Comandi agent (enable/disable/restart servizi) |
| `gaia/device/{id}/status` | Pi → Node-RED | Heartbeat agent (capabilities, servizi attivi) |
| `gaia/device/all/command` | Node-RED → tutti | Broadcast a tutti i Pi |
| `gaia/devices/{id}/announce` | Pi → Node-RED | Annuncio Pi → Device Registry assegna room |
| `gaia/devices/{id}/config` | Node-RED → Pi | Config room (retained) |
| `openhab/hue/#` | OpenHAB → Node-RED | Stato luci e sensori Hue |
| `casa/+/pianta/+/umidita` | Sensori → Node-RED | Umidità piante |
| `telegram/alert` | Node-RED → Telegram | Allarmi da inviare |

---

## Deploy su Raspberry Pi

Ogni Pi riceve il codice via scp e viene gestito dall'agent:

```bash
# Copia tutto sul Pi (dall'host miniPC)
scp -r pi/ <user>@<IP>:~/gaia/

# Sul Pi: installa agent + servizi
cd ~/gaia/agent && bash install.sh
# → crea /etc/gaia/, installa servizi systemd, configura sudoers

# Configura la stanza (obbligatorio!)
sudo nano /etc/gaia/device.conf
# → imposta NODE_ID=ingresso (o salotto, cucina, ...)

# Avvia l'agent
sudo systemctl start gaia-agent
sudo systemctl status gaia-agent
```

Poi da Node-RED (o Pi Manager in gaia-web) abilita i servizi:
```
MQTT: gaia/device/{id}/command → {"action":"enable","service":"yolo"}
```

### Venv esterno (se hai già torch/ultralytics installato)

Se sul Pi hai già un venv con YOLO funzionante, non serve ricrearlo:

```bash
# In /etc/gaia/yolo.conf
YOLO_VENV=/home/user/yolo_edge/venv
```

Analogo per `MEDIAPIPE_VENV` in `/etc/gaia/mediapipe.conf` e `VOICE_VENV` in `/etc/gaia/voice.conf`.

---

## miniPC Local Agent

`minipc/local_agent.py` emula un Pi sul miniPC per testare OTA e Pi Manager senza hardware fisico. Stessa interfaccia MQTT di `pi/agent/agent.py` ma gestisce processi locali (subprocess) invece di systemctl.

```bash
# Avvio manuale
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/minipc/local_agent.py

# Come servizio systemd
sudo cp ~/core-node-0/minipc/gaia-local-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gaia-local-agent
```

---

## Voice Pipeline miniPC (gaia_listener.py)

```
Microfono (Polycom USB, 48kHz stereo)
    ↓ downsample a 16kHz mono
    ↓ gate energetico (RMS > 300)
IDLE: accumula frame → whisper-tiny → cerca "gaia" nel testo
    │                          + GaiaWakeVerifier (embedding continuo, parallelo —
    │                            2026-07-04, vedi sotto) → LISTENING diretto se supera soglia
    ↓ wake word trovato → LISTENING
    ↓ registra fino al silenzio
    ↓ whisper-medium (testo, 2026-07-04: era "small") + resemblyzer (speaker ID)
    ↓ pubblica su gaia/voice/command/minipc
Node-RED: Intent Detection → Ollama → TTS → gaia/voice/tts/minipc
         └ doppia conferma volto+voce (opt-in, vedi docs/automazioni.md)
         └ 2026-07-04: mqtt-in dedicato (tab Voice) legge questo topic e lo
           inoltra a say.sh — prima nessuno lo ascoltava, le risposte ai
           comandi finivano su MQTT senza mai essere lette ad alta voce
           (diverso dai "pensieri spontanei" su casa/tts/play, quelli già
           funzionanti)
```

**Nota prestazioni (2026-07-04)**: whisper-medium su CPU condivisa con la visione locale
(YOLO+MediaPipe via `gaia-local-agent`) può salire da ~8s a ~27s per trascrizione — non è
un bug del modello, è contesa CPU (load average misurato: 11.58 su 4 core). Vedi memoria
`project-architettura-core-ops` per la decisione di separare i ruoli hardware (Core senza
mic/camera vs OPS/monitor touch con visione+voce). Nel frattempo, `sudo systemctl stop
gaia-local-agent` libera CPU per testare la voce.

**GaiaWakeVerifier (2026-07-04)** — stesso approccio del Pi (openWakeWord
`AudioFeatures` + classificatore LogisticRegression), ma con un **modello dedicato
al mic del miniPC** (`gaia_wakeword_samples_minipc/gaia_verifier_minipc.pkl`, MAI
condiviso con quello del Pi — acustiche diverse). Gira in continuo su una finestra
scorrevole di 1.5s, in parallelo al text-search whisper-tiny esistente: se il
modello non è ancora allenato, `feed()` ritorna sempre 0.0 e il comportamento
resta identico a prima (nessuna regressione). Allenabile da admin.html → card
"Wakeword — 'Gaia' (miniPC / monitor touch)" — registra almeno 3 (idealmente
20–30) campioni positivi/negativi **dal mic del miniPC**, poi "Addestra": il
modello si ricarica a caldo via MQTT (`gaia/admin/reload_gaia_verifier`), nessun
riavvio del servizio necessario.

**Enrollment speaker:**
```bash
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/minipc/script/enroll_voice.py Mauro
```

**Avvio servizio:**
```bash
sudo bash ~/core-node-0/minipc/apply-service-update.sh
journalctl -u gaia-listener -f
```

---

## Node-RED — sincronizzazione flows

**Dall'8 agosto 2026 Node-RED gira su OPS** (container Docker
`gaia-nodered-test`, repo montato allo stesso path assoluto Linux di
Core), non più localmente su Core — vedi `docs/architettura.md` §1. Il
repo tiene la copia sorgente in `node-red/flows.json`; il deploy verso
OPS **passa sempre da `scripts/deploy_ops_nodered.sh`**, mai da un
copia-incolla manuale: lo script rigenera ad ogni esecuzione la patch
degli IP (broker/OpenHAB/memory → `192.168.1.142`, necessaria perché lo
stesso `flows.json` gira su una macchina diversa da Core) prima di
pubblicarlo via l'API `/flows` — un deploy della copia non patchata ha
disconnesso il broker in produzione per decine di secondi, tre volte,
prima che questo script esistesse.

```bash
# Deploy repo -> OPS (unico modo corretto)
bash scripts/deploy_ops_nodered.sh

# Deploy repo -> web statico su OPS (gaia-web)
bash scripts/deploy_ops_web.sh

# Deploy pi/{yolo,mediapipe,voice,camera,agent} -> OTA servito da OPS
bash scripts/deploy_ops_pi.sh
```

`Load Brain at StartUp` (inject `once` su tab Inject) ricarica `gaiaBrain`
da `brain.json` ad ogni avvio del container — sopravvivono
rooms/presence/people/lights/plants/sensors/mood/lifeIndex/gamification/automations;
si azzerano invece diary/events/thoughts/memories/chatLog/emotions/gestures/sessions
(comportamento normale ad ogni riavvio, non solo quando il processo muore per errore).

---

## Avvio sistema completo

```bash
# Servizi Docker su Core (mosquitto, openhab, qdrant — Ollama resta fermo qui,
# gira solo su OPS dal 10/8/2026)
docker compose up -d

# Node-RED gira in Docker su OPS (container gaia-nodered-test), non su Core —
# se non risponde su :1880, va riavviato/verificato LÌ, non qui

# Verifica servizi Core
systemctl status gaia-listener gaia-tccm
journalctl -u gaia-listener -f
```

> Qdrant è gestito dal `docker-compose.yaml` come gli altri servizi (verificato 2026-07-03: migrato dal container manuale al compose senza perdita dati). Lo storage è il bind mount assoluto `/home/core/qdrant_storage` (collection `gaia_memory_large`, usata da `gaia-brain/brain_memory.py`), volutamente fuori dal repo.
>
> `brain_memory.py` stesso (il wrapper FastAPI su porta 8000 che genera gli embedding e scrive/legge Qdrant) **non è in Docker ma è comunque supervisionato** — systemd, unità `gaia-memory.service` (`Restart=always`), non `gaia-brain` (nome intuitivo ma sbagliato, verificato dal vivo 2026-08-18 mentre si diagnosticava un bug di performance). `systemctl status gaia-memory` / `journalctl -u gaia-memory -f` per i log.

---

## Percorsi chiave

| Percorso | Contenuto |
|---|---|
| `~/core-node-0/pi/` | Script per Raspberry Pi (agent, yolo, mediapipe, voice) |
| `~/core-node-0/minipc/script/` | Voice pipeline miniPC (gaia_listener.py, enroll_voice.py) |
| `~/core-node-0/minipc/local_agent.py` | Local agent miniPC (test OTA / Pi Manager) |
| `~/core-node-0/minipc/script/voice_db.json` | Database speaker (gitignored — dati personali) |
| `~/core-node-0/venv/` | Venv miniPC (symlink → /media/core/D/venv) |
| `/home/core/.node-red/flows.json` | Flows live Node-RED |
| `/etc/gaia/` | Configurazioni device (device.conf, yolo.conf, ...) |
| `/media/core/D/piper-voices/` | Modelli TTS Piper |
| `/media/core/D/gaia-web/` | Web UI live (servita da Node-RED) |
| `/media/core/D/gaia-brain/` | Brain memory service |

---

---

## Web UI (`/media/core/D/gaia-web/`)

Servita staticamente da Node-RED (`httpStatic`). Non in git (runtime), ma le sorgenti sono mantenute lì.

| File | Ruolo |
|---|---|
| `dashboard.html` | Dashboard live WebSocket — presenza, emozioni, soul, comandi vocali, debug |
| `admin.html` | Admin unificato: tuning microfono, enrollment voci/volti, modelli AI, tab Pi Manager integrato |
| `pi-manager.html` | (standalone legacy) Gestione Pi via MQTT WebSocket |

**Note dashboard v1.0.1:**
- Sezioni stabili aggiornate in-place (no flickering)
- Card comandi vocali alimentata da `brain.voiceCommands` (via WebSocket)
- Pannello debug con tabelle incrementali (rebuild solo se dati cambiano e pannello aperto)

**Note admin v1.0.1:**
- Tab "⚙ Configurazione" + "🍓 Pi Devices" — MQTT client caricato lazy al primo click
- RMS threshold ticks visivi su tutti e tre i bar del Pi
- Calibrazione con barra visiva + ratio rumore
- Registrazione campioni wakeword "Gaia" dal microfono Pi (positivi e negativi)
- Sezione Citofono: raccolta campioni + training modello + distribuzione OTA
- Upload file audio/immagine per enrollment voce/volto

---

## Voice Pipeline Pi (`pi/voice/`) — v1.0.1

| Parametro | Valore | Note |
|---|---|---|
| `GAIA_THRESHOLD` | `0.80` | Alzato da 0.70/0.65 per evitare falsi positivi da TV italiana |
| `vad_filter` | `True` | Già attivo — riduce latenza STT (0.2s silenzio vs 15s) |
| Guardia durata audio | ≥10s scartati | Clip vicino al max (12s) = probabile rumore ambientale continuo |
| Wakeword base | `alexa` (openWakeWord) | + verifica con `gaia_verifier.pkl` custom |

**Come raccogliere campioni wakeword "Gaia" e addestrare il modello:**
1. In `admin.html → Modelli AI → Wakeword Gaia`: registra ≥15 positivi ("Gaia" netto) e ≥15 negativi (TV accesa, parlato normale)
2. Usa il pulsante "📡 Da Pi ingresso" per catturare l'audio direttamente dal microfono Pi (topic MQTT `gaia/voice/record_clip/{stanza}`)
3. Clicca "🎓 Addestra modello" → il modello viene distribuito via OTA al Pi e gaia-voice si riavvia

---

## Citofono (`minipc/script/train_doorbell_model.py`) — v1.0.1

Modello ML (LogisticRegression su AudioFeatures di openWakeWord) per rilevare il suono del citofono:
- Raccolta campioni da `admin.html → Modelli AI → Citofono`
- Training: `python3 minipc/script/train_doorbell_model.py`
- Distribuzione: automatica via OTA al Pi ingresso dopo training da admin.html
- Inferenza Pi: controlla `models/doorbell_verifier.pkl` ad ogni frame audio → pubblica `gaia/{stanza}/alarm {type:"doorbell"}`

---

## Note di sistema (2026-07-03)

### Dispositivo microfono live nel panel admin
- **Problema**: il panel "Microfoni — Stato live" non mostra quale device è in uso (rimane "—")
- **Stato**: `listener_config.json` salva `current_device_name` (es: "default") ma il UI non lo legge
- **Tentativo non riuscito** (16:30): aggiunto endpoint Python + fetch JavaScript, ma `await` fuori da `async` → revertito
- **TODO Claude**: implementare lettura device name con funzione helper `async` oppure callback con `Promise`
- **File coinvolti**: 
  - `/home/core/D/gaia-web/admin.html` riga ~176: `<span id="listener-device-name">—</span>`
  - `/home/core/core-node-0/minipc/script/gaia_admin.py`: aggiungere GET `/api/listener/device`
  - `/home/core/core-node-0/minipc/script/listener_config.json`: contiene `current_device_name`

---

## Changelog

### v1.0.1
- Voice Pi: `GAIA_THRESHOLD=0.80`, guardia durata audio ≥10s, `vad_filter=True` confermato
- Admin: RMS ticks visivi Pi, calibrazione con barra, recording campioni wakeword da Pi (positivi+negativi)
- Admin: unificato con Pi Manager via tab nav (MQTT lazy), sezione Citofono completa
- Dashboard: sezioni DOM stabili (no flickering), card comandi vocali, debug incrementale
- Node-RED: `brain.voiceCommands` (max 20) salvato in Intent Detection, incluso nel payload WebSocket
- Pi: broker camera condivisa (`pi/camera/camera_server.py` + `camera_client.py`) con seqlock shared memory
- Pi: OTA unificata su tutti i servizi (`pi/voice/ota.py`, `pi/mediapipe/ota.py`, `pi/yolo/ota.py`)
- Enrollment: upload file audio/immagine da admin.html; rsync `voice_db.json` → Pi
- Citofono: script training + endpoint API admin completi

### v1.0.0
- Prima release stabile: YOLO11 + MediaPipe + openWakeWord + Whisper + Piper
- Node-RED brain, intent detection, Ollama, Qdrant, Telegram, OpenHAB Hue
- Pi Manager, admin panel, dashboard Three.js

---

Autore: Mauro Spagnoli — GAIA, coscienza artificiale per la casa.
