#!/usr/bin/env python3
"""
GAIA Provisioning WiFi — livello 2 (docs/provisioning-wifi.md)

Daemon che porta un Pi "vergine" (o che ha perso la rete) in rete:

  BOOT ──► online? ──sì──► idle (ricontrolla ogni CHECK_S)
             │no (per più di OFFLINE_GRACE_S)
             ▼
        AP MODE  "Gaia-Setup-XXXX" (nmcli hotspot, WPA2)
        + captive portal HTTP :80 su 10.42.0.1
             │ submit (ssid, psk, stanza)
             ▼
        teardown AP → nmcli device wifi connect
             ├─ ok  → torna idle (l'agent farà discovery+provision)
             └─ fail → riaccende AP, portale mostra l'errore

Ogni AP_RETRY_S l'AP viene comunque abbassato per RETRY_WINDOW_S per
lasciare che NetworkManager ritenti l'autoconnect alle reti note (caso
"il router era solo spento").

Il portale è anche il MENU STANDALONE (2026-07-16, "modalità bosco"):
quando il Pi è isolato (installazione artistica, nessun Core) la stessa
pagina — dal telefono via hotspot o dal touchscreen (kiosk →
http://localhost/) — permette di accendere/spegnere i servizi gaia-*,
regolare il volume e riavviare. I toggle passano da systemctl (siamo
root) e persistono in agent/device.json, così l'agent riporta tutto
allo stesso stato al prossimo boot anche senza rete.

Gira come root (nmcli + porta 80). Config via env / EnvironmentFile
/etc/gaia/provision.conf:
  AP_IFACE=wlan0  AP_PASSWORD=gaiasetup  PORTAL_PORT=80
  CHECK_S=30  OFFLINE_GRACE_S=60  AP_RETRY_S=600  RETRY_WINDOW_S=60
  GAIA_PROVISION_FORCE_AP=1   ← solo test: AP subito, ignora lo stato rete
"""
import json
import os
import pwd
import re
import socket
import subprocess
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ── Config ────────────────────────────────────────────────────────────
AP_IFACE        = os.getenv("AP_IFACE", "wlan0")
AP_PASSWORD     = os.getenv("AP_PASSWORD", "gaiasetup")     # WPA2, min 8 char
PORTAL_PORT     = int(os.getenv("PORTAL_PORT", "80"))
CHECK_S         = int(os.getenv("CHECK_S", "30"))
OFFLINE_GRACE_S = int(os.getenv("OFFLINE_GRACE_S", "60"))  # 2026-08-11: era 180
AP_RETRY_S      = int(os.getenv("AP_RETRY_S", "600"))
RETRY_WINDOW_S  = int(os.getenv("RETRY_WINDOW_S", "60"))
FORCE_AP        = os.getenv("GAIA_PROVISION_FORCE_AP", "0") == "1"

AP_CON_NAME = "gaia-setup"          # nome profilo NM dell'hotspot

_DIR        = os.path.dirname(os.path.abspath(__file__))
_GAIA_ROOT  = os.path.dirname(_DIR)
DEVICE_JSON = os.path.join(_GAIA_ROOT, "agent", "device.json")

# ── Stato condiviso col portale ───────────────────────────────────────
_state = {
    "mode":       "starting",   # starting | idle | ap | connecting
    "last_error": None,
    "ssids":      [],           # scan pre-AP: [{ssid, signal, security}]
    "submitted":  None,         # credenziali in attesa di essere provate
}
_state_lock = threading.Lock()


def log(msg: str):
    print(f"[Provision] {msg}", flush=True)


# ── nmcli helpers ─────────────────────────────────────────────────────
def _nmcli(*args, timeout=30) -> subprocess.CompletedProcess:
    return subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)


def _device_id_suffix() -> str:
    for iface in ("eth0", AP_IFACE):
        p = f"/sys/class/net/{iface}/address"
        if os.path.exists(p):
            return open(p).read().strip().replace(":", "")[-4:].upper()
    return "0000"


AP_SSID = f"Gaia-Setup-{_device_id_suffix()}"


def is_online() -> bool:
    """Online = un device ethernet/wifi attivo con IPv4, che non sia il
    nostro hotspot. (Non richiede internet: basta la LAN, Gaia è locale.)"""
    r = _nmcli("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status")
    for line in r.stdout.splitlines():
        parts = line.split(":")
        if len(parts) < 4:
            continue
        dev, typ, st, con = parts[0], parts[1], parts[2], parts[3]
        if typ not in ("ethernet", "wifi") or con == AP_CON_NAME:
            continue
        if not (st.startswith("connected") or st.startswith("collegato")):
            continue
        ip = _nmcli("-t", "-f", "IP4.ADDRESS", "device", "show", dev)
        if "IP4.ADDRESS" in ip.stdout:
            return True
    return False


