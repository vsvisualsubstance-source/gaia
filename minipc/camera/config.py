import os

# ── CONFIG LOADER ─────────────────────────────────────────────────────────────
# Priorità: variabili d'ambiente > /etc/gaia/camera.conf > defaults

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
    'CAMERA_INDEX':  '0',
    'FRAME_WIDTH':   '640',
    'FRAME_HEIGHT':  '480',
    'FPS_LIMIT':     '15',
}

_file_cfg = _load_conf('/etc/gaia/camera.conf')
_cfg = {**_defaults, **_file_cfg, **{k: os.environ[k] for k in _defaults if k in os.environ}}

# CAMERA_INDEX puo' essere un indice numerico (es. "1") o un path stabile
# (es. /dev/v4l/by-id/usb-..., non cambia mai anche se il kernel rinumera
# /dev/videoN dopo una riconnessione USB — vedi minipc/camera/gaia-camera.service)
_cam_raw = _cfg['CAMERA_INDEX']
CAMERA_INDEX  = _cam_raw if '/' in _cam_raw else int(_cam_raw)
FRAME_WIDTH   = int(_cfg['FRAME_WIDTH'])
FRAME_HEIGHT  = int(_cfg['FRAME_HEIGHT'])
FPS_LIMIT     = float(_cfg['FPS_LIMIT'])
