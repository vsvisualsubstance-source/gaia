#!/usr/bin/env python3
"""
GAIA Agent — daemon di controllo servizi per Raspberry Pi

Responsabilità:
  - Legge device.json all'avvio e porta i servizi allo stato configurato
  - Ascolta comandi MQTT per abilitare/disabilitare/riavviare servizi
  - Pubblica heartbeat ogni HEARTBEAT_INTERVAL secondi
  - Gestisce OTA per aggiornamenti file singoli
  - Auto-rileva periferiche (camera, microfono)
"""
import glob
import hashlib
import json
import os
import signal
import subprocess
import time
import threading
import urllib.request
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import config


# ──────────────────────────────────────────────────────────────────────
# Stato globale
# ──────────────────────────────────────────────────────────────────────
_running       = True
_device_config = {}
_capabilities  = {}
_config_lock   = threading.Lock()


def _handle_signal(sig, frame):
    global _running
    _running = False
    print("\n[Agent] Shutdown...")


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)


# ──────────────────────────────────────────────────────────────────────
# device.json
# ──────────────────────────────────────────────────────────────────────
_DEFAULT_CONFIG = {
    "device_id": config.DEVICE_ID,
    "stanza":    config.DEFAULT_STANZA,
    "services": {
        "yolo":      {"enabled": False},
        "mediapipe": {"enabled": False},
        "voice":     {"enabled": False},
    }
}


def load_config() -> dict:
    if os.path.exists(config.DEVICE_JSON):
        with open(config.DEVICE_JSON) as f:
            return json.load(f)
    cfg = _DEFAULT_CONFIG.copy()
    save_config(cfg)
    return cfg


def save_config(cfg: dict):
    cfg["updated"] = datetime.now(timezone.utc).isoformat()
    with _config_lock:
        with open(config.DEVICE_JSON, "w") as f:
            json.dump(cfg, f, indent=2)


def _write_device_env(cfg: dict):
    """Scrive /etc/gaia/device.conf — letto dai servizi come EnvironmentFile."""
    stanza = cfg.get("stanza", config.DEFAULT_STANZA)
    lines = [
        f"CAMERA_NAME={stanza}",
        f"MQTT_HOST={config.MQTT_HOST}",
        f"MQTT_PORT={config.MQTT_PORT}",
        f"DEVICE_ID={config.DEVICE_ID}",
    ]
    os.makedirs(os.path.dirname(config.DEVICE_ENV_FILE), exist_ok=True)
    with open(config.DEVICE_ENV_FILE, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[Agent] device.conf aggiornato → CAMERA_NAME={stanza}")


# ──────────────────────────────────────────────────────────────────────
# Capability detection
# ──────────────────────────────────────────────────────────────────────
def detect_capabilities() -> dict:
    camera = len(glob.glob("/dev/video*")) > 0

    mic = False
    try:
        r = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=5)
        mic = "card" in r.stdout
    except Exception:
        pass

    return {"camera": camera, "mic": mic}


# ──────────────────────────────────────────────────────────────────────
# Service management
# ──────────────────────────────────────────────────────────────────────
def _systemctl(action: str, unit: str) -> bool:
    try:
        r = subprocess.run(
            ["sudo", "systemctl", action, unit],
            capture_output=True, timeout=15
        )
        ok = r.returncode == 0
        print(f"[Agent] systemctl {action} {unit} → {'OK' if ok else 'FAIL'}")
        return ok
    except Exception as e:
        print(f"[Agent] systemctl error: {e}")
        return False


def service_status(key: str) -> str:
    unit = config.SERVICE_MAP.get(key)
    if not unit:
        return "unknown"
    try:
        r = subprocess.run(
            ["systemctl", "is-active", unit],
            capture_output=True, text=True, timeout=5
        )
        return r.stdout.strip()   # "active" | "inactive" | "failed"
    except Exception:
        return "unknown"


def all_statuses() -> dict:
    return {k: service_status(k) for k in config.SERVICE_MAP}


# Servizi che dipendono dal frame broker condiviso (camera_server) — vedi _sync_camera
CAMERA_CONSUMERS = ("yolo", "mediapipe")


def _camera_consumer_count(cfg: dict) -> int:
    services = cfg.get("services", {})
    return sum(1 for k in CAMERA_CONSUMERS if services.get(k, {}).get("enabled", False))


def _sync_camera(cfg: dict):
    """Garantisce che gaia-camera sia attivo se e solo se almeno un consumer
    (yolo/mediapipe) lo richiede in cfg. Idempotente — può essere chiamata
    ogni volta che lo stato di un consumer cambia, senza dover tracciare
    a mano le transizioni 0→1/1→0."""
    want = _camera_consumer_count(cfg) > 0
    is_active = service_status("camera") == "active"
    if want and not is_active:
        print("[Agent] Avvio gaia-camera (richiesto da yolo/mediapipe)")
        _systemctl("start", config.SERVICE_MAP["camera"])
        time.sleep(1)   # lascia il tempo a camera_server di creare la shared memory
    elif not want and is_active:
        print("[Agent] Stop gaia-camera (nessun consumer attivo)")
        _systemctl("stop", config.SERVICE_MAP["camera"])


