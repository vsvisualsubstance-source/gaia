#!/usr/bin/env python3
"""
GAIA TD-Studio Agent — porting macOS del pattern subprocess di
ops/agent/agent.py (a sua volta porting Windows di minipc/local_agent.py).

Gestisce processi locali (subprocess) invece di launchd/systemctl. Stessa
interfaccia MQTT di pi/agent/agent.py e ops/agent/agent.py:
  - pubblica: gaia/device/{id}/status  (heartbeat ogni 30s, retain=True, role="tdstudio")
  - ascolta:  gaia/device/{id}/command
  - ascolta:  gaia/device/all/command

Le definizioni dei servizi vengono da services.json (manifest locale) — vedi
quel file per cmd/cwd/env_extra/conflicts. A differenza di ops/agent.py
(Windows, nessun concetto nativo di mutua esclusione tra processi gestiti
a mano) qui un servizio puo' dichiarare "conflicts": [altre chiavi] --
usato per i .toe di TouchDesigner che vanno uno alla volta (herbarium/
project2/project3): avviarne uno ferma prima gli altri elencati.
"""
from __future__ import annotations

import fcntl
import json
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
import net_resolve
import discovery

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Singleton lock (fcntl, POSIX — vale per macOS come per Linux) ───────────
_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCK_FILE = os.path.join(_DIR, "agent.lock")
_lock_fh = None


