import os
import socket


def _load_conf(path):
    cfg = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    cfg[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return cfg


_defaults = {
    'CAMERA_NAME': 'ingresso',   # stanza (scritta dall'agent in device.conf)
    'MQTT_HOST':   '192.168.1.142',
    'MQTT_PORT':   '1883',
    'CELL':        '44',         # dimensione base glifo in px
}

_file_cfg = _load_conf('/etc/gaia/screen.conf')
_cfg = {**_defaults, **_file_cfg, **{k: os.environ[k] for k in _defaults if k in os.environ}}

DEVICE_ID = os.getenv("DEVICE_ID", socket.gethostname())
ROOM      = _cfg['CAMERA_NAME']
MQTT_HOST = _cfg['MQTT_HOST']
MQTT_PORT = int(_cfg['MQTT_PORT'])
CELL      = float(_cfg['CELL'])
