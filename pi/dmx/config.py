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

# Canali DMX della fixture pilotata. START_ADDRESS è il primo canale
# (1-512) nell'universo, non necessariamente 1 se condivide l'universo con
# altre fixture patchate altrove.
NUM_CHANNELS   = int(_get("DMX_NUM_CHANNELS", "3"))
START_ADDRESS  = int(_get("DMX_START_ADDRESS", "1"))

# Molte fixture economiche (stesso "D+RGB 4CH"/"D+RGBW 5CH" visto nei
# profili di DMX V8 su TD) hanno un canale Master/Dimmer SEPARATO prima dei
# canali colore, non RGB puro -- confermato dal vivo su Pi Ingresso il
# 2026-10-02 (test canale per canale contro il nodo Electroconcept
# 2.1.1.2: RGB sui primi 3 canali non dava nulla, dimmer+colore sì).
# 0 = nessun canale dimmer separato (fixture RGB pura, comportamento di
# sempre: la luminosità si applica moltiplicando R/G/B prima dell'invio).
# N>0 = offset (1-based, relativo a START_ADDRESS) del canale dimmer; i 3
# canali RGB che seguono subito dopo vengono mandati GREZZI (0-255), la
# luminosità va tutta sul canale dimmer.
DIMMER_CHANNEL = int(_get("DMX_DIMMER_CHANNEL", "0"))

# Refresh dell'uscita Art-Net. ≤44Hz per spec (Art-Net 4) — stesso limite
# già rispettato lato TD per DMX V8 (passato lì da 120 a 40Hz, vedi
# TD4Gaia GAIA_INTERFACE.md "TD/Win-PD, 7").
FPS = float(_get("DMX_FPS", "30"))

STATUS_EVERY_S = int(_get("DMX_STATUS_EVERY_S", "5"))

PALETTES_FILE = _get("DMX_PALETTES_FILE", os.path.join(_BASE, "palettes.json"))

# Webserver locale per il mini menu touch (www/dmx-touch.html) -- 0/vuoto
# disattiva (nessun www/ da servire, es. un Pi senza display). Porta fissa
# di convenzione per questo progetto, stesso principio di 6454/Art-Net o
# 1883/MQTT: un valore solo, documentato, mai da indovinare altrove.
TOUCH_PORT = int(_get("DMX_TOUCH_PORT", "8099"))

TIMELINES_FILE = _get("DMX_TIMELINES_FILE", os.path.join(_BASE, "timelines.json"))

# Audio-reattività (base: livello RMS -> brillantezza, niente bande/kick
# come DMX V8 su TD -- quello resta il posto giusto per l'analisi vera).
# Stesso gotcha PipeWire già documentato in pi/livestream/pi/mediaplayer:
# un microfono USB (qui la webcam) reclamato da PipeWire sparisce
# dall'accesso ALSA diretto -- "default" passa dal plugin pipewire-alsa,
# che lo rivede sempre. Spento di default: non ogni installazione ha un
# microfono dedicato a questo, va acceso esplicitamente via MQTT quando
# il device ce l'ha (qui confermato dal vivo: mic della webcam, card 4).
AUDIO_DEVICE = _get("DMX_AUDIO_DEVICE", "default")
AUDIO_SAMPLE_RATE = int(_get("DMX_AUDIO_RATE", "16000"))

# Più fixture nello stesso universo (2026-10-03): se fixtures.json esiste,
# definisce N fixture indipendenti (ognuna con il proprio start_address/
# num_channels/dimmer_channel, stesso significato di
# DMX_NUM_CHANNELS/DMX_START_ADDRESS/DMX_DIMMER_CHANNEL sopra, solo per
# fixture invece che per il device intero). Se il file NON esiste, resta
# il comportamento di sempre: UNA fixture ("a") costruita dalle variabili
# sopra -- zero cambi richiesti per chi ha già un setup a fixture singola
# (es. Pi Ingresso). Vedi fixtures.json.example per il formato.
FIXTURES_FILE = _get("DMX_FIXTURES_FILE", os.path.join(_BASE, "fixtures.json"))