def scan_wifi() -> list[dict]:
    """Scan reti visibili (da fare PRIMA di accendere l'AP: in AP mode
    lo scan è inaffidabile). Deduplica per SSID tenendo il segnale max."""
    _nmcli("device", "wifi", "rescan", timeout=20)
    time.sleep(3)
    r = _nmcli("-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list")
    best: dict[str, dict] = {}
    for line in r.stdout.splitlines():
        m = re.match(r"^(.*):(\d+):(.*)$", line)
        if not m or not m.group(1):
            continue
        ssid, sig, sec = m.group(1), int(m.group(2)), m.group(3)
        if ssid == AP_SSID:
            continue
        if ssid not in best or sig > best[ssid]["signal"]:
            best[ssid] = {"ssid": ssid, "signal": sig, "security": sec or "open"}
    return sorted(best.values(), key=lambda x: -x["signal"])


def ap_up() -> bool:
    log(f"Accendo AP {AP_SSID} su {AP_IFACE}")
    _nmcli("connection", "delete", AP_CON_NAME)   # pulizia profilo precedente
    r = _nmcli("device", "wifi", "hotspot",
               "ifname", AP_IFACE, "con-name", AP_CON_NAME,
               "ssid", AP_SSID, "band", "bg", "password", AP_PASSWORD,
               timeout=45)
    if r.returncode != 0:
        log(f"Hotspot FALLITO: {r.stderr.strip()[:200]}")
        return False
    return True


def ap_down():
    log("Spengo AP")
    _nmcli("connection", "down", AP_CON_NAME)
    _nmcli("connection", "delete", AP_CON_NAME)


def try_connect(ssid: str, psk: str) -> tuple[bool, str]:
    """Prova a connettersi alla rete indicata. Ritorna (ok, errore)."""
    log(f"Provo connessione a '{ssid}'")
    _nmcli("device", "wifi", "rescan", timeout=20)
    time.sleep(3)
    args = ["device", "wifi", "connect", ssid, "ifname", AP_IFACE]
    if psk:
        args += ["password", psk]
    r = _nmcli(*args, timeout=75)
    if r.returncode == 0 and "successfully" in (r.stdout + r.stderr).lower() or r.returncode == 0:
        log(f"Connesso a '{ssid}'")
        return True, ""
    err = (r.stderr or r.stdout).strip()[:200]
    log(f"Connessione fallita: {err}")
    # Profilo fallito: rimuovilo per non lasciare autoconnect rotti
    _nmcli("connection", "delete", ssid)
    return False, err


def save_stanza(stanza: str):
    """Merge della stanza in agent/device.json (l'agent la usa al prossimo
    avvio; se già in rete, l'assegnazione passa comunque dal provision)."""
    if not stanza:
        return
    try:
        cfg = {}
        if os.path.exists(DEVICE_JSON):
            cfg = json.load(open(DEVICE_JSON))
        cfg["stanza"] = stanza
        with open(DEVICE_JSON, "w") as f:
            json.dump(cfg, f, indent=2)
        log(f"Stanza salvata in device.json: {stanza}")
    except Exception as e:
        log(f"Errore salvataggio stanza (ignoro): {e}")


# ── Servizi standalone (menu nel portale) ─────────────────────────────
GAIA_SERVICES = [
    ("camera",      "📷", "Camera — serve la pagina web camere"),
    ("herbarium",   "🌿", "Herbarium — le piante suonano"),
    ("mediaplayer", "🎵", "Media player"),
    ("screen",      "✴️", "Sigillo asemico (display)"),
    ("kiosk",       "🖥️", "Welcome kiosk (display)"),
    ("voice",       "🎤", "Voce — wakeword e TTS"),
    ("yolo",        "👁️", "Visione YOLO"),
    ("mediapipe",   "🖐️", "MediaPipe — gesti e pose"),
    ("livestream",  "📡", "LiveStream — trasmetti la stanza"),
]
_SVC_NAMES       = {s[0] for s in GAIA_SERVICES}
SVC_CONFLICTS    = {"screen": "kiosk", "kiosk": "screen"}  # Conflicts= reciproco nei .service
CAMERA_CONSUMERS = ("yolo", "mediapipe", "kiosk")          # chi la richiede come dipendenza (mai auto-stop, vedi agent.py)

