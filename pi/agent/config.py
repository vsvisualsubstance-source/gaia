import json
import os

# ── Manifest per-macchina (Fase 0 architettura distribuita, 2026-07-06) ──────
# /etc/gaia/services.json permette di usare QUESTO stesso agent su macchine
# non-Pi (ruolo core/media/...): dichiara ruolo e servizi gestibili. Se il
# file manca o è illeggibile restano le mappe hardcoded del Pi — la
# retrocompatibilità coi Pi già deployati è totale. Formato: vedi
# services.json.example accanto a questo file e docs/core-distribuito.md.
SERVICES_MANIFEST = os.getenv("GAIA_SERVICES_MANIFEST", "/etc/gaia/services.json")

_manifest = {}
if os.path.exists(SERVICES_MANIFEST):
    try:
        with open(SERVICES_MANIFEST) as f:
            _manifest = json.load(f)
        if not isinstance(_manifest, dict):
            _manifest = {}
    except Exception as e:
        print(f"[config] manifest {SERVICES_MANIFEST} illeggibile ({e}) — uso i default Pi")
        _manifest = {}

MACHINE_ROLE = _manifest.get("machine_role", "pi")
_ID_PREFIX   = _manifest.get("device_id_prefix", "pi")


def _detect_device_id() -> str:
    """ID univoco da MAC address (ultimi 6 hex della prima interfaccia trovata)."""
    for iface in ("eth0", "wlan0", "enp1s0", "wlp2s0"):
        mac_path = f"/sys/class/net/{iface}/address"
        if os.path.exists(mac_path):
            with open(mac_path) as f:
                mac = f.read().strip().replace(":", "")
                return f"{_ID_PREFIX}-{mac[-6:].lower()}"
    return f"{_ID_PREFIX}-{os.uname().nodename}"


def _detect_mac() -> str:
    for iface in ("eth0", "wlan0"):
        mac_path = f"/sys/class/net/{iface}/address"
        if os.path.exists(mac_path):
            with open(mac_path) as f:
                return f.read().strip()
    return ""


DEVICE_ID      = os.getenv("DEVICE_ID",    _detect_device_id())
DEFAULT_STANZA = os.getenv("CAMERA_NAME",  "ingresso")
MAC            = _detect_mac()
SW_VERSION     = "1.0.2"   # versione del bundle pi/ — usata da /api/provision

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

_BASE       = os.path.dirname(os.path.abspath(__file__))
_GAIA_ROOT  = os.path.dirname(_BASE)
DEVICE_JSON = os.path.join(_BASE, "device.json")

HEARTBEAT_INTERVAL = 30   # secondi tra un heartbeat e il successivo

# Mappa chiave-logica → nome systemd unit (default Pi)
SERVICE_MAP = {
    "yolo":      "gaia-yolo",
    "mediapipe": "gaia-mediapipe",
    "voice":     "gaia-voice",
    "camera":    "gaia-camera",   # gestito come dipendenza di yolo/mediapipe, non attivabile a mano
    "screen":    "gaia-screen",   # superficie asemica su display DSI (pi/screen)
}

# File di ambiente condiviso — agent lo scrive, i servizi lo leggono
DEVICE_ENV_FILE = "/etc/gaia/device.conf"

# Percorsi base di ogni servizio sul Pi (usati da OTA)
SERVICE_DIRS = {
    "yolo":      os.path.join(_GAIA_ROOT, "yolo"),
    "mediapipe": os.path.join(_GAIA_ROOT, "mediapipe"),
    "voice":     os.path.join(_GAIA_ROOT, "voice"),
    "agent":     _BASE,
    "camera":    os.path.join(_GAIA_ROOT, "camera"),
    "screen":    os.path.join(_GAIA_ROOT, "screen"),
}

# Se il manifest dichiara servizi, sostituisce ENTRAMBE le mappe (l'entry
# "agent" resta sempre, serve all'auto-OTA dell'agent stesso).
if isinstance(_manifest.get("services"), dict) and _manifest["services"]:
    SERVICE_MAP  = {}
    SERVICE_DIRS = {"agent": _BASE}
    for _key, _svc in _manifest["services"].items():
        if not isinstance(_svc, dict) or "unit" not in _svc:
            print(f"[config] manifest: servizio {_key!r} senza 'unit' — ignorato")
            continue
        SERVICE_MAP[_key]  = _svc["unit"]
        SERVICE_DIRS[_key] = _svc.get("dir", os.path.join(_GAIA_ROOT, _key))
