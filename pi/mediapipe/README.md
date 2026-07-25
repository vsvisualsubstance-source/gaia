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
| `OSC_LANDMARKS` | `0` | `1` = manda anche i landmark grezzi (viso/mani/pose) via OSC diretto a TouchDesigner — vedi sezione dedicata sotto |
| `OSC_HOST` | `127.0.0.1` | IP di TouchDesigner, solo se `OSC_LANDMARKS=1` |
| `OSC_PORT` | `7000` | Porta OSC di TouchDesigner |
| `OSC_INTERVAL` | `0.08` | Secondi tra un invio mocap e l'altro (~12Hz), indipendente da `PUBLISH_INTERVAL` |

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

## Mocap grezzo → TouchDesigner via OSC (`OSC_LANDMARKS=1`)

Il payload MQTT sopra manda solo i campi **derivati** (emotion/pose/gesture) — i punti
grezzi di viso/mani/scheletro esistono già in memoria ad ogni frame (MediaPipe li calcola
comunque) ma normalmente vengono scartati subito dopo. Con `OSC_LANDMARKS=1` vengono
anche mandati via OSC/UDP **direttamente** a TouchDesigner, bypassando MQTT/Node-RED —
è motion capture ad alta frequenza (centinaia di punti, ~12Hz), non un evento
"semantico" per il brain: instradarlo nella pipeline dei pensieri/presenze la
rallenterebbe inutilmente per nulla.

Richiede `pip install python-osc` nel venv del servizio (non è nei requirements.txt di
default: è opzionale, solo per chi accende questo flag — tipicamente OPS, non i Pi).

### Schema indirizzi — un device, un tipo

```
/gaia/mocap/{device_id}/meta/room           stringa, stanza corrente
/gaia/mocap/{device_id}/meta/faces          intero, quanti volti in questo frame
/gaia/mocap/{device_id}/meta/hands          intero, quante mani
/gaia/mocap/{device_id}/meta/poses          intero, quante persone in posa

/gaia/mocap/{device_id}/face/{i}            478 punti × (x,y,z) in UN messaggio,
                                             i = indice volto (0, 1, ... se MAX_FACES>1)

/gaia/mocap/{device_id}/hand/left/{i}       21 punti × (x,y,z) in UN messaggio
/gaia/mocap/{device_id}/hand/right/{i}      idem, mano destra

/gaia/mocap/{device_id}/pose/{i}            33 punti × (x,y,z,visibility) in UN messaggio
```

**Un messaggio per volto/mano/posa, non un messaggio per coordinata**: 478 punti del
viso viaggiano in un solo pacchetto UDP (lista di 1434 float), non 478 pacchetti — il
costo di rete resta basso anche con più persone in scena. Lato TouchDesigner, un OSC In
DAT (non CHOP: qui il valore per indirizzo è una lista, non uno scalare) o uno Script
CHOP che spacca l'array è il modo naturale di consumarlo.

Coordinate normalizzate 0-1 rispetto al frame camera (convenzione MediaPipe standard),
`z` è profondità relativa (negativo = più vicino alla camera). `visibility` della posa
è una confidenza 0-1 sul singolo punto (utile per nascondere arti occlusi invece di
disegnarli comunque).

Namespace separato (`/gaia/mocap/...`) da quello della dashboard (`/gaia/...`, vedi
`minipc/touchdesigner/README.md`) e dal feed curato (`/gaia/canvas/...`) — tre feed
indipendenti sulla stessa porta OSC, TD li distingue per prefisso indirizzo.

**Verificato dal vivo (2026-07-25)** da OPS reale verso questa rete: formato indirizzi
e conteggi confermati esatti (`face/0` → 1434 float = 478×3, `hand/left/0` → 63 =
21×3, `pose/0` → 132 = 33×4). **Non verificata** la cattura dal vivo con
camera+MediaPipe reali su OPS — al momento del test la shared memory di
`gaia-camera` non era raggiungibile per una seconda istanza del servizio (vedi
gotcha sotto, non legato a questa feature).

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
