# GAIA MediaPipe Node

Script per Raspberry Pi. Rileva presenza, emozioni, pose e gesture
tramite webcam e pubblica su MQTT ogni secondo.

---

## Deploy su un nuovo Raspberry Pi

```bash
# 1. Copia i file sul Pi (dall'host)
scp -r pi/ <user>@<IP>:~/gaia/

# 2. Sul Pi: installa tutti i servizi tramite agent
cd ~/gaia/agent && bash install.sh

# 3. Configura la stanza
sudo nano /etc/gaia/device.conf   # → NODE_ID=ingresso

# 4. Se hai già un venv con MediaPipe installato, puntaci:
sudo nano /etc/gaia/mediapipe.conf   # → MEDIAPIPE_VENV=/path/al/venv

# 5. Se non hai un venv, installane uno locale:
cd ~/gaia/mediapipe && bash install.sh

# 6. Abilita il servizio (dall'agent o da Pi Manager)
# MQTT → gaia/device/{id}/command  {"action":"enable","service":"mediapipe"}
# oppure: sudo systemctl start gaia-mediapipe
```

**Richiede ARM 64-bit** (aarch64 / Raspberry Pi OS 64-bit). MediaPipe non funziona su ARM 32-bit.

---

## Configurazione (/etc/gaia/mediapipe.conf)

| Variabile | Default | Descrizione |
|---|---|---|
| `MEDIAPIPE_VENV` | `./venv` | Path venv da usare (lascia vuoto per locale) |
| `CAMERA_NAME` | `unknown` | Nome stanza (es. `ingresso`, `salotto`) |
| `MQTT_HOST` | `192.168.1.142` | IP broker MQTT |
| `MQTT_PORT` | `1883` | Porta broker |
| `PUBLISH_INTERVAL` | `1.0` | Secondi tra pubblicazioni |
| `FRAME_SKIP` | `1` | Analizza 1 frame ogni N catturati (FaceMesh+Hands+Pose sono pesanti su Pi) |
| `HEADLESS` | `1` | `1` = nessuna finestra (server/Pi senza display) |
| `TOPIC` | `gaia/mediapipe/pose` | Topic MQTT |
| `MAX_FACES` | `1` | Volti rilevati in contemporanea (FaceMesh) |
| `MAX_HANDS` | `2` | Mani rilevate in contemporanea |
| `POSE_COMPLEXITY` | `1` | Solo per Pose legacy (`MULTI_PERSON=0`): `0`=lite `1`=full `2`=heavy |
| `MULTI_PERSON` | `0` | `1` = usa la Tasks API (`PoseLandmarker`, multi-persona) invece della Pose legacy (single-persona per costruzione) |
| `MAX_POSES` | `2` | Persone in posa rilevate in contemporanea, usato solo se `MULTI_PERSON=1` |
| `POSE_MODEL_PATH` | *(vuoto)* | Path al bundle `.task` di PoseLandmarker, obbligatorio se `MULTI_PERSON=1` (vedi sotto) |

Le variabili d'ambiente hanno priorità sul file di configurazione. **Tutti i default
sopra riproducono esattamente il comportamento pre-2026-07-04** (1 persona, Pose
legacy) — pensati per essere alzati solo su device con più CPU disponibile (oggi:
il minipc, via `env_extra` in `minipc/local_agent.py`), lasciando i Pi invariati.

### Multi-persona (`MULTI_PERSON=1`)

L'API legacy `mp.solutions.pose.Pose` rileva **una sola persona** per costruzione —
non esiste un `max_num_poses`. Per più persone serve la Tasks API
(`mediapipe.tasks.python.vision.PoseLandmarker`), che richiede di scaricare a parte
un bundle `.task` (~9MB, non incluso in git):

```bash
curl -sL -o pose_landmarker_full.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
```

Se `MULTI_PERSON=1` ma `POSE_MODEL_PATH` non esiste, il servizio logga un errore e
torna automaticamente alla Pose singola (nessun crash).

FaceMesh e Hands supportano nativamente il multi-persona (`max_num_faces`/
`max_num_hands`) senza bisogno della Tasks API — solo Pose ha questo limite.

