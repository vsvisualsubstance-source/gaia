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

Independent Python services live here, one per directory. `yolo/`, `mediapipe/`, `voice/`
have their own venv; the rest ("light" modules, see `docs/pi-moduli-futuri.md` §Contratto)
run on system `python3` + system `paho-mqtt`:

| Dir | Service | Role |
|---|---|---|
| `agent/` | `gaia-agent` | Always-on daemon. Controls the other services via MQTT, owns room/identity config. |
| `camera/` | `gaia-camera` | Opens the webcam once, publishes frames to shared memory for yolo/mediapipe to read. Independent base service — toggleable on its own to serve `web/cameras.html`; see below. |
| `yolo/` | `gaia-yolo` | Person/object detection (ultralytics YOLO11) → `gaia/{room}/frame` etc. |
| `mediapipe/` | `gaia-mediapipe` | Pose/gesture/emotion detection → `gaia/mediapipe/pose`. Requires ARM 64-bit (aarch64) — MediaPipe does not run on 32-bit Pi OS. |
| `voice/` | `gaia-voice` | Wakeword (openWakeWord) → STT (faster-whisper) → MQTT, and MQTT → TTS (Piper) → speaker. |
| `herbarium/` | `gaia-herbarium` | AV Herbarium — sensore MIDI (pianta/simulatore/mediapipe) → motore musicale (`music_engine.py`) → Carla headless → ALSA out. `herbsim`/`herbmp` sono sorgenti di note ALTERNATIVE (`Conflicts=` reciproco) — generano solo eventi finti, è `gaia-herbarium` stesso il motore che li ascolta e li suona: nessuno dei due produce audio senza di lui attivo. Vedi `docs/pi-moduli-futuri.md` Modulo 1. |
| `livestream/` | `gaia-livestream` | Il Pi trasmette (mic/webcam o libreria locale) via **icecast2 locale** (non centralizzato — vedi `docs/pi-moduli-futuri.md` Modulo 2 per il perché). `icecast2` è un demone di sistema sempre attivo (come mosquitto su Core), non gestito dall'agent; `gaia-livestream` è solo il source client ffmpeg, on/off e cambio sorgente via MQTT `gaia/livestream/{stanza}/command`. |
| `screen/` | `gaia-screen` | Superficie asemica su display DSI (pygame KMSDRM, engine `asemic_engine.py`). `Conflicts=` con gaia-kiosk: uno solo dei due possiede il display. |
| `kiosk/` | `gaia-kiosk` | Welcome su display DSI (cage + Chromium `--kiosk --password-store=basic` — senza quel flag Chromium si blocca sul dialog del portachiavi GNOME). URL da `/etc/gaia/kiosk.conf` o default welcome con `cam=localhost&room=$CAMERA_NAME`. `Conflicts=` con gaia-screen. È in `SERVICE_DEPENDENCIES`: attivarlo accende camera_server (se non già attivo) per la bolla MJPEG. |
| `mediaplayer/` | `gaia-mediaplayer` | Musica/radio per stanza: mpv IPC + MQTT (`gaia/media/{stanza}/command|status`). Cross-platform (unix socket / named pipe Windows) — stesso modulo su OPS (manifest) e minipc (local_agent). Preset+card web+Telegram `/musica` lato Core. |
| `provision/` | `gaia-provision` | WiFi onboarding: se il Pi resta offline, hotspot "Gaia-Setup-XXXX" + captive portal su 10.42.0.1 per configurare rete/stanza. Gira come root (nmcli + porta 80), sempre attivo, idle quando online. Vedi `docs/provisioning-wifi.md`. |

`agent` is the only service enabled at boot (`systemctl enable gaia-agent`); it starts/stops yolo/mediapipe/voice based on `agent/device.json`, so don't assume they're running just because their code is present. `camera` is a normal, independently toggleable entry in `device.json` (needed to serve `web/cameras.html` on its own) — but yolo/mediapipe/kiosk also declare it as a one-way dependency (see `SERVICE_DEPENDENCIES` in `agent/agent.py`): enabling any of them auto-starts camera if it isn't already running, but disabling them never auto-stops it. Camera must be stopped explicitly. This mirrors 2026-08-13's `CAMERA_CONSUMERS`/`_sync_camera` ref-counted design being reverted 2026-08-14 — it silently blocked toggling camera on its own, which the first Pi (`ingresso`) had supported.

