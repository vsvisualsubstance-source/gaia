---
name: project-gaia
description: "Gaia home AI system — architettura, componenti, stato v1.0.2 (aggiornato 2026-07-03)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8012867d-fe76-4f6f-bc52-dae005c52866
---

# Gaia Project — v1.0.2 (commit cf3c2a8)

Distributed home AI (voce, visione, presenza, LLM, domotica) su miniPC i5 + Raspberry Pi per stanza.

**Why:** Smart home cognitiva con presenza, voce, emozioni, LLM Ollama, TTS Piper, Telegram, OpenHAB Hue.
**How to apply:** Sistema distribuito, MQTT backbone. Voice pipeline miniPC ha speaker ID; Pi ha wakeword ML custom. Node-RED è l'orchestratore centrale.

---

## Hardware

- **miniPC** i5 @ 192.168.1.142 — Node-RED, MQTT broker (mosquitto:1883/9001), Face Recognition, Qdrant, Ollama, Piper TTS
- **Raspberry Pi 4** `pi-fd75d8` (stanza: `ingresso`) — YOLO11 + MediaPipe + gaia-voice
  - **IN PRODUZIONE dal 2026-07-03**: dietro router Google Home, rete `192.168.86.x` (Pi = 192.168.86.249; visto dalla LAN come 192.168.1.212, WAN del router Google). Doppio NAT: il Pi raggiunge il miniPC in uscita (MQTT/HTTP ok), ma **SSH/rsync/ping dal miniPC verso il Pi NON funzionano più** → deploy SOLO via OTA MQTT. Il vecchio IP 192.168.1.189 è morto. **Tailscale bypassa il NAT**: SSH/rsync di nuovo possibili via 100.76.11.49 ([[reference-tailscale]]); PI_VOICE_SYNC_TARGETS già aggiornato
- **Microfono miniPC**: Polycom Communicator USB (48kHz stereo, ALSA idx=5 hw:1,0)
- **Mic Pi**: webcam USB integrata (16kHz mono)

---

## Struttura repo `/home/core/core-node-0/`

```
pi/              ← deployato sui Raspberry Pi via rsync
  agent/         gaia-agent daemon (enable/disable servizi via MQTT)
  camera/        broker frame condivisi (SharedMemory seqlock) — camera_server.py
  yolo/          YOLO11 person+object detection → gaia/{stanza}/frame
  mediapipe/     pose/gesture/emozioni → gaia/mediapipe/pose
  voice/         openWakeWord + faster-whisper + Piper → gaia/voice/command/{stanza}
minipc/
  script/        voice pipeline miniPC: gaia_listener.py, gaia_admin.py, enroll_voice.py
                 train_doorbell_model.py, gaia_wakeword_samples/
  local_agent.py agente miniPC per test OTA/Pi Manager senza Pi fisico
node-red/
  flows.json     flows git-tracked (copia del live /home/core/.node-red/flows.json)
```

**Runtime (non in git):** `/media/core/D/gaia-web/` — web UI servita da Node-RED httpStatic.

---

## Voice Pipeline — Pi (`pi/voice/main.py`)

- Wakeword: openWakeWord modello `alexa` (hey_mycroft) → confidence check con `gaia_verifier.pkl` (LogisticRegression su AudioFeatures embedding)
- **`GAIA_THRESHOLD=0.80`** — alzato da 0.65/0.70 perché TV italiana produce confidence 0.67–0.73 → falsi positivi
- **Guardia durata**: clip ≥10s (= `RECORD_SECONDS_MAX-2`) scartati — rumore ambientale continuo
- **`vad_filter=True`** in faster-whisper → latenza ~0.2s su silenzio vs 15s senza
- STT: faster-whisper `base` int8, `language="it"`, `beam_size=3`
- Config remota via MQTT: `gaia/voice/admin/{stanza}` → `{cmd:"config", wakeword_threshold, gaia_threshold, silence_threshold}`
- Registrazione clip remota: `gaia/voice/record_clip/{stanza}` → `{label:"positive"/"negative", duration_s}` → POST `http://miniPC:8765/api/gaia-wakeword/sample`

---

## Voice Pipeline — miniPC (`minipc/script/gaia_listener.py`)

- Wakeword: whisper-tiny → cerca "gaia" nel testo trascritto
- STT: whisper-small
- Speaker ID: resemblyzer VoiceEncoder cosine similarity (threshold 0.72)
- DB: `minipc/script/voice_db.json` (gitignored)
- MQTT out: `gaia/voice/command/minipc` → `{text, speaker, confidence, ts}`

