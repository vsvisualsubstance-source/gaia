#!/usr/bin/env python3
"""
GAIA OPS Agent — porting Windows del pattern subprocess di
minipc/local_agent.py (Missione 4 in ops/CLAUDE.md).

Gestisce processi locali (subprocess) invece di systemctl (che non esiste su
Windows). Stessa interfaccia MQTT di pi/agent/agent.py:
  - pubblica: gaia/device/{id}/status  (heartbeat ogni 30s, retain=True, role="ops")
  - ascolta:  gaia/device/{id}/command
  - ascolta:  gaia/device/all/command

Le definizioni dei servizi vengono da services.json (manifest locale, non
hardcoded come in local_agent.py) — vedi quel file per cmd/cwd/env_extra.
"""
import json
import msvcrt
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import hashlib
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

# La console Windows di default usa la codepage locale (es. cp1252) per
# stdout quando non e' una tty (redirect su file) — i log dei sottoprocessi
# (accenti, frecce) mandano in crash print() con UnicodeEncodeError.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Singleton lock (msvcrt invece di fcntl — non esiste su Windows) ──────────
_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCK_FILE = os.path.join(_DIR, "agent.lock")
_lock_fh = None


def _acquire_lock():
    global _lock_fh
    _lock_fh = open(_LOCK_FILE, "w+")
    try:
        msvcrt.locking(_lock_fh.fileno(), msvcrt.LK_NBLCK, 1)
        _lock_fh.write(str(os.getpid()))
        _lock_fh.flush()
    except OSError:
        print("[Agent] Un'altra istanza è già in esecuzione. Uscita.")
        sys.exit(1)


# ── Manifest servizi ──────────────────────────────────────────────────────
MANIFEST_FILE = os.path.join(_DIR, "services.json")
with open(MANIFEST_FILE, encoding="utf-8") as f:
    _manifest = json.load(f)

MACHINE_ROLE     = _manifest.get("machine_role", "ops")
_SERVICE_DEFS    = _manifest["services"]
CAMERA_CONSUMERS = tuple(_manifest.get("camera_consumers", []))

CONFIG_FILE = os.path.join(_DIR, "agent_config.json")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
HEARTBEAT_INTERVAL = 30

_DEFAULT_CFG = {
    "device_id": _manifest.get("device_id", f"ops-{socket.gethostname()}"),
    "stanza":    _manifest.get("stanza", "unknown"),
    "name":      _manifest.get("stanza", "unknown"),
    "services":  {k: {"enabled": False} for k in _SERVICE_DEFS if k != "camera"},
}

# ── Stato globale ─────────────────────────────────────────────────────
_running    = True
_cfg        = {}
# RLock, non Lock: _sync_camera (che chiama _start_service -> _build_env,
# che rilegge _cfg) viene invocato da dentro un "with _cfg_lock" gia' preso
# in enable/disable/set_config — con un Lock semplice e' un deadlock certo
# (thread che aspetta un lock che tiene gia' lui stesso).
_cfg_lock   = threading.RLock()
_procs: dict = {}
_procs_lock = threading.Lock()
_start_ts   = time.monotonic()


# ── Config persistence ────────────────────────────────────────────────
def load_config() -> dict:
    base = {k: v for k, v in _DEFAULT_CFG.items()}
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        base.update({k: saved[k] for k in ("device_id", "stanza", "name", "updated") if k in saved})
        for svc in _SERVICE_DEFS:
            if svc == "camera":
                continue
            if svc in saved.get("services", {}):
                base["services"][svc] = saved["services"][svc]
    else:
        save_config(base.copy())
    return base


def save_config(cfg: dict):
    cfg["updated"] = datetime.now(timezone.utc).isoformat()
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def detect_capabilities() -> dict:
    # Questa macchina (silvermini2) ha sempre camera+mic — niente equivalente
    # Windows comodo di /dev/video*/arecord per rilevarli dinamicamente.
    return {"camera": True, "mic": True}


