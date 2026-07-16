"""Config gaia-herbarium — layering: env > /etc/gaia/herbarium.conf > default."""
import os
import socket


def _load_conf(path):
    cfg = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip()
    return cfg


_conf = _load_conf("/etc/gaia/herbarium.conf")


def _get(key, default):
    return os.getenv(key, _conf.get(key, default))


DEVICE_ID = _get("DEVICE_ID", socket.gethostname())
ROOM      = _get("CAMERA_NAME", "cucina")
MQTT_HOST = _get("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(_get("MQTT_PORT", "1883"))

_BASE      = os.path.dirname(os.path.abspath(__file__))
PATCH      = _get("HERBARIUM_PATCH", os.path.join(_BASE, "patch.carxp"))
CARLA_BIN  = _get("CARLA_BIN", "carla")
SCAN_EVERY_S      = int(_get("HERBARIUM_SCAN_S", "5"))
HEARTBEAT_EVERY_S = int(_get("HERBARIUM_HEARTBEAT_S", "30"))
# note anche in locale (udp://127.0.0.1) per gaia-screen: nel bosco non c'è
# broker MQTT, il canale localhost funziona sempre
UDP_PORT          = int(_get("HERBARIUM_UDP_PORT", "8791"))
