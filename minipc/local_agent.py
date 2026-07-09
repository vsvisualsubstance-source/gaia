#!/usr/bin/env python3
"""
GAIA Local Agent — emula un Pi sul miniPC per test OTA e Pi Manager.

Gestisce processi locali (subprocess) invece di systemctl.
Stessa interfaccia MQTT del pi/agent/agent.py:
  - pubblica: gaia/device/{id}/status  (heartbeat ogni 30s, retain=True)
  - ascolta:  gaia/device/{id}/command
  - ascolta:  gaia/device/all/command
"""
import fcntl
import glob
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import time
import threading
import urllib.request
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

# ── Singleton lock ────────────────────────────────────────────────────
_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCK_FILE = os.path.join(_DIR, "local_agent.lock")
_lock_fh = None

def _acquire_lock():
    global _lock_fh
    _lock_fh = open(_LOCK_FILE, "w")
    try:
        fcntl.flock(_lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fh.write(str(os.getpid()))
        _lock_fh.flush()
    except OSError:
        print("[Agent] Un'altra istanza è già in esecuzione. Uscita.")
        sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────
CONFIG_FILE = os.path.join(_DIR, "local_agent_config.json")

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
HEARTBEAT_INTERVAL = 30

_DEFAULT_CFG = {
    "device_id": f"minipc-{socket.gethostname()}",
    "stanza":    "minipc-test",
    "name":      "MiniPC (test locale)",
    "services": {k: {"enabled": False} for k in ("yolo", "mediapipe")},
}

# ── Mappa servizi → comando da eseguire ──────────────────────────────
# Ogni servizio è un processo Python locale.
# env_extra: variabili aggiuntive oltre a quelle di sistema + stanza.
_SERVICE_DEFS = {
    "yolo": {
        "cmd": [
            "/media/core/D/gaia-vision/venv/bin/python3",
            "/media/core/D/gaia-vision/main.py",
        ],
        "cwd": "/media/core/D/gaia-vision",
        "env_extra": {"HEADLESS": "1"},
        # Directory OTA: i file scaricati vengono salvati qui
        "ota_dir": "/media/core/D/gaia-vision",
    },
    "mediapipe": {
        "cmd": [
            # venv Python 3.11 — non importa sounddevice/PortAudio a livello modulo
            # Il venv Python 3.14 (/media/core/D/venv) include mediapipe.tasks.audio
            # che inizializza PortAudio all'import e crasha senza sessione utente.
            "/media/core/D/mediapipe-vision/venv/bin/python3",
            "/home/core/core-node-0/pi/mediapipe/mediapipe_node.py",
        ],
        "cwd": "/home/core/core-node-0/pi/mediapipe",
        # XDG_RUNTIME_DIR: mediapipe importa sounddevice→PortAudio→PulseAudio;
        # senza il socket utente (/run/user/1000/pulse) l'import crasha nel
        # contesto systemd. Con la variabile l'import va a buon fine.
        # Il resto (MAX_FACES..POSE_MODEL_PATH) alza il minipc a "full" +
        # multi-persona (2), lasciando i Pi al default legacy (1 persona) —
        # decisione 2026-07-04, vedi pi/mediapipe/README.md.
        "env_extra": {
            "HEADLESS": "1", "XDG_RUNTIME_DIR": "/run/user/1000",
            "MAX_FACES": "2", "MAX_HANDS": "4", "POSE_COMPLEXITY": "2",
            "MULTI_PERSON": "1", "MAX_POSES": "2",
            "POSE_MODEL_PATH": "/media/core/D/mediapipe-vision/models/pose_landmarker_full.task",
        },
        "ota_dir": "/home/core/core-node-0/pi/mediapipe",
    },
    "scene": {
        # Scene worker VLM (F5 gaia-semantico): descrive le stanze via moondream
        "cmd": [
            "/media/core/D/venv/bin/python3",
            "/home/core/core-node-0/minipc/script/scene_worker.py",
        ],
        "cwd": "/home/core/core-node-0/minipc/script",
        "env_extra": {"SCENE_INTERVAL": "900"},
        "ota_dir": "/home/core/core-node-0/minipc/script",
    },
}

# ── Stato globale ─────────────────────────────────────────────────────
_running      = True
_cfg          = {}
_cfg_lock     = threading.Lock()
_procs: dict  = {}   # key → subprocess.Popen | None
_procs_lock   = threading.Lock()


# ── Config persistence ────────────────────────────────────────────────
def load_config() -> dict:
    base = {k: v for k, v in _DEFAULT_CFG.items()}
    if os.path.exists(CONFIG_FILE):
        saved = json.load(open(CONFIG_FILE))
        base.update({k: saved[k] for k in ("device_id","stanza","name","updated") if k in saved})
        # Mantieni solo i servizi che l'agent conosce (ignora "voice" e altri extra)
        for svc in _SERVICE_DEFS:
            if svc in saved.get("services", {}):
                base["services"][svc] = saved["services"][svc]
    else:
        save_config(base.copy())
    return base


def save_config(cfg: dict):
    cfg["updated"] = datetime.now(timezone.utc).isoformat()
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


# ── Capabilities ─────────────────────────────────────────────────────


def _service_endpoints(key: str, stanza: str, ip: str) -> dict:
    """Dove consumare ogni servizio — la parte 'semantica' del profilo
    (docs/gaia-semantico.md, contratto 1). Chi legge il profilo scopre gli
    endpoint senza hardcodare IP o topic."""
    if key == "camera":
        return {"mjpeg": f"http://{ip}:8766/video"}
    if key == "voice":
        return {"tts": f"gaia/voice/tts/{stanza}",
                "command": f"gaia/voice/command/{stanza}",
                "stats": f"gaia/voice/stats/{stanza}"}
    if key == "mediapipe":
        return {"pose": "gaia/mediapipe/pose"}
    if key == "yolo":
        return {"frame": f"gaia/{stanza}/frame",
                "snapshot": f"gaia/{stanza}/snapshot"}
    return {}


def detect_capabilities() -> dict:
    caps = {}
    caps["camera"] = len(glob.glob("/dev/video*")) > 0
    caps["mic"] = False
    try:
        r = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=5)
        caps["mic"] = "card" in r.stdout
    except Exception:
        pass
    # F4 gaia-semantico: capability estese → il Core suggerisce i moduli
    caps["audio_out"] = False
    try:
        r = subprocess.run(["aplay", "-l"], capture_output=True, text=True, timeout=5)
        caps["audio_out"] = "card" in r.stdout
    except Exception:
        pass
    caps["display"] = False
    try:
        for st in glob.glob("/sys/class/drm/*/status"):
            if open(st).read().strip() == "connected":
                caps["display"] = True
                break
    except Exception:
        pass
    caps["midi"] = sorted(os.path.basename(p) for p in glob.glob("/dev/snd/midi*") + glob.glob("/dev/midi*"))
    caps["i2c"] = len(glob.glob("/dev/i2c-*")) > 0
    return caps


