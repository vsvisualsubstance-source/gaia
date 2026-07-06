# OPS — Missione per Claude su silvermini2 (Windows 11)

Sei il Claude che lavora sulla macchina **OPS** del sistema GAIA: `silvermini2`,
Windows 11, Ryzen 7, 32GB RAM, GPU 2GB, utente `vsvis` (account MS
vs.visualsubstance@gmail.com). IP LAN `192.168.1.239`, Tailscale `100.91.251.83`.

Questo file è stato scritto dal Claude che lavora sul **Core** (miniPC Linux
`core-node-0`, IP `192.168.1.142`) il 2026-07-06 — è il passaggio di consegne.
La memoria di progetto è in `ops/memory/` (leggila tutta prima di iniziare).
L'architettura completa è in `docs/core-distribuito.md` e `pi/CLAUDE.md`.

## Contesto in tre righe

GAIA è una home-AI distribuita: il Core (miniPC) ha Node-RED (il "brain"),
broker MQTT, Ollama, Qdrant, OpenHAB e la web UI; i Raspberry per stanza fanno
visione+voce. Questa macchina diventa **OPS**: prende visione (yolo+mediapipe)
e voce, perché il Core ha solo 4 core e andava in saturazione.

## Coordinate fisse

- **Broker MQTT**: `192.168.1.142:1883` (tutto passa da lì)
- **Node-RED**: `http://192.168.1.142:1880` (payload WS su `/gaia`)
- **Admin API**: `http://192.168.1.142:8765`
- **Repo**: questo — il Claude del Core lavora su `main`; committa spesso,
  piccolo, e fai `git pull --rebase` prima di ogni push. I tuoi appunti di
  memoria vanno in `ops/memory/` (viaggiano via git, è il canale tra noi due).

## MISSIONE 1 — Sblocca l'accesso SSH dal Core (PRIMA COSA)

Il Claude del Core deve poterti raggiungere. sshd è già installato e attivo.
Esegui in PowerShell **admin**:

```powershell
$key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHs37ilSj2Qq7uYue88B/ou6IKHaSeNM8o2Hljo06Qda core-node-0-to-pi'
Set-Content -Path C:\ProgramData\ssh\administrators_authorized_keys -Value $key -Encoding Ascii
icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "*S-1-5-32-544:F" /grant "*S-1-5-18:F"
Restart-Service sshd
```

Verifica: da quel momento il Core può fare `ssh vsvis@192.168.1.239`.

## SCOPERTE SUL CAMPO (2026-07-06, dal Core via SSH — leggere prima della Missione 2)

- `C:\TouchDesigner\TOE\` contiene GIÀ MediaPipe per TD (`mediapipe-touchdesigner-main`,
  FACEMASK.toe) e `Yolo.toe`; `C:\TouchDesigner\piante\` + `AV.toe` = lavoro AV/VST
  esistente dell'utente — sono i semi dell'AV Herbarium (docs/pi-moduli-futuri.md).
- **Decisione architetturale**: il sensing 24/7 per il brain lo fanno i servizi Python
  headless (questa missione). TouchDesigner è lo strato CREATIVO che consuma i dati GAIA
  (bridge OSC in `minipc/touchdesigner/`) — non va usato come backbone di sensing.
- **Camera condivisa**: su Windows la webcam è esclusiva. camera_server ne è l'unico
  proprietario; TouchDesigner la legge dallo stream MJPEG `http://localhost:8766/video`
  (Video Stream In TOP). Non aprire mai la webcam da due processi.
- Venv già creato in `C:\gaia\venv` (Python 3.11.9) ma vuoto: la Missione 2 parte
  dall'installazione dei pacchetti in QUESTO venv.
- SSH dal Core funziona (Missione 1 ok) — il Claude del Core può ispezionare la macchina;
  il lavoro locale resta tuo per evitare conflitti.