# Preset del motore musicale Herbarium — stessi nomi/etichette di
# web/admin.html (HERB_PRESETS) e chiavi di herbarium/music_engine.py
# (PRESETS), duplicati qui per lo stesso motivo di camera_client.py/ota.py
# (docs/pi/CLAUDE.md): il portale deve restare autonomo, senza dipendere da
# un file condiviso raggiungibile solo con Core in rete.
HERB_PRESETS = [
    ("pentatonica_calma", "Pentatonica calma"),
    ("accordi_maggiori",  "Accordi maggiori"),
    ("drone_modale",      "Drone modale"),
    ("arpeggio_arioso",   "Arpeggio arioso"),
    ("blues_notturno",    "Blues notturno"),
    ("cromatico_libero",  "Cromatico libero"),
    ("ambient_profondo",    "Ambient profondo"),
    ("ambient_cristallino", "Ambient cristallino"),
    ("ambient_notturno",    "Ambient notturno"),
    ("ambient_respiro",     "Ambient respiro"),
    ("ambient_alba",        "Ambient alba"),
    ("melodico_cantabile",  "Melodico cantabile"),
    ("drone_infinito",      "Drone infinito"),
    ("arabeggiante",        "Arabeggiante"),
]
_HERB_PRESET_NAMES = {k for k, _ in HERB_PRESETS}
HERBARIUM_CONF = "/etc/gaia/herbarium.conf"


def _read_herbarium_conf() -> dict:
    cfg = {}
    if os.path.exists(HERBARIUM_CONF):
        with open(HERBARIUM_CONF) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip()
    return cfg


def get_herb_preset() -> str:
    return _read_herbarium_conf().get("HERBARIUM_ENGINE_PRESET", "pentatonica_calma")


def set_herb_preset(name: str) -> tuple[bool, str]:
    """Scrive HERBARIUM_ENGINE_PRESET in herbarium.conf (EnvironmentFile del
    servizio) e riavvia gaia-herbarium se già attivo, per applicarlo subito
    invece che al prossimo boot — nessuna dipendenza da MQTT/Core."""
    if name not in _HERB_PRESET_NAMES:
        return False, "preset non valido"
    cfg = _read_herbarium_conf()
    cfg["HERBARIUM_ENGINE_PRESET"] = name
    try:
        with open(HERBARIUM_CONF, "w") as f:
            for k, v in cfg.items():
                f.write(f"{k}={v}\n")
    except OSError as e:
        return False, str(e)
    log(f"Preset Herbarium impostato: {name}")
    if _svc_active("herbarium"):
        _systemctl("restart", "gaia-herbarium")
    return True, ""


def get_drum_volume() -> int:
    try:
        return int(_read_herbarium_conf().get("HERBARIUM_DRUM_VOLUME", "100"))
    except ValueError:
        return 100


def set_drum_volume(value: int) -> tuple[bool, str]:
    """Stesso principio di set_herb_preset: scrive HERBARIUM_DRUM_VOLUME in
    herbarium.conf e riavvia gaia-herbarium se già attivo."""
    value = max(0, min(100, value))
    cfg = _read_herbarium_conf()
    cfg["HERBARIUM_DRUM_VOLUME"] = str(value)
    try:
        with open(HERBARIUM_CONF, "w") as f:
            for k, v in cfg.items():
                f.write(f"{k}={v}\n")
    except OSError as e:
        return False, str(e)
    log(f"Volume batteria Herbarium impostato: {value}%")
    if _svc_active("herbarium"):
        _systemctl("restart", "gaia-herbarium")
    return True, ""


LIVESTREAM_CONF = "/etc/gaia/livestream.conf"


def _read_livestream_conf() -> dict:
    cfg = {}
    if os.path.exists(LIVESTREAM_CONF):
        with open(LIVESTREAM_CONF) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip()
    return cfg


def get_livestream_source() -> str:
    return _read_livestream_conf().get("LIVESTREAM_SOURCE", "mic")


def set_livestream_source(source: str) -> tuple[bool, str]:
    """Stesso principio di set_herb_preset: scrive LIVESTREAM_SOURCE in
    livestream.conf e riavvia gaia-livestream se già attivo."""
    if source not in ("mic", "library"):
        return False, "sorgente non valida"
    cfg = _read_livestream_conf()
    cfg["LIVESTREAM_SOURCE"] = source
    try:
        with open(LIVESTREAM_CONF, "w") as f:
            for k, v in cfg.items():
                f.write(f"{k}={v}\n")
    except OSError as e:
        return False, str(e)
    log(f"Sorgente LiveStream impostata: {source}")
    if _svc_active("livestream"):
        _systemctl("restart", "gaia-livestream")
    return True, ""


