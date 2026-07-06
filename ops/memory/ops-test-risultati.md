---
name: ops-test-risultati
description: "Missione 2/3 OPS (silvermini2) — stack visione nativo Windows: esito, fix applicati, carico misurato, problemi noti"
metadata:
  node_type: memory
  type: project
---

# Test stack visione OPS (silvermini2, 2026-07-06)

**Why:** verifica del profilo FULL (yolo+mediapipe+camera) su Windows nativo, come da
`ops/CLAUDE.md` Missione 2/3, per confermare che silvermini2 possa sostituire la visione
locale del Core.

**Esito: funziona end-to-end**, confermato anche dal Core via SSH (vedi
[[verifica-core-2026-07-06]]) — ma quella prima verifica leggeva una webcam sbagliata (vedi
sotto), corretto in questa sessione.

## Setup

- Venv `C:\gaia\venv` (Python 3.11.9): `paho-mqtt opencv-python mediapipe==0.10.14
  ultralytics numpy scipy`.
- **mediapipe 0.10.35 (l'ultima) non ha `mp.solutions` su Windows** — il wheel Windows
  espone solo `Image`/`ImageFormat`/`tasks`, niente FaceMesh/Hands/Pose legacy.
  `mediapipe_node.py` usa `mp.solutions.face_mesh`/`hands` sempre (anche con
  `MULTI_PERSON=1`) → **pin a `mediapipe==0.10.14`**, che include ancora `solutions`.
- Modello pose: `pi/mediapipe/models/pose_landmarker_full.task` scaricato dall'URL nel
  README del modulo (gitignored, non versionare — aggiunto `ops/models/` a `.gitignore`
  per lo stesso motivo).
- Servizi lanciati manualmente (non come servizi Windows) da:
  - `minipc/camera/camera_server.py` (ha l'MJPEG :8766, `pi/camera/` no)
  - `pi/yolo/main.py`
  - `pi/mediapipe/mediapipe_node.py`
- **DEVICE_ID unificato**: `ops-silvermini2` per tutti e tre (il Core aveva notato due ID
  divergenti in un giro precedente, `-mp` per mediapipe — corretto, ora un solo device nel
  registry).

## Fix applicati (committati, vedi commit `60e9cd4`)

1. **Backend camera Windows**: `cv2.VideoCapture(index)` col backend MSMF di default apre
   la webcam (`isOpened()==True`) ma **non cattura mai un frame** (`can't grab frame. Error:
   -2147483638`) sulla HD Pro Webcam C920 di questa macchina — silenzioso, nessun errore
   finché non si prova a leggere. Fix in `minipc/camera/camera_server.py`: backend
   `cv2.CAP_DSHOW` su `sys.platform == 'win32'`, invariato (`CAP_ANY`/V4L2) su Linux/Pi.
2. **`POSE_MODEL_PATH` su Windows**: `mp_tasks.BaseOptions(model_asset_path=...)` fallisce
   **con qualsiasi path testato** (assoluto `C:\...`, forward-slash `C:/...`, relativo) con
   `Unable to open file at <site-packages>/<path dato>, errno=22` — il resolver C++ di
   mediapipe tratta come "relativo alla resource dir del pacchetto" qualunque path non
   riconosca come assoluto stile POSIX (niente `/` iniziale). Fix in
   `pi/mediapipe/mediapipe_node.py`: leggere il file in Python e passare i byte via
   `model_asset_buffer` invece di `model_asset_path` — bypassa del tutto la risoluzione
   path lato C++, comportamento invariato su Linux/Pi.
3. **CAMERA_INDEX sbagliato — NON un fix di codice, solo operativo**: questa macchina ha
   **4 virtual camera NDI** oltre alla Logitech C920 reale. `CAMERA_INDEX` di default (`0`)
   apriva una delle NDI (frame nero, `mean()==0.0`, ma `isOpened()`/grab **riuscivano**
   silenziosamente — la prima verifica del Core ha validato pipeline e MQTT ma stava
   guardando il nero). **La Logitech C920 reale è all'indice 4** su questa macchina
   (verificato scattando un frame da ogni indice 0-7 e controllando visivamente/`mean()`).
   Indici enumerati con `cv2.VideoCapture(i, cv2.CAP_DSHOW)`: 0-3 = NDI (1920x1080, nero),
   4 = Logitech (640x480, contenuto reale), 5-7 = non aperti. **Non hardcodare l'indice nel
   codice** (dipende dalla macchina, esattamente come da convenzione già in uso per il
   miniPC con `/dev/v4l/by-id/`) — va passato come `CAMERA_INDEX=4` in env quando si
   lancia `camera_server.py` su silvermini2. Se in futuro si aggiungono/rimuovono virtual
   cam NDI l'indice può cambiare — verificare con lo script di scan prima di assumere che
   sia ancora 4.

## Carico macchina (con camera+yolo+mediapipe attivi, FRAME_SKIP default)

- CPU media ~34-46% (due misurazioni indipendenti, mia e del Core, campionate in momenti
  diversi — variabilità legata anche ai processi duplicati della sessione Core in
  parallelo durante i test, vedi sotto).
- RAM ~35% di 32GB.
- Se serve margine per la voce (Missione 2 punto 4): `FRAME_SKIP=2` quasi dimezza il carico
  visione (nota del Core, non ancora testato da questa sessione).

## Problemi noti / da tenere a mente

1. **Camera esclusiva, letteralmente**: durante questa sessione la stessa macchina ha
   avuto **due `camera_server.py` concorrenti** (uno mio nel venv, uno della sessione Core
   via SSH con Python di sistema) più volte, sempre avviati entro lo stesso secondo l'uno
   dall'altro. Ogni nuovo `camera_server` fa `_unlink_if_exists` + ricrea la shared memory
   con lo stesso nome — il secondo scavalca il primo, e un `Stop-Process -Force` su uno dei
   due (niente cleanup, TerminateProcess non esegue `finally`) ha fatto crashare a cascata
   anche gli altri processi (yolo/mediapipe) che leggevano quella shared memory. **Prima di
   lanciare la visione locale da qui, verificare `Get-CimInstance Win32_Process -Filter
   "Name='python.exe'"` per processi già attivi** (specialmente con
   `CommandLine like '%camera_server%'`) — non c'è ancora un lock/coordinamento automatico
   tra le due sessioni Claude che possono operare su questa macchina.
2. **Device Registry**: il primo avvio con `NODE_ID=cucina` è stato sovrascritto a
   `room=unknown` da un retained precedente (nessun'assegnazione stanza pregressa per
   `ops-silvermini2` in Device Registry) — risolto dal Core con
   `POST /gaia/device/assign {device_id, room}` (vedi [[verifica-core-2026-07-06]]), non
   richiede altra azione qui.
3. `paho-mqtt` 2.x logga `DeprecationWarning: Callback API version 1` (gotcha già noto in
   `ops/CLAUDE.md`) — non bloccante, i callback hanno già il 5° argomento.

## Prossimi passi

- Confermare che l'indice 4 resti stabile alla prossima connessione/riavvio (come per la
  webcam USB del miniPC, un indice numerico non è garantito stabile — qui però è
  interno/integrato, probabilmente più stabile del caso USB, ma non testato su riavvio).
- Valutare `FRAME_SKIP=2` se serve margine CPU per la voce.
- Missione 2 punto 4 (voce): non ancora iniziata in questa sessione.
- Concordare con la sessione Core un modo per non lanciare visione locale da entrambe le
  parti contemporaneamente (vedi punto 1 sopra).
