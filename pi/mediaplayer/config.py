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

IS_WIN         = os.name == "nt"
MPV_BIN        = _get("MPV_BIN", "mpv")
MPV_SOCK       = _get("MPV_SOCK", r"\\.\pipe\gaia-mpv" if IS_WIN else "/tmp/gaia-mpv.sock")
# es. "alsa/plughw:CARD=Headphones,DEV=0" (jack 3.5mm, bypassa PipeWire) o
# "pipewire/alsa_output.usb-..." (va bene se la scheda e' gia' in uso
# esclusivo da PipeWire, es. una USB -- vedi gotcha sotto).
# GOTCHA (trovato dal vivo su vsrasp01, 2026-08-26): senza questa variabile
# mpv auto-seleziona l'uscita provando pipewire/pulse/alsa/JACK in ordine --
# sotto systemd (nessuna sessione utente/XDG_RUNTIME_DIR, vedi install.sh)
# pipewire/pulse falliscono silenziosamente e mpv arriva fino a JACK, di
# solito non installato ("jack server is not running", errore 524, nessun
# audio, nessun crash visibile). Una scheda USB puo' risultare "Device or
# resource busy" con --ao=alsa diretto se PipeWire la tiene gia' aperta in
# esclusiva (caso vsrasp01/Communicator) -- in quel caso il device va
# passato COME pipewire (`pipewire/alsa_output...`, nome esatto da
# `mpv --audio-device=help`), non come alsa/plughw diretto, e install.sh
# deve gia' aver messo XDG_RUNTIME_DIR nella unit altrimenti pipewire non
# e' raggiungibile comunque. Testare sempre con
# `mpv --audio-device=... file.wav` (interattivo, non da systemd) prima
# di fidarsi del default.
MPV_AUDIO_DEVICE = _get("MPV_AUDIO_DEVICE", "")
# Uscita verso la rete Dante (Solaro QR1), diversa per macchina — es. su Core
# "pulse/alsa_output.usb-XILICA_AUDIO_SOLARO_QR1_ASOLARO_QR1-00.analog-stereo"
# (nome del sink PipeWire). Vuoto = funzione non disponibile su questa macchina.
MPV_AUDIO_DEVICE_DANTE = _get("MPV_AUDIO_DEVICE_DANTE", "")
DEFAULT_VOLUME = int(_get("MEDIA_VOLUME", "60"))
STATUS_EVERY_S = int(_get("MEDIA_STATUS_EVERY_S", "5"))