def enable_service(key: str, cfg: dict = None) -> bool:
    if key in CAMERA_CONSUMERS and cfg is not None:
        _sync_camera(cfg)
    unit = config.SERVICE_MAP.get(key)
    if not unit:
        return False
    return _systemctl("start", unit)


def disable_service(key: str, cfg: dict = None) -> bool:
    unit = config.SERVICE_MAP.get(key)
    if not unit:
        return False
    ok = _systemctl("stop", unit)
    if key in CAMERA_CONSUMERS and cfg is not None:
        _sync_camera(cfg)
    return ok


def restart_service(key: str) -> bool:
    unit = config.SERVICE_MAP.get(key)
    if not unit:
        return False
    return _systemctl("restart", unit)


# ──────────────────────────────────────────────────────────────────────
# MQTT
# ──────────────────────────────────────────────────────────────────────
_mqtt = mqtt.Client(client_id=f"gaia-agent-{config.DEVICE_ID}")
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


def _on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        client.subscribe(f"gaia/device/{config.DEVICE_ID}/command")
        client.subscribe("gaia/device/all/command")
        print(f"[MQTT] Connesso — device_id: {config.DEVICE_ID}")
        _publish_status()
    else:
        print(f"[MQTT] Connessione fallita rc={rc}")


def _on_disconnect(client, userdata, rc, properties=None):
    if rc != 0:
        print(f"[MQTT] Disconnesso (rc={rc})")


