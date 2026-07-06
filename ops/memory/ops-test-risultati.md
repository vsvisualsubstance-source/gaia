---
name: ops-test-risultati
description: "Missioni 2/3/4 OPS (silvermini2) — stack visione+voce nativo Windows e agent Pi Manager: esito, fix applicati, carico misurato, problemi noti"
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
- Concordare con la sessione Core un modo per non lanciare visione locale da entrambe le
  parti contemporaneamente (vedi punto 1 sopra).

## Missione 2 punto 4 — Voce (2026-07-06, sessione successiva)

**Non ho usato `minipc/script/gaia_listener.py`** come da indicazione letterale della
missione: usa pyaudio/resemblyzer (speaker ID) e soprattutto pubblica su
`gaia/voice/tts/minipc`, che in Node-RED è cablato a un `exec` di
`minipc/say.sh` **eseguito sul Core** (Piper+aplay locali al processo Node-RED) — nella
vecchia architettura miniPC-unico Node-RED e gli altoparlanti erano la stessa macchina,
qui non più: avrebbe fatto parlare il Core, non silvermini2. Ho invece portato
`pi/voice/main.py` (openWakeWord + faster-whisper + MQTT), che già usa
`gaia/voice/tts/{stanza}` — **lo stesso schema per-stanza che Node-RED pubblica già**
(vedi `Build TTS payload` in flows.json) — quindi zero modifiche lato Core necessarie.

Nuovo modulo: `ops/voice/` (`config.py` + `main.py`), non stessa cosa di `pi/voice/`:
- **TTS**: libreria Python `piper-tts` (onnxruntime, bundlata, niente binario esterno) +
  playback con `sounddevice` invece di piper.exe+aplay (Linux-only). Stesso modello vocale
  del resto del sistema, `it_IT-paola-medium` (scaricato da HuggingFace
  `rhasspy/piper-voices`, 63MB, in `ops/voice/models/`, gitignored) — voce coerente in
  tutta la casa.
- Rimosso: OTA (qui si lancia a mano, niente agent/systemd) e rilevamento citofono (non
  pertinente a questa macchina).
- Mic/output audio: **default di sistema già corretti**, non serve MIC_DEVICE/OUTPUT_DEVICE
  espliciti — `sounddevice` risolve l'input di default sulla Logitech C920 (non una delle
  virtual mic NDI) e l'output sugli altoparlanti reali (MB16AMTR USB Audio). Verificato con
  `sd.query_devices()`.
- **Gotcha stdout bufferizzato**: `print()` senza flush esplicito, se lo stdout non è una
  tty (redirect su file), Windows/Python bufferizza tutto — il log restava vuoto per
  minuti anche a servizio pienamente avviato. Fix: `PYTHONUNBUFFERED=1` in env al lancio
  (stesso gotcha già noto sui Pi per lo stdout dei servizi, vedi [[project_gaia]]).
- **Gotcha HF Hub hang**: al primo avvio, `WhisperModel("base")` ha controllato la
  freschezza della cache HuggingFace via rete (anche a modello già scaricato) e si è
  bloccato per minuti — molto probabilmente rate-limit/contesa dovuta al download
  concorrente della sessione Core in parallelo sulla stessa cache utente condivisa
  (`~/.cache/huggingface`, condivisa tra tutti gli interpreti Python dello stesso utente
  Windows, non per-venv). Fix: `HF_HUB_OFFLINE=1` in env — il modello era già in cache,
  carica istantaneamente senza toccare la rete.