- `C:\WWWROOT\_\pipe\` = progetto museo web dell'utente con `@mediapipe/tasks-vision`
  (MediaPipe **JavaScript**, browser). Non c'entra col sensing Python (pacchetti diversi,
  convivono) ma è know-how riusabile: tracking client-side nella Welcome page per le
  gesture→glifi asemici (roadmap v3 in docs/vocabolario-asemico.md), zero carico server.

## MISSIONE 2 — Stack visione+voce nativo Windows (il test OPS)

**Decisione già presa (non rimetterla in discussione senza motivo): Python
NATIVO su Windows, NIENTE WSL2** — camera e microfono sono il motivo di
esistere di questa macchina e il passthrough WSL2 è inaffidabile.

Servizi da portare su (in quest'ordine):
1. `pi/camera/camera_server.py` — apre la webcam, frame in
   `multiprocessing.shared_memory` (cross-platform) + MJPEG su `:8766`.
2. `pi/mediapipe/mediapipe_node.py` — profilo FULL via env:
   `MAX_FACES=2 MAX_HANDS=4 POSE_COMPLEXITY=2 MULTI_PERSON=1 MAX_POSES=2
   POSE_MODEL_PATH=<scarica pose_landmarker_full.task, URL nel README del modulo>`
3. `pi/yolo/main.py` — person/object detection; gli snapshot volti vanno via
   MQTT al Core, il riconoscimento resta là (NON serve face service qui).
4. Voce per ultima: `minipc/script/gaia_listener.py` come riferimento, ma
   ATTENZIONE: usa path Linux (say.sh, /media/core/D…) e un modello wakeword
   allenato sul mic del miniPC — sul mic di questa macchina serviranno
   campioni nuovi. Per il primo test bastano i punti 1-3.

Env comune per tutti i servizi:
```
MQTT_HOST=192.168.1.142   MQTT_PORT=1883
DEVICE_ID=ops-silvermini2
CAMERA_NAME=<stanza: chiedi all'utente dove sta la macchina>
HEADLESS=1
```

Setup consigliato: Python 3.11 o 3.12 (winget install Python.Python.3.12),
un venv unico per il test (`C:\gaia\venv`), pip: `paho-mqtt opencv-python
mediapipe ultralytics numpy`. GPU: ignorala, la CPU basta (8 core).

**Gotcha noti** (pagati sulla pelle del Core, non ripagarli):
- paho-mqtt 2.x: `mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, ...)` e i
  callback `on_connect/on_disconnect` con 5° argomento `properties=None`.
- `fcntl` non esiste su Windows (è il lock del local_agent del miniPC) — per
  il test lancia i servizi direttamente, l'agent si porta dopo.
- `camera_client.py` ha un workaround per il resource_tracker della
  shared_memory (bpo-38119): verificare che regga sul Python scelto — se i
  frame "spariscono", è quello.
- Il payload mediapipe multi-persona (`people[]`, `people_count`) è già
  gestito dal brain: non cambiare la forma del payload.

## MISSIONE 3 — Misura e verifica

1. Carico: media CPU/RAM con i 3 servizi attivi (Task Manager o
   `Get-Counter '\Processor(_Total)\% Processor Time'` campionato 60s).
2. Dal Core arrivano i dati? Verifica MQTT: topic `gaia/mediapipe/pose` con
   `device_id=ops-silvermini2` e `gaia/{stanza}/frame` da yolo.
3. La Welcome page (`http://192.168.1.142:1880/welcome.html`) deve reagire ai
   dati OPS (i dati viaggiano via brain, machine-agnostic). La bolla camera
   MJPEG punta al Core: per il test aprila con il browser sulla porta 8766 di
   QUESTA macchina per verificare lo stream, l'integrazione UI la fa il Core.
4. Scrivi i risultati (carico, cosa funziona, cosa no) in
   `ops/memory/ops-test-risultati.md` e committa+pusha: il Claude del Core
   li legge da lì e coordina i passi successivi (spegnere la visione locale
   sul miniPC, ecc.).

## MISSIONE 4 — Agent Windows (visibilità e controllo in Pi Manager)

Senza agent la macchina è invisibile a Pi Manager (che ascolta
`gaia/device/+/status`) e i servizi non si possono avviare/fermare da remoto.
Porta il pattern SUBPROCESS di `minipc/local_agent.py` su Windows:
- `fcntl` non esiste → lock con `msvcrt.locking` o file-pid semplice.
- `_SERVICE_DEFS` per questa macchina: camera (minipc/camera/camera_server.py),
  yolo (pi/yolo/main.py), mediapipe (pi/mediapipe/mediapipe_node.py), voice
  quando pronta — con i rispettivi env (CAMERA_INDEX=4, DSHOW, profilo full…).
  Meglio ancora: leggi le definizioni da un manifest `services.json` locale
  (stesso schema di `pi/agent/services.json.example`, ruolo `ops`).
- `DEVICE_ID=ops-silvermini2`, heartbeat 30s retained su
  `gaia/device/ops-silvermini2/status` con campo `role: "ops"`.
- Avvio automatico: Task Scheduler di Windows (`schtasks`) o cartella Startup —
  l'agent poi avvia i servizi abilitati (pattern `apply_initial_config`).
- Bonus: con l'agent attivo, enable/disable/restart funzionano da Pi Manager
  e da Telegram, e l'OTA arriva anche qui.

## Regole della casa

- Il broker, il brain e la web UI NON si toccano da qui: sono del Core.
- Non pubblicare su topic MQTT retained di configurazione (`gaia/devices/+/config`).
- Commit piccoli con messaggi chiari; mai committare modelli/dati personali
  (vedi .gitignore).
- Se qualcosa del contesto non torna, chiedi all'utente o lascia una domanda
  in `ops/memory/` per il Claude del Core.
