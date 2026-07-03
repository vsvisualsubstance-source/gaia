# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session memory

At the start of every session, read `.claude/memory/MEMORY.md` and all files it references. This directory is the shared memory for this project and travels with the repo via rsync — it is the source of truth for project context across machines (Pi and miniPC).

**Sync is manual, not automatic** — there is no watcher/hook/cron keeping `.claude/` or `CLAUDE.md` in sync between the miniPC repo and any Pi. `core-node-0/pi/` on the miniPC is the master copy (same convention as the rest of this directory). After editing `CLAUDE.md` or anything under `.claude/memory/` here, push it out:
```bash
rsync -avz .claude/ user@<pi-ip>:~/gaia/.claude/
rsync -avz CLAUDE.md  user@<pi-ip>:~/gaia/CLAUDE.md
```
If a Pi session adds/edits memory locally instead, pull it back the same way before it's lost on next deploy (`rsync -avz user@<pi-ip>:~/gaia/.claude/ .claude/`). Trailing slash matters — same trap as code sync, see below.

## What this is

This directory is the subtree deployed to each Raspberry Pi in the GAIA distributed home-AI system (one Pi per room). On the miniPC host repo it lives at `core-node-0/pi/`; on a Pi it is copied via `scp -r pi/ <user>@<IP>:~/gaia/` and becomes the Pi's project root (`~/gaia/`). All MQTT traffic goes to a central broker on the miniPC at `192.168.1.142:1883`; there is no logic on the Pi that talks to anything else.

> Qdrant (memoria vettoriale, solo miniPC) è nel `docker-compose.yaml` del repo root dal 2026-07-03, storage su `/home/core/qdrant_storage`. Nessun servizio Qdrant gira sui Pi.

Five independent Python services live here, each in its own directory with its own venv and systemd unit:

| Dir | Service | Role |
|---|---|---|
| `agent/` | `gaia-agent` | Always-on daemon. Controls the other services via MQTT, owns room/identity config. |
| `camera/` | `gaia-camera` | Opens the webcam once, publishes frames to shared memory for yolo/mediapipe to read. Not user-toggleable — see below. |
| `yolo/` | `gaia-yolo` | Person/object detection (ultralytics YOLO11) → `gaia/{room}/frame` etc. |
| `mediapipe/` | `gaia-mediapipe` | Pose/gesture/emotion detection → `gaia/mediapipe/pose`. Requires ARM 64-bit (aarch64) — MediaPipe does not run on 32-bit Pi OS. |
| `voice/` | `gaia-voice` | Wakeword (openWakeWord) → STT (faster-whisper) → MQTT, and MQTT → TTS (Piper) → speaker. |

`agent` is the only service enabled at boot (`systemctl enable gaia-agent`); it starts/stops yolo/mediapipe/voice based on `agent/device.json`, so don't assume they're running just because their code is present. `camera` is never in `device.json` and can't be enabled/disabled directly via MQTT command — `agent.py` starts/stops it automatically as a reference-counted dependency whenever yolo or mediapipe is enabled/disabled (see `CAMERA_CONSUMERS`/`_sync_camera` in `agent/agent.py`).

Deployed Pis run **paho-mqtt 2.x** even though `requirements.txt` says `paho-mqtt>=1.6.1` (open-ended pin) — confirmed via the `Callback API version 1 is deprecated` warning in `journalctl -u gaia-agent`. Every `on_connect`/`on_disconnect` callback must accept a 5th `properties=None` arg or it crashes on connect under v2.

**Re-syncing code to a Pi**: `~/gaia/` already exists on every deployed Pi, so `scp -r pi/ user@host:~/gaia/` (the literal command in the deploy section below) copies the `pi` directory *into* `~/gaia/`, producing a stale nested `~/gaia/pi/agent/...` instead of updating `~/gaia/agent/...` in place — same trap if you `scp -r yolo/` into an existing `~/gaia/yolo/`. This already happened once and caused a Claude Code session running on the Pi to read stale pre-fix code and report fixed bugs as still open. Always re-sync with `rsync -avz pi/ user@host:~/gaia/` (trailing slash on the source = copy contents, not the directory) and check `find ~/gaia -maxdepth 2 -type d` afterward for unexpected nesting before trusting any in-place analysis.

## Architecture

**Config layering** (all four services follow this): environment variables > `/etc/gaia/{service}.conf` (or `device.conf` for agent-written values) > hardcoded defaults in each service's `config.py`. `/etc/gaia/device.conf` is written by `agent.py` (`_write_device_env`) and is the single source of truth for `CAMERA_NAME` that yolo/mediapipe/voice read as `EnvironmentFile=` in their systemd units — changing the room happens through the agent, not by hand-editing each service's conf.