def get_stream_url() -> str:
    """URL dello stream icecast locale — costruito dall'IP che questo Pi usa
    davvero in questo momento (AP mode 10.42.0.1, o l'IP di LAN una volta
    connesso), non hardcodato."""
    mount = _read_livestream_conf().get("LIVESTREAM_MOUNT", "stream.ogg")
    port = _read_livestream_conf().get("ICECAST_PORT", "8000")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except OSError:
        ip = "127.0.0.1"
    return f"http://{ip}:{port}/{mount}"


def _systemctl(*args) -> subprocess.CompletedProcess:
    return subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=60)


def _svc_active(name: str) -> bool:
    return _systemctl("is-active", f"gaia-{name}").stdout.strip() == "active"


def _load_device_cfg() -> dict:
    try:
        return json.load(open(DEVICE_JSON))
    except (OSError, ValueError):
        return {}


def _save_device_cfg(cfg: dict):
    try:
        st = os.stat(DEVICE_JSON) if os.path.exists(DEVICE_JSON) else os.stat(_GAIA_ROOT)
        with open(DEVICE_JSON, "w") as f:
            json.dump(cfg, f, indent=2)
        os.chown(DEVICE_JSON, st.st_uid, st.st_gid)  # il portale è root: il file resta dell'utente
    except OSError as e:
        log(f"Errore salvataggio device.json (ignoro): {e}")


def _ensure_camera(cfg: dict):
    """Se un consumer (yolo/mediapipe/kiosk) sta per partire, assicura che
    gaia-camera sia già attiva. Solo one-way: non la ferma mai in automatico —
    la camera è un servizio base indipendente (serve anche da sola web/cameras.html),
    esattamente come in agent.py. Serve perché qui bypassiamo l'agent (che
    gestisce le dipendenze solo sui comandi MQTT — e nel bosco MQTT non c'è)."""
    if not _svc_active("camera"):
        _systemctl("start", "gaia-camera")
    cfg.setdefault("services", {}).setdefault("camera", {})["enabled"] = True


def toggle_service(name: str, action: str) -> tuple[bool, str]:
    """systemctl start/stop + persistenza enabled in device.json."""
    if name not in _SVC_NAMES or action not in ("start", "stop"):
        return False, "servizio o azione non validi"
    cfg = _load_device_cfg()
    services = cfg.setdefault("services", {})
    if action == "start" and name in SVC_CONFLICTS:
        # systemd ferma l'altro da solo (Conflicts=): allinea solo il flag
        services.setdefault(SVC_CONFLICTS[name], {})["enabled"] = False
    r = _systemctl(action, f"gaia-{name}")
    if r.returncode != 0:
        return False, (r.stderr or r.stdout).strip()[:200]
    services.setdefault(name, {})["enabled"] = (action == "start")
    if action == "start" and name in CAMERA_CONSUMERS:
        _ensure_camera(cfg)
    _save_device_cfg(cfg)
    log(f"Servizio {name}: {action}")
    return True, ""


def _audio_user() -> pwd.struct_passwd:
    return pwd.getpwuid(os.stat(_GAIA_ROOT).st_uid)


def _wpctl(*args) -> subprocess.CompletedProcess:
    """wpctl nella sessione PipeWire dell'utente gaia (il portale è root)."""
    u = _audio_user()
    return subprocess.run(
        ["runuser", "-u", u.pw_name, "--", "env",
         f"XDG_RUNTIME_DIR=/run/user/{u.pw_uid}", "wpctl", *args],
        capture_output=True, text=True, timeout=10)


def get_volume() -> int | None:
    try:
        m = re.search(r"Volume:\s*([\d.]+)",
                      _wpctl("get-volume", "@DEFAULT_AUDIO_SINK@").stdout)
        return round(float(m.group(1)) * 100) if m else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def set_volume(pct: int):
    _wpctl("set-volume", "@DEFAULT_AUDIO_SINK@", f"{max(0, min(100, int(pct)))}%")


def services_state() -> dict:
    cfg = _load_device_cfg()
    services = cfg.get("services", {})
    return {
        "services": [
            {"name": n, "icon": ic, "label": lb, "active": _svc_active(n),
             "enabled": services.get(n, {}).get("enabled", False)}
            for n, ic, lb in GAIA_SERVICES],
        "volume": get_volume(),
        "stanza": cfg.get("stanza"),
        "herb_preset": get_herb_preset(),
        "herb_drum_volume": get_drum_volume(),
        "livestream_source": get_livestream_source(),
        "stream_url": get_stream_url(),
    }


