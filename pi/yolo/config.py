import os
import socket

# ── CONFIG LOADER ─────────────────────────────────────────────────────────────
# Priorità: variabili d'ambiente > /etc/gaia/yolo.conf > defaults

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
    'NODE_ID':                  'unknown',
    'LOCATION':                 'casa',
    'ZONE':                     'unknown',
    'CAMERA_NAME':              'cam1',
    'CAMERA_INDEX':             '0',
    'MQTT_HOST':                '192.168.1.142',
    'MQTT_PORT':                '1883',
    'YOLO_MODEL':               'models/yolo11n.pt',
    'CONFIDENCE_THRESHOLD':     '0.45',
    'FRAME_SKIP':               '6',
    'PERSON_TIMEOUT':           '6',
    'EVENT_COOLDOWN_SEC':       '5',
    'SNAPSHOT_CONF_THRESHOLD':  '0.75',
    'HEARTBEAT_INTERVAL':       '30',
    'MIN_CONFIRMED_HITS':       '3',
}

_file_cfg = _load_conf('/etc/gaia/yolo.conf')
_cfg = {**_defaults, **_file_cfg, **{k: os.environ[k] for k in _defaults if k in os.environ}}

# ── DEVICE IDENTITY ───────────────────────────────────────────────────────────
# Stabile per tutta la vita del processo (hostname del Pi)
DEVICE_ID = socket.gethostname()

# ── INITIAL CLAIMS ────────────────────────────────────────────────────────────
# Questi sono i valori di partenza. NODE_ID può essere aggiornato
# a runtime dal Device Registry via MQTT retained.
NODE_ID             = _cfg['NODE_ID']
LOCATION            = _cfg['LOCATION']
ZONE                = _cfg['ZONE']
CAMERA_NAME         = _cfg['CAMERA_NAME']
CAMERA_INDEX        = int(_cfg['CAMERA_INDEX'])

# ── MQTT ──────────────────────────────────────────────────────────────────────
MQTT_HOST           = _cfg['MQTT_HOST']
MQTT_PORT           = int(_cfg['MQTT_PORT'])

# ── YOLO ──────────────────────────────────────────────────────────────────────
YOLO_MODEL                = _cfg['YOLO_MODEL']
CONFIDENCE_THRESHOLD      = float(_cfg['CONFIDENCE_THRESHOLD'])
FRAME_SKIP                = int(_cfg['FRAME_SKIP'])

# ── TRACKING ──────────────────────────────────────────────────────────────────
PERSON_TIMEOUT            = float(_cfg['PERSON_TIMEOUT'])
EVENT_COOLDOWN_SEC        = float(_cfg['EVENT_COOLDOWN_SEC'])

# ── SNAPSHOT ──────────────────────────────────────────────────────────────────
SNAPSHOT_CONF_THRESHOLD   = float(_cfg['SNAPSHOT_CONF_THRESHOLD'])

# ── SYSTEM ────────────────────────────────────────────────────────────────────
HEARTBEAT_INTERVAL        = float(_cfg['HEARTBEAT_INTERVAL'])
MIN_CONFIRMED_HITS        = int(_cfg['MIN_CONFIRMED_HITS'])
