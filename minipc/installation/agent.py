#!/usr/bin/env python3
"""
GAIA Installation Agent — porting Windows del pattern subprocess di
minipc/local_agent.py, stessa base di ops/agent/agent.py adattata per una
macchina "touring" non presidiata (2026-09: Palazzo Ducale Genova, 1 mese,
video-mapping via MadMapper). Due differenze reali rispetto a ops/agent.py
(quella macchina è sempre in LAN con Core, questa no):

  1. Discovery Tailscale (discovery.py, portato da pi/agent/) PRIMA della
     connessione MQTT — senza, l'agent non troverebbe affatto il broker
     stando su una rete diversa da quella di casa.
  2. Watchdog reale (vedi _watchdog_loop): ops/agent.py non riavvia mai un
     servizio caduto da solo (lo fa solo su comando MQTT esplicito) — va
     bene per una macchina presidiata, non per una lasciata sola un mese.
  3. `reboot`/`shutdown` REALI (ops/agent.py li rifiuta esplicitamente,
     "silvermini2 non e' un Pi headless") — qui servono come rete di
     sicurezza software sopra lo scheduling BIOS/Task Scheduler.
  4. `shutdown_at` (2026-09-19, "HH:MM" o null in set_config/device.json,
     controllabile da Admin/Telegram) — spegnimento programmato SOFTWARE,
     controllato dal watchdog loop stesso (nessun secondo thread/schtasks
     separato). Alternativa remotamente modificabile a un Task Scheduler
     nativo fisso: cambiare orario non richiede più SSH sulla macchina.

Stessa interfaccia MQTT di pi/agent/agent.py e ops/agent/agent.py:
  - pubblica: gaia/device/{id}/status  (heartbeat ogni 30s, retain=True)
  - ascolta:  gaia/device/{id}/command
  - ascolta:  gaia/device/all/command

Le definizioni dei servizi vengono da services.json (manifest locale).
"""
import json
import msvcrt
import os
import re
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

MACHINE_ROLE     = _manifest.get("machine_role", "installation")
_SERVICE_DEFS    = _manifest["services"]
CAMERA_CONSUMERS = tuple(_manifest.get("camera_consumers", []))

CONFIG_FILE = os.path.join(_DIR, "agent_config.json")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
HEARTBEAT_INTERVAL = 30

# Watchdog — riavvia da solo un servizio "enabled" che risulta caduto,
# ritenta a oltranza, notifica Telegram dopo N fallimenti consecutivi (MAI
# un reboot automatico dell'intera macchina, richiesto esplicitamente: da
# remoto, headless, per un mese, un loop di riavvii per un problema
# strutturale sarebbe peggio del problema originale).
WATCHDOG_INTERVAL    = 30
WATCHDOG_ALERT_AFTER = 5

_DEFAULT_CFG = {
    "device_id": _manifest.get("device_id", f"installation-{socket.gethostname()}"),
    "stanza":    _manifest.get("stanza", "unknown"),
    "name":      _manifest.get("stanza", "unknown"),
    "services":  {k: {"enabled": False} for k in _SERVICE_DEFS if k != "camera"},
    # Spegnimento programmato (2026-09-19, richiesto esplicitamente: controllo
    # da Gaia invece di uno schtasks fisso non modificabile da remoto) --
    # "HH:MM" (ora locale della macchina) o None = disabilitato. Rete di
    # sicurezza SOFTWARE sopra a un eventuale spegnimento schedulato via Task
    # Scheduler nativo -- qui e' controllabile da Admin/Telegram senza SSH.
    "shutdown_at": None,
}

# Guardia anti-doppio-trigger: l'orario viene controllato ogni WATCHDOG_INTERVAL
# (30s), quindi un solo minuto HH:MM combacia per ~2 giri -- senza questa data
# scatterebbe lo shutdown due volte (irrilevante in pratica, la prima gia' spegne
# la macchina, ma resta un bug se mai il comando fallisse silenziosamente).
_last_scheduled_shutdown_date = None

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

# Watchdog: fallimenti consecutivi per servizio + se e' gia' stato mandato
# un alert per questa "striscia" di fallimenti (evita spam ad ogni giro
# dopo il primo alert, un solo avviso finche' non recupera).
_watchdog_fail_counts: dict = {}
_watchdog_alerted: set = set()