---

## Admin API (`minipc/script/gaia_admin.py`) — porta 8765

Serve `admin.html`. Gestisce: config miniPC, enrollment voci/volti (mic + file upload), calibrazione, modelli wakeword/citofono. Training modelli → distribuzione OTA → riavvio servizio Pi.

Endpoint chiave: `/api/status`, `/api/config`, `/api/enroll/voice[-upload]`, `/api/enroll/face[-upload]`, `/api/gaia-wakeword/{status,record,record-local,upload,train}`, `/api/doorbell/{status,record,upload,sample,train}`, `/api/pi-voice/{config,calibrate}`, `/api/pi-service/{room}/{action}`.

---

## Node-RED — Brain e WebSocket

- **Brain global**: `global.get('gaiaBrain')` — struttura dati centrale (rooms, people, soul, progression, voiceStatus, voiceCommands)
- **`brain.voiceCommands`**: array max 20 entry `{text, stanza, intent, ts}` — salvato in `voice-fn-intent` (Intent Detection node)
- **WebSocket `ws://miniPC:1880/gaia`**: broadcast da `ThreeViewEngineGAME` ogni tick — payload include `voiceCommands`, `voiceStatus`, presence, rooms, soul
- **Pi Manager MQTT WebSocket**: porta 9001 — topic `gaia/device/+/status` (retained heartbeat agent)

---

## Web UI (`/media/core/D/gaia-web/`)

| File | Descrizione |
|---|---|
| `dashboard.html` | Dashboard live WS — sezioni DOM stabili, card voice commands, debug incrementale |
| `admin.html` | Admin unificato con tab: "⚙ Configurazione" + "🍓 Pi Devices" (MQTT lazy) |
| `pi-manager.html` | Solo redirect → `admin.html#pi` (consolidato 2026-07-03) |

---

## Modelli AI (sui Pi)

| File | Dove | Descrizione |
|---|---|---|
| `gaia_verifier.pkl` | `~/gaia/voice/models/` | Wakeword custom "Gaia" — LogisticRegression su AudioFeatures |
| `doorbell_verifier.pkl` | `~/gaia/voice/models/` | Citofono — stesso approccio |
| `it_IT-paola-medium.onnx` | `~/gaia/voice/models/` | TTS Piper (gitignored, ~63MB) |

Training su miniPC → distribuzione via OTA (`gaia/ota/broadcast` → Pi scarica + riavvia).

---

## Deploy Pi

**Pi in produzione: OTA via MQTT oppure rsync/ssh via Tailscale (asemico@100.76.11.49)** — gli IP LAN 192.168.x del Pi non sono raggiungibili.
- Per-file: `curl -X POST http://localhost:1880/gaia/ota/push -d '{"service":"voice","script":"main.py","restart":true}'`
- Agent-mediated: publish `gaia/device/pi-fd75d8/command` `{"action":"ota_update",...}`

```bash
# rsync valido solo per Pi sulla stessa LAN (setup/lab)
rsync -avz pi/ asemico@<pi-ip>:~/gaia/
cd ~/gaia/agent && bash install.sh && sudo systemctl start gaia-agent
```

## Discovery & Provisioning (v1.0.2 — docs/discovery-protocol.md)

- **gaia-beacon** (miniPC, UDP 8899, systemd + avahi `_gaia._tcp`): risponde a `GAIA_DISCOVER` con `{mqtt_host, mqtt_port, admin_port, version}`
- **Pi agent**: cascata cache(`gaia_core.json`)→broadcast→mDNS, fallback TCP 1883. Il broadcast NON attraversa il NAT Google → in produzione funziona via probe unicast dell'IP in cache. Env `MQTT_HOST` salta la discovery (rimosso dalla unit!), `GAIA_DISCOVERY=0` la spegne
- **Provision livello 3**: agent POSTa `/api/provision` al boot; assegnazione stanza da admin.html tab Pi → "Device registrati" (`/api/provision/assign` aggiorna registry + set_config MQTT + **Device Registry Node-RED** — mai assegnare solo via Node-RED: i due registri divergono, caso storico "ingresso1")
- **Livello 2 FATTO (2026-07-03)**: `pi/provision/` — gaia-provision.service (root) su ogni Pi: offline >180s → AP "Gaia-Setup-XXXX" + captive portal 10.42.0.1 (DNS wildcard via dnsmasq-shared NM). Testato in produzione da remoto. Doc: docs/provisioning-wifi.md

## Gotcha operativi (2026-07-03/04)