# ── Process management ────────────────────────────────────────────────
def _build_env(extra: dict) -> dict:
    """Ambiente per il sottoprocesso: sistema + stanza + extra."""
    env = os.environ.copy()
    with _cfg_lock:
        stanza = _cfg.get("stanza", "minipc-test")
        device_id = _cfg.get("device_id", "minipc-test")
    env["CAMERA_NAME"] = stanza
    env["DEVICE_ID"]   = device_id
    env["MQTT_HOST"]   = MQTT_HOST
    env["MQTT_PORT"]   = str(MQTT_PORT)
    env.update(extra)
    return env


def _is_running(key: str) -> bool:
    with _procs_lock:
        p = _procs.get(key)
        return p is not None and p.poll() is None


def _svc_status(key: str) -> str:
    if key not in _SERVICE_DEFS:
        return "unknown"
    return "active" if _is_running(key) else "inactive"


def _start_service(key: str) -> bool:
    if _is_running(key):
        return True
    defn = _SERVICE_DEFS.get(key)
    if not defn:
        print(f"[Agent] Servizio sconosciuto: {key}")
        return False
    env  = _build_env(defn.get("env_extra", {}))
    cwd  = defn.get("cwd")
    cmd  = defn["cmd"]
    # Verifica che il file principale esista
    script = cmd[1] if len(cmd) > 1 else cmd[0]
    if not os.path.exists(script):
        print(f"[Agent] File non trovato: {script}")
        return False
    print(f"[Agent] Avvio {key}: {' '.join(cmd)}")
    with _procs_lock:
        _procs[key] = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
    # Thread per scaricare stdout senza bloccarsi
    def drain(p, svc):
        for line in p.stdout:
            print(f"[{svc}] {line.decode(errors='replace').rstrip()}")
    threading.Thread(target=drain, args=(_procs[key], key), daemon=True).start()
    return True


