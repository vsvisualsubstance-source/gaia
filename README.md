# GAIA – Coscienza Artificiale della Casa

Sistema cognitivo distribuito per domotica intelligente. Integra rilevamento visivo (YOLO, MediaPipe), riconoscimento facciale (InsightFace), riconoscimento vocale (Whisper + resemblyzer), automazione (OpenHAB, MQTT), LLM locale (Ollama), memoria vettoriale (Qdrant), notifiche Telegram e interfaccia 3D (Three.js).

---

## Struttura repository

```
core-node-0/
├── pi/                    ← codice deployato sui Raspberry Pi
│   ├── agent/             gaia-agent: daemon di controllo servizi via MQTT
│   ├── yolo/              rilevamento persone/oggetti (YOLO)
│   ├── mediapipe/         pose, gesture, emozioni (MediaPipe)
│   └── voice/             wakeword + STT + TTS (openWakeWord + Whisper + Piper)
├── minipc/                ← codice locale al miniPC (non va sui Pi)
│   ├── script/            voice pipeline (gaia_listener.py), enrollment, debug
│   ├── wakeword_models/   modelli wakeword (gitignored)
│   ├── say.sh             TTS locale via Piper
│   └── transcribe_audio.sh STT da file audio
├── node-red/              ← flows git-tracked
│   ├── flows.json         flussi principali (copia del live)
│   ├── voice-flow.json    intent detection + TTS response (importabile)
│   └── device-manager-flow.json gestione Pi via MQTT (importabile)
├── gaia-web/              web UI (Three.js + dashboard)
├── mosquitto/             config broker MQTT
└── docker-compose.yaml    servizi Docker (mosquitto, openhab, ollama)
```

**Area di lavoro su D: drive** (non in git, usata per sviluppo Pi):
```
/media/core/D/
├── pi-yolo/       copia di lavoro pi/yolo
├── pi-mediapipe/  copia di lavoro pi/mediapipe
├── pi-voice/      copia di lavoro pi/voice
├── pi-agent/      copia di lavoro pi/agent
├── gaia-brain/    memoria a lungo termine (Qdrant + FastAPI)
└── piper-voices/  modelli TTS Piper
```

---

## Architettura generale

```
┌─────────────────────────────────────────────────────────────────┐
│                     RASPBERRY PI (uno per stanza)               │
│                                                                 │
│  [Camera] → pi/yolo         → gaia/vision/{stanza}/frame       │
│  [Camera] → pi/mediapipe    → gaia/mediapipe/pose              │
│  [Mic]    → pi/voice        → gaia/voice/command/{stanza}      │
│                                                                 │
│  pi/agent: gestisce enable/disable servizi via MQTT OTA         │
└─────────────────────────────┬───────────────────────────────────┘
                              │ MQTT
┌─────────────────────────────▼───────────────────────────────────┐
│                     MINIPC (192.168.1.142)                      │
│                                                                 │
│  [Mic] minipc/script/gaia_listener.py                          │
│        → gaia/voice/command/minipc                             │
│                                                                 │
│  Node-RED: orchestrazione, brain, intent, TTS, Telegram        │
│  Ollama: LLM locale          Qdrant: memoria episodica         │
│  OpenHAB: luci/sensori       Piper: TTS italiano               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Componenti software

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Node-RED | JavaScript | Orchestrazione flussi (presenza, visione, chat, TTS, memoria, Telegram) |
| pi/yolo | Python (ultralytics) | Rilevamento persone/oggetti → `gaia/vision/{stanza}/frame` |
| pi/mediapipe | Python (MediaPipe) | Pose, gesture, emozioni → `gaia/mediapipe/pose` |
| pi/voice | Python (openWakeWord + Whisper + Piper) | Wakeword → STT → `gaia/voice/command/{stanza}` |
| pi/agent | Python (paho-mqtt) | Daemon Pi: gestisce start/stop servizi via MQTT |
| gaia_listener | Python (Whisper + resemblyzer) | Wakeword miniPC "Gaia" → STT → speaker ID → `gaia/voice/command/minipc` |
| Piper TTS | Binary (it_IT-paola-medium) | Sintesi vocale → `minipc/say.sh` |
| Ollama | LLM locale (qwen2.5:3b) | Risposte e pensieri spontanei |
| Qdrant | Vector DB | Memoria episodica a lungo termine |
| OpenHAB | Java (MQTT) | Luci Hue, sensori temperatura/luminosità |
| Telegram Bot | node-red-contrib-telegrambot | Allarmi, comandi `/stato`, chat remota |
| Three.js | JavaScript (WebGL) | Render 3D avatar, piante, luci |

---

## Topic MQTT principali

| Topic | Direzione | Descrizione |
|---|---|---|
| `gaia/vision/{stanza}/frame` | Pi → Node-RED | Frame YOLO (persons_count, oggetti) |
| `gaia/mediapipe/pose` | Pi → Node-RED | Pose/gesture/emozione da MediaPipe |
| `gaia/voice/command/{stanza}` | Pi → Node-RED | Comando vocale da Pi `{text, stanza, ts}` |
| `gaia/voice/command/minipc` | miniPC → Node-RED | Comando vocale miniPC `{text, speaker, confidence}` |
| `gaia/voice/tts/{stanza}` | Node-RED → Pi | Testo da sintetizzare sul Pi |
| `gaia/voice/tts/minipc` | Node-RED → miniPC | Testo da sintetizzare sul miniPC |
| `gaia/voice/status/{stanza}` | Pi → Node-RED | Stato pipeline vocale (listening/recording/speaking) |
| `gaia/device/{id}/command` | Node-RED → Pi | Comandi agent (enable/disable/restart servizi) |
| `gaia/device/{id}/status` | Pi → Node-RED | Heartbeat agent (capabilities, servizi attivi) |
| `gaia/device/all/command` | Node-RED → tutti | Broadcast a tutti i Pi |
| `openhab/hue/#` | OpenHAB → Node-RED | Stato luci e sensori Hue |
| `casa/+/pianta/+/umidita` | Sensori → Node-RED | Umidità piante |
| `telegram/alert` | Node-RED → Telegram | Allarmi da inviare |

