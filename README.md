# GAIA – Coscienza Artificiale della Casa

GAIA è un sistema cognitivo distribuito per la domotica intelligente. Integra rilevamento visivo (YOLO, MediaPipe), riconoscimento facciale (InsightFace), riconoscimento vocale (Whisper + resemblyzer), automazione (OpenHAB, MQTT), elaborazione del linguaggio naturale (Ollama), memoria vettoriale (Qdrant), notifiche via Telegram e un'interfaccia 3D in tempo reale (Three.js).

---

## Architettura generale

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐
│ Telecamere      │  │ Microfono       │  │ Sensori MQTT    │  │ Telegram    │
│ (YOLO + Face)   │  │ (Polycom USB)   │  │ (piante, luci)  │  │ Bot         │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘
         │                    │                     │                   │
         │            gaia_listener.py              │                   │
         │          (wake+STT+speaker ID)           │                   │
         │                    │                     │                   │
         ▼                    ▼                     ▼                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           Node-RED (Core)                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐   │
│  │Dispatcher│→ │Pre-Parser│→ │  Norms   │→ │  GAIA    │→ │ 3D View   │   │
│  │          │  │(MP/Plant)│  │ (per src)│  │  Brain   │  │ Engine    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └───────────┘   │
│                                    ↑                                       │
│              ┌─────────────────────┤                                       │
│         Voice tab                  │                                       │
│  [MQTT casa/voce/comando] → [Voce→Chat] → [POST /gaia/chat]                │
└────────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Client 3D       │  │ Dashboard       │  │ Piper TTS       │
│ (Three.js)      │  │ + Debug Panel   │  │ (it_IT-paola)   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Componenti software

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Node-RED | JavaScript | Orchestrazione flussi (presenza, visione, chat, TTS, memoria, Telegram) |
| YOLO | Python (ONNX) | Rilevamento persone/oggetti → `gaia/+/frame` |
| Face recognition | Python (InsightFace) | Identifica nome dai volti → `gaia/vision/identity` |
| MediaPipe | Python (test.py) | Pose, gesture, emozioni → `gaia/mediapipe/pose` |
| **gaia_listener** | Python (Whisper + resemblyzer) | Wake word "Gaia" → STT → speaker ID → `casa/voce/comando` |
| Piper TTS | Binary (it_IT-paola-medium) | Sintesi vocale italiana → riproduce `casa/tts/play` |
| Ollama | LLM locale (qwen2.5:3b) | Genera risposte e pensieri spontanei |
| Qdrant | Vector DB | Memoria episodica a lungo termine |
| OpenHAB | Java (MQTT) | Luci Hue, sensori temperatura/luminosità |
| Telegram Bot | node-red-contrib-telegrambot | Allarmi, comandi `/stato`, chat remota |
| Three.js | JavaScript (WebGL) | Render 3D avatar, piante, luci |

---

## Struttura dei percorsi

| Percorso | Contenuto |
|---|---|
| `/home/core/core-node-0/` | Progetto principale (questo repo) |
| `/home/core/.node-red/` | Flussi Node-RED (`flows.json`) |
| `/home/core/core-node-0/script/` | Script Python (voice pipeline, enrollment, debug) |
| `/home/core/core-node-0/venv/` | Virtual environment Python (voice pipeline) |
| `/home/core/gaia/brain.json` | Stato persistente del brain (aggiornato ogni 60s) |
| `/media/core/D/gaia-web/` | Web UI statica (Three.js + dashboard HTML) |
| `/media/core/D/mediapipe-script/` | Script MediaPipe per Raspberry Pi (`test.py`) |
| `/media/core/D/venv/` | Venv per YOLO/MediaPipe (sui Raspberry Pi) |
| `/media/core/D/face-env/` | Venv per face recognition (InsightFace) |

---

## Flussi Node-RED

### Pipeline MQTT → Brain (Tab Gaia Engine)

Ogni sorgente MQTT segue il pattern: **Dispatcher → PreParser (opz.) → Norm → GAIA Brain**

#### Dispatcher (id: `44882f413905a1b1`)
Smista i messaggi MQTT in arrivo verso il normalizzatore corretto:
- Output 1 → VisionNorm (`gaia/+/frame`, `gaia/vision/identity`)
- Output 2 → PlantPreParser (`casa/+/pianta/+/+`)
- Output 3 → **MediaPipePreParser** (`gaia/mediapipe/pose`)
- Output 4 → HueNorm (`openhab/hue/#`)

#### MediaPipePreParser (id: `b7f3a1e2c9d40001`) — nuovo
Crea / aggiorna `brain.rooms[camera]` direttamente prima della normalizzazione. Garantisce che la stanza esista anche se la persona non è ancora identificata. Estrae `camera` / `node` dal payload grezzo. Passa poi a MediaPipeNorm.

#### MediaPipeNorm (id: `6ebd50e6dfa8dbef`)
Converte il payload `gaia/mediapipe/pose` in eventi standardizzati `{source:'mediapipe', category:'emotion'|'pose'|'gesture', ...}`. Filtra gesture `"none"`. Gestisce timestamp interi dal Pi (ms) o float (s → ms).