# ── Config persistence ────────────────────────────────────────────────
def load_config() -> dict:
    base = {k: v for k, v in _DEFAULT_CFG.items()}
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        base.update({k: saved[k] for k in ("device_id", "stanza", "name", "updated", "shutdown_at") if k in saved})
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
    (docs/gaia-semantico.md, contratto 1)."""
    return {}


def detect_capabilities() -> dict:
    global _caps_cache
    if _caps_cache is not None:
        return _caps_cache
    caps = {"camera": False, "mic": False, "audio_out": True,
            "display": True, "midi": [], "i2c": False}
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
    da _procs -- serve quando l'AGENT STESSO e' stato riavviato lasciando
    il vecchio sottoprocesso vivo come orfano. Stesso fix di ops/agent.py
    (bug reale trovato dal vivo 2026-08-21 su un caso analogo, kiosk)."""
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
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_Process | Where-Object "
             f"{{$_.CommandLine -like '*{signature}*' -and "
             "$_.Name -ne 'powershell.exe' -and $_.Name -ne 'pwsh.exe'} | "
             "Select-Object -First 1 -ExpandProperty ProcessId)"],
            capture_output=True, text=True, timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        pid = r.stdout.strip()
        return int(pid) if pid.isdigit() else None
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
    env = _build_env(defn.get("env_extra", {}))
    cwd = defn.get("cwd")
    cmd = [c.replace("{STANZA}", _cfg.get("stanza", "")) for c in defn["cmd"]]
    if defn.get("check_script", True):
        script = os.path.join(cwd, cmd[-1]) if cwd else cmd[-1]
        if not os.path.exists(script):
            print(f"[Agent] File non trovato: {script}")
            return False
    print(f"[Agent] Avvio {key}: {' '.join(cmd)}")
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
    pid = _adopted_pids.pop(key, None) or _find_os_pid(key)
    if pid is not None:
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=8,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            print(f"[Agent] Fermato processo orfano {key} (PID={pid})")
        except Exception as e:
            print(f"[Agent] Errore fermando orfano {key} (PID={pid}): {e}")
    _orphan_check_cache.pop(key, None)
    return True


def _restart_service(key: str) -> bool:
    _stop_service(key)
    time.sleep(0.5)
    return _start_service(key)


def _sync_camera(services_cfg: dict):
    pass  # nessuna camera su questa macchina


# ── MQTT ──────────────────────────────────────────────────────────────
_mqtt = None


def _notify_telegram(text: str):
    """Stesso topic/pattern già in produzione per gli alert TD
    (osc_bridge.py TDDeviceRegistry._notify(), riga 289-290) — un publish
    su gaia/notify/telegram, consumato dal dispatcher Telegram esistente."""
    if not _mqtt:
        return
    try:
        _mqtt.publish("gaia/notify/telegram", json.dumps({"text": text}))
    except Exception as e:
        print(f"[Agent] Errore notifica Telegram: {e}")


def _do_shutdown(reason: str):
    """Unico punto che spegne davvero la macchina — usato sia dal comando
    MQTT diretto sia dal trigger programmato (_watchdog_loop) cosi' i due
    percorsi non duplicano la stessa subprocess.run e restano coerenti."""
    print(f"[Agent] Shutdown ({reason}) — eseguo tra 5s.")
    _notify_telegram(f"🔌 Shutdown ({reason}) sulla macchina installazione — in corso.")
    subprocess.run(["shutdown", "/s", "/t", "5"],
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def _publish_status():
    with _cfg_lock:
        device_id   = _cfg.get("device_id")
        stanza      = _cfg.get("stanza")
        name        = _cfg.get("name", stanza)
        svc_cfg     = _cfg.get("services", {})
        shutdown_at = _cfg.get("shutdown_at")

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
        "shutdown_at":  shutdown_at,
        "uptime":       _get_uptime(),
        "ts":           int(time.time() * 1000),
    }
    _mqtt.publish(f"gaia/device/{device_id}/status", json.dumps(payload), retain=True)
    _publish_profile(payload)