# ── Captive portal ────────────────────────────────────────────────────
PORTAL_HTML = """<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gaia — Configurazione WiFi</title>
<style>
 body{background:#0d1117;color:#e6edf3;font-family:system-ui;margin:0;
      display:flex;justify-content:center;min-height:100vh}
 .box{width:100%;max-width:420px;padding:24px}
 h1{color:#00ffcc;font-size:1.5rem;margin:16px 0 4px}
 p.sub{color:#8b949e;margin:0 0 20px;font-size:.9rem}
 label{display:block;color:#8b949e;font-size:.8rem;margin:14px 0 4px;text-transform:uppercase}
 select,input{width:100%;box-sizing:border-box;padding:14px;font-size:1.05rem;
      background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:10px}
 button{width:100%;margin-top:22px;padding:16px;font-size:1.1rem;font-weight:600;
      background:#00ffcc;color:#0d1117;border:none;border-radius:10px;min-height:56px}
 button:disabled{opacity:.5}
 .err{background:#3d1d20;border:1px solid #f85149;color:#f85149;
      padding:10px 14px;border-radius:8px;margin-top:16px;font-size:.9rem}
 .ok{background:#12261e;border:1px solid #2ea043;color:#3fb950;
      padding:10px 14px;border-radius:8px;margin-top:16px;font-size:.95rem}
 .ring{width:64px;height:64px;border-radius:50%;border:3px solid #00ffcc;
      margin:8px auto 0;box-shadow:0 0 24px #00ffcc55}
 h2{font-size:.85rem;color:#8b949e;margin:26px 0 10px;text-transform:uppercase;letter-spacing:.06em}
 .svc{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#161b22;
      border:1px solid #30363d;border-radius:10px;margin-bottom:8px}
 .svc .nm{flex:1;font-size:.95rem}
 .dot{width:10px;height:10px;border-radius:50%;background:#30363d;flex-shrink:0}
 .dot.on{background:#3fb950;box-shadow:0 0 8px #3fb95088}
 .svc button{width:auto;margin:0;padding:8px 14px;min-height:40px;font-size:.85rem;border-radius:8px}
 .svc button.stop{background:#21262d;color:#e6edf3;border:1px solid #30363d}
 .volrow{display:flex;align-items:center;gap:12px;padding:4px 2px;font-size:1.1rem}
 .volrow input{flex:1;accent-color:#00ffcc;padding:0}
 .volrow span.pct{width:48px;text-align:right;font-size:.9rem;color:#8b949e}
 details{margin-top:26px}
 summary{color:#8b949e;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;
      cursor:pointer;margin-bottom:4px}
 .ghost{background:none;border:1px solid #30363d;color:#8b949e;font-weight:400;
      min-height:44px;padding:10px;font-size:.9rem}
</style></head><body><div class="box">
<div class="ring"></div>
<h1>Ciao, sono Gaia</h1>
<p class="sub">%SUBTITLE%</p>
%ERROR%
<h2>Servizi</h2>
<div id="svcs" style="color:#8b949e;font-size:.9rem">carico…</div>
<div class="volrow" style="margin-top:6px">🎼<select id="herbpreset" style="flex:1"></select>
  <button style="width:auto;margin:0;padding:8px 14px;min-height:40px;font-size:.85rem;border-radius:8px"
    onclick="setPreset(this)">Applica</button></div>
<div class="volrow">🥁<input type="range" id="herbdrumvol" min="0" max="100" value="100"
  oninput="document.getElementById('herbdrumvollab').textContent=this.value+'%'"
  onchange="setDrumVolume(this.value)"><span class="pct" id="herbdrumvollab">—</span></div>
<div class="volrow" style="margin-top:6px">📡<select id="livestreamsource" style="flex:1">
  <option value="mic">Microfono</option><option value="library">Libreria locale</option></select>
  <button style="width:auto;margin:0;padding:8px 14px;min-height:40px;font-size:.85rem;border-radius:8px"
    onclick="setLivestreamSource(this)">Applica</button></div>
<div id="streamlink" style="font-size:.8rem;color:#8b949e;margin:-2px 0 6px;word-break:break-all"></div>
<div class="volrow">🔊<input type="range" id="vol" min="0" max="100" value="60"
  oninput="document.getElementById('vollab').textContent=this.value+'%'"
  onchange="setVol(this.value)"><span class="pct" id="vollab">—</span></div>
<details %WIFI_OPEN%><summary>Rete WiFi</summary>
<form onsubmit="return send(this)">
  <label>Rete WiFi</label>
  <select name="ssid" id="ssid">%OPTIONS%</select>
  <label>Password WiFi</label>
  <input name="psk" type="password" autocomplete="off" placeholder="password della rete">
  <label>Stanza (opzionale)</label>
  <input name="stanza" placeholder="es. ingresso, salotto…" autocapitalize="none">
  <button id="btn" type="submit">Connetti Gaia →</button>
</form>
<div id="msg"></div>
</details>
<button class="ghost" style="width:100%;margin-top:26px"
  onclick="if(confirm('Riavviare Gaia?'))fetch('/reboot',{method:'POST'})">↻ Riavvia Gaia</button>
<button class="ghost" style="width:100%;margin-top:10px"
  onclick="if(confirm('Spegnere Gaia? Per riaccenderlo servirà staccare/riattaccare l\\'alimentazione.'))fetch('/shutdown',{method:'POST'})">⏻ Spegni Gaia</button>
<script>
function send(f){
  document.getElementById('btn').disabled = true;
  fetch('/connect', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ssid:f.ssid.value, psk:f.psk.value, stanza:f.stanza.value.trim().toLowerCase()})})
  .then(r=>r.json()).then(d=>{
    document.getElementById('msg').innerHTML =
      '<div class="ok">Sto provando a connettermi a <b>'+f.ssid.value+'</b>…<br>' +
      'Se la rete <b>%SSID%</b> sparisce, ha funzionato: ricollega il telefono al WiFi di casa.<br>' +
      'Se riappare, la password era sbagliata: riprova.</div>';
  }).catch(()=>{ document.getElementById('btn').disabled = false; });
  return false;
}
function svcRow(s){
  return '<div class="svc"><span class="dot '+(s.active?'on':'')+'"></span>'+
    '<span class="nm">'+s.icon+' '+s.label+'</span>'+
    '<button class="'+(s.active?'stop':'')+'" onclick="toggle(\\''+s.name+'\\','+s.active+',this)">'+
    (s.active?'Spegni':'Accendi')+'</button></div>';
}
var HERB_PRESETS = [["pentatonica_calma","Pentatonica calma"],["accordi_maggiori","Accordi maggiori"],
  ["drone_modale","Drone modale"],["arpeggio_arioso","Arpeggio arioso"],["blues_notturno","Blues notturno"],
  ["cromatico_libero","Cromatico libero"],["ambient_profondo","Ambient profondo"],
  ["ambient_cristallino","Ambient cristallino"],["ambient_notturno","Ambient notturno"],
  ["ambient_respiro","Ambient respiro"],["ambient_alba","Ambient alba"],
  ["melodico_cantabile","Melodico cantabile"],["drone_infinito","Drone infinito"],
  ["arabeggiante","Arabeggiante"]];
document.getElementById('herbpreset').innerHTML =
  HERB_PRESETS.map(function(p){return '<option value="'+p[0]+'">'+p[1]+'</option>';}).join('');
function render(d){
  document.getElementById('svcs').innerHTML = d.services.map(svcRow).join('');
  var v = document.getElementById('vol');
  if(d.volume!=null && document.activeElement!==v){
    v.value = d.volume;
    document.getElementById('vollab').textContent = d.volume+'%';
  }
  var p = document.getElementById('herbpreset');
  if(d.herb_preset && document.activeElement!==p) p.value = d.herb_preset;
  var dv = document.getElementById('herbdrumvol');
  if(d.herb_drum_volume!=null && document.activeElement!==dv){
    dv.value = d.herb_drum_volume;
    document.getElementById('herbdrumvollab').textContent = d.herb_drum_volume+'%';
  }
  var ls = document.getElementById('livestreamsource');
  if(d.livestream_source && document.activeElement!==ls) ls.value = d.livestream_source;
  if(d.stream_url) document.getElementById('streamlink').innerHTML =
    'Link stream: <a href="'+d.stream_url+'" style="color:#00ffcc" target="_blank">'+d.stream_url+'</a>';
}
function loadSvcs(){ fetch('/services').then(r=>r.json()).then(render).catch(()=>{}); }
function setPreset(btn){
  var sel = document.getElementById('herbpreset');
  btn.disabled = true; btn.textContent = '…';
  fetch('/herbarium/preset',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({preset: sel.value})})
  .then(r=>r.json()).then(d=>{ btn.disabled=false; btn.textContent='Applica'; if(d.error) alert(d.error); })
  .catch(()=>{ btn.disabled=false; btn.textContent='Applica'; });
}
function setDrumVolume(v){
  fetch('/herbarium/drum_volume',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({value:+v})});
}
function setLivestreamSource(btn){
  var sel = document.getElementById('livestreamsource');
  btn.disabled = true; btn.textContent = '…';
  fetch('/livestream/source',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({source: sel.value})})
  .then(r=>r.json()).then(d=>{ btn.disabled=false; btn.textContent='Applica'; if(d.error) alert(d.error); })
  .catch(()=>{ btn.disabled=false; btn.textContent='Applica'; });
}
function toggle(name,active,btn){
  btn.disabled = true; btn.textContent = '…';
  fetch('/service',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({service:name, action:active?'stop':'start'})})
  .then(r=>r.json()).then(d=>{ render(d); if(d.error) alert(d.error); })
  .catch(()=>loadSvcs());
}
function setVol(v){
  fetch('/volume',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({value:+v})});
}
loadSvcs(); setInterval(loadSvcs, 10000);
</script>
</div></body></html>"""