#### IdentityNormalizer (id: `207369c11f6ab51f`)
Normalizza `gaia/vision/identity`. Ignora i messaggi con topic `gaia/mediapipe/*` per evitare che MediaPipe generi eventi identity spurii.

#### VisionNorm (id: `877612987dfba13c`)
Normalizza frame YOLO (`gaia/+/frame`) in eventi `spatial_analysis`.

#### PlantPreParser (id: `a2b3f4e0977cd510`)
Estrae `room` e `plantId` dal topic `casa/{room}/pianta/{id}/{tipo}`. Passa a PlantNorm.

#### PlantNorm (id: `f75aee44f7d54304`)
Converte in evento `{source:'plant', category:'soil', device:plantId, room:room, value:float}`.

#### GAIA Brain (id: `b6ee3252b6912e1b`)
Aggiorna `global.gaiaBrain` in base agli eventi. Logiche chiave:
- **spatial_analysis**: aggiorna `rooms[camera].persons_count`. In `spatial_analysis` elimina entries obsolete di presenza (`delete brain.presence[old]` — non `present=false`) per evitare crescita illimitata.
- **identity**: guard yolo=0 — se YOLO riporta 0 persone nella stanza, ignora l'identity in arrivo (previene re-aggiunta dopo uscita).
- **mediapipe**: aggiorna emozione/pose della stanza. Per persone sconosciute (`unknown`) aggiorna solo `room.currentEmotion` / `room.currentPose`, non `room.people` né `brain.presence`.
- **plant**: salva `brain.plants[plantId].moisture` e `.room`.
- `roomId` per vision: `e.node || e.camera || e.device || "salotto"`.

#### PresenceEngine (id: `b2ec295f9322f551`)
Gestisce entrate/uscite/identity. Guard yolo=0: se `brain.rooms[camera].persons_count === 0`, ignora l'identity in arrivo. Timeout 90s. Sostituisce gli `unknown` con il nome reale quando arriva l'identity.

#### ThreeViewEngine (id: `8b62e3834e77ba91`)
Costruisce il JSON per la dashboard 3D:
- Mostra "Ospite" al posto di `unknown`.
- Mostra stanze con soli dati MediaPipe (flag `_mediapipe`) anche senza persone YOLO identificate.
- Aggiunge badge MediaPipe (emozione, pose, gesture, smile, mouth) alla card stanza.

#### Save Brain (id: `c2dec82d55826e91`)
Filtra prima di scrivere `brain.json`:
- **Presence**: esclude entries `unknown_*` e quelle `present=false` non viste da > 7 giorni.
- **Rooms**: whitelist — conserva solo stanze il cui id contiene uno dei nomi noti (salotto, sala, ingresso, cucina, camera, bagno, studio, esterno, garage, cantina, terrazzo, giardino). Elimina stanze fantasma come `sconosciuta`.

---

## Voice Pipeline (gaia_listener.py)

```
Microfono (Polycom USB, 48kHz stereo)
    ↓ downsample a 16kHz mono (scipy.signal.resample_poly)
    ↓ gate energetico (RMS > 300)
IDLE: accumula frame finché non c'è silenzio (25 frame ~0.75s)
    ↓ whisper-tiny → cerca "gaia" nel testo
Wake word trovato → LISTENING
    ↓ registra fino al silenzio
    ↓ whisper-small (trascrizione qualità) + resemblyzer (speaker ID) in parallelo
    ↓ pubblica su casa/voce/comando
Node-RED: Voce→Chat → /gaia/chat → Ollama → TTS
```

**Enrollment speaker**: `python3 script/enroll_voice.py <nome>` — registra 3 campioni da 5s, calcola embedding medio, salva in `script/voice_db.json`.

**Avvio servizio**:
```bash
sudo cp script/gaia-listener.service /etc/systemd/system/
sudo systemctl enable --now gaia-listener
sudo systemctl status gaia-listener
journalctl -u gaia-listener -f
```

---

## MediaPipe su Raspberry Pi

Script: `/media/core/D/mediapipe-script/test.py`

**Configurazione**:
```python
CAMERA = "ingresso"   # nome della stanza — modificare per ogni Pi
MQTT_HOST = "192.168.1.142"
```

**Payload pubblicato** su `gaia/mediapipe/pose`:
```json
{
  "person_detected": true,
  "camera": "ingresso",
  "node": "ingresso",
  "ts": 1718000000000,
  "emotion": "happy",
  "smile_score": 85,
  "attention": "center",
  "gesture": "none",
  "pose": "standing",
  "mouth_open": false,
  "eyes_open": true
}
```

Pubblica solo quando `person_detected=true` e con throttle di 1s. Quando la persona esce smette di pubblicare (MediaPipePreParser gestisce il fallback a `persons_count=0`).

---

## Topic MQTT principali

