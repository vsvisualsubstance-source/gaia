"""Config gaia-dmx — layering: env > /etc/gaia/dmx.conf > default."""
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


_conf = _load_conf("/etc/gaia/dmx.conf")


def _get(key, default):
    return os.getenv(key, _conf.get(key, default))


DEVICE_ID = _get("DEVICE_ID", socket.gethostname())
ROOM      = _get("CAMERA_NAME", "cucina")        # stanza iniziale (registry può cambiarla)
MQTT_HOST = _get("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(_get("MQTT_PORT", "1883"))

_BASE = os.path.dirname(os.path.abspath(__file__))

# Nodo Art-Net di destinazione (es. un dimmer/driver RGB in rete) — MAI un
# default indovinato: vuoto finché non lo si imposta davvero, stesso
# principio già seguito per gli altri service.json/.conf di questo progetto
# (mai ipotizzare un IP hardware). Con ARTNET_HOST vuoto il servizio parte
# comunque (status/timeline funzionano) ma logga un avviso e non manda
# pacchetti DMX finché non viene configurato.
ARTNET_HOST = _get("ARTNET_HOST", "")
ARTNET_PORT = int(_get("ARTNET_PORT", "6454"))   # porta standard Art-Net

# Indirizzamento Art-Net a 3 campi (net/subnet/universo), stesso schema già
# visto nello scan Art-Net di DMX V8 su TD ("U net:subnet:universo").
ARTNET_NET      = int(_get("ARTNET_NET", "0"))
ARTNET_SUBNET   = int(_get("ARTNET_SUBNET", "0"))
ARTNET_UNIVERSE = int(_get("ARTNET_UNIVERSE", "0"))

# Canali DMX della fixture pilotata: 3 = RGB, 4 = RGBW. START_ADDRESS è il
# primo canale (1-512) nell'universo, non necessariamente 1 se condivide
# l'universo con altre fixture patchate altrove.
NUM_CHANNELS   = int(_get("DMX_NUM_CHANNELS", "3"))
START_ADDRESS  = int(_get("DMX_START_ADDRESS", "1"))

# Refresh dell'uscita Art-Net. ≤44Hz per spec (Art-Net 4) — stesso limite
# già rispettato lato TD per DMX V8 (passato lì da 120 a 40Hz, vedi
# TD4Gaia GAIA_INTERFACE.md "TD/Win-PD, 7").
FPS = float(_get("DMX_FPS", "30"))

STATUS_EVERY_S = int(_get("DMX_STATUS_EVERY_S", "5"))

PALETTES_FILE = _get("DMX_PALETTES_FILE", os.path.join(_BASE, "palettes.json"))
