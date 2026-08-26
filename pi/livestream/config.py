"""Config gaia-livestream — layering: env > /etc/gaia/livestream.conf > default."""
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


_conf = _load_conf("/etc/gaia/livestream.conf")


def _get(key, default):
    return os.getenv(key, _conf.get(key, default))


DEVICE_ID = _get("DEVICE_ID", socket.gethostname())
ROOM      = _get("CAMERA_NAME", "cucina")
MQTT_HOST = _get("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(_get("MQTT_PORT", "1883"))

_BASE = os.path.dirname(os.path.abspath(__file__))

# Sorgente audio: "mic" (webcam/microfono via ffmpeg -f alsa) oppure
# "library" (playlist in loop dalla libreria musicale LOCALE al Pi — non
# quella di Core, che è un'altra macchina; vedi LIBRARY_DIR). Cambiabile a
# caldo via MQTT gaia/livestream/{stanza}/command {"source": "mic"|"library"}.
SOURCE = _get("LIVESTREAM_SOURCE", "mic")

# "default" passa dal plugin ALSA di PipeWire (pipewire-alsa, installato da
# install.sh) invece dell'hw: diretto — un microfono USB che PipeWire ha già
# reclamato come sorgente di sistema sparisce dall'accesso ALSA diretto
# (stesso bug incontrato con pi/voice, vedi install.sh di quel modulo).
MIC_DEVICE = _get("LIVESTREAM_MIC_DEVICE", "default")

# Selettore multi-microfono (2026-08-26, trovato dal vivo su vsrasp01: due
# ingressi USB reali contemporaneamente collegati, "Communicator" e webcam
# "C920" -- niente ingresso jack, i Raspberry Pi non ne hanno uno per audio).
# Opzionale: due coppie label/device, cambiabili a caldo via MQTT
# {"mic_device": "<label>"} quando source=mic. Vuoto = nessuna scelta
# esposta, resta il MIC_DEVICE singolo sopra (comportamento di sempre).
MIC_DEVICE_OPTIONS = {}
for _slot in ("A", "B"):
    _label = _get(f"LIVESTREAM_MIC_{_slot}_LABEL", "")
    _device = _get(f"LIVESTREAM_MIC_{_slot}_DEVICE", "")
    if _label and _device:
        MIC_DEVICE_OPTIONS[_label] = _device

LIBRARY_DIR = _get("LIVESTREAM_LIBRARY_DIR", os.path.join(_BASE, "musica"))
LIBRARY_EXT = (".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".opus")

ICECAST_HOST = "localhost"          # icecast gira SEMPRE in locale sul Pi
ICECAST_PORT = int(_get("ICECAST_PORT", "8000"))
# Generata da install.sh (una per device — vedi GOTCHA in install.sh),
# scritta sia qui che in /etc/icecast2/icecast.xml.
ICECAST_SOURCE_PASSWORD = _get("ICECAST_SOURCE_PASSWORD", "")
MOUNT = _get("LIVESTREAM_MOUNT", "stream.ogg")   # nome fisso: la stanza può cambiare senza spostare l'URL
BITRATE = _get("LIVESTREAM_BITRATE", "96k")

SCAN_EVERY_S      = int(_get("LIVESTREAM_SCAN_S", "5"))
HEARTBEAT_EVERY_S = int(_get("LIVESTREAM_HEARTBEAT_S", "30"))