Deployed Pis run **paho-mqtt 2.x** even though `requirements.txt` says `paho-mqtt>=1.6.1` (open-ended pin) — confirmed via the `Callback API version 1 is deprecated` warning in `journalctl -u gaia-agent`. Every `on_connect`/`on_disconnect` callback must accept a 5th `properties=None` arg or it crashes on connect under v2.

**Re-syncing code to a Pi**: `~/gaia/` already exists on every deployed Pi, so `scp -r pi/ user@host:~/gaia/` (the literal command in the deploy section below) copies the `pi` directory *into* `~/gaia/`, producing a stale nested `~/gaia/pi/agent/...` instead of updating `~/gaia/agent/...` in place — same trap if you `scp -r yolo/` into an existing `~/gaia/yolo/`. This already happened once and caused a Claude Code session running on the Pi to read stale pre-fix code and report fixed bugs as still open. Always re-sync with `rsync -avz pi/ user@host:~/gaia/` (trailing slash on the source = copy contents, not the directory) and check `find ~/gaia -maxdepth 2 -type d` afterward for unexpected nesting before trusting any in-place analysis.

## Architecture

**Config layering** (all four services follow this): environment variables > `/etc/gaia/{service}.conf` (or `device.conf` for agent-written values) > hardcoded defaults in each service's `config.py`. `/etc/gaia/device.conf` is written by `agent.py` (`_write_device_env`) and is the single source of truth for `CAMERA_NAME` that yolo/mediapipe/voice read as `EnvironmentFile=` in their systemd units — changing the room happens through the agent, not by hand-editing each service's conf.

**Device ID consistency**: all services must use the same `DEVICE_ID` so the Device Registry in Node-RED sees a single entity per Pi. `agent/config.py` computes it from the MAC address (`pi-{mac[-6:]}`), writes it to `/etc/gaia/device.conf`, and the systemd unit for every service loads that file as `EnvironmentFile`. All `config.py` files use `DEVICE_ID = os.getenv("DEVICE_ID", socket.gethostname())` — the env var takes priority over hostname. Never hardcode `socket.gethostname()` without the `os.getenv` fallback, otherwise different services will announce with different IDs and the Device Registry will create phantom duplicate entries.

**External venv support**: each service's `start.sh` looks for `{SERVICE}_VENV` (e.g. `YOLO_VENV`, `MEDIAPIPE_VENV`, `VOICE_VENV`) in its conf file before falling back to a local `./venv`. This lets a Pi reuse a venv that already has torch/ultralytics/mediapipe installed instead of rebuilding one.

**Device Registry / dynamic room identity** (`yolo/mqtt_client.py`, similarly in other services): on connect, a service subscribes to `gaia/devices/{device_id}/config` (retained) and publishes an `announce` to `gaia/devices/{device_id}/announce`. Node-RED's Device Registry replies with the authoritative room on the retained config topic. Until then the service uses its local `NODE_ID`/`CAMERA_NAME` claim. MQTT publish topics (`topic_frame`, `topic_events`, `topic_heartbeat`, `topic_snapshot` in yolo) are *properties* derived from the current room, not fixed strings — they change automatically if the registry reassigns the room, with no restart.

**Agent command/control**: `agent.py` subscribes to `gaia/device/{device_id}/command` and the broadcast `gaia/device/all/command`. It accepts `enable`/`disable`/`restart` (per service, maps through `config.SERVICE_MAP` to systemd unit names), `set_config` (changes `stanza`/`name`/per-service enabled flags, rewrites `/etc/gaia/device.conf`, restarts active services if the room changed), `status`, `reboot`, `shutdown` (2026-08-10, `sudo poweroff` — requires physically unplugging/replugging power to bring the Pi back, no remote power-on), and `ota_update`. State persists in `agent/device.json`; every mutation re-publishes a retained status payload on `gaia/device/{device_id}/status` (includes `role`).