def _publish_profile(status_payload: dict):
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
        "sw_version":   "1.0.0",
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
            if "stanza" in cmd and cmd["stanza"] != _cfg.get("stanza"):
                _cfg["stanza"] = cmd["stanza"]
                stanza_changed = True
            if "name" in cmd:
                _cfg["name"] = cmd["name"]
            if "shutdown_at" in cmd:
                val = cmd["shutdown_at"]
                if val in (None, ""):
                    _cfg["shutdown_at"] = None
                elif isinstance(val, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", val):
                    _cfg["shutdown_at"] = val
                else:
                    print(f"[Agent] shutdown_at non valido (atteso HH:MM o null): {val!r}, ignorato")
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
        # Macchina non presidiata per un mese: a differenza di ops/agent.py
        # (rifiutato lì, "silvermini2 non e' un Pi headless") qui un
        # power-cycle software via MQTT/Telegram/Admin e' proprio la rete
        # di sicurezza voluta, sopra lo scheduling BIOS/Task Scheduler.
        print("[Agent] Reboot richiesto via MQTT — eseguo tra 5s.")
        _notify_telegram("🔄 Reboot richiesto da remoto sulla macchina installazione — in corso.")
        subprocess.run(["shutdown", "/r", "/t", "5"],
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        return

    elif action == "shutdown":
        _do_shutdown("richiesto da remoto")
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


# ── Watchdog ──────────────────────────────────────────────────────────
def _watchdog_loop():
    """Macchina non presidiata: un servizio "enabled" che cade va
    rilanciato da solo, non solo su comando MQTT esplicito (quello che fa
    ops/agent.py, corretto per una macchina sempre presidiata, non qui).
    Ritenta A OLTRANZA -- mai un reboot automatico dell'intera macchina
    (richiesto esplicitamente, troppo rischioso da remoto per un mese: un
    problema strutturale diventerebbe un loop di riavvii). Dopo
    WATCHDOG_ALERT_AFTER fallimenti CONSECUTIVI per lo stesso servizio,
    un solo alert Telegram (non uno ad ogni giro) finche' non recupera."""
    global _last_scheduled_shutdown_date
    while _running:
        time.sleep(WATCHDOG_INTERVAL)
        with _cfg_lock:
            services    = dict(_cfg.get("services", {}))
            shutdown_at = _cfg.get("shutdown_at")
        if shutdown_at:
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            if now.strftime("%H:%M") == shutdown_at and _last_scheduled_shutdown_date != today:
                _last_scheduled_shutdown_date = today
                _do_shutdown(f"programmato {shutdown_at}")
        for key, scfg in services.items():
            if not scfg.get("enabled"):
                _watchdog_fail_counts.pop(key, None)
                _watchdog_alerted.discard(key)
                continue
            if _is_running(key):
                if _watchdog_fail_counts.pop(key, None):
                    print(f"[Watchdog] {key}: recuperato")
                    if key in _watchdog_alerted:
                        _watchdog_alerted.discard(key)
                        _notify_telegram(f"✅ \"{key}\" di nuovo attivo (installazione).")
                continue
            fails = _watchdog_fail_counts.get(key, 0) + 1
            _watchdog_fail_counts[key] = fails
            print(f"[Watchdog] {key}: caduto (fallimento #{fails}), riavvio...")
            _restart_service(key)
            if fails >= WATCHDOG_ALERT_AFTER and key not in _watchdog_alerted:
                _watchdog_alerted.add(key)
                _notify_telegram(
                    f"⚠️ \"{key}\" non riparte da {fails} tentativi consecutivi "
                    f"sulla macchina installazione — il watchdog continua a ritentare."
                )
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
    print(f"[GAIA Installation Agent] device_id : {_cfg['device_id']}")
    print(f"[GAIA Installation Agent] stanza    : {_cfg['stanza']}")
    print(f"[GAIA Installation Agent] role      : {MACHINE_ROLE}")

    # Discovery PRIMA di tutto (gap critico rispetto a ops/agent.py, vedi
    # docstring modulo): questa macchina non è sulla LAN di casa, MQTT_HOST
    # di default (192.168.1.142) quasi certamente non è raggiungibile da
    # Palazzo Ducale. GAIA_CORE_TAILSCALE_HOST va impostato nel .bat di
    # avvio (o env) prima del primo avvio in loco.
    info = discovery.discover(cached_host=MQTT_HOST)
    if info and info.get("mqtt_host") and info["mqtt_host"] != MQTT_HOST:
        print(f"[GAIA Installation Agent] Gaia Core trovato: {info['mqtt_host']} (default era {MQTT_HOST})")
        MQTT_HOST = info["mqtt_host"]

    print(f"[GAIA Installation Agent] MQTT      : {MQTT_HOST}:{MQTT_PORT}")
    print(f"[GAIA Installation Agent] Servizi   : {list(_SERVICE_DEFS.keys())}")

    apply_initial_config()

    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-installation-agent-{_cfg['device_id']}")
    _mqtt.on_connect = _on_connect
    _mqtt.on_message = _on_message
    # Senza questo, il reconnect automatico di loop_start() dopo la
    # connessione iniziale si e' visto bloccarsi indefinitamente al primo
    # riavvio del broker (trovato dal vivo 2026-09-05: mosquitto riavviato
    # lato Core, questa macchina -- sola su Tailscale, non LAN -- mai piu'
    # riconnessa da sola, richiesto un bounce manuale del processo mentre
    # Core/OPS/Pi sulla stessa LAN del broker si erano ririconnessi senza
    # problemi). Stesso fix gia' presente in minipc/tccm/tccm_agent.py e
    # ops/agent/agent.py.
    _mqtt.reconnect_delay_set(min_delay=2, max_delay=30)

    backoff = 5
    while _running:
        try:
            _mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
            break
        except OSError as e:
            print(f"[GAIA Installation Agent] Connessione MQTT fallita ({e}), riprovo tra {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
    if not _running:
        return
    _mqtt.loop_start()

    threading.Thread(target=_watchdog_loop, daemon=True).start()

    last_hb = 0
    while _running:
        if time.time() - last_hb >= HEARTBEAT_INTERVAL:
            _publish_status()
            last_hb = time.time()
        time.sleep(1)

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA Installation Agent] Terminato.")


if __name__ == "__main__":
    main()