- **`/` (root) quasi piena (94%, 2.6GB liberi) per via di `~/.cache` (5.6GB: pip 3.5GB,
  huggingface 2.0GB)** — spostata su `/media/core/D/home-cache/` con symlink al posto degli
  originali (`ln -s /media/core/D/home-cache/huggingface /home/core/.cache/huggingface`,
  stesso per `pip`) — 50GB liberi su D:. Liberati 5.4GB su `/` (94%→81%). Se si scaricano
  nuovi modelli/pacchetti, verificare che finiscano nella cache su D: (dovrebbero, essendo
  symlink trasparenti) e non ricreino i path originali su `/`.
- **Ottimizzazione disco 2026-07-06 (root 82%→72%)**: dati docker spostati in
  `/media/core/D/gaia-data/{ollama,openhab,mosquitto,qdrant}` (compose aggiornato: config
  mosquitto resta versionata nel repo `./mosquitto/config`, tutto il resto su D). Anche
  `~/.insightface` (600M) e `~/.npm` → `/media/core/D/home-cache/` con symlink. I file
  scritti dai container sono OWNED DA ROOT: `mv` da utente fallisce a metà — usare un
  container usa-e-getta (`docker run --rm --entrypoint /bin/sh -v src:/src -v dst:/dst
  ollama/ollama -c 'cp -a /src/. /dst/'`). Il colpo grosso (data-root docker 12,3GB in
  /var/lib/docker + journal + apt + snap) è in `minipc/script/optimize_root_disk.sh` —
  RICHIEDE SUDO dell'utente, verificare se l'ha eseguito.
- **Riavviare gaia-face ferma gaia-camera** (visto 2026-07-06): dopo un restart di
  gaia-face controllare `systemctl is-active gaia-camera` e riavviarla se serve.
- **Contesa CPU tra visione locale (YOLO+MediaPipe via `gaia-local-agent`) e voce
  (whisper) sul miniPC** — load average arrivato a 11.58 su 4 core, `gaia-vision/main.py` da
  solo al 235% CPU. Trascrizione whisper-medium passata da ~8s a ~27s con questo carico.
  Portato alla decisione di separare i ruoli hardware, vedi
  [[project-architettura-core-ops]]. Nel frattempo: `sudo systemctl stop gaia-local-agent`
  libera CPU per testare la voce senza interferenze (riavviare quando serve testare la
  visione locale).
- **Webcam miniPC rinumerata da USB replug → gaia-camera in crash-loop, yolo/mediapipe a
  cascata "in attesa" (non rotti)**: la webcam USB (UC W20) può essere rinumerata da
  `/dev/video0` a `/dev/video1`/`2` dopo una riconnessione USB — `gaia-camera.service` resta
  fisso sull'indice configurato e va in `Restart=on-failure` loop ("Camera 0 non accessibile,
  esco"). `local_agent.py` (yolo+mediapipe sul miniPC) logga correttamente "camera broker non
  disponibile" e ritenta — sono a valle, non la causa. Diagnosi: `ls /dev/video*` per vedere
  quali indici esistono davvero, poi `cv2.VideoCapture(i).isOpened()` per trovare quello che
  apre e cattura un frame reale (non basta che si apra: un nodo può essere solo metadata).
  Fix: `CAMERA_INDEX=N` in `/etc/gaia/camera.conf` (creare `/etc/gaia/` se non esiste, serve
  sudo) + `sudo systemctl restart gaia-camera` — mai hardcodare l'indice nel `.service`, usare
  sempre il file conf (vedi commento in `minipc/camera/gaia-camera.service`).
  **Successo il 2026-07-04 (stesso giorno, seconda rinumerazione)**: l'indice numerico non è
  affidabile — la webcam UC W20 si è rinumerata due volte nella stessa giornata (0→1, poi di
  nuovo con video1 sparito). **Fix definitivo**: `CAMERA_INDEX` ora accetta anche un path
  stabile (`minipc/camera/config.py` — se il valore contiene `/`, non viene castato a int),
  puntato a `/dev/v4l/by-id/usb-CVTE_UC_W20_Camera_510550000000100-video-index0` (elencabili con
  `ls /dev/v4l/by-id/`) — non cambia mai anche se il kernel rinumera `/dev/videoN`. Preferire
  sempre il path by-id all'indice numerico per questa webcam.