# Endpoint di rilevamento captive dei vari OS: qualsiasi GET fuori da "/"
# riceve un redirect → il telefono apre il popup del portale.
CAPTIVE_PROBES = ("/generate_204", "/gen_204", "/hotspot-detect.html",
                  "/connecttest.txt", "/ncsi.txt", "/success.txt",
                  "/canonical.html", "/redirect")


class PortalHandler(BaseHTTPRequestHandler):

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/status":
            with _state_lock:
                self._send_json({k: _state[k] for k in ("mode", "last_error")})
            return
        if path == "/services":
            self._send_json(services_state())
            return
        with _state_lock:
            cur_mode = _state["mode"]
        if path != "/":
            if cur_mode == "ap":
                # probe captive → redirect al portale (solo in hotspot)
                self.send_response(302)
                self.send_header("Location", "http://10.42.0.1/")
                self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()
            return
        if cur_mode != "ap":
            # Online (gestione rete da LAN): scan fresco a ogni apertura —
            # in AP mode invece lo scan è fatto prima di accendere l'hotspot
            # perché l'AP occupa la radio.
            fresh = scan_wifi()
            with _state_lock:
                if fresh:
                    _state["ssids"] = fresh
        with _state_lock:
            ssids = list(_state["ssids"])
            err   = _state["last_error"]
        opts = "".join(
            f'<option value="{s["ssid"]}">{s["ssid"]}  ({s["signal"]}%)</option>'
            for s in ssids) or '<option value="">nessuna rete trovata</option>'
        subtitle = ("Accendi i servizi che vuoi qui sotto — funziono anche da sola. "
                    "Oppure collegami alla rete WiFi di casa."
                    if cur_mode == "ap" else
                    "Sono online. Da qui gestisci i miei servizi e la rete WiFi — se qualcosa "
                    "va storto, dopo 3 minuti accendo l'hotspot di soccorso Gaia-Setup.")
        html = (PORTAL_HTML
                .replace("%OPTIONS%", opts)
                .replace("%SUBTITLE%", subtitle)
                .replace("%SSID%", AP_SSID)
                .replace("%WIFI_OPEN%", "open" if cur_mode == "ap" else "")
                .replace("%ERROR%", f'<div class="err">Ultimo tentativo fallito: {err}</div>' if err else ""))
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except ValueError:
            self.send_response(400); self.end_headers(); return

        if path == "/connect":
            ssid = (body.get("ssid") or "").strip()
            with _state_lock:
                _state["submitted"] = {
                    "ssid": ssid,
                    "psk": body.get("psk") or "",
                    "stanza": (body.get("stanza") or "").strip(),
                }
            log(f"Portale: credenziali ricevute per '{ssid}'")
            self._send_json({"ok": True})
            return

        if path == "/service":
            ok, err = toggle_service((body.get("service") or "").strip(),
                                     (body.get("action") or "").strip())
            state = services_state()
            state["ok"] = ok
            if err:
                state["error"] = err
            self._send_json(state)
            return

        if path == "/volume":
            try:
                set_volume(int(body.get("value")))
            except (TypeError, ValueError):
                self._send_json({"ok": False}, 400)
                return
            self._send_json({"ok": True, "volume": get_volume()})
            return

        if path == "/herbarium/preset":
            ok, err = set_herb_preset((body.get("preset") or "").strip())
            resp = {"ok": ok, "herb_preset": get_herb_preset()}
            if err:
                resp["error"] = err
            self._send_json(resp)
            return

        if path == "/herbarium/drum_volume":
            try:
                ok, err = set_drum_volume(int(body.get("value")))
            except (TypeError, ValueError):
                self._send_json({"ok": False, "error": "valore non valido"}, 400)
                return
            resp = {"ok": ok, "herb_drum_volume": get_drum_volume()}
            if err:
                resp["error"] = err
            self._send_json(resp)
            return

        if path == "/livestream/source":
            ok, err = set_livestream_source((body.get("source") or "").strip())
            resp = {"ok": ok, "livestream_source": get_livestream_source()}
            if err:
                resp["error"] = err
            self._send_json(resp)
            return

        if path == "/reboot":
            log("Riavvio richiesto dal portale")
            self._send_json({"ok": True})
            threading.Timer(2, lambda: subprocess.run(["systemctl", "reboot"])).start()
            return

        if path == "/shutdown":
            log("Spegnimento richiesto dal portale")
            self._send_json({"ok": True})
            threading.Timer(2, lambda: subprocess.run(["systemctl", "poweroff"])).start()
            return

        self.send_response(404); self.end_headers()

    def log_message(self, *_):
        pass


