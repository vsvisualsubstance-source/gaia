---
name: project-architettura-core-ops
description: "Decisione architetturale 2026-07-04 — split Core (senza mic/camera) / OPS-Touch (visione+voce) / Pi (invariato), motivata da contesa CPU misurata"
metadata: 
  node_type: memory
  type: project
  originSessionId: 139b6cd4-d727-4fcd-83d5-910eceaf6073
---

# Architettura Core / OPS-Touch / Pi (deciso 2026-07-04)

**Why:** durante il debug della lentezza vocale sul miniPC (vedi [[project-voice-minipc]]) è
emerso un limite di capacità reale: `gaia-vision/main.py` (YOLO locale) + `mediapipe_node.py`
locali consumavano da soli ~3 core su 4 (i5-6500T), facendo salire whisper-medium da ~8s a
~27s per trascrizione. Load average misurato: 11.58 su 4 core. Non è un bug software — è
semplicemente più carico di quanto l'hardware attuale regga bene tutto insieme
(visione + voce + Node-RED + Qdrant + Ollama + OpenHAB + docker).

**Decisione dell'utente**: separare i ruoli invece di far girare tutto sulla stessa macchina:

| Ruolo | Cosa gira | Hardware |
|---|---|---|
| **Core** | Servizi che non hanno bisogno di mic/camera: Node-RED, mosquitto, Ollama, Qdrant, OpenHAB, gaia_admin.py, beacon discovery | Un miniPC dedicato |
| **OPS / Touch** | Servizi che hanno bisogno di mic/camera: yolo locale, mediapipe locale, face_service (riconoscimento volti), gaia_listener.py (voce), camera_server | Il monitor touch di produzione (mic+camera integrati) |
| **Pi** | Invariato — un Pi per stanza (yolo/mediapipe/voice/agent), come oggi | Raspberry Pi esistenti |

**How to apply:** questa è la macchina attuale (`core-node-0`) che oggi fa DA ENTRAMBI Core e
OPS contemporaneamente (per questo la contesa CPU) — non ancora fisicamente separata. Quando si
procede alla separazione:
- I servizi "Core" (Node-RED, mosquitto, Ollama, Qdrant, OpenHAB, gaia_admin.py) restano dove
  sono concettualmente centrali — `MQTT_HOST`/`MQTT_BROKER` in tutti i config puntano già a un
  singolo host, la migrazione è principalmente spostare docker-compose + Node-RED su una nuova
  macchina e aggiornare gli IP/hostname nei vari `config.py`/`.conf`.
- I servizi "OPS" (yolo locale, mediapipe locale, face_service, gaia_listener.py, camera_server)
  vanno sul monitor touch — verificare che quella macchina abbia CPU sufficiente per farli
  girare TUTTI insieme senza la stessa contesa vista qui (motivo per cui si sta separando).
- Il Pi resta com'è — non tocca CPU della macchina Core/OPS, gira per conto suo.

**Non ancora fatto**: nessuna migrazione fisica eseguita in questa sessione — solo la
diagnosi (contesa CPU) e la decisione. `gaia-local-agent` (che emula YOLO+MediaPipe sul
miniPC per testare senza Pi fisico) è stato fermato manualmente per liberare CPU durante i
test vocali, va riavviato quando serve testare di nuovo la visione locale.

## Prossimi passi

- Pianificare la migrazione fisica (nuovo hardware per Core, il monitor touch diventa OPS).
- Verificare le specifiche CPU/RAM del monitor touch di produzione contro il carico reale
  misurato qui (yolo+mediapipe+face+voce insieme).
- Aggiornare `MQTT_HOST`/discovery beacon quando Core e OPS sono su macchine fisiche diverse
  (oggi sono la stessa macchina, quindi `localhost` funziona ovunque — non sarà più vero dopo
  la separazione).

## Estensione a N macchine (2026-07-06)

Il design completo per macchine core multiple (agent unico basato su `pi/agent` + manifest
`/etc/gaia/services.json` per-macchina, matrice ruoli Core/OPS/Media/Pi coi vincoli
hardware, mediaplayer mpv+MQTT, checklist migrazione) è in **`docs/core-distribuito.md`**
(repo). Moduli Pi futuri (contratto + AV Herbarium con MPR121/FluidSynth→Carla, LiveStream
con icecast server sul Core e source ffmpeg/darkice sul Pi): **`docs/pi-moduli-futuri.md`**.
Fase 0 IMPLEMENTATA 2026-07-06 (config.py legge il manifest, agent.py adattato, testata: fallback/media/corrotto) — arriva ai Pi al prossimo rsync, innocua senza manifest.