**Camera condivisa**: questo servizio non apre più la webcam direttamente — legge i frame dal broker `gaia-camera` (shared memory), avviato/fermato automaticamente da `gaia-agent` quando `mediapipe` o `yolo` sono abilitati. L'indice webcam si configura in `/etc/gaia/camera.conf`, non più qui.

---

## Payload MQTT

Topic: `gaia/mediapipe/pose`

```json
{
  "camera": "ingresso",
  "node":   "ingresso",
  "ts":     1718000000000,
  "person_detected": true,
  "emotion":     "neutral",
  "smile_score": 55,
  "attention":   "center",
  "gesture":     "none",
  "pose":        "standing",
  "mouth_open":  false,
  "eyes_open":   true,
  "people_count": 1,
  "people": [
    {
      "id": 0, "emotion": "neutral", "smile_score": 55, "attention": "center",
      "mouth_open": false, "eyes_open": true, "pose": "standing", "gestures": []
    }
  ]
}
```

### Regole sui valori

| Campo | Valori | Note |
|---|---|---|
| `person_detected` | `true` / `false` | segnale primario di presenza |
| `emotion` | `"neutral"` / `"happy"` / `"surprised"` / `null` | `null` = volto non visibile; campo flat = persona 0 |
| `attention` | `"center"` / `"left"` / `"right"` / `"unknown"` | |
| `gesture` | `"none"` / `"fist"` / `"point"` / `"victory"` / `"three"` / `"open_hand"` | prima gesture della persona 0, per compatibilità |
| `pose` | `"standing"` / `"sitting"` / `"arms_up"` / `"unknown"` | |
| `people_count` | intero ≥ 0 | quante persone distinte sono state associate nel frame |
| `people` | array | un oggetto per persona, stessi campi dei flat più `id` e `gestures` (lista, può avere più di 1 elemento se `MAX_HANDS` > 2) |

Pubblica **sempre** ogni `PUBLISH_INTERVAL` secondi, anche quando nessuno è rilevato
(`person_detected: false`). Questo permette a Node-RED di azzerare il conteggio persone
senza dover gestire timeout.

**Nota su `people[]` con `MULTI_PERSON=1`**: FaceMesh, Hands e Pose sono tre pipeline
indipendenti senza un tracking-id condiviso — l'associazione persona-per-persona è
best-effort per vicinanza orizzontale (`x` del volto o del busto), non un vero
multi-object-tracking. Affidabile quando le persone sono separate lateralmente
(inquadratura fissa tipica di una stanza), non garantita se si sovrappongono o si
scambiano di posto rapidamente frame-per-frame.

---

## Multi-device

Ogni Raspberry Pi ha il proprio `/etc/gaia/mediapipe.conf` con `CAMERA_NAME` diverso.
Tutti pubblicano sullo stesso topic `gaia/mediapipe/pose`. Node-RED identifica la
stanza dal campo `camera` nel payload.

```
Pi 1 (ingresso) ──┐
Pi 2 (salotto)  ──┤──► gaia/mediapipe/pose ──► Node-RED ──► brain.rooms[camera]
Pi 3 (cucina)   ──┘
```

---

## Log

```
09:15:01 [gaia-mp] camera=ingresso broker=192.168.1.142:1883 device=0
09:15:01 [gaia-mp] MQTT connesso
09:15:01 [gaia-mp] Camera 0 aperta
09:15:02 [gaia-mp] em=neutral pose=standing gest=none
09:15:10 [gaia-mp] · nessuno in scena
```

---

## File

| File | Descrizione |
|---|---|
| `mediapipe_node.py` | Script principale |
| `mediapipe.conf.example` | Template configurazione → copiare in `/etc/gaia/mediapipe.conf` |
| `start.sh` | Avvio con supporto venv esterno (usa MEDIAPIPE_VENV) |
| `install.sh` | Installazione venv locale + dipendenze |
| `install_service.sh` | Installa solo il servizio systemd (senza reinstallare venv) |
| `requirements.txt` | Dipendenze Python |
| `ota.py` | Aggiornamenti OTA via MQTT |
