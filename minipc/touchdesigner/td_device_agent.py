#!/usr/bin/env python3
"""
GAIA TD Device Agent — fa comparire un'istanza TouchDesigner in Pi Manager
(web/admin.html) come un device a se' stante, con un servizio "project"
avviabile/fermabile/riavviabile da remoto — stesso protocollo MQTT di
pi/agent/agent.py e ops/agent/agent.py:
  - pubblica: gaia/device/{device_id}/status  (heartbeat 30s, retain=True, role="touchdesigner")
  - ascolta:  gaia/device/{device_id}/command
  - ascolta:  gaia/device/all/command

A differenza di ops/agent (N servizi Python headless da un manifest
condiviso), qui il "servizio" e' uno solo: il processo TouchDesigner.exe
con il .toe di questa istanza. Un manifest per istanza (td_instance.json,
vedi td_instance.json.example) = una card separata in Admin — cosi' piu'
progetti TD sulla stessa o su macchine diverse compaiono ognuno per conto
suo, non ammucchiati dentro la card ops-silvermini2.

GOTCHA TD non autosalva: enable/restart lanciano TouchDesigner.exe pulito,
ma restart/disable terminano il processo senza salvare — chi preme quei
bottoni in Admin sta chiudendo TD come un Alt+F4, non con un salvataggio
di cortesia. Nessuna conferma qui: e' una scelta dell'operatore in Admin,
non del codice.

LIMITE noto: "project" risulta "active" solo se e' STATO avviato da questo
agent (tracciato via subprocess.Popen, stesso limite di ops/agent per
kiosk/Edge) — un TD lanciato a mano prima di avviare l'agent non viene
rilevato finche' non lo si riavvia passando da qui.
"""
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

if os.name == "nt":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Manifest istanza ──────────────────────────────────────────────────
MANIFEST_FILE = os.getenv("TD_AGENT_MANIFEST", os.path.join(_DIR, "td_instance.json"))
with open(MANIFEST_FILE, encoding="utf-8") as f:
    _manifest = json.load(f)

DEVICE_ID = _manifest["device_id"]
STANZA    = _manifest.get("stanza", "unknown")
NAME      = _manifest.get("name", DEVICE_ID)
TD_EXE    = _manifest["td_exe"]
PROJECT   = _manifest["project"]
EXTRA_ARGS = _manifest.get("args", [])

CONFIG_FILE = os.path.join(_DIR, f"td_agent_state_{DEVICE_ID}.json")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
HEARTBEAT_INTERVAL = 30

# ── Singleton lock (per device_id: piu' istanze sulla stessa macchina
# usano manifest diversi e non devono bloccarsi a vicenda) ─────────────
_LOCK_FILE = os.path.join(_DIR, f"td_agent_{DEVICE_ID}.lock")
_lock_fh = None


