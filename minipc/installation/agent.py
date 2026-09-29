#!/usr/bin/env python3
"""
GAIA Installation Agent — copia gemella di ops/agent/agent.py, stesso
CONTRATTO agent Windows (docs/agent-windows-contract.md): STESSO agent.py
su ogni macchina Windows del progetto. Vedi quel documento prima di
modificare questo file, e propagare ogni modifica strutturale anche alla
copia in ops/agent/ (il repo duplica il file invece di importarlo
cross-directory, stesso principio gia' documentato per net_resolve.py).

Comportamento differenziato SOLO da services.json: qui "watchdog":true
(macchina non presidiata) e "shutdown_at" gia' in uso, "conflicts"/
"camera_consumers" assenti (nessuna webcam su questa macchina, i relativi
percorsi restano no-op innocui).

Gestisce processi locali (subprocess) invece di systemctl (che non esiste su
Windows). Stessa interfaccia MQTT di pi/agent/agent.py:
  - pubblica: gaia/device/{id}/status  (heartbeat ogni 30s, retain=True)
  - ascolta:  gaia/device/{id}/command
  - ascolta:  gaia/device/all/command

Le definizioni dei servizi vengono da services.json (manifest locale, non
hardcoded come in local_agent.py) — vedi quel file per cmd/cwd/env_extra.
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
import psutil
import net_resolve
import discovery

# ── Singleton lock (msvcrt invece di fcntl — non esiste su Windows) ──────────
_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCK_FILE = os.path.join(_DIR, "agent.lock")
_lock_fh = None


class _RotatingConsole:
    """Sostituisce sys.stdout/stderr: pythonw.exe non ha una console reale,
    quindi senza un redirect esplicito i print() andrebbero persi (o in
    crash se sys.stdout e' None) -- e senza QUESTA classe la codepage
    locale (es. cp1252) mandava in crash print() con UnicodeEncodeError sui
    log dei sottoprocessi (accenti, frecce): sostituisce anche il vecchio
    `sys.stdout.reconfigure(encoding="utf-8", ...)`, ora ridondante dato che
    apriamo il file noi stessi in utf-8.

    Scrive su agent.log con rotazione a dimensione massima -- fatto qui
    invece che con un redirect `>>` di cmd.exe (run_agent.bat, prima)
    perche' un handle ereditato dalla shell resta aperto sul file per tutta
    la vita del processo e blocca il rename in rotazione (PermissionError
    su Windows). Trovato dal vivo 2026-09-29: agent.log su OPS arrivato a
    483MB, mai ruotato da quando esiste. run_agent.bat non redirige piu' su
    questo file (solo su NUL, rete di sicurezza se questa classe fallisse
    ad avviarsi)."""

    def __init__(self, path, max_bytes=20 * 1024 * 1024, backups=5):
        self._path = path
        self._max_bytes = max_bytes
        self._backups = backups
        self._lock = threading.Lock()
        self._fh = open(path, "a", encoding="utf-8", errors="replace")

    def write(self, s):
        with self._lock:
            try:
                self._fh.write(s)
                self._fh.flush()
                if self._fh.tell() >= self._max_bytes:
                    self._rotate()
            except Exception:
                pass
        return len(s)

    def flush(self):
        with self._lock:
            try:
                self._fh.flush()
            except Exception:
                pass

    def isatty(self):
        return False

    def _rotate(self):
        try:
            self._fh.close()
            for i in range(self._backups - 1, 0, -1):
                src, dst = f"{self._path}.{i}", f"{self._path}.{i + 1}"
                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)
            if os.path.exists(self._path):
                dst1 = f"{self._path}.1"
                if os.path.exists(dst1):
                    os.remove(dst1)
                os.rename(self._path, dst1)
        finally:
            self._fh = open(self._path, "a", encoding="utf-8", errors="replace")


try:
    sys.stdout = sys.stderr = _RotatingConsole(os.path.join(_DIR, "agent.log"))
except Exception:
    pass


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
# Contratto agent Windows (docs/agent-windows-contract.md): stesso agent.py
# su ogni macchina Windows, comportamento differenziato SOLO da services.json.
# "watchdog":true = riavvia da solo un servizio "enabled" che risulta caduto
# (macchina non presidiata, es. installazione touring). false = mai (macchina
# presidiata come OPS: un utente puo' chiudere TD a mano dal suo stesso tasto
# X per alleggerire la macchina senza che l'agent glielo rilanci sotto -- vedi
# incidente reale 2026-09-02 in project-architettura-core-ops).
WATCHDOG_ENABLED = bool(_manifest.get("watchdog", False))

CONFIG_FILE = os.path.join(_DIR, "agent_config.json")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
_mqtt = None

# Ri-scoperta automatica dopo disconnessione prolungata (2026-09-19, bug
# reale trovato due volte dal vivo -- Corridoio su pi/agent.py e la macchina
# installazione di Palazzo Ducale dopo un riavvio reale: discovery.discover()
# gira UNA SOLA VOLTA all'avvio del processo; se la prima scelta si rivela
# irraggiungibile solo al connect vero, paho continua a ritentare lo STESSO
# host morto in eterno col solo backoff di reconnect_delay_set, mai una nuova
# discovery -- unico modo per uscirne era riavviare l'agent a mano. Portato
# su OPS 2026-09-29 dopo l'incidente della LAN demo (IP di OPS cambiato piu'
# volte in un mattino, vedi project-evento-25-settembre): utile ovunque, non
# solo per le macchine fuori LAN.
_mqtt_connected = False
_last_disconnect_ts = time.time()
_next_rediscovery_ts = 0
RECOVERY_THRESHOLD = 90
HEARTBEAT_INTERVAL = 30

# Watchdog (solo se WATCHDOG_ENABLED, vedi sopra) — riavvia da solo un
# servizio "enabled" caduto, ritenta a oltranza, notifica Telegram dopo N
# fallimenti consecutivi (MAI un reboot automatico dell'intera macchina).
WATCHDOG_INTERVAL    = 30
WATCHDOG_ALERT_AFTER = 5

_DEFAULT_CFG = {
    "device_id": _manifest.get("device_id", f"installation-{socket.gethostname()}"),
    "stanza":    _manifest.get("stanza", "unknown"),
    "name":      _manifest.get("stanza", "unknown"),
    "services":  {k: {"enabled": False} for k in _SERVICE_DEFS if k != "camera"},
    # Spegnimento programmato ("HH:MM" o None) — stessa semantica di
    # minipc/installation/agent.py e pi/agent/agent.py, ora sul contratto
    # comune: controllabile da Admin/Telegram senza SSH su QUALSIASI Windows.
    "shutdown_at": None,
}

# Guardia anti-doppio-trigger per lo shutdown programmato: l'orario viene
# controllato ogni WATCHDOG_INTERVAL/HEARTBEAT (30s), quindi un solo minuto
# HH:MM combacia per ~2 giri -- senza questa data scatterebbe due volte.
_last_scheduled_shutdown_date = None

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
# Lock PER-CHIAVE (non uno globale) attorno a "controlla se gira -> ferma i
# conflitti -> avvia" di _start_service, cosi' due comandi 'enable' concorrenti
# per la STESSA chiave (es. TD Gaia che manda 'enable' piu' volte ravvicinate)
# non passano ENTRAMBI il controllo _is_running(key) prima che il primo abbia
# fatto in tempo a registrare il proprio Popen -- bug reale trovato dal vivo
# 2026-09-19 (evento 25/9): istanze duplicate di Herbarium/Yolo TD.
#
# Un lock GLOBALE unico (primo tentativo, poi trovato reale il problema
# descritto sotto) serializzava anche chiavi DIVERSE senza motivo (avviare
# touchdesigner_yolo bloccava touchdesigner_herbarium finche' non finiva, con
# _stop_conflicts che aspetta fino a 5s per processo fermato +
# CAMERA_RELEASE_DELAY) e soprattutto ha prodotto un DEADLOCK REALE dal vivo
# con un burst di comandi concorrenti (disable camera/yolo/mediapipe + enable
# di entrambi i progetti TD quasi simultanei) -- l'agent si e' bloccato per
# oltre 25 minuti, nessun heartbeat, causa esatta non isolata con certezza.
# Per-chiave riduce la contesa (chiavi diverse non si bloccano a vicenda) e
# l'acquire ha comunque un timeout (vedi sotto) come rete di sicurezza finale:
# l'agent non deve MAI piu' restare bloccato per sempre, qualunque sia la
# causa esatta di un blocco imprevisto.
_start_service_locks: dict = {}
_start_service_locks_guard = threading.Lock()
_START_LOCK_TIMEOUT = 15.0


def _get_start_lock(key: str) -> threading.RLock:
    with _start_service_locks_guard:
        lock = _start_service_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _start_service_locks[key] = lock
        return lock
# Processi orfani (istanze reali OS, non lanciate dal Popen di QUESTA
# istanza dell'agent) rilevati e adottati -- vedi _find_os_pid/_is_running.
_adopted_pids: dict = {}
_orphan_check_cache: dict = {}   # key -> (bool_alive, scaduto_a)
# Deve stare SOPRA HEARTBEAT_INTERVAL (30s) o il commento sopra ("non
# spammare PowerShell ad ogni heartbeat") e' falso -- bug reale trovato dal
# vivo 2026-09-29: con 20s < 30s la cache scadeva sempre PRIMA del prossimo
# heartbeat, quindi ogni servizio spento (nessun PID da adottare, il
# fast-path psutil in _is_running non si applica) riapriva comunque una
# PowerShell/conhost.exe visibile ad ogni ciclo. Il fast-path psutil copre
# gia' gli orfani TROVATI; questo TTL copre il caso "cercato e non
# trovato" (voice/kiosk quando spenti).
_ORPHAN_CHECK_TTL = 45.0
_start_ts   = time.monotonic()

# Watchdog: fallimenti consecutivi per servizio + se e' gia' stato mandato
# un alert per questa "striscia" di fallimenti (evita spam ad ogni giro dopo
# il primo alert, un solo avviso finche' non recupera). No-op se
# WATCHDOG_ENABLED e' False (vedi sopra).
_watchdog_fail_counts: dict = {}
_watchdog_alerted: set = set()


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
    """Capability della macchina (F4 gaia-semantico). Su Windows i probe
    affidabili sono costosi: camera/mic via OpenCV/sounddevice al primo giro,
    poi cache; audio_out/display assunti presenti su questa workstation."""
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
    # MAI probare la webcam con VideoCapture qui: su Windows è esclusiva e
    # il probe la strapperebbe al camera_server. Se il servizio camera gira,
    # la capability è vera per definizione; altrimenti resta il default.
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


def _service_signature(key: str) -> str | None:
    """Stringa univoca usata per riconoscere il processo OS di 'key' --
    stesso path assoluto gia' verificato in _start_service (check_script),
    o l'ultimo argomento per i servizi con check_script=False (es. kiosk:
    --user-data-dir=... e' gia' univoco di suo, a differenza di "main.py"
    che da solo comparirebbe identico per yolo/mediapipe/voice/mediaplayer).
    Usata sia da _find_os_pid (scansione PowerShell) sia dal fast-path a
    PID noto in _is_running (verifica psutil, vedi li')."""
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
    return signature


def _find_os_pid(key: str) -> int | None:
    """Scansiona i processi OS reali per un'istanza di 'key' non tracciata
    da _procs -- serve quando l'AGENT STESSO e' stato riavviato (crash,
    aggiornamento Windows, un deploy) lasciando il vecchio sottoprocesso
    vivo come orfano: senza questo, _is_running si fida solo della memoria
    dell'istanza agent CORRENTE e non vede quello vecchio ancora attivo.
    Bug reale trovato dal vivo 2026-08-21 (kiosk: "stop"/"enable" da Admin
    rispondevano OK senza toccare il processo reale -- Edge con lo stesso
    --user-data-dir assorbe silenziosamente un secondo lancio invece di
    aprirne uno nuovo, nessun errore visibile).

    Costosa (spawna powershell.exe): usata solo per la scansione iniziale
    o quando il PID adottato in precedenza e' sparito -- vedi il fast-path
    a PID noto in _is_running, aggiunto 2026-09-29 apposta per non dover
    richiamare questa ad ogni scadenza cache per gli stessi orfani gia'
    noti (TD Herbarium/Yolo/DMX, check_script:false quindi mai in _procs:
    prima riaprivano una PowerShell/conhost.exe visibile quasi ad ogni
    heartbeat, percepito dall'utente come un "watchdog" che sfarfalla
    finestre cmd)."""
    signature = _service_signature(key)
    if signature is None:
        return None
    try:
        # Esclude powershell.exe/pwsh.exe dal match: senza, il processo che
        # esegue QUESTA STESSA query si auto-matcha (la sua riga di comando
        # contiene letteralmente la stringa 'signature' cercata) --
        # falso positivo reale trovato dal vivo 2026-08-21, un PID diverso
        # ad ogni chiamata, tutti già spariti al controllo successivo.
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
    # Un orfano gia' adottato in un giro precedente: verifica il PID noto
    # con psutil (chiamata nativa in-process, nessun sottoprocesso) invece
    # di rilanciare ogni volta la scansione PowerShell di _find_os_pid --
    # vedi nota li' per il perche' (2026-09-29, finestre cmd visibili).
    known_pid = _adopted_pids.get(key)
    if known_pid is not None:
        try:
            proc = psutil.Process(known_pid)
            signature = _service_signature(key) or ""
            if signature and signature in " ".join(proc.cmdline()):
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        # PID sparito o riassegnato a un altro processo (cmdline non
        # combacia piu') -- ricadi sulla scansione completa sotto.
        _adopted_pids.pop(key, None)
        _orphan_check_cache.pop(key, None)
    # Nessun Popen nostro vivo, nessun PID orfano gia' noto -- verifica se
    # esiste un processo orfano reale (vedi _find_os_pid). Cache breve per
    # non spammare PowerShell ad ogni heartbeat/status poll.
    now = time.monotonic()
    cached = _orphan_check_cache.get(key)
    if cached and now < cached[1]:
        return cached[0]
    pid = _find_os_pid(key)
    if pid is not None:
        print(f"[Agent] {key}: rilevato processo orfano PID={pid} (non lanciato da questa istanza dell'agent, adottato)")
        _adopted_pids[key] = pid
    alive = pid is not None
    _orphan_check_cache[key] = (alive, now + _ORPHAN_CHECK_TTL)
    return alive


def _svc_status(key: str) -> str:
    if key not in _SERVICE_DEFS:
        return "unknown"
    return "active" if _is_running(key) else "inactive"


# Webcam esclusiva (stesso principio di CAMERA_CONSUMERS/_sync_camera sopra):
# fermare un consumer non libera subito l'hardware, il driver/OS impiega un
# istante in piu' a rilasciarlo DOPO che il processo e' gia' morto per
# davvero (p.wait() gia' confermato). Trovato dal vivo 2026-09-19 (evento
# 25/9): avviare touchdesigner_yolo/herbarium subito dopo aver fermato
# yolo/mediapipe nativi dava un conflitto webcam in TD "come se il servizio
# gaia non si spegnesse in tempo" -- perche' letteralmente non faceva in
# tempo, il process kill e il rilascio hardware non sono lo stesso istante.
# Vale in ENTRAMBE le direzioni: anche tornare da un .toe che ha la webcam
# aperta a yolo/mediapipe nativi ha lo stesso identico problema, quindi
# l'insieme copre sia i consumer nativi sia i due progetti TD.
CAMERA_RELEASE_DELAY = 2.0
# touchdesigner_herbarium ESCLUSO apposta (2026-09-19, richiesto
# esplicitamente): confermato dal vivo che non tocca la webcam, resta
# sempre acceso durante l'evento 25/9 -- solo touchdesigner_yolo la apre
# davvero.
CAMERA_HOLDING_SERVICES = set(CAMERA_CONSUMERS) | {"camera", "touchdesigner_yolo"}


def _stop_conflicts(key: str):
    """Progetti TD che vanno uno alla volta sulla stessa istanza
    TouchDesigner (es. touchdesigner/touchdesigner_herbarium su OPS):
    dichiarati in "conflicts" nel manifest, fermati prima di avviarne uno
    nuovo -- stesso meccanismo gia' in minipc/tdstudio/agent.py, portato
    qui perche' prima esisteva un solo slot TD per macchina (nessun
    concetto di conflitto). Include anche i consumer camera nativi
    (yolo/mediapipe/camera, 2026-09-19) -- un progetto TD che apre la
    webcam direttamente e' in conflitto con loro tanto quanto con un altro
    progetto TD, stesso hardware esclusivo."""
    defn = _SERVICE_DEFS.get(key, {})
    stopped_camera_consumer = False
    for other in defn.get("conflicts", []):
        if other in _SERVICE_DEFS and _is_running(other):
            print(f"[Agent] {key} e' in conflitto con {other}, lo fermo prima")
            _stop_service(other)
            with _cfg_lock:
                _cfg.setdefault("services", {}).setdefault(other, {})["enabled"] = False
            if other in CAMERA_HOLDING_SERVICES:
                stopped_camera_consumer = True
    # Solo se abbiamo davvero fermato un consumer nativo (yolo/mediapipe/
    # kiosk) e non per "camera" stessa -- altrimenti si rientra in
    # _start_service("camera") mentre potremmo essere gia' dentro una sua
    # chiamata in corso (vedi guardia di rientranza in _sync_camera).
    if stopped_camera_consumer and key != "camera":
        with _cfg_lock:
            services_cfg = dict(_cfg.get("services", {}))
        _sync_camera(services_cfg)
        print(f"[Agent] Attendo {CAMERA_RELEASE_DELAY}s per il rilascio hardware della webcam...")
        time.sleep(CAMERA_RELEASE_DELAY)


def _start_service(key: str) -> bool:
    defn = _SERVICE_DEFS.get(key)
    if not defn:
        print(f"[Agent] Servizio sconosciuto: {key}")
        return False
    if defn.get("type") == "http_check":
        # Servizio gestito fuori dall'agent (es. Ollama ha un proprio
        # ollama app.exe che si auto-riavvia in autonomia su Windows --
        # spawnare un secondo processo qui competerebbe sulla stessa
        # porta). L'agent lo espone in sola lettura al contratto Pi
        # Manager, non ne possiede il ciclo di vita.
        ok = _is_running(key)
        print(f"[Agent] {key} e' gestito esternamente, non avviabile da qui (attivo={ok})")
        return ok
    lock = _get_start_lock(key)
    if not lock.acquire(timeout=_START_LOCK_TIMEOUT):
        # Rete di sicurezza (vedi commento sopra _start_service_locks): non
        # bloccare mai per sempre, anche se la causa di fondo di una
        # contesa lunga non e' chiara -- meglio un 'enable' che fallisce e
        # si puo' ritentare che un agent intero bloccato.
        print(f"[Agent] Timeout ({_START_LOCK_TIMEOUT}s) acquisendo il lock di avvio per {key}, salto")
        return False
    try:
        if _is_running(key):
            return True
        _stop_conflicts(key)
        env = _build_env(defn.get("env_extra", {}))
        cwd = defn.get("cwd")
        # {STANZA} negli argomenti → stanza corrente (es. URL del kiosk che
        # segue il device quando viene riassegnato, come CAMERA_NAME sul Pi)
        cmd = [c.replace("{STANZA}", _cfg.get("stanza", "")) for c in defn["cmd"]]
        # check_script: false per i servizi il cui ultimo argomento non è un
        # file (es. kiosk: l'ultimo arg è un URL)
        if defn.get("check_script", True):
            script = os.path.join(cwd, cmd[-1]) if cwd else cmd[-1]
            if not os.path.exists(script):
                print(f"[Agent] File non trovato: {script}")
                return False
        print(f"[Agent] Avvio {key}: {' '.join(cmd)}")
        # CREATE_NO_WINDOW: senza, ogni sottoprocesso apre/condivide una
        # console visibile — chiuderla per errore (es. pensando fosse un
        # singolo servizio) manda un evento di chiusura a TUTTO l'albero di
        # processi (visto in produzione: chiusa una finestra "camera", morti
        # anche yolo/mediapipe/voice insieme). Con questo flag non c'e'
        # nessuna finestra da chiudere per sbaglio.
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
    finally:
        lock.release()


def _stop_service(key: str) -> bool:
    defn = _SERVICE_DEFS.get(key)
    if defn and defn.get("type") == "http_check":
        print(f"[Agent] {key} e' gestito esternamente, non fermabile da qui")
        return False
    with _procs_lock:
        p = _procs.get(key)
        if p is not None and p.poll() is None:
            # Windows non ha SIGTERM reale: terminate() manda comunque un
            # segnale gestibile ai processi Python (CTRL_BREAK non serve
            # qui, terminate() basta per i nostri script — nessun cleanup
            # complesso oltre a chiudere socket/stream, gia' gestito nei
            # finally).
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
    # (agent riavviato dopo il lancio originale) da fermare comunque,
    # altrimenti "stop" da Admin risponde OK senza chiudere nulla (bug
    # trovato dal vivo 2026-08-21, vedi _find_os_pid).
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


# ── Camera come dipendenza ref-contata di yolo/mediapipe ──────────────
# Stessa logica di pi/agent/agent.py (CAMERA_CONSUMERS/_sync_camera): la
# webcam e' esclusiva (vedi ops/memory/ops-test-risultati.md), quindi non va
# mai abilitata/disabilitata direttamente ma solo come effetto collaterale di
# yolo/mediapipe che ne hanno bisogno.
def _camera_consumers_active(services_cfg: dict) -> int:
    return sum(1 for k in CAMERA_CONSUMERS if services_cfg.get(k, {}).get("enabled", False))


_syncing_camera = False  # guardia di rientranza, vedi commento sotto


def _sync_camera(services_cfg: dict):
    """Guardia di rientranza (2026-09-19, bug reale trovato dal vivo):
    _stop_conflicts() ora chiama questa funzione, e questa puo' chiamare
    _start_service("camera"), che a sua volta chiama SEMPRE _stop_conflicts()
    all'inizio -- se "camera" e' ancora need=True/running=False mentre siamo
    DENTRO la stessa catena di chiamate (es. il primo _start_service("camera")
    non ha ancora fatto in tempo a registrare il processo appena lanciato),
    si rientra qui all'infinito fino a RecursionError, mai risolto dallo
    stato reale perche' la catena non torna mai al chiamante originale per
    aggiornarlo. Con questa guardia, un rientro durante una sincronizzazione
    gia' in corso è semplicemente ignorato: la sincronizzazione esterna
    (quella gia' in volo) vede comunque lo stato giusto una volta che i suoi
    stessi _start_service/_stop_service ritornano."""
    global _syncing_camera
    if "camera" not in _SERVICE_DEFS or _syncing_camera:
        return
    _syncing_camera = True
    try:
        need = _camera_consumers_active(services_cfg) > 0
        running = _is_running("camera")
        if need and not running:
            _start_service("camera")
        elif not need and running:
            _stop_service("camera")
    finally:
        _syncing_camera = False


# ── MQTT ──────────────────────────────────────────────────────────────
def _notify_telegram(text: str):
    """Stesso topic/pattern gia' in produzione per gli alert TD
    (osc_bridge.py TDDeviceRegistry._notify()) — un publish su
    gaia/notify/telegram, consumato dal dispatcher Telegram esistente."""
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
    _notify_telegram(f"🔌 Shutdown ({reason}) su {MACHINE_ROLE}:{_cfg.get('device_id')} — in corso.")
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
    global _mqtt_connected
    if reason_code == 0:
        _mqtt_connected = True
        with _cfg_lock:
            device_id = _cfg.get("device_id")
        client.subscribe(f"gaia/device/{device_id}/command")
        client.subscribe("gaia/device/all/command")
        print(f"[MQTT] Connesso — device_id: {device_id}")
        _publish_status()
    else:
        print(f"[MQTT] Connessione fallita rc={reason_code}")


def _on_disconnect(client, userdata, disconnect_flags, reason_code, properties=None):
    global _mqtt_connected, _last_disconnect_ts
    was_connected = _mqtt_connected
    _mqtt_connected = False
    if was_connected:
        _last_disconnect_ts = time.time()
    if reason_code != 0:
        print(f"[MQTT] Disconnesso (rc={reason_code})")


def _maybe_rediscover():
    """Chiamata ad ogni giro del loop principale in main() -- vedi commento
    sopra RECOVERY_THRESHOLD. No-op quasi sempre (early return)."""
    global _next_rediscovery_ts, MQTT_HOST, MQTT_PORT
    if _mqtt_connected or _mqtt is None:
        return
    now = time.time()
    if now - _last_disconnect_ts < RECOVERY_THRESHOLD or now < _next_rediscovery_ts:
        return
    _next_rediscovery_ts = now + RECOVERY_THRESHOLD
    print(f"[Agent] Disconnesso da oltre {RECOVERY_THRESHOLD}s, ri-eseguo discovery...")
    try:
        info = discovery.discover(cached_host=MQTT_HOST)
    except Exception as e:
        print(f"[Agent] Ri-discovery fallita: {e}")
        return
    if info and info.get("mqtt_host") and info["mqtt_host"] != MQTT_HOST:
        print(f"[Agent] Nuovo host trovato: {info['mqtt_host']} (era {MQTT_HOST})")
        MQTT_HOST = info["mqtt_host"]
        MQTT_PORT = int(info.get("mqtt_port", MQTT_PORT))
        try:
            _mqtt.connect_async(MQTT_HOST, MQTT_PORT, 60)
        except Exception as e:
            print(f"[Agent] connect_async fallita: {e}")
    else:
        print("[Agent] Ri-discovery: nessun host migliore trovato, continuo a ritentare quello attuale")


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
        # Contratto agent Windows: reboot/shutdown via MQTT/Pi Manager/
        # Telegram su QUALSIASI macchina Windows (prima "reboot" era
        # ignorato apposta su OPS, "non e' un Pi headless" — richiesto
        # esplicitamente in seguito, vedi docs/agent-windows-contract.md).
        print("[Agent] Reboot richiesto via MQTT — eseguo tra 5s.")
        _notify_telegram(f"🔄 Reboot richiesto da remoto su {MACHINE_ROLE}:{_cfg.get('device_id')} — in corso.")
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


# ── Watchdog (solo se WATCHDOG_ENABLED, vedi manifest "watchdog") ──────
def _watchdog_loop():
    """Riavvia da solo un servizio "enabled" che risulta caduto, non solo
    su comando MQTT esplicito -- per le macchine non presidiate
    (WATCHDOG_ENABLED, contratto in docs/agent-windows-contract.md).
    Ritenta A OLTRANZA -- mai un reboot automatico dell'intera macchina.
    Dopo WATCHDOG_ALERT_AFTER fallimenti CONSECUTIVI per lo stesso
    servizio, un solo alert Telegram (non uno ad ogni giro) finche' non
    recupera. Gestisce anche shutdown_at (spegnimento programmato) qui
    invece che in un thread separato -- gia' un loop periodico."""
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
            if key == "camera":
                continue  # gestita solo via ref-count (_sync_camera), mai dal watchdog
            if not scfg.get("enabled"):
                _watchdog_fail_counts.pop(key, None)
                _watchdog_alerted.discard(key)
                continue
            if _is_running(key):
                if _watchdog_fail_counts.pop(key, None):
                    print(f"[Watchdog] {key}: recuperato")
                    if key in _watchdog_alerted:
                        _watchdog_alerted.discard(key)
                        _notify_telegram(f"✅ \"{key}\" di nuovo attivo su {_cfg.get('device_id')}.")
                continue
            fails = _watchdog_fail_counts.get(key, 0) + 1
            _watchdog_fail_counts[key] = fails
            print(f"[Watchdog] {key}: caduto (fallimento #{fails}), riavvio...")
            _restart_service(key)
            if fails >= WATCHDOG_ALERT_AFTER and key not in _watchdog_alerted:
                _watchdog_alerted.add(key)
                _notify_telegram(
                    f"⚠️ \"{key}\" non riparte da {fails} tentativi consecutivi "
                    f"su {_cfg.get('device_id')} — il watchdog continua a ritentare."
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
    global _cfg, _mqtt, MQTT_HOST

    _acquire_lock()
    _cfg = load_config()
    print(f"[GAIA Installation Agent] device_id : {_cfg['device_id']}")
    print(f"[GAIA Installation Agent] stanza    : {_cfg['stanza']}")
    print(f"[GAIA Installation Agent] role      : {MACHINE_ROLE}")
    print(f"[GAIA Installation Agent] watchdog  : {WATCHDOG_ENABLED}")

    # Discovery PRIMA di tutto -- no-op quasi ovunque (cache/broadcast/mDNS
    # trovano Core sulla LAN in un attimo), ma copre anche OPS ora: se l'IP
    # LAN di Core cambiasse, l'agent lo ritrova da solo invece di restare
    # puntato su un host morto (vedi commento su RECOVERY_THRESHOLD sopra).
    info = discovery.discover(cached_host=MQTT_HOST)
    if info and info.get("mqtt_host") and info["mqtt_host"] != MQTT_HOST:
        print(f"[GAIA Installation Agent] Gaia Core trovato: {info['mqtt_host']} (default era {MQTT_HOST})")
        MQTT_HOST = info["mqtt_host"]

    print(f"[GAIA Installation Agent] MQTT      : {MQTT_HOST}:{MQTT_PORT}")
    print(f"[GAIA Installation Agent] Servizi   : {list(_SERVICE_DEFS.keys())}")

    apply_initial_config()

    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-installation-agent-{_cfg['device_id']}")
    _mqtt.on_connect = _on_connect
    _mqtt.on_disconnect = _on_disconnect
    _mqtt.on_message = _on_message
    _mqtt.reconnect_delay_set(min_delay=2, max_delay=30)

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
            print(f"[GAIA Installation Agent] Connessione MQTT fallita ({e}), riprovo tra {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
    if not _running:
        return
    _mqtt.loop_start()

    if WATCHDOG_ENABLED:
        threading.Thread(target=_watchdog_loop, daemon=True).start()

    last_hb = 0
    while _running:
        if time.time() - last_hb >= HEARTBEAT_INTERVAL:
            _publish_status()
            last_hb = time.time()
        _maybe_rediscover()
        time.sleep(1)

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA Installation Agent] Terminato.")


if __name__ == "__main__":
    main()