**Testato**: pipeline completa avviata (Piper/Whisper/openWakeWord caricati, MQTT connesso,
`room=cucina` confermata dal Device Registry). TTS verificato end-to-end pubblicando su
`gaia/voice/tts/cucina` → stato passato `listening → speaking → listening` → **audio
sentito realmente dagli altoparlanti** (confermato dall'utente).

**Non ancora testato**: wakeword + comando vocale via microfono reale (richiede una
persona che parli). Il wakeword attivo è **`alexa`** (modello pretrained generico
openWakeWord, default), **non "Gaia"** — nessun campione/modello custom
(`gaia_verifier.pkl`) esiste ancora per il microfono di questa macchina, esattamente come
segnalato in `ops/CLAUDE.md` Missione 2. Finché non si allena un modello dedicato (stessi
strumenti usati per Pi/miniPC, admin.html → raccolta campioni → training), il rilevamento
wake funziona dicendo "Alexa", non "Gaia".

### Prossimi passi voce

- Raccogliere 20-30 campioni "Gaia" dal microfono di questa macchina e allenare
  `ops/voice/models/gaia_verifier.pkl` (stesso approccio di [[project_voice_minipc]]) —
  serve un endpoint/flow admin per farlo, non esiste ancora per questa macchina
  specificamente.
- Testare il giro STT completo (wakeword reale + comando parlato) con una persona davanti
  al microfono.
- Verificare se lanciare anche la voce insieme a camera+yolo+mediapipe cambia
  sensibilmente il carico misurato sopra (non rimisurato in questa sessione).

## Missione 4 — Agent Windows per Pi Manager (2026-07-06, stessa sessione voce)

Nuovo modulo `ops/agent/` (`agent.py` + `services.json` + `run_agent.bat`), porting del
pattern SUBPROCESS di `minipc/local_agent.py` (non il pattern systemd di `pi/agent/agent.py`
— Windows non ha systemd). Stessa interfaccia MQTT: `gaia/device/{id}/status` (heartbeat 30s,
retained, con `role: "ops"`) e `gaia/device/{id}/command` (`enable`/`disable`/`restart`/
`set_config`/`status`/`ota_update`; `reboot` loggato ma ignorato — questa non è un Pi
headless da riavviare da remoto senza conferma).

**Differenze dal riferimento (`local_agent.py`)**:
- Definizioni servizi lette da `services.json` (manifest locale, ruolo `ops`,
  `device_id`/`stanza`/`cmd`/`cwd`/`env_extra` per camera/yolo/mediapipe/voice) invece di
  hardcoded nello script — più facile da aggiornare senza toccare la logica.
- **Camera come dipendenza ref-contata** di yolo/mediapipe (`CAMERA_CONSUMERS`/
  `_sync_camera`, stessa logica di `pi/agent/agent.py`, non presente in `local_agent.py`):
  si avvia da sola quando il primo tra yolo/mediapipe viene abilitato, si ferma quando
  l'ultimo viene disabilitato — mai gestibile a mano via comando (bloccato esplicitamente in
  `set_config`). Necessario per rispettare l'esclusività della webcam scoperta in Missione 2/3.
- Lock singleton: `msvcrt.locking()` invece di `fcntl.flock()` (non esiste su Windows).

**Gotcha trovati e risolti**:
1. **Deadlock da lock non rientrante**: `_sync_camera` (chiamato da dentro un
   `with _cfg_lock:` in enable/disable/set_config) finiva per richiamare `_build_env`, che
   riacquisisce lo stesso `_cfg_lock` — con un `threading.Lock` normale il thread si blocca
   per sempre aspettando un lock che tiene già lui stesso. Sintomo: il comando `enable yolo`
   avviava yolo ma la camera non partiva mai, senza nessun errore visibile (il thread del
   comando restava bloccato in silenzio). Fix: `threading.RLock()` al posto di
   `threading.Lock()` per `_cfg_lock`. **Se si aggiungono nuovi punti che tengono
   `_cfg_lock` e poi chiamano (anche indirettamente) `_start_service`/`_stop_service`,
   verificare che non ci sia lo stesso problema.**
2. **Stesso gotcha encoding cp1252** già visto per la voce: `sys.stdout.reconfigure(
   encoding="utf-8", errors="replace")` necessario anche qui, altrimenti i log dei
   sottoprocessi (accenti, frecce) mandano in `UnicodeEncodeError` il thread `drain` che
   inoltra il loro stdout.

**Testato end-to-end via MQTT** (comandi inviati da un client di test, non da Pi Manager
reale): `enable yolo` → camera si avvia da sola, yolo rileva persone; `enable mediapipe` e
`enable voice` → entrambi attivi in parallelo; `disable yolo` (mediapipe ancora attivo) →
camera resta su; `disable mediapipe` → camera si ferma (nessun consumer rimasto); stato
`gaia/device/ops-silvermini2/status` con `role:"ops"`, `capabilities`, `services`, `uptime`
tutti corretti.