---

## Deploy su Raspberry Pi

Ogni Pi riceve il codice via scp e viene gestito dall'agent:

```bash
# Copia tutto sul Pi
scp -r pi/agent/ pi@192.168.1.XXX:/opt/gaia/
scp -r pi/yolo/  pi@192.168.1.XXX:/opt/gaia/   # se ha camera
scp -r pi/voice/ pi@192.168.1.XXX:/opt/gaia/   # se ha microfono

# Sul Pi: installa e configura
cd /opt/gaia/agent && bash install.sh
nano device.json  # imposta "stanza"
sudo systemctl start gaia-agent

# Da Node-RED poi: abilita i servizi che vuoi
# MQTT: gaia/device/{id}/command → {"action":"enable","service":"yolo"}
```

---

## Voice Pipeline miniPC (gaia_listener.py)

```
Microfono (Polycom USB, 48kHz stereo)
    ↓ downsample a 16kHz mono
    ↓ gate energetico (RMS > 300)
IDLE: accumula frame → whisper-tiny → cerca "gaia" nel testo
    ↓ wake word trovato → LISTENING
    ↓ registra fino al silenzio
    ↓ whisper-small (testo) + resemblyzer (speaker ID)
    ↓ pubblica su gaia/voice/command/minipc
Node-RED: voice-flow → intent detection → Ollama → TTS → gaia/voice/tts/minipc
```

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

Node-RED usa `/home/core/.node-red/flows.json`. Il repo tiene una copia in `node-red/flows.json`.

```bash
# Esporta da NR verso repo (dopo modifiche nell'editor)
cp /home/core/.node-red/flows.json ~/core-node-0/node-red/flows.json

# Importa da repo verso NR
cp ~/core-node-0/node-red/flows.json /home/core/.node-red/flows.json
sudo systemctl restart nodered
```

I nuovi flow (`voice-flow.json`, `device-manager-flow.json`) vanno importati manualmente:
Node-RED → Menu → **Import** → seleziona il file → Deploy.

---

## Avvio sistema completo

```bash
# Servizi Docker
docker compose up -d

# Verifica
systemctl status nodered gaia-listener
journalctl -u gaia-listener -f
```

---

## Percorsi chiave

| Percorso | Contenuto |
|---|---|
| `~/core-node-0/pi/` | Script per Raspberry Pi (agent, yolo, mediapipe, voice) |
| `~/core-node-0/minipc/script/` | Voice pipeline miniPC (gaia_listener.py, enroll_voice.py) |
| `~/core-node-0/minipc/script/voice_db.json` | Database speaker (gitignored — dati personali) |
| `~/core-node-0/venv/` | Venv miniPC (symlink → /media/core/D/venv) |
| `/home/core/.node-red/flows.json` | Flows live Node-RED |
| `/home/core/gaia/brain.json` | Stato brain persistente |
| `/media/core/D/piper-voices/` | Modelli TTS Piper |
| `/media/core/D/pi-*/` | Copie di lavoro script Pi su D: drive |

---

Autore: Mauro Spagnoli — GAIA, coscienza artificiale per la casa.
