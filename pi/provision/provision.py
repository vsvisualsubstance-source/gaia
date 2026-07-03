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

Gira come root (nmcli + porta 80). Config via env / EnvironmentFile
/etc/gaia/provision.conf:
  AP_IFACE=wlan0  AP_PASSWORD=gaiasetup  PORTAL_PORT=80
  CHECK_S=30  OFFLINE_GRACE_S=180  AP_RETRY_S=600  RETRY_WINDOW_S=60
  GAIA_PROVISION_FORCE_AP=1   ← solo test: AP subito, ignora lo stato rete
"""
import json
import os
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
OFFLINE_GRACE_S = int(os.getenv("OFFLINE_GRACE_S", "180"))
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
</style></head><body><div class="box">
<div class="ring"></div>
<h1>Ciao, sono Gaia</h1>
<p class="sub">Collegami alla rete WiFi di casa per completare l'installazione.</p>
%ERROR%
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
</script>
</div></body></html>"""

# Endpoint di rilevamento captive dei vari OS: qualsiasi GET fuori da "/"
# riceve un redirect → il telefono apre il popup del portale.
CAPTIVE_PROBES = ("/generate_204", "/gen_204", "/hotspot-detect.html",
                  "/connecttest.txt", "/ncsi.txt", "/success.txt",
                  "/canonical.html", "/redirect")


class PortalHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/status":
            with _state_lock:
                body = json.dumps({k: _state[k] for k in ("mode", "last_error")}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
            return
        if path != "/":
            # probe captive o pagina qualsiasi → redirect al portale
            self.send_response(302)
            self.send_header("Location", "http://10.42.0.1/")
            self.end_headers()
            return
        with _state_lock:
            ssids = list(_state["ssids"])
            err   = _state["last_error"]
        opts = "".join(
            f'<option value="{s["ssid"]}">{s["ssid"]}  ({s["signal"]}%)</option>'
            for s in ssids) or '<option value="">nessuna rete trovata</option>'
        html = (PORTAL_HTML
                .replace("%OPTIONS%", opts)
                .replace("%SSID%", AP_SSID)
                .replace("%ERROR%", f'<div class="err">Ultimo tentativo fallito: {err}</div>' if err else ""))
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/connect":
            self.send_response(404); self.end_headers(); return
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            self.send_response(400); self.end_headers(); return
        ssid = (body.get("ssid") or "").strip()
        with _state_lock:
            _state["submitted"] = {
                "ssid": ssid,
                "psk": body.get("psk") or "",
                "stanza": (body.get("stanza") or "").strip(),
            }
        log(f"Portale: credenziali ricevute per '{ssid}'")
        resp = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(resp))
        self.end_headers()
        self.wfile.write(resp)

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

    portal = None
    offline_since = None
    ap_started_at = None

    while True:
        online = is_online() and not FORCE_AP

        with _state_lock:
            mode = _state["mode"]

        if online:
            if mode == "ap":
                log("Rete tornata: chiudo AP e portale")
                ap_down()
                if portal:
                    portal.shutdown(); portal = None
            offline_since = None
            with _state_lock:
                _state["mode"] = "idle"
                _state["last_error"] = None
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
                if portal:
                    portal.shutdown(); portal = None
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