**Manifest per-macchina (2026-07-06)**: se esiste `/etc/gaia/services.json` (override via env `GAIA_SERVICES_MANIFEST`), `config.py` sostituisce `SERVICE_MAP`/`SERVICE_DIRS` con i servizi dichiarati lì e imposta `MACHINE_ROLE`/`device_id_prefix` — è ciò che permette di installare QUESTO agent su macchine non-Pi (ruoli core/media, vedi `docs/core-distribuito.md` nel repo root e `services.json.example`). Sui Pi il file NON va creato: senza manifest valgono le mappe hardcoded di sempre, retrocompatibilità totale. Con manifest senza `camera`, `_sync_camera` è un no-op.

**OTA** — two parallel paths:
- *Path 1 — autonomous (gaia/ota/broadcast)*: `ota.py` (present in yolo/, mediapipe/, voice/) subscribes to `gaia/ota/broadcast` and `gaia/devices/{device_id}/update`. On receipt, downloads the file from the given URL, verifies MD5, writes to `base_dir/script`, optionally restarts the service. Triggered by Node-RED `POST /gaia/ota/push` or by `gaia_admin.py._distribute_model_via_ota()` (for trained models). Node-RED's `GET /gaia/ota/{service}/{file}` serves the source file from `core-node-0/pi/{service}/{file}` — to add a new OTA-servable file, just place it in the right `pi/` subdirectory, no Node-RED config change needed.
- *Path 2 — agent-mediated (gaia/device/{id}/command)*: agent.py handles `ota_update` action, downloads to `SERVICE_DIRS[service]`, restarts. Used for camera/ (no MQTT in camera_server.py) and agent itself.
- camera/ has `ota.py` present but not integrated (camera_server.py has no MQTT client) — camera OTA goes via Path 2 only.

**Camera broker** (`camera/camera_server.py` + `camera_client.py`, the latter duplicated byte-for-byte into `yolo/` and `mediapipe/` — same convention as `ota.py`): neither yolo nor mediapipe opens `cv2.VideoCapture` directly anymore; both read frames from two fixed-name `multiprocessing.shared_memory` segments (`gaia_cam_header`, `gaia_cam_frame`) written by `camera_server.py`, using a lock-free seqlock protocol (even sequence number = stable frame, odd = write in progress, readers retry on a torn/odd read). `camera_client.py` also works around a real Python 3.11 stdlib bug (bpo-38119, confirmed present — Pis run 3.11.2): every process attaching a `SharedMemory` segment, even read-only, registers it with its own `resource_tracker` and unlinks it on exit unless explicitly unregistered, which would silently destroy frames out from under the still-running writer. Only `camera_server.py` ever calls `.unlink()`; readers only `.close()`. If editing the seqlock protocol, the struct format (`HEADER_FMT` in `camera_client.py`) must change identically in all three copies of the file.

**YOLO tracking pipeline** (`yolo/main.py`): `CameraClient.read()` → `Detector.infer()` (every `FRAME_SKIP` frames, not every frame) → `Tracker.update()`. A person track only fires `person_entered` / is counted in `persons_count` once it has `MIN_CONFIRMED_HITS` consecutive hits, to filter false positives. Both `persons` and `objects` are tallied from every track the tracker currently holds (not gated to the exact frame a detection landed on) — an earlier version counted only `age == 0` tracks, which made `persons_count` flicker 0/1 every loop iteration whenever `FRAME_SKIP > 1` skipped the detection step; don't reintroduce that gate. Face-recognition snapshots are sent separately on `topic_snapshot` only above `SNAPSHOT_CONF_THRESHOLD` and once per track.

**MediaPipe payload contract**: publishes on every `PUBLISH_INTERVAL` tick regardless of whether a person is present (`person_detected: false` is a valid, expected message) — this lets Node-RED zero out presence without needing its own timeout logic. See `mediapipe/README.md` for the full field/value table (`emotion`, `gesture`, `pose`, `attention`, etc.) before changing the payload shape, since Node-RED's brain parses these fields by exact string value. Like yolo, analysis (FaceMesh+Hands+Pose — the heaviest part on Pi hardware) runs only every `FRAME_SKIP` captured frames (default `1` = every frame); publishing still happens on the `PUBLISH_INTERVAL` clock using the last computed result.

