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
| `CAMERA_INDEX` | `0` | Indice webcam USB |
| `PUBLISH_INTERVAL` | `1.0` | Secondi tra pubblicazioni |
| `HEADLESS` | `1` | `1` = nessuna finestra (server/Pi senza display) |
| `TOPIC` | `gaia/mediapipe/pose` | Topic MQTT |

Le variabili d'ambiente hanno priorità sul file di configurazione.

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
  "eyes_open":   true
}
```

### Regole sui valori

| Campo | Valori | Note |
|---|---|---|
| `person_detected` | `true` / `false` | segnale primario di presenza |
| `emotion` | `"neutral"` / `"happy"` / `null` | `null` = volto non visibile |
| `attention` | `"center"` / `"left"` / `"right"` / `"unknown"` | |
| `gesture` | `"none"` / `"fist"` / `"point"` / `"victory"` / `"three"` / `"open_hand"` | |
| `pose` | `"standing"` / `"sitting"` / `"arms_up"` / `"unknown"` | |

Pubblica **sempre** ogni `PUBLISH_INTERVAL` secondi, anche quando nessuno è rilevato
(`person_detected: false`). Questo permette a Node-RED di azzerare il conteggio persone
senza dover gestire timeout.

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