# ── Process management ────────────────────────────────────────────────
def _build_env(extra: dict) -> dict:
    env = os.environ.copy()
    with _cfg_lock:
        stanza    = _cfg.get("stanza", "unknown")
        device_id = _cfg.get("device_id", "unknown")
    env["CAMERA_NAME"] = stanza
    env["NODE_ID"]     = stanza
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
    env = _build_env(defn.get("env_extra", {}))
    cwd = defn.get("cwd")
    cmd = defn["cmd"]
    script = os.path.join(cwd, cmd[-1]) if cwd else cmd[-1]
    if not os.path.exists(script):
        print(f"[Agent] File non trovato: {script}")
        return False
    print(f"[Agent] Avvio {key}: {' '.join(cmd)}")
    # CREATE_NO_WINDOW: senza, ogni sottoprocesso apre/condivide una console
    # visibile — chiuderla per errore (es. pensando fosse un singolo
    # servizio) manda un evento di chiusura a TUTTO l'albero di processi
    # (visto in produzione: chiusa una finestra "camera", morti anche
    # yolo/mediapipe/voice insieme). Con questo flag non c'e' nessuna
    # finestra da chiudere per sbaglio.
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    with _procs_lock:
        _procs[key] = subprocess.Popen(
            cmd, cwd=cwd, env=env, creationflags=creationflags,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
    proc = _procs[key]

    def drain(p, svc):
        for line in p.stdout:
            print(f"[{svc}] {line.decode(errors='replace').rstrip()}")
    threading.Thread(target=drain, args=(proc, key), daemon=True).start()
    return True


def _stop_service(key: str) -> bool:
    with _procs_lock:
        p = _procs.get(key)
        if p is None or p.poll() is not None:
            _procs[key] = None
            return True
        # Windows non ha SIGTERM reale: terminate() manda comunque un
        # segnale gestibile ai processi Python (CTRL_BREAK non serve qui,
        # terminate() basta per i nostri script — nessun cleanup complesso
        # oltre a chiudere socket/stream, gia' gestito nei finally).
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


# ── Camera come dipendenza ref-contata di yolo/mediapipe ──────────────
# Stessa logica di pi/agent/agent.py (CAMERA_CONSUMERS/_sync_camera): la
# webcam e' esclusiva (vedi ops/memory/ops-test-risultati.md), quindi non va
# mai abilitata/disabilitata direttamente ma solo come effetto collaterale di
# yolo/mediapipe che ne hanno bisogno.
def _camera_consumers_active(services_cfg: dict) -> int:
    return sum(1 for k in CAMERA_CONSUMERS if services_cfg.get(k, {}).get("enabled", False))


def _sync_camera(services_cfg: dict):
    if "camera" not in _SERVICE_DEFS:
        return
    need = _camera_consumers_active(services_cfg) > 0
    running = _is_running("camera")
    if need and not running:
        _start_service("camera")
    elif not need and running:
        _stop_service("camera")


# ── MQTT ──────────────────────────────────────────────────────────────
_mqtt = None


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
        "role":         MACHINE_ROLE,
        "ip":           _get_ip(),
        "capabilities": detect_capabilities(),
        "services":     services,
        "config":       svc_cfg,
        "uptime":       _get_uptime(),
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(f"gaia/device/{device_id}/status", json.dumps(payload), retain=True)


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
        threading.Thread(target=_safe_handle_command, args=(cmd,), daemon=True).start()
    except Exception as e:
        print(f"[MQTT] Errore parsing: {e}")


def _safe_handle_command(cmd: dict):
    try:
        _handle_command(cmd)
    except Exception as e:
        print(f"[Agent] Errore gestendo comando {cmd}: {e}")


def _handle_command(cmd: dict):
    action  = cmd.get("action", "")
    service = cmd.get("service", "")
    print(f"[Agent] Comando: {cmd}")

    if action == "enable" and service:
        ok = _start_service(service)
        if ok:
            with _cfg_lock:
                _cfg.setdefault("services", {}).setdefault(service, {})["enabled"] = True
                if service in CAMERA_CONSUMERS:
                    _sync_camera(_cfg["services"])
            save_config(_cfg)

    elif action == "disable" and service:
        _stop_service(service)
        with _cfg_lock:
            _cfg.setdefault("services", {}).setdefault(service, {})["enabled"] = False
            if service in CAMERA_CONSUMERS:
                _sync_camera(_cfg["services"])
        save_config(_cfg)

    elif action == "restart" and service:
        _restart_service(service)

    elif action == "set_config":
        stanza_changed = False
        with _cfg_lock:
            if "stanza" in cmd and cmd["stanza"] != _cfg.get("stanza"):
                _cfg["stanza"] = cmd["stanza"]
                stanza_changed = True
            if "name" in cmd:
                _cfg["name"] = cmd["name"]
            if "services" in cmd:
                for svc, val in cmd["services"].items():
                    if svc == "camera":
                        continue  # gestita solo via ref-count, mai a mano
                    enabled = val if isinstance(val, bool) else val.get("enabled", False)
                    _cfg.setdefault("services", {}).setdefault(svc, {})["enabled"] = enabled
                    if enabled:
                        _start_service(svc)
                    else:
                        _stop_service(svc)
                _sync_camera(_cfg["services"])
        save_config(_cfg)
        if stanza_changed:
            for key in list(_SERVICE_DEFS.keys()):
                if _is_running(key):
                    print(f"[Agent] Riavvio {key} per cambio stanza")
                    _restart_service(key)

    elif action == "status":
        pass

    elif action == "ota_update":
        threading.Thread(
            target=_ota_update,
            args=(service, cmd.get("url", ""), cmd.get("md5", ""), cmd.get("filename", "")),
            daemon=True
        ).start()
        return

    elif action == "reboot":
        print("[Agent] Reboot richiesto via MQTT — non eseguito automaticamente su "
              "questa macchina (silvermini2 non e' un Pi headless): ignorato.")
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
    dest  = os.path.join(defn["cwd"], fname)
    tmp   = dest + ".ota_tmp"

    print(f"[OTA] Download {url} -> {dest}")
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
        print(f"[OTA] OK {dest}")
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
    _sync_camera(services)


# ── Helpers ───────────────────────────────────────────────────────────
def _get_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "?"


def _get_uptime() -> int:
    # Niente /proc/uptime su Windows: uptime del processo agent stesso
    # (non del sistema operativo) — sufficiente per il pannello Pi Manager,
    # che lo usa solo come indicatore "da quanto e' vivo il device".
    return int(time.monotonic() - _start_ts)


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
    _cfg = load_config()
    print(f"[GAIA OPS Agent] device_id : {_cfg['device_id']}")
    print(f"[GAIA OPS Agent] stanza    : {_cfg['stanza']}")
    print(f"[GAIA OPS Agent] role      : {MACHINE_ROLE}")
    print(f"[GAIA OPS Agent] MQTT      : {MQTT_HOST}:{MQTT_PORT}")
    print(f"[GAIA OPS Agent] Servizi   : {list(_SERVICE_DEFS.keys())}")

    apply_initial_config()

    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-ops-agent-{_cfg['device_id']}")
    _mqtt.on_connect = _on_connect
    _mqtt.on_message = _on_message

    # AtLogOn può scattare prima che la rete/Tailscale sia pronta a
    # raggiungere il Core: niente retry qui = crash del processo intero
    # (visto il 2026-07-09, servizi già avviati restati orfani). Riprova
    # con backoff invece di morire al primo tentativo fallito.
    backoff = 5
    while _running:
        try:
            _mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
            break
        except OSError as e:
            print(f"[GAIA OPS Agent] Connessione MQTT fallita ({e}), riprovo tra {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
    if not _running:
        return
    _mqtt.loop_start()

    last_hb = 0
    while _running:
        if time.time() - last_hb >= HEARTBEAT_INTERVAL:
            _publish_status()
            last_hb = time.time()
        time.sleep(1)

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA OPS Agent] Terminato.")


if __name__ == "__main__":
    main()