**Device ID consistency**: all services must use the same `DEVICE_ID` so the Device Registry in Node-RED sees a single entity per Pi. `agent/config.py` computes it from the MAC address (`pi-{mac[-6:]}`), writes it to `/etc/gaia/device.conf`, and the systemd unit for every service loads that file as `EnvironmentFile`. All `config.py` files use `DEVICE_ID = os.getenv("DEVICE_ID", socket.gethostname())` — the env var takes priority over hostname. Never hardcode `socket.gethostname()` without the `os.getenv` fallback, otherwise different services will announce with different IDs and the Device Registry will create phantom duplicate entries.

**External venv support**: each service's `start.sh` looks for `{SERVICE}_VENV` (e.g. `YOLO_VENV`, `MEDIAPIPE_VENV`, `VOICE_VENV`) in its conf file before falling back to a local `./venv`. This lets a Pi reuse a venv that already has torch/ultralytics/mediapipe installed instead of rebuilding one.

**Device Registry / dynamic room identity** (`yolo/mqtt_client.py`, similarly in other services): on connect, a service subscribes to `gaia/devices/{device_id}/config` (retained) and publishes an `announce` to `gaia/devices/{device_id}/announce`. Node-RED's Device Registry replies with the authoritative room on the retained config topic. Until then the service uses its local `NODE_ID`/`CAMERA_NAME` claim. MQTT publish topics (`topic_frame`, `topic_events`, `topic_heartbeat`, `topic_snapshot` in yolo) are *properties* derived from the current room, not fixed strings — they change automatically if the registry reassigns the room, with no restart.

**Agent command/control**: `agent.py` subscribes to `gaia/device/{device_id}/command` and the broadcast `gaia/device/all/command`. It accepts `enable`/`disable`/`restart` (per service, maps through `config.SERVICE_MAP` to systemd unit names), `set_config` (changes `stanza`/`name`/per-service enabled flags, rewrites `/etc/gaia/device.conf`, restarts active services if the room changed), `status`, `reboot`, and `ota_update`. State persists in `agent/device.json`; every mutation re-publishes a retained status payload on `gaia/device/{device_id}/status`.

**OTA** — two parallel paths:
- *Path 1 — autonomous (gaia/ota/broadcast)*: `ota.py` (present in yolo/, mediapipe/, voice/) subscribes to `gaia/ota/broadcast` and `gaia/devices/{device_id}/update`. On receipt, downloads the file from the given URL, verifies MD5, writes to `base_dir/script`, optionally restarts the service. Triggered by Node-RED `POST /gaia/ota/push` or by `gaia_admin.py._distribute_model_via_ota()` (for trained models). Node-RED's `GET /gaia/ota/{service}/{file}` serves the source file from `core-node-0/pi/{service}/{file}` — to add a new OTA-servable file, just place it in the right `pi/` subdirectory, no Node-RED config change needed.
- *Path 2 — agent-mediated (gaia/device/{id}/command)*: agent.py handles `ota_update` action, downloads to `SERVICE_DIRS[service]`, restarts. Used for camera/ (no MQTT in camera_server.py) and agent itself.
- camera/ has `ota.py` present but not integrated (camera_server.py has no MQTT client) — camera OTA goes via Path 2 only.

**Camera broker** (`camera/camera_server.py` + `camera_client.py`, the latter duplicated byte-for-byte into `yolo/` and `mediapipe/` — same convention as `ota.py`): neither yolo nor mediapipe opens `cv2.VideoCapture` directly anymore; both read frames from two fixed-name `multiprocessing.shared_memory` segments (`gaia_cam_header`, `gaia_cam_frame`) written by `camera_server.py`, using a lock-free seqlock protocol (even sequence number = stable frame, odd = write in progress, readers retry on a torn/odd read). `camera_client.py` also works around a real Python 3.11 stdlib bug (bpo-38119, confirmed present — Pis run 3.11.2): every process attaching a `SharedMemory` segment, even read-only, registers it with its own `resource_tracker` and unlinks it on exit unless explicitly unregistered, which would silently destroy frames out from under the still-running writer. Only `camera_server.py` ever calls `.unlink()`; readers only `.close()`. If editing the seqlock protocol, the struct format (`HEADER_FMT` in `camera_client.py`) must change identically in all three copies of the file.