def _acquire_lock():
    global _lock_fh
    _lock_fh = open(_LOCK_FILE, "w+")
    try:
        fcntl.flock(_lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fh.write(str(os.getpid()))
        _lock_fh.flush()
    except OSError:
        print("[Agent] Un'altra istanza è già in esecuzione. Uscita.")
        sys.exit(1)


# ── Manifest servizi ──────────────────────────────────────────────────────
MANIFEST_FILE = os.path.join(_DIR, "services.json")
with open(MANIFEST_FILE, encoding="utf-8") as f:
    _manifest = json.load(f)

MACHINE_ROLE     = _manifest.get("machine_role", "tdstudio")
_SERVICE_DEFS    = _manifest["services"]
CAMERA_CONSUMERS = tuple(_manifest.get("camera_consumers", []))

CONFIG_FILE = os.path.join(_DIR, "agent_config.json")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
HEARTBEAT_INTERVAL = 30

_DEFAULT_CFG = {
    "device_id": _manifest.get("device_id", f"tdstudio-{socket.gethostname()}"),
    "stanza":    _manifest.get("stanza", "unknown"),
    "name":      _manifest.get("stanza", "unknown"),
    "services":  {k: {"enabled": False} for k in _SERVICE_DEFS if k != "camera"},
}

# ── Stato globale ─────────────────────────────────────────────────────
_running    = True
_cfg        = {}
_cfg_lock   = threading.RLock()
_procs: dict = {}
_procs_lock = threading.Lock()
# Processi orfani (istanze reali OS, non lanciate dal Popen di QUESTA
# istanza dell'agent) rilevati e adottati -- vedi _find_os_pid/_is_running.
_adopted_pids: dict = {}
_orphan_check_cache: dict = {}   # key -> (bool_alive, scaduto_a)
_ORPHAN_CHECK_TTL = 20.0
_start_ts   = time.monotonic()

# ── Watchdog ──────────────────────────────────────────────────────────
WATCHDOG_INTERVAL = 30   # secondi tra un giro e l'altro
WATCHDOG_ALERT_AFTER = 3  # notifica Telegram dopo N tentativi falliti consecutivi
_watchdog_fail_count: dict = {}


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


def _service_endpoints(key: str, stanza: str, ip: str) -> dict:
    """Dove consumare ogni servizio — la parte 'semantica' del profilo
    (docs/gaia-semantico.md, contratto 1). I .toe di TD non espongono
    endpoint propri (nessun contratto ancora definito verso Envoy/MCP
    per questa macchina), quindi il default {} vale per tutti."""
    return {}


def detect_capabilities() -> dict:
    """Capability della macchina (F4 gaia-semantico)."""
    global _caps_cache
    if _caps_cache is not None:
        return _caps_cache
    caps = {"camera": False, "mic": False, "audio_out": True,
            "display": True, "midi": [], "i2c": False}
    try:
        import sounddevice as sd
        devs = sd.query_devices()
        caps["mic"] = any(d.get("max_input_channels", 0) > 0 for d in devs)
        caps["audio_out"] = any(d.get("max_output_channels", 0) > 0 for d in devs)
    except Exception:
        pass
    try:
        caps["camera"] = _svc_status("camera") == "active" or "camera" in _SERVICE_DEFS
    except Exception:
        pass
    _caps_cache = caps
    return caps


_caps_cache = None


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


def _http_check(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def _find_os_pid(key: str) -> int | None:
    """Scansiona i processi OS reali per un'istanza di 'key' non tracciata
    da _procs -- serve quando l'AGENT STESSO e' stato riavviato (crash,
    aggiornamento, un deploy) lasciando il vecchio sottoprocesso vivo come
    orfano. Stesso principio/gotcha di ops/agent.py (_find_os_pid, trovato
    dal vivo 2026-08-21), qui via pgrep -f invece di PowerShell/CIM --
    pgrep esclude sempre se stesso dai risultati, nessun falso positivo
    da escludere a mano come nel caso powershell.exe la'."""
    defn = _SERVICE_DEFS.get(key)
    if not defn or defn.get("type") in ("docker", "http_check"):
        return None
    cmd = defn["cmd"]
    cwd = defn.get("cwd")
    if defn.get("check_script", True):
        signature = os.path.join(cwd, cmd[-1]) if cwd else cmd[-1]
    else:
        signature = cmd[-1]
    with _cfg_lock:
        signature = signature.replace("{STANZA}", _cfg.get("stanza", ""))
    try:
        r = subprocess.run(
            ["pgrep", "-f", signature],
            capture_output=True, text=True, timeout=8,
        )
        pids = [int(p) for p in r.stdout.split() if p.isdigit()]
        return pids[0] if pids else None
    except Exception:
        return None


def _is_running(key: str) -> bool:
    defn = _SERVICE_DEFS.get(key)
    if defn and defn.get("type") == "http_check":
        return _http_check(defn["check_url"])
    with _procs_lock:
        p = _procs.get(key)
        if p is not None and p.poll() is None:
            return True
    now = time.monotonic()
    cached = _orphan_check_cache.get(key)
    if cached and now < cached[1]:
        return cached[0]
    pid = _find_os_pid(key)
    if pid is not None:
        if _adopted_pids.get(key) != pid:
            print(f"[Agent] {key}: rilevato processo orfano PID={pid} (non lanciato da questa istanza dell'agent, adottato)")
        _adopted_pids[key] = pid
    else:
        _adopted_pids.pop(key, None)
    alive = pid is not None
    _orphan_check_cache[key] = (alive, now + _ORPHAN_CHECK_TTL)
    return alive


def _svc_status(key: str) -> str:
    if key not in _SERVICE_DEFS:
        return "unknown"
    return "active" if _is_running(key) else "inactive"


def _stop_conflicts(key: str):
    """I .toe di TD vanno uno alla volta (herbarium/project2/project3):
    prima di avviarne uno, ferma quelli dichiarati in conflitto nel
    manifest — stesso ruolo del 'Conflicts=' di systemd usato per
    kiosk/screen sul Pi, qui esplicito perche' non gestiamo unit native."""
    defn = _SERVICE_DEFS.get(key, {})
    for other in defn.get("conflicts", []):
        if other in _SERVICE_DEFS and _is_running(other):
            print(f"[Agent] {key} e' in conflitto con {other}, lo fermo prima")
            _stop_service(other)
            with _cfg_lock:
                _cfg.setdefault("services", {}).setdefault(other, {})["enabled"] = False


def _start_service(key: str) -> bool:
    defn = _SERVICE_DEFS.get(key)
    if not defn:
        print(f"[Agent] Servizio sconosciuto: {key}")
        return False
    if defn.get("type") == "http_check":
        ok = _is_running(key)
        print(f"[Agent] {key} e' gestito esternamente, non avviabile da qui (attivo={ok})")
        return ok
    if _is_running(key):
        return True
    _stop_conflicts(key)
    env = _build_env(defn.get("env_extra", {}))
    cwd = defn.get("cwd")
    cmd = [c.replace("{STANZA}", _cfg.get("stanza", "")) for c in defn["cmd"]]
    if defn.get("check_script", True):
        script = os.path.join(cwd, cmd[-1]) if cwd else cmd[-1]
        if not os.path.exists(script):
            print(f"[Agent] File non trovato: {script}")
            return False
    print(f"[Agent] Avvio {key}: {' '.join(cmd)}")
    with _procs_lock:
        _procs[key] = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
    proc = _procs[key]

    def drain(p, svc):
        for line in p.stdout:
            print(f"[{svc}] {line.decode(errors='replace').rstrip()}")
    threading.Thread(target=drain, args=(proc, key), daemon=True).start()
    return True


def _stop_service(key: str) -> bool:
    defn = _SERVICE_DEFS.get(key)
    if defn and defn.get("type") == "http_check":
        print(f"[Agent] {key} e' gestito esternamente, non fermabile da qui")
        return False
    with _procs_lock:
        p = _procs.get(key)
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
            _procs[key] = None
            print(f"[Agent] Fermato: {key}")
            _orphan_check_cache.pop(key, None)
            return True
        _procs[key] = None
    # Nessun Popen nostro vivo -- ma potrebbe esserci un orfano adottato
    # (agent riavviato dopo il lancio originale) da fermare comunque.
    pid = _adopted_pids.pop(key, None) or _find_os_pid(key)
    if pid is not None:
        try:
            os.kill(pid, signal.SIGKILL)
            print(f"[Agent] Fermato processo orfano {key} (PID={pid})")
        except Exception as e:
            print(f"[Agent] Errore fermando orfano {key} (PID={pid}): {e}")
    _orphan_check_cache.pop(key, None)
    return True


def _restart_service(key: str) -> bool:
    _stop_service(key)
    time.sleep(0.5)
    return _start_service(key)


def _notify_telegram(text: str):
    """Stesso pattern di TDDeviceRegistry._notify() in
    minipc/touchdesigner/osc_bridge.py — publish semplice, nessuna gestione
    di conferma di consegna (il dispatcher Node-RED se ne occupa)."""
    try:
        _mqtt.publish("gaia/notify/telegram", json.dumps({"text": text}))
    except Exception as e:
        print(f"[Watchdog] Notifica Telegram fallita: {e}")


def _watchdog_tick():
    """TD (o qualunque servizio) puo' morire senza che nessuno lo rilanci —
    _start_service/_restart_service esistono gia' ma prima nulla li
    richiamava da solo se un processo abilitato cadeva. Gira ogni
    WATCHDOG_INTERVAL, ritenta SEMPRE (mai un reboot automatico della
    macchina, deciso esplicitamente per questa classe di macchine — vedi
    minipc/installation/ per lo stesso principio sulla touring machine),
    avvisa su Telegram dopo N tentativi falliti consecutivi cosi' non resta
    silenzioso se il file .toe e' sbagliato o TD non riesce proprio a
    partire."""
    with _cfg_lock:
        services_cfg = dict(_cfg.get("services", {}))
    for key, scfg in services_cfg.items():
        if not scfg.get("enabled"):
            _watchdog_fail_count.pop(key, None)
            continue
        if _is_running(key):
            if _watchdog_fail_count.get(key):
                print(f"[Watchdog] {key} di nuovo attivo")
                _notify_telegram(f"✅ {key} su {MACHINE_ROLE} ({_cfg.get('device_id')}) di nuovo attivo.")
            _watchdog_fail_count[key] = 0
            continue
        count = _watchdog_fail_count.get(key, 0) + 1
        _watchdog_fail_count[key] = count
        print(f"[Watchdog] {key} non attivo (tentativo {count}), riavvio...")
        _restart_service(key)
        if count == WATCHDOG_ALERT_AFTER:
            _notify_telegram(f"⚠️ {key} su {MACHINE_ROLE} ({_cfg.get('device_id')}) "
                              f"non riparte da {count} tentativi, verifica dal vivo.")


# ── Camera come dipendenza ref-contata (non usata oggi su questa macchina,
# lasciata per coerenza col manifest generico — vedi pi/agent.py e
# ops/agent.py). Resta un no-op se camera_consumers e' vuoto in services.json.
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
        "tailscale_ip": net_resolve.local_tailscale_ip(),
        "internet":     net_resolve.has_internet(),
        "capabilities": detect_capabilities(),
        "services":     services,
        "config":       svc_cfg,
        "uptime":       _get_uptime(),
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(f"gaia/device/{device_id}/status", json.dumps(payload), retain=True)
    _publish_profile(payload)


def _publish_profile(status_payload: dict):
    """Profilo semantico retained (docs/gaia-semantico.md): capability +
    servizi CON endpoint."""
    device_id = status_payload.get("device_id")
    stanza    = status_payload.get("stanza", "")
    ip        = status_payload.get("ip", "")
    services = {}
    for key in _SERVICE_DEFS:
        services[key] = {
            "state": _svc_status(key),
            "endpoints": _service_endpoints(key, stanza, ip),
        }
    profile = {
        "device_id":    device_id,
        "role":         MACHINE_ROLE,
        "room":         stanza,
        "ip":           ip,
        "tailscale_ip": status_payload.get("tailscale_ip"),
        "internet":     status_payload.get("internet"),
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
                        continue
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
        print("[Agent] Reboot richiesto via MQTT")
        # AppleScript/System Events invece di 'sudo shutdown -r now': nessuna
        # modifica ai permessi di sistema richiesta (deciso 2026-09-11 dopo
        # che una regola sudoers NOPASSWD e' stata bloccata dai controlli di
        # sicurezza dell'ambiente di sviluppo). Gira come l'utente loggato;
        # se altre app hanno documenti non salvati puo' comparire un dialogo
        # invece di riavviare subito -- limite noto, accettato.
        subprocess.run(["osascript", "-e", 'tell application "System Events" to restart'])
        return

    elif action == "shutdown":
        print("[Agent] Shutdown richiesto via MQTT")
        subprocess.run(["osascript", "-e", 'tell application "System Events" to shut down'])
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
    global _cfg, _mqtt, MQTT_HOST

    _acquire_lock()
    _cfg = load_config()

    # Discovery cascata (cache → broadcast UDP → mDNS → Tailscale, quest'ultimo
    # solo se GAIA_CORE_TAILSCALE_HOST e' impostato) -- stessa identica logica
    # di pi/agent.py, mancante in ops/agent.py (workstation sempre sulla LAN
    # di casa, qui invece una macchina che potrebbe non esserlo sempre). Un
    # MQTT_HOST esplicito da env mantiene la priorità (layering config).
    if "MQTT_HOST" not in os.environ and os.getenv("GAIA_DISCOVERY", "1") != "0":
        try:
            info = discovery.discover(cached_host=MQTT_HOST)
            if info:
                if info["mqtt_host"] != MQTT_HOST:
                    print(f"[Agent] Gaia Core trovato: {info['mqtt_host']} (config era {MQTT_HOST})")
                MQTT_HOST = info["mqtt_host"]
        except Exception as e:
            print(f"[Agent] Discovery fallita ({e}), uso {MQTT_HOST}")

    print(f"[GAIA TD-Studio Agent] device_id : {_cfg['device_id']}")
    print(f"[GAIA TD-Studio Agent] stanza    : {_cfg['stanza']}")
    print(f"[GAIA TD-Studio Agent] role      : {MACHINE_ROLE}")
    print(f"[GAIA TD-Studio Agent] MQTT      : {MQTT_HOST}:{MQTT_PORT}")
    print(f"[GAIA TD-Studio Agent] Servizi   : {list(_SERVICE_DEFS.keys())}")

    apply_initial_config()

    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-tdstudio-agent-{_cfg['device_id']}")
    _mqtt.on_connect = _on_connect
    _mqtt.on_message = _on_message

    # LoginItem/LaunchAgent puo' partire prima che la rete/Tailscale sia
    # pronta a raggiungere il Core: niente retry qui = crash del processo
    # intero, stesso gotcha gia' visto su ops/agent.py (2026-07-09).
    backoff = 5
    while _running:
        try:
            _mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
            break
        except OSError as e:
            print(f"[GAIA TD-Studio Agent] Connessione MQTT fallita ({e}), riprovo tra {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
    if not _running:
        return
    _mqtt.loop_start()

    last_hb = 0
    last_wd = 0
    while _running:
        if time.time() - last_hb >= HEARTBEAT_INTERVAL:
            _publish_status()
            last_hb = time.time()
        if time.time() - last_wd >= WATCHDOG_INTERVAL:
            _watchdog_tick()
            last_wd = time.time()
        time.sleep(1)

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA TD-Studio Agent] Terminato.")


if __name__ == "__main__":
    main()
