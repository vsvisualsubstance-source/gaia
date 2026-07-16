"""Config gaia-mediaplayer — layering: env > /etc/gaia/mediaplayer.conf > default."""
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


_conf = _load_conf("/etc/gaia/mediaplayer.conf")


def _get(key, default):
    return os.getenv(key, _conf.get(key, default))


DEVICE_ID = _get("DEVICE_ID", socket.gethostname())
ROOM      = _get("CAMERA_NAME", "cucina")        # stanza iniziale (registry può cambiarla)
MQTT_HOST = _get("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(_get("MQTT_PORT", "1883"))

MPV_SOCK       = _get("MPV_SOCK", "/tmp/gaia-mpv.sock")
DEFAULT_VOLUME = int(_get("MEDIA_VOLUME", "60"))
STATUS_EVERY_S = int(_get("MEDIA_STATUS_EVERY_S", "5"))