def _on_message(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        threading.Thread(target=_handle_command, args=(cmd,), daemon=True).start()
    except Exception as e:
        print(f"[MQTT] Errore parsing comando: {e}")


_mqtt.on_connect    = _on_connect
_mqtt.on_disconnect = _on_disconnect
_mqtt.on_message    = _on_message


def _publish_status():
    payload = {
        "device_id":    config.DEVICE_ID,
        "name":         _device_config.get("name", _device_config.get("stanza", config.DEFAULT_STANZA)),
        "stanza":       _device_config.get("stanza", config.DEFAULT_STANZA),
        "ip":           _get_ip(),
        "capabilities": _capabilities,
        "services":     all_statuses(),
        "config":       _device_config.get("services", {}),
        "uptime":       _get_uptime(),
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(
        f"gaia/device/{config.DEVICE_ID}/status",
        json.dumps(payload),
        retain=True
    )


def _get_ip() -> str:
    try:
        r = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3)
        return r.stdout.strip().split()[0]
    except Exception:
        return "?"


def _get_uptime() -> int:
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return 0


# ──────────────────────────────────────────────────────────────────────
# Command handler
# ──────────────────────────────────────────────────────────────────────
def _handle_command(cmd: dict):
    action  = cmd.get("action", "")
    service = cmd.get("service", "")

    print(f"[Agent] Comando ricevuto: {cmd}")

    if service == "camera" and action in ("enable", "disable"):
        print("[Agent] gaia-camera è gestito automaticamente da yolo/mediapipe, comando ignorato")
        _publish_status()
        return

    if action == "enable" and service:
        with _config_lock:
            _device_config.setdefault("services", {}).setdefault(service, {})["enabled"] = True
        ok = enable_service(service, _device_config)
        if ok:
            save_config(_device_config)
        else:
            with _config_lock:
                _device_config["services"][service]["enabled"] = False
            if service in CAMERA_CONSUMERS:
                _sync_camera(_device_config)

    elif action == "disable" and service:
        with _config_lock:
            _device_config.setdefault("services", {}).setdefault(service, {})["enabled"] = False
        ok = disable_service(service, _device_config)
        if ok:
            save_config(_device_config)
        else:
            with _config_lock:
                _device_config["services"][service]["enabled"] = True
            if service in CAMERA_CONSUMERS:
                _sync_camera(_device_config)

    elif action == "restart" and service:
        restart_service(service)

    elif action == "set_config":
        stanza_changed = False
        with _config_lock:
            if "stanza" in cmd:
                if cmd["stanza"] != _device_config.get("stanza"):
                    _device_config["stanza"] = cmd["stanza"]
                    stanza_changed = True
            if "name" in cmd:
                _device_config["name"] = cmd["name"]
            if "services" in cmd:
                for svc, val in cmd["services"].items():
                    enabled = val if isinstance(val, bool) else val.get("enabled", False)
                    _device_config.setdefault("services", {}).setdefault(svc, {})["enabled"] = enabled
                    if enabled:
                        enable_service(svc, _device_config)
                    else:
                        disable_service(svc, _device_config)
        save_config(_device_config)
        _write_device_env(_device_config)
        if stanza_changed:
            # Riavvia i servizi attivi so che leggano il nuovo CAMERA_NAME
            for svc, cfg in _device_config.get("services", {}).items():
                if cfg.get("enabled") and service_status(svc) == "active":
                    print(f"[Agent] Riavvio {svc} per cambio stanza")
                    restart_service(svc)

    elif action == "status":
        pass   # risponde sotto con _publish_status()

    elif action == "reboot":
        _publish_status()
        time.sleep(2)
        subprocess.run(["sudo", "reboot"])
        return

    elif action == "ota_update":
        threading.Thread(
            target=_ota_update,
            args=(cmd.get("service", ""), cmd.get("url", ""), cmd.get("md5", ""),
                  cmd.get("filename", ""), cmd.get("version", "?")),
            daemon=True
        ).start()
        return   # status verrà pubblicato al termine dell'OTA

    else:
        print(f"[Agent] Azione non riconosciuta: {action}")

    _publish_status()


# ──────────────────────────────────────────────────────────────────────
# OTA — aggiornamento file singolo
# ──────────────────────────────────────────────────────────────────────
def _ota_ack(status: str, version: str, error: str = None):
    payload = {
        "device_id": config.DEVICE_ID,
        "type":      "agent",
        "status":    status,
        "version":   version,
        "ts":        int(time.time() * 1000),
    }
    if error:
        payload["error"] = error
    _mqtt.publish(f"gaia/devices/{config.DEVICE_ID}/ota/ack", json.dumps(payload), retain=False)


def _ota_update(service_key: str, url: str, md5_expected: str, filename: str, version: str = "?"):
    target_dir = config.SERVICE_DIRS.get(service_key)
    if not target_dir or not url:
        print("[OTA] Parametri mancanti")
        _ota_ack("failed", version, "missing_params")
        return

    fname = filename or url.split("/")[-1]
    target_real = os.path.realpath(target_dir)
    dest = os.path.realpath(os.path.join(target_dir, fname))
    if not dest.startswith(target_real + os.sep):
        print(f"[OTA] Path traversal: {fname}")
        _ota_ack("failed", version, "path_traversal")
        return
    tmp = dest + ".ota_tmp"

    print(f"[OTA] Download {url} → {dest}")
    try:
        urllib.request.urlretrieve(url, tmp)

        if md5_expected:
            with open(tmp, "rb") as f:
                actual = hashlib.md5(f.read()).hexdigest()
            if actual != md5_expected:
                print(f"[OTA] MD5 mismatch: {actual} != {md5_expected}")
                os.remove(tmp)
                _ota_ack("failed", version, "md5_mismatch")
                return

        os.replace(tmp, dest)
        print(f"[OTA] ✓ Aggiornato: {dest}")

        # Riavvia il servizio aggiornato
        restart_service(service_key)
        _ota_ack("updated", version)

    except Exception as e:
        print(f"[OTA] Errore: {e}")
        if os.path.exists(tmp):
            os.remove(tmp)
        _ota_ack("failed", version, str(e))

    _publish_status()


# ──────────────────────────────────────────────────────────────────────
# Avvio iniziale — porta i servizi allo stato in device.json
# ──────────────────────────────────────────────────────────────────────
def apply_initial_config():
    _write_device_env(_device_config)   # assicura /etc/gaia/device.conf aggiornato
    _sync_camera(_device_config)        # avvia gaia-camera una sola volta se serve, prima dei consumer
    for svc, cfg in _device_config.get("services", {}).items():
        if cfg.get("enabled", False):
            print(f"[Agent] Avvio: {svc}")
            enable_service(svc, _device_config)
        else:
            disable_service(svc, _device_config)


# ──────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────
def main():
    global _device_config, _capabilities

    _device_config = load_config()
    _capabilities  = detect_capabilities()

    # Aggiorna device_id nel file se era quello di default
    if _device_config.get("device_id") in ("pi-CONFIGURA", "pi-unknown"):
        _device_config["device_id"] = config.DEVICE_ID
        save_config(_device_config)

    print(f"[GAIA Agent] device_id : {config.DEVICE_ID}")
    print(f"[GAIA Agent] stanza    : {_device_config.get('stanza')}")
    print(f"[GAIA Agent] camera    : {_capabilities.get('camera')}")
    print(f"[GAIA Agent] mic       : {_capabilities.get('mic')}")
    print(f"[GAIA Agent] MQTT      : {config.MQTT_HOST}:{config.MQTT_PORT}")

    apply_initial_config()

    _mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, 60)
    _mqtt.loop_start()

    last_heartbeat = 0
    while _running:
        now = time.time()
        if now - last_heartbeat >= config.HEARTBEAT_INTERVAL:
            _publish_status()
            last_heartbeat = now
        time.sleep(1)

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA Agent] Terminato.")


if __name__ == "__main__":
    main()