**Avvio automatico**: Scheduled Task Windows `GAIA-OPS-Agent` (trigger `AtLogOn` per
l'utente corrente, `RestartCount=5`/`RestartInterval=1min` se crasha, esegue
`ops/agent/run_agent.bat` che redirige stdout/stderr su `ops/agent/agent.log`, gitignored).
Registrato con PowerShell elevato (`Register-ScheduledTask`, richiede admin — stesso pattern
UAC della Missione 1). Verificato con `Start-ScheduledTask` manuale: si avvia, si connette a
MQTT, e **il lock impedisce correttamente una doppia istanza** (l'ho verificato per sbaglio:
un mio processo agent di test manuale ancora vivo ha fatto uscire subito l'istanza lanciata
dal task schedulato con "Un'altra istanza è già in esecuzione").

**Non fatto in questa sessione**: nessun test OTA (`ota_update`) — il meccanismo è portato
1:1 da `local_agent.py` ma non esercitato; test di riavvio completo della macchina (il
trigger `AtLogOn` presuppone che l'utente `vsvis` faccia login, non testato un riavvio reale
del PC).

### Incidente post-deploy: chiusura finestra console ha ucciso tutto lo stack

Poco dopo il deploy, l'utente ha chiuso quella che pensava fosse la finestra della sola
camera — in realtà agent + camera + yolo + mediapipe + voice condividevano tutti **la
stessa console** (aperta dal task perché lanciava `python.exe`, non `pythonw.exe`, con
logon interattivo): chiudere quella finestra manda un `CTRL_CLOSE_EVENT`/window-close a
tutto il gruppo di processi, non solo al "primo piano" — visto in log come
`forrtl: error (200): program aborting due to window-CLOSE event` sul processo voice
(runtime Fortran/MKL di ctranslate2), ma in realtà TUTTI i servizi sono morti insieme.
Il Scheduled Task ha registrato `LastTaskResult=3221225786` (`STATUS_CONTROL_C_EXIT`) ma
non si è riavviato da solo nonostante `RestartCount=5` — il riavvio automatico su
crash **non copre la chiusura via finestra su un trigger `AtLogOn`**, va verificato meglio
se ricapita (per ora si riavvia a mano con `Start-ScheduledTask`).

**Fix applicato** (`ops/agent/agent.py`, `run_agent.bat`, nuovo `run_agent_hidden.vbs`):
- `subprocess.Popen(..., creationflags=subprocess.CREATE_NO_WINDOW)` per ogni servizio
  figlio — non condividono più (né aprono una propria) finestra console.
- `run_agent.bat` ora lancia `pythonw.exe` (non `python.exe`) per l'agent stesso — nessuna
  console, ma serve comunque il redirect (`>> agent.log 2>&1`) nel `.bat` perché `pythonw`
  da solo non ha stdout valido (sarebbe `None`, `print()` esploderebbe).
- Il Task Scheduler con logon interattivo mostra comunque una finestra per il `cmd.exe`
  che esegue il `.bat`, quindi l'azione del task ora è `wscript.exe run_agent_hidden.vbs`
  (`WScript.Shell.Run ..., 0, False` — stile finestra 0 = nascosta), che a sua volta lancia
  il `.bat` invisibile. **Aggiornare la registrazione task se si tocca `run_agent.bat`**:
  serve rieseguire `Register-ScheduledTask` (admin) con l'Action puntata al `.vbs`, non
  più direttamente al `.bat`.
- Verificato: nessuna finestra visibile dopo il riavvio, tutti e 4 i servizi tornati
  `active` via status MQTT.

**Trovato anche un problema laterale durante il recovery**: fermare il processo agent
(`Stop-Process`) non termina i suoi sottoprocessi (camera/yolo/mediapipe/voice) — a
differenza della chiusura-finestra, che uccide tutto il gruppo, Windows non propaga la
terminazione da padre a figli. Risultato: due generazioni di servizi orfani rimaste vive
in parallelo (vecchia + nuova), e la camera nuova falliva l'apertura perché quella vecchia
teneva ancora l'indice 4. **Prima di riavviare l'agent per debug, verificare ed eventualmente
terminare esplicitamente anche i sottoprocessi**, non solo il processo agent.