def _stop_service(key: str) -> bool:
    with _procs_lock:
        p = _procs.get(key)
        if p is None or p.poll() is not None:
            _procs[key] = None
            return True
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
        _procs[key] = None
    print(f"[Agent] Fermato: {key}")
    return True


def _restart_service(key: str) -> bool:
    _stop_service(key)
    time.sleep(0.5)
    return _start_service(key)


# ── MQTT ──────────────────────────────────────────────────────────────
_mqtt = None   # inizializzato in main()


def _publish_status():
    with _cfg_lock:
        device_id = _cfg.get("device_id")
        stanza    = _cfg.get("stanza")
        name      = _cfg.get("name", stanza)
        svc_cfg   = _cfg.get("services", {})

    services = {k: _svc_status(k) for k in _SERVICE_DEFS}

    payload = {
        "device_id":    device_id,
        "name":         name,
        "stanza":       stanza,
        "ip":           _get_ip(),
        "capabilities": detect_capabilities(),
        "services":     services,
        "config":       svc_cfg,
        "uptime":       _get_uptime(),
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(
        f"gaia/device/{device_id}/status",
        json.dumps(payload),
        retain=True
    )
    _publish_profile(payload)


def _publish_profile(status_payload: dict):
    """Profilo semantico retained (docs/gaia-semantico.md). Il miniPC oggi è
    Core+OPS insieme: role 'core' (i servizi visione qui sono di test)."""
    device_id = status_payload.get("device_id")
    stanza    = status_payload.get("stanza", "")
    ip        = status_payload.get("ip", "")
    services = {}
    for key in _SERVICE_DEFS:
        services[key] = {
            "state": _svc_status(key),
            "endpoints": _service_endpoints(key, stanza, ip),
        }
    # La camera del miniPC gira sotto systemd (gaia-camera), non sotto questo
    # agent: senza questa entry il profilo non dichiara l'MJPEG e salotto
    # resta invisibile a cameras.html e allo scene worker.
    try:
        r = subprocess.run(["systemctl", "is-active", "gaia-camera"],
                           capture_output=True, text=True, timeout=5)
        services["camera"] = {
            "state": r.stdout.strip(),
            "endpoints": _service_endpoints("camera", stanza, ip),
        }
    except Exception:
        pass
    profile = {
        "device_id":    device_id,
        "role":         "core",
        "room":         stanza,
        "ip":           ip,
        "capabilities": status_payload.get("capabilities", {}),
        "services":     services,
        "sw_version":   "1.0.2",
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(f"gaia/devices/{device_id}/profile",
                  json.dumps(profile), retain=True)


def _on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        with _cfg_lock:
            device_id = _cfg.get("device_id")
        client.subscribe(f"gaia/device/{device_id}/command")
        client.subscribe("gaia/device/all/command")
        print(f"[MQTT] Connesso — device_id: {device_id}")
        _publish_status()
    else:
        print(f"[MQTT] Connessione fallita rc={reason_code}")


def _on_message(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        threading.Thread(target=_handle_command, args=(cmd,), daemon=True).start()
    except Exception as e:
        print(f"[MQTT] Errore parsing: {e}")


def _handle_command(cmd: dict):
    action  = cmd.get("action", "")
    service = cmd.get("service", "")
    print(f"[Agent] Comando: {cmd}")

    if action == "enable" and service:
        ok = _start_service(service)
        if ok:
            with _cfg_lock:
                _cfg.setdefault("services", {}).setdefault(service, {})["enabled"] = True
            save_config(_cfg)

    elif action == "disable" and service:
        _stop_service(service)
        with _cfg_lock:
            _cfg.setdefault("services", {}).setdefault(service, {})["enabled"] = False
        save_config(_cfg)

    elif action == "restart" and service:
        _restart_service(service)

    elif action == "set_config":
        stanza_changed = False
        with _cfg_lock:
            if "stanza" in cmd:
                if cmd["stanza"] != _cfg.get("stanza"):
                    _cfg["stanza"] = cmd["stanza"]
                    stanza_changed = True
            if "name" in cmd:
                _cfg["name"] = cmd["name"]
            if "services" in cmd:
                for svc, val in cmd["services"].items():
                    enabled = val if isinstance(val, bool) else val.get("enabled", False)
                    _cfg.setdefault("services", {}).setdefault(svc, {})["enabled"] = enabled
                    if enabled:
                        _start_service(svc)
                    else:
                        _stop_service(svc)
        save_config(_cfg)
        if stanza_changed:
            # Riavvia i servizi attivi con il nuovo CAMERA_NAME
            for key in list(_SERVICE_DEFS.keys()):
                if _is_running(key):
                    print(f"[Agent] Riavvio {key} per cambio stanza")
                    _restart_service(key)

    elif action == "status":
        pass   # risponde sotto

    elif action == "ota_update":
        threading.Thread(
            target=_ota_update,
            args=(service, cmd.get("url",""), cmd.get("md5",""), cmd.get("filename","")),
            daemon=True
        ).start()
        return

    else:
        print(f"[Agent] Azione sconosciuta: {action}")

    _publish_status()


def _ota_update(service_key: str, url: str, md5_expected: str, filename: str):
    defn = _SERVICE_DEFS.get(service_key)
    if not defn or not url:
        print("[OTA] Parametri mancanti")
        _publish_status()
        return

    fname = filename or url.split("/")[-1]
    dest  = os.path.join(defn["ota_dir"], fname)
    tmp   = dest + ".ota_tmp"

    print(f"[OTA] Download {url} → {dest}")
    try:
        urllib.request.urlretrieve(url, tmp)
        if md5_expected:
            with open(tmp, "rb") as f:
                actual = hashlib.md5(f.read()).hexdigest()
            if actual != md5_expected:
                print(f"[OTA] MD5 mismatch: {actual} != {md5_expected}")
                os.remove(tmp)
                _publish_status()
                return
        os.replace(tmp, dest)
        print(f"[OTA] ✓ {dest}")
        _restart_service(service_key)
    except Exception as e:
        print(f"[OTA] Errore: {e}")
        if os.path.exists(tmp):
            os.remove(tmp)

    _publish_status()


# ── Apply initial config ──────────────────────────────────────────────
def apply_initial_config():
    with _cfg_lock:
        services = _cfg.get("services", {})
    for svc, scfg in services.items():
        if scfg.get("enabled"):
            print(f"[Agent] Avvio iniziale: {svc}")
            _start_service(svc)


# ── Helpers ───────────────────────────────────────────────────────────
def _get_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "?"


def _get_uptime() -> int:
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return 0


def _handle_signal(sig, frame):
    global _running
    _running = False
    print("\n[Agent] Shutdown — fermo i servizi...")
    for key in list(_SERVICE_DEFS.keys()):
        if _is_running(key):
            _stop_service(key)


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)


# ── Main ──────────────────────────────────────────────────────────────
def main():
    global _cfg, _mqtt

    _acquire_lock()
    _cfg  = load_config()
    print(f"[GAIA Local Agent] device_id : {_cfg['device_id']}")
    print(f"[GAIA Local Agent] stanza    : {_cfg['stanza']}")
    print(f"[GAIA Local Agent] MQTT      : {MQTT_HOST}:{MQTT_PORT}")
    print(f"[GAIA Local Agent] Servizi   : {list(_SERVICE_DEFS.keys())}")

    apply_initial_config()

    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-local-agent-{_cfg['device_id']}")
    _mqtt.on_connect = _on_connect
    _mqtt.on_message = _on_message
    _mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
    _mqtt.loop_start()

    last_hb = 0
    while _running:
        if time.time() - last_hb >= HEARTBEAT_INTERVAL:
            _publish_status()
            last_hb = time.time()
        time.sleep(1)

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA Local Agent] Terminato.")


if __name__ == "__main__":
    main()
