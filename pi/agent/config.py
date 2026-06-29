import os


def _detect_device_id() -> str:
    """ID univoco da MAC address (ultimi 6 hex di eth0 o wlan0)."""
    for iface in ("eth0", "wlan0"):
        mac_path = f"/sys/class/net/{iface}/address"
        if os.path.exists(mac_path):
            with open(mac_path) as f:
                mac = f.read().strip().replace(":", "")
                return f"pi-{mac[-6:].lower()}"
    return f"pi-{os.uname().nodename}"


DEVICE_ID      = os.getenv("DEVICE_ID",    _detect_device_id())
DEFAULT_STANZA = os.getenv("CAMERA_NAME",  "ingresso")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

_BASE       = os.path.dirname(os.path.abspath(__file__))
DEVICE_JSON = os.path.join(_BASE, "device.json")

HEARTBEAT_INTERVAL = 30   # secondi tra un heartbeat e il successivo

# Mappa chiave-logica → nome systemd unit
SERVICE_MAP = {
    "yolo":      "gaia-yolo",
    "mediapipe": "gaia-mediapipe",
    "voice":     "gaia-voice",
}

# File di ambiente condiviso — agent lo scrive, i servizi lo leggono
DEVICE_ENV_FILE = "/etc/gaia/device.conf"

# Percorsi base di ogni servizio sul Pi (usati da OTA)
SERVICE_DIRS = {
    "yolo":      "/opt/gaia/yolo",
    "mediapipe": "/opt/gaia/mediapipe",
    "voice":     "/opt/gaia/voice",
    "agent":     "/opt/gaia/agent",
}