**YOLO tracking pipeline** (`yolo/main.py`): `CameraClient.read()` → `Detector.infer()` (every `FRAME_SKIP` frames, not every frame) → `Tracker.update()`. A person track only fires `person_entered` / is counted in `persons_count` once it has `MIN_CONFIRMED_HITS` consecutive hits, to filter false positives. Both `persons` and `objects` are tallied from every track the tracker currently holds (not gated to the exact frame a detection landed on) — an earlier version counted only `age == 0` tracks, which made `persons_count` flicker 0/1 every loop iteration whenever `FRAME_SKIP > 1` skipped the detection step; don't reintroduce that gate. Face-recognition snapshots are sent separately on `topic_snapshot` only above `SNAPSHOT_CONF_THRESHOLD` and once per track.

**MediaPipe payload contract**: publishes on every `PUBLISH_INTERVAL` tick regardless of whether a person is present (`person_detected: false` is a valid, expected message) — this lets Node-RED zero out presence without needing its own timeout logic. See `mediapipe/README.md` for the full field/value table (`emotion`, `gesture`, `pose`, `attention`, etc.) before changing the payload shape, since Node-RED's brain parses these fields by exact string value. Like yolo, analysis (FaceMesh+Hands+Pose — the heaviest part on Pi hardware) runs only every `FRAME_SKIP` captured frames (default `1` = every frame); publishing still happens on the `PUBLISH_INTERVAL` clock using the last computed result.

**Voice pipeline** (`voice/main.py`): openWakeWord listens continuously; on wake it records until silence, transcribes with faster-whisper (`WHISPER_LANG="it"`), and publishes to `gaia/voice/command/{stanza}`. It also subscribes to `gaia/voice/tts/{stanza}` and speaks incoming text via Piper binary + `aplay`, publishing `listening`/`speaking` state to `gaia/voice/status/{stanza}` (retained).

## Commands

Initial setup on a fresh Pi (after `scp -r pi/ <user>@<IP>:~/gaia/`):
```bash
cd ~/gaia/agent && bash install.sh        # installs all 5 systemd units, sudoers, /etc/gaia
sudo nano /etc/gaia/device.conf           # set CAMERA_NAME / room (NODE_ID=ingresso etc.)
sudo systemctl start gaia-agent
```

Enable a service remotely (agent then starts/manages it):
```
MQTT publish → gaia/device/{device_id}/command
{"action":"enable","service":"yolo"}
```

Manual run of a single service without systemd (each `start.sh` sources the matching `/etc/gaia/*.conf` first):
```bash
cd ~/gaia/yolo && bash start.sh         # or mediapipe/, voice/, agent/
```

Point a service at an existing external venv instead of building a local one — set in the relevant `/etc/gaia/*.conf`:
```
YOLO_VENV=/path/to/venv          # in yolo.conf
MEDIAPIPE_VENV=/path/to/venv     # in mediapipe.conf
VOICE_VENV=/path/to/venv         # in voice.conf
CAMERA_VENV=/path/to/venv        # in camera.conf
```

Logs / status:
```bash
journalctl -u gaia-agent -f
journalctl -u gaia-camera -f      # frame broker — check this first if yolo/mediapipe report no frames
journalctl -u gaia-yolo -f
systemctl status gaia-mediapipe
```

There is no test suite or lint/build step in this directory — these are long-running daemons validated by running them against real camera/mic hardware and watching MQTT traffic (`mosquitto_sub -h 192.168.1.142 -t 'gaia/#' -v`).

Enable/disable services also from Telegram:
```
/attiva yolo      → enable (camera + yolo start automatically)
/disattiva yolo   → disable
/attiva mediapipe | /disattiva mediapipe
/attiva voice     | /disattiva voice
/servizi          → show available commands
```

OTA trigger for a specific file (from miniPC):
```bash
curl -X POST http://localhost:1880/gaia/ota/push \
  -H 'Content-Type: application/json' \
  -d '{"service":"voice","script":"main.py","restart":true}'
# Oppure gaia_admin.py lo fa automaticamente dopo training modelli
```

Voice models on Pi (voice/models/):
- `gaia_verifier.pkl` — wakeword custom "Gaia" (train da admin.html → Wakeword Gaia)
- `doorbell_verifier.pkl` — rilevamento citofono (train da admin.html → Citofono)
- `it_IT-paola-medium.onnx` + `.json` — TTS Piper (gitignored, ~63MB)
- Tutti i .pkl sono gitignored, distribuiti via OTA da gaia_admin.py._distribute_model_via_ota()