- **`kill -HUP $(pgrep -f node-red)` NON ricarica i flow — termina il processo.** Questo Node-RED
  (v5.0.0, gestito a mano con `node-red --userDir /home/core/.node-red &`, non da pm2/systemd
  nonostante esistano vecchi log in `~/.pm2/logs/`) non intercetta SIGHUP, quindi lo uccide come
  azione di default. La doc precedente in questa stessa memory ("Node-RED — sincronizzazione
  flows") che consigliava `kill -HUP` per ricaricare senza perdere `gaiaBrain` **è sbagliata** —
  verificato l'11-07-03 dopo un deploy di modifiche a `flows.json` (fix wiring Pet/Disability/
  Maggiordomo): il processo è morto, andava riavviato a mano. **Per applicare modifiche a
  `flows.json` in produzione: riavviare con `node-red --userDir /home/core/.node-red &`** (non
  kill -HUP). Buona notizia: `Load Brain at StartUp` (inject `once:true` su tab Inject) rilancia
  automaticamente `Parse Brain` che ricarica `gaiaBrain` da `/home/core/gaia/brain.json` — lo
  stato "duraturo" (rooms/presence/people/lights/plants/sensors/mood/lifeIndex/gamification/
  automations) sopravvive al riavvio; solo diary/events/thoughts/memories/chatLog/emotions/
  gestures/sessions vengono azzerati ad ogni riavvio (comportamento normale, non un bug introdotto
  dal riavvio manuale).
- Log agent Pi: stdout era buffered → tutti i log flushati alla morte con timestamp falsi. Fix: `python3 -u` in start.sh. Vale per ogni servizio con print
- Riavvio servizi miniPC senza sudo: `kill -9 <MainPID>` + `Restart=on-failure/always` di systemd
- I servizi Pi (yolo/mediapipe) sono stati trovati 2 volte `disabled` senza automatismo colpevole (probabilmente azione manuale/Telegram). Se ricapita: monitorare `gaia/device/+/command`
- Qdrant: nel docker-compose dal 2026-07-03, storage bind `/home/core/qdrant_storage`, collection `gaia_memory_large` (gaia-brain)
- Riavvio completo miniPC testato OK 2026-07-03 (docker, Node-RED, beacon, gaia-* tutti su da soli)

---

## Blocchi di sviluppo autonomi (2026-07-03)

Il sistema è stato suddiviso in blocchi indipendenti, ognuno con doc nel repo (`docs/`) +
memory dedicata, per poter lavorare su uno senza dover ricaricare tutto il contesto:

| Blocco | Doc repo | Memory |
|---|---|---|
| Web: Admin/PiManager, Arte Visiva, Gaming | `docs/web-sections.md` | [[project-gaia-web]], [[project-web-gaming-rpg]] |
| Node-RED (mappa tab) | `node-red/README.md` | — |
| Pensieri Profondi (Brain/Qdrant/Ollama) | `docs/pensieri-profondi.md` | [[project-pensieri-profondi]] |
| Evoluzione Maggiordomo | `docs/maggiordomo.md` | [[project-maggiordomo]] |
| Pet Recognition + Disability | `docs/pet-disability.md` | [[project-pet-disability]] |
| Automazioni (indice + audit + toggle) | `docs/automazioni.md` | [[project-automazioni]] |
| ESP32/Arduino (roadmap, non iniziato) | `docs/esp32-roadmap.md` | [[project-esp32-roadmap]] |
| TouchDesigner OSC bridge | `minipc/touchdesigner/README.md` | [[project-touchdesigner-osc]] |

---

## MQTT Topics principali

| Topic | Dir | Descrizione |
|---|---|---|
| `gaia/{stanza}/frame` | Pi→NR | YOLO frame (persons_count, oggetti) |
| `gaia/mediapipe/pose` | Pi→NR | Pose/gesture/emozione |
| `gaia/voice/command/{stanza}` | Pi→NR | Comando vocale `{text, stanza, ts}` |
| `gaia/voice/command/minipc` | miniPC→NR | Comando vocale `{text, speaker, confidence}` |
| `gaia/voice/status/{stanza}` | Pi→NR | Stato pipeline (retained) |
| `gaia/voice/admin/{stanza}` | miniPC→Pi | Config remota (threshold, calibration) |
| `gaia/voice/record_clip/{stanza}` | miniPC→Pi | Richiesta registrazione campione |
| `gaia/device/{id}/command` | NR→Pi | Controllo agent (enable/disable/restart/reboot) |
| `gaia/device/{id}/status` | Pi→NR | Heartbeat agent (retained, capabilities, servizi) |
| `gaia/{stanza}/alarm` | Pi→NR | Allarme (doorbell, motion) |
| `gaia/ota/broadcast` | miniPC→Pi | Push OTA file (voice, yolo, mediapipe) |
