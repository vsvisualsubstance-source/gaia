# GAIA – Coscienza Artificiale della Casa

Sistema cognitivo distribuito per domotica intelligente. Integra rilevamento visivo (YOLO, MediaPipe), riconoscimento facciale (InsightFace), riconoscimento vocale (Whisper + resemblyzer), automazione (OpenHAB, MQTT), LLM locale (Ollama), memoria vettoriale (Qdrant), notifiche Telegram e interfaccia 3D (Three.js).

---

## Struttura repository

```
core-node-0/
├── pi/                    ← codice deployato sui Raspberry Pi
│   ├── agent/             gaia-agent: daemon + service files (yolo/voice/mediapipe)
│   ├── yolo/              rilevamento persone/oggetti (YOLO11)
│   ├── mediapipe/         pose, gesture, emozioni (MediaPipe)
│   └── voice/             wakeword + STT + TTS (openWakeWord + Whisper + Piper)
├── minipc/                ← codice locale al miniPC (non va sui Pi)
│   ├── script/            voice pipeline (gaia_listener.py), enrollment, debug
│   ├── local_agent.py     agente locale (emula Pi per test OTA e Pi Manager)
│   ├── gaia-local-agent.service  systemd unit per local_agent
│   ├── wakeword_models/   modelli wakeword (gitignored)
│   ├── say.sh             TTS locale via Piper
│   └── transcribe_audio.sh STT da file audio
├── node-red/              ← flows git-tracked
│   └── flows.json         flussi principali (copia del live)
├── mosquitto/             config broker MQTT
└── docker-compose.yaml    servizi Docker (mosquitto, openhab, ollama)
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

```
┌─────────────────────────────────────────────────────────────────┐
│                     RASPBERRY PI (uno per stanza)               │
│                                                                 │
│  [Camera] → pi/yolo         → gaia/{stanza}/frame              │
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
│  [Camera] /media/core/D/gaia-vision/main.py                   │
│        → gaia/{camera_name}/frame                              │
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
| pi/yolo | Python (ultralytics YOLO11) | Rilevamento persone/oggetti → `gaia/{stanza}/frame` |
| pi/mediapipe | Python (MediaPipe) | Pose, gesture, emozioni → `gaia/mediapipe/pose` |
| pi/voice | Python (openWakeWord + Whisper + Piper) | Wakeword → STT → `gaia/voice/command/{stanza}` |
| pi/agent | Python (paho-mqtt) | Daemon Pi: gestisce start/stop servizi via MQTT |
| minipc/local_agent | Python (paho-mqtt) | Agente locale miniPC (test OTA + Pi Manager senza Pi fisico) |
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

# Importa da repo verso NR + ricarica
cp ~/core-node-0/node-red/flows.json /home/core/.node-red/flows.json
kill -HUP $(pgrep -f node-red)   # ricarica i flow senza perdere il context
# oppure riavvia completamente (perde il global context / gaiaBrain in-memory):
# pkill node-red && node-red --userDir /home/core/.node-red &
```

---

## Avvio sistema completo

```bash
# Servizi Docker (mosquitto, ollama, qdrant)
docker compose up -d

# Node-RED (se non parte automaticamente)
node-red --userDir /home/core/.node-red &

# Verifica
systemctl status gaia-listener
journalctl -u gaia-listener -f
```

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

Autore: Mauro Spagnoli — GAIA, coscienza artificiale per la casa.