**Voice pipeline** (`voice/main.py`): openWakeWord listens continuously; on wake it records until silence, transcribes with faster-whisper (`WHISPER_LANG="it"`), and publishes to `gaia/voice/command/{stanza}`. It also subscribes to `gaia/voice/tts/{stanza}` and speaks incoming text via Piper binary + `aplay`, publishing `listening`/`speaking` state to `gaia/voice/status/{stanza}` (retained).

**LiveStream pipeline** (`livestream/main.py`): ffmpeg pushes either the mic (`-f alsa -i default`, via the pipewire-alsa plugin — see gotcha below) or a shuffled concat playlist of `LIVESTREAM_LIBRARY_DIR` (local to this Pi, not Core's music library) into a locally-running `icecast2` (fixed mount `stream.ogg`, port 8000). `icecast2` itself is a system daemon installed by `livestream/install.sh` and left always-running (like mosquitto on Core) — it is not started/stopped by the agent or by this script; only the ffmpeg source client is. Source switch is live via `gaia/livestream/{stanza}/command {"source":"mic"|"library"}` (also reachable from the captive portal and Admin's Pi Manager). Listener count in the retained `gaia/livestream/{stanza}/state` comes from icecast's own `status-json.xsl`. Deliberately **not** the centralized-server design in `docs/pi-moduli-futuri.md`'s original Modulo 2 plan — every Pi is self-contained, no dependency on a reachable Core/OPS.

## Two Pi environment profiles (2026-08-14)

Every Pi up to this point (`ingresso`, `studio`) was set up by **cloning the golden SD
card** (see "Setting up a new Pi from a cloned SD card" below) — Raspberry Pi OS,
**Python 3.11.2**, everything in this file written against that baseline. `vsrasp01`
(set up 2026-08-13 from a **fresh Debian 13 "trixie" install**, not a clone — chosen
at the time without realizing the Python version consequences) is the first Pi on
**Python 3.13**, and several modules needed real workarounds to run there. Recorded
here so the next fresh (non-cloned) Pi doesn't rediscover all of this from scratch —
**cloning the golden card remains the recommended path**; only use a fresh install
+ these workarounds if cloning isn't an option.

Findings, module by module, all confirmed live on `vsrasp01`:

- **yolo**: unpinned `torch` resolves a CUDA-enabled build on some environments, pulling
  ~2GB of unused `nvidia-*` packages that can fill a small `/tmp` tmpfs ("No space left
  on device" with plenty of space on `/`). Fixed project-wide in `install.sh`: torch
  **and** torchvision installed together from `https://download.pytorch.org/whl/cpu` —
  torchvision must come from the same index or it mismatches the CPU-only torch build
  ("operator torchvision::nms does not exist").
- **mediapipe**: the legacy `mp.solutions.*` API (used throughout `mediapipe_node.py`)
  was dropped in mediapipe 1.0.0, the *only* version with an aarch64 wheel for Python
  3.13. The last version with both `.solutions` and an aarch64 wheel is 0.10.18, which
  tops out at Python 3.12. On 3.13, build a **separate venv with a portable Python 3.12**
  (`uv python install 3.12`, no system package needed) instead of the system interpreter.
- **voice**: two independent Python-version ceilings, both below 3.13 —
  `tflite-runtime` (an `openwakeword` dependency) has no PyPI wheel past Python 3.9 for
  aarch64 (piwheels.org does have one at 3.9, official PyPI does not); separately,
  `scikit-learn` must be **pinned to `==1.6.1`** (see below) which also caps out below
  3.13 for aarch64. Net effect: voice needs a **portable Python 3.9** venv
  (`uv python install 3.9`), the most constrained of any module. `main.py` also uses
  `X | None` union-type hints (Python 3.10+ syntax) — add
  `from __future__ import annotations` at the top before targeting anything below 3.10.
- **scikit-learn cross-machine pin**: the "Gaia" wakeword verifier model is *trained on
  Core* and *loaded on the Pi* via pickle — if the two machines' scikit-learn versions
  differ, unpickling breaks with `'LogisticRegression' object has no attribute
  'multi_class'` (or similar) with no useful traceback. Pin `scikit-learn==1.6.1`
  identically in `voice/requirements.txt` **and** in Core's own `requirements.txt`
  (whatever version is the ceiling for the most Python-constrained Pi in the fleet —
  1.6.1 today because of voice's Python 3.9 requirement above).
- **USB mic + PipeWire**: on any Pi where PipeWire is active (herbarium needs it), a
  USB audio device (e.g. a webcam mic) gets claimed by PipeWire as a system source —
  raw ALSA access (`hw:X,Y` or even the `default` PCM) from PortAudio/ffmpeg then stops
  seeing the device at all (`sd.query_devices()` empty, or ffmpeg's `cannot open audio
  device default (Host is down)`), silently, no permission-style error. Fix: install
  `pipewire-alsa` (not just `pipewire-jack`) — it registers a `pipewire`/`default` ALSA
  PCM that PortAudio/ffmpeg *can* see, PipeWire handling the sample-rate conversion
  transparently. Needed by both `voice/` and `livestream/`; **also requires
  `Environment=XDG_RUNTIME_DIR=/run/user/1000` in the `.service` file**, or the plugin
  can't find the user's PipeWire session and fails the same way.
- **herbarium + Carla**: the reference Pis install Carla from the KXStudio PPA (built
  for Ubuntu) via `apt`. That PPA has no Debian trixie packages at all. Use the
  **Flatpak build** (`flatpak install flathub studio.kx.carla`) instead — but the
  Flatpak sandbox only sees `$HOME` (its `filesystems` permission is `home`, not the
  whole host), so anything `patch.carxp` references outside `$HOME` (the default SF2
  soundfont at `/usr/share/sounds/sf2/`, LV2 plugins in `/usr/lib/lv2`) loads silently
  empty — MIDI/audio wiring all report success, but the synth produces no sound and
  there's no error to grep for. Fix: copy the SF2 (`x42-plugins`'s `midifilter.lv2` too)
  into `$HOME` and point *only the on-device copy* of `patch.carxp` at the new path —
  never the repo's own `patch.carxp`, which stays correct for the apt-installed Carla
  on reference Pis. Also: Flatpak Carla defaults to `ProcessMode=1` ("Multiple
  Clients") which exposes one JACK/PipeWire client per plugin instead of Carla's own
  single-`events-in` port that `herbarium/main.py`'s wiring code expects — set
  `ProcessMode=2` ("Continuous Rack") in `~/.var/app/studio.kx.carla/config/falkTX/
  Carla2.conf` (`[Engine]` section) to get the single-client behavior back.

None of the above needed for a Pi cloned from the golden card — Python 3.11.2 already
satisfies every dependency's normal, unpinned wheel range, and Carla comes from
KXStudio as usual. Update this section (or replace it) once `ingresso` is back online
and re-verified against the current code — some of the above may turn out to apply to
*any* Debian trixie-based Pi regardless of how it's provisioned, not just fresh
installs, but that hasn't been tested yet.

## Commands

Initial setup on a fresh Pi (after `scp -r pi/ <user>@<IP>:~/gaia/`):
```bash
cd ~/gaia/agent && bash install.sh        # installs all 5 systemd units, sudoers, /etc/gaia
sudo nano /etc/gaia/device.conf           # set CAMERA_NAME / room (NODE_ID=ingresso etc.)
sudo systemctl start gaia-agent
```

Setting up a new Pi from a **cloned SD card** (dd/rpi-clone/Raspberry Pi Imager "use existing image") instead of a fresh OS install: run `bash ~/gaia/reset-clone-identity.sh` once, before connecting it to the home network — it wipes `agent/device.json` (so the clone doesn't announce the same `stanza` as the source Pi), regenerates SSH host keys and `/etc/machine-id` (a clone shares both with the source otherwise), and sets a new hostname. `DEVICE_ID` needs no action, it's derived from the MAC address (`config.py`) so it's already unique on the clone. Room/WiFi assignment is left to `gaia-provision`'s captive portal on first boot, not hand-edited.

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