def _acquire_lock():
    global _lock_fh
    _lock_fh = open(_LOCK_FILE, "w+")
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(_lock_fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(_lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fh.write(str(os.getpid()))
        _lock_fh.flush()
    except OSError:
        print(f"[TD Agent] Un'altra istanza per {DEVICE_ID} e' gia' in esecuzione. Uscita.")
        sys.exit(1)


# ── Stato / config persistita (solo "enabled": auto-avvio al boot dell'agent) ──
def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    cfg = {"enabled": False}
    save_config(cfg)
    return cfg


def save_config(cfg: dict):
    cfg["updated"] = datetime.now(timezone.utc).isoformat()
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


_cfg = {}
_cfg_lock = threading.Lock()
_proc = None
_proc_lock = threading.Lock()
_start_ts = time.monotonic()
_running = True


# ── Process management (unico servizio: "project") ─────────────────────
def _is_running() -> bool:
    with _proc_lock:
        return _proc is not None and _proc.poll() is None


def _svc_status() -> str:
    return "active" if _is_running() else "inactive"


def _start_project() -> bool:
    global _proc
    if _is_running():
        return True
    if not os.path.exists(PROJECT):
        print(f"[TD Agent] Progetto non trovato: {PROJECT}")
        return False
    cmd = [TD_EXE, PROJECT] + EXTRA_ARGS
    print(f"[TD Agent] Avvio TouchDesigner: {' '.join(cmd)}")
    # NIENTE CREATE_NO_WINDOW: a differenza dei servizi headless (yolo,
    # mediapipe...) TD e' lo strato visivo/creativo — la finestra DEVE
    # comparire, e' il motivo per cui esiste.
    with _proc_lock:
        _proc = subprocess.Popen(cmd)
    return True


def _stop_project() -> bool:
    global _proc
    with _proc_lock:
        if _proc is None or _proc.poll() is not None:
            _proc = None
            return True
        _proc.terminate()
        try:
            _proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _proc.kill()
        _proc = None
    print(f"[TD Agent] Fermato: {DEVICE_ID}")
    return True


def _restart_project() -> bool:
    _stop_project()
    time.sleep(1)
    return _start_project()


# ── MQTT ─────────────────────────────────────────────────────────────
_mqtt = None


def _get_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "?"


def _get_uptime() -> int:
    return int(time.monotonic() - _start_ts)


def _publish_status():
    payload = {
        "device_id":    DEVICE_ID,
        "name":         NAME,
        "stanza":       STANZA,
        "role":         "touchdesigner",
        "ip":           _get_ip(),
        "capabilities": {"display": True},
        "services":     {"project": _svc_status()},
        "config":       {"project": {"enabled": _cfg.get("enabled", False)}},
        "uptime":       _get_uptime(),
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(f"gaia/device/{DEVICE_ID}/status", json.dumps(payload), retain=True)


def _on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        client.subscribe(f"gaia/device/{DEVICE_ID}/command")
        client.subscribe("gaia/device/all/command")
        print(f"[TD Agent] Connesso — device_id: {DEVICE_ID}")
        _publish_status()
    else:
        print(f"[TD Agent] Connessione MQTT fallita rc={reason_code}")


def _on_disconnect(client, userdata, rc, properties=None):
    if rc != 0:
        print(f"[TD Agent] Disconnesso (rc={rc})")


def _on_message(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
        threading.Thread(target=_safe_handle_command, args=(cmd,), daemon=True).start()
    except Exception as e:
        print(f"[TD Agent] Errore parsing comando: {e}")


def _safe_handle_command(cmd: dict):
    try:
        _handle_command(cmd)
    except Exception as e:
        print(f"[TD Agent] Errore gestendo comando {cmd}: {e}")


def _handle_command(cmd: dict):
    action  = cmd.get("action", "")
    service = cmd.get("service", "")
    # service e' sempre "project" qui, ma un comando broadcast
    # (gaia/device/all/command) o generico senza "service" va comunque
    # gestito: e' l'unico servizio che questo agent conosce.
    if service and service != "project":
        return
    print(f"[TD Agent] Comando: {cmd}")

    if action == "enable":
        ok = _start_project()
        if ok:
            with _cfg_lock:
                _cfg["enabled"] = True
                save_config(_cfg)

    elif action == "disable":
        _stop_project()
        with _cfg_lock:
            _cfg["enabled"] = False
            save_config(_cfg)

    elif action == "restart":
        _restart_project()

    elif action == "status":
        pass

    else:
        print(f"[TD Agent] Azione sconosciuta o non applicabile: {action}")

    _publish_status()


def _handle_signal(sig, frame):
    global _running
    _running = False
    print("\n[TD Agent] Shutdown — non fermo TouchDesigner (resta come lasciato dall'operatore).")


signal.signal(signal.SIGINT, _handle_signal)
if hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, _handle_signal)


def main():
    global _cfg, _mqtt

    _acquire_lock()
    _cfg = load_config()
    print(f"[TD Agent] device_id : {DEVICE_ID}")
    print(f"[TD Agent] stanza    : {STANZA}")
    print(f"[TD Agent] progetto  : {PROJECT}")
    print(f"[TD Agent] MQTT      : {MQTT_HOST}:{MQTT_PORT}")

    if _cfg.get("enabled"):
        print("[TD Agent] Avvio iniziale (enabled=true nello stato salvato)")
        _start_project()

    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-td-agent-{DEVICE_ID}")
    _mqtt.on_connect    = _on_connect
    _mqtt.on_disconnect = _on_disconnect
    _mqtt.on_message    = _on_message

    backoff = 5
    while _running:
        try:
            _mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
            break
        except OSError as e:
            print(f"[TD Agent] Connessione MQTT fallita ({e}), riprovo tra {backoff}s")
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
    print("[TD Agent] Terminato.")


if __name__ == "__main__":
    main()
