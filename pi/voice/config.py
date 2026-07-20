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
    'NODE_ID':              'ingresso',
    'CAMERA_NAME':          'ingresso',
    'MQTT_HOST':            '192.168.1.142',
    'MQTT_PORT':            '1883',
    'SAMPLE_RATE':          '16000',
    'CHUNK_SIZE':           '1280',
    'SILENCE_THRESHOLD':    '400',
    'RECORD_SECONDS_MAX':   '12',
    'MIC_DEVICE':           '',
    'WAKEWORD_MODEL':       'alexa',
    'WAKEWORD_THRESHOLD':   '0.35',
    'GAIA_THRESHOLD':       '0.80',
    'WHISPER_MODEL':        'base',
    'PIPER_SAMPLE_RATE':    '22050',
}

CONF_PATH = '/etc/gaia/voice.conf'
_file_cfg = _load_conf(CONF_PATH)
_cfg = {**_defaults, **_file_cfg, **{k: os.environ[k] for k in _defaults if k in os.environ}}

# ── Device identity ───────────────────────────────────────────────────
# DEVICE_ID: legge DEVICE_ID dall'env (scritto da agent in /etc/gaia/device.conf),
# cade back su hostname solo se non impostato (garantisce ID uniforme tra tutti i servizi).
DEVICE_ID = os.getenv("DEVICE_ID", socket.gethostname())
NODE_ID   = _cfg.get('NODE_ID') or _cfg.get('CAMERA_NAME', 'ingresso')

# ── MQTT ─────────────────────────────────────────────────────────────
MQTT_HOST = _cfg['MQTT_HOST']
MQTT_PORT = int(_cfg['MQTT_PORT'])

# ── Audio ─────────────────────────────────────────────────────────────
SAMPLE_RATE        = int(_cfg['SAMPLE_RATE'])
CHUNK_SIZE         = int(_cfg['CHUNK_SIZE'])   # 80ms @ 16kHz — richiesto da openWakeWord
SILENCE_THRESHOLD  = int(_cfg['SILENCE_THRESHOLD'])
RECORD_SECONDS_MAX = int(_cfg['RECORD_SECONDS_MAX'])

_mic_env   = _cfg['MIC_DEVICE']
MIC_DEVICE = int(_mic_env) if _mic_env.isdigit() else (_mic_env if _mic_env else None)

# ── Wakeword (openWakeWord) ───────────────────────────────────────────
WAKEWORD_MODEL_NAME = _cfg['WAKEWORD_MODEL']
WAKEWORD_THRESHOLD  = float(_cfg['WAKEWORD_THRESHOLD'])
GAIA_THRESHOLD      = float(_cfg['GAIA_THRESHOLD'])

# ── STT (faster-whisper) ─────────────────────────────────────────────
WHISPER_MODEL = _cfg['WHISPER_MODEL']
WHISPER_LANG  = "it"

# ── TTS (Piper) ───────────────────────────────────────────────────────
_BASE             = os.path.dirname(os.path.abspath(__file__))
PIPER_BIN         = os.path.join(_BASE, "bin", "piper")
PIPER_MODEL       = os.path.join(_BASE, "models", "it_IT-paola-medium.onnx")
PIPER_CONFIG      = os.path.join(_BASE, "models", "it_IT-paola-medium.onnx.json")
PIPER_SAMPLE_RATE = int(_cfg['PIPER_SAMPLE_RATE'])