def start_portal() -> HTTPServer:
    srv = HTTPServer(("0.0.0.0", PORTAL_PORT), PortalHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log(f"Portale HTTP attivo su :{PORTAL_PORT}")
    return srv


# ── Main loop ─────────────────────────────────────────────────────────
def main():
    log(f"Avvio — AP SSID: {AP_SSID}, iface: {AP_IFACE}, force_ap: {FORCE_AP}")
    ap_down()   # pulizia: nessun hotspot orfano da run precedenti

    # Portale SEMPRE attivo (2026-07-10): anche online serve la pagina di
    # gestione rete su http://<ip-lan>/ — cambio rete senza aspettare il
    # soccorso hotspot. La rete di sicurezza resta: se il cambio va male e
    # il Pi finisce offline, dopo OFFLINE_GRACE_S nasce comunque l'AP.
    portal = start_portal()
    offline_since = None
    ap_started_at = None

    while True:
        online = is_online() and not FORCE_AP

        with _state_lock:
            mode = _state["mode"]

        if online:
            if mode == "ap":
                log("Rete tornata: chiudo AP (il portale resta per la gestione da LAN)")
                ap_down()
            offline_since = None
            with _state_lock:
                _state["mode"] = "idle"
                _state["last_error"] = None
                sub = _state["submitted"]
                _state["submitted"] = None
            if sub:
                # Cambio rete richiesto DA ONLINE: tenta il join; se fallisce,
                # NetworkManager riaggancia il profilo precedente (autoconnect)
                # e in ultima istanza scatta il soccorso hotspot.
                log(f"Cambio rete da online → '{sub['ssid']}'")
                save_stanza(sub["stanza"])
                time.sleep(2)          # lascia arrivare la risposta HTTP al client
                ok, err = try_connect(sub["ssid"], sub["psk"])
                with _state_lock:
                    _state["last_error"] = None if ok else (err or "connessione fallita")
                log(f"Cambio rete: {'OK' if ok else 'FALLITO — ' + str(err)}")
            time.sleep(CHECK_S)
            continue

        # ── offline ──
        if offline_since is None:
            offline_since = time.time()
            log("Offline: aspetto autoconnect NetworkManager "
                f"({0 if FORCE_AP else OFFLINE_GRACE_S}s di grazia)")

        if not FORCE_AP and time.time() - offline_since < OFFLINE_GRACE_S:
            time.sleep(5)
            continue

        if mode != "ap":
            # Scan PRIMA di accendere l'AP
            with _state_lock:
                _state["ssids"] = scan_wifi()
                log(f"Scan: {len(_state['ssids'])} reti")
            if not ap_up():
                time.sleep(30)
                continue
            if portal is None:
                portal = start_portal()
            ap_started_at = time.time()
            with _state_lock:
                _state["mode"] = "ap"
            log(f"AP attivo: SSID={AP_SSID} pass={AP_PASSWORD} portale=http://10.42.0.1/")

        # ── in AP mode: attendi credenziali dal portale ──
        with _state_lock:
            sub = _state["submitted"]
            _state["submitted"] = None

        if sub:
            with _state_lock:
                _state["mode"] = "connecting"
            save_stanza(sub["stanza"])
            time.sleep(2)          # lascia arrivare la risposta HTTP al client
            ap_down()
            ok, err = try_connect(sub["ssid"], sub["psk"])
            if ok:
                with _state_lock:
                    _state["mode"] = "idle"
                    _state["last_error"] = None
                offline_since = None
                continue
            with _state_lock:
                _state["mode"] = "starting"   # ricrea AP al giro dopo
                _state["last_error"] = err or "connessione fallita"
            continue

        # Ritenta le reti note ogni AP_RETRY_S (router tornato acceso?)
        if not FORCE_AP and ap_started_at and time.time() - ap_started_at > AP_RETRY_S:
            log(f"Nessuna configurazione da {AP_RETRY_S}s: provo autoconnect per {RETRY_WINDOW_S}s")
            ap_down()
            with _state_lock:
                _state["mode"] = "starting"
            deadline = time.time() + RETRY_WINDOW_S
            while time.time() < deadline:
                if is_online():
                    break
                time.sleep(5)
            continue

        time.sleep(3)


if __name__ == "__main__":
    main()