| Topic | Direzione | Descrizione |
|---|---|---|
| `gaia/+/frame` | → Node-RED | Frame YOLO (persons_count, oggetti) |
| `gaia/+/events` | → Node-RED | Eventi presenza raw (person_entered/left) |
| `gaia/vision/identity` | → Node-RED | Face recognition (nome persona) |
| `gaia/mediapipe/pose` | → Node-RED | Pose/gesture/emozione da MediaPipe (Pi) |
| `casa/voce/comando` | → Node-RED | Comando vocale `{text, speaker, confidence}` |
| `gaia/voce/stato` | ← gaia_listener | Stato pipeline vocale (idle/listening/processing) |
| `casa/tts/play` | ← Node-RED | Testo da sintetizzare con Piper |
| `openhab/hue/#` | → Node-RED | Stato luci e sensori Hue |
| `casa/+/pianta/+/umidita` | → Node-RED | Umidità piante (room estratta dal topic) |
| `telegram/alert` | → Node-RED | Allarmi da inviare su Telegram |

---

## Interfacce utente

| Interfaccia | URL | Descrizione |
|---|---|---|
| Render 3D | `http://localhost:1880/gaia-web/` | Avatar Three.js in tempo reale |
| Dashboard | `http://192.168.1.142/dashboard.html` | Stanze, presenza, debug panel |
| Node-RED | `http://localhost:1880` | Editor flussi |

### Dashboard Debug Panel
La dashboard (`/media/core/D/gaia-web/dashboard.html`) include un pannello debug che mostra:
- Tabella stanze con persone, emozione, MediaPipe badge
- Tabella persone con ultima stanza e timestamp
- JSON grezzo dell'ultimo messaggio WebSocket
- Bottone "↺ Brain" per ricaricare `brain.json` via inject API

---

## Deploy Node-RED

Modificare `flows.json` su disco non ricarica automaticamente. Usare l'API REST:

```bash
# Deploy completo (sostituisce tutti i flussi)
curl -X POST http://localhost:1880/flows \
  -H "Content-Type: application/json" \
  -H "Node-RED-Deployment-Type: full" \
  -d @/home/core/.node-red/flows.json
# Risposta attesa: 204

# Ricaricare brain.json (inject node)
curl -X POST http://localhost:1880/inject/5266e36842a24f3b
```

---

## brain.json

Percorso: `/home/core/gaia/brain.json`

Caricato all'avvio da **Parse Brain** (id: `f8b116d0052fdf14`), ricaricabile via inject (id: `5266e36842a24f3b`). Salvato ogni 60s da **Save Brain** (id: `c2dec82d55826e91`).

**Struttura principale:**
```json
{
  "rooms": { "salotto": { "persons_count": 1, "people": ["Mauro"], ... } },
  "presence": { "Mauro": { "present": true, "room": "salotto", "lastSeen": 1718000000000 } },
  "plants": { "monstera": { "moisture": 42, "room": "salotto", "lastSeen": 1718000000000 } },
  "emotions": { "Mauro": { "emotion": "happy", "ts": 1718000000000 } },
  "lights": {},
  "mood": { "stress": 0, "calm": 0, "social": 0, "curiosity": 0, "energy": 50, "state": "neutra" }
}
```

**Whitelist stanze** (Save Brain): salotto, sala, ingresso, cucina, camera, bagno, studio, esterno, garage, cantina, terrazzo, giardino. Stanze non in lista vengono scartate al salvataggio.

**Pulizia presence**: le entry `unknown_*` non vengono mai salvate. Le entry `present=false` non viste da >7 giorni vengono scartate.

---

## Avvio e dipendenze

### Servizi Docker (docker-compose.yaml)
```bash
docker compose up -d   # mosquitto, openhab, ollama
```

### Node-RED
```bash
systemctl status nodered
```

### Voice Pipeline
```bash
sudo systemctl start gaia-listener
# oppure
source ~/core-node-0/venv/bin/activate
python3 ~/core-node-0/script/gaia_listener.py
```

---

## Backup e manutenzione

- Flussi Node-RED: `/home/core/core-node-0/backups/`
- Brain state: `/home/core/gaia/brain.json` (solo stato volatile, ricreato automaticamente)
- Speaker DB: `script/voice_db.json`
- Memoria episodica: Qdrant (esportabile con snapshot)

---

## Moduli implementati

- Presence Engine con face recognition, pulizia unknown, guard yolo=0
- MediaPipe pipeline: PreParser → Norm → Brain (stanze da Pi senza YOLO)
- Voice pipeline: wake word + STT + speaker ID
- Memoria episodica Qdrant (store/recall)
- Pensieri spontanei con contesto LTM
- Chat via HTTP e Telegram con risposte contestuali
- Telegram `/stato` con report completo
- Plant tracking per stanza
- Debug panel dashboard con raw WebSocket data
- Pet Concierge (luce soffusa, acqua, musica)
- Disability Assistant (pose sdraiate, frigorifero, fiamme)
- Maggiordomo (citofono, finestre con pioggia)

## Roadmap

- Comandi vocali per controllo luci/OpenHAB
- Salvataggio conversazioni su Qdrant
- Comandi Telegram aggiuntivi (`/luci`, `/piante`)
- Pruning automatico ricordi Qdrant

---

Autore: Mauro Spagnoli — GAIA, coscienza artificiale per la casa.
