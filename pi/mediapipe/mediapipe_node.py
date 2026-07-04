#!/usr/bin/env python3
"""
GAIA MediaPipe Node — versione stabile con Device Registry
Ogni Pi ha un device_id stabile (hostname). Al boot:
  1. Subscribe a gaia/devices/{id}/config (retained) → room assignment immediata
  2. Publish a gaia/devices/{id}/announce → il registry Node-RED risponde con config
  3. Applica la room ricevuta senza restart

Topic di controllo:
    gaia/devices/{id}/config   ← Node-RED invia room assignment (retained)
    gaia/devices/{id}/announce → Pi pubblica al boot

Topic dati:
    gaia/mediapipe/pose        → payload con camera=room_corrente
"""

import cv2
import mediapipe as mp
import paho.mqtt.client as mqtt
import json
import time
import os
import signal
import socket
import subprocess
import logging
from ota import OtaHandler
from camera_client import CameraClient

# ── CONFIG ────────────────────────────────────────────────────────────────────

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
    'CAMERA_NAME':      'unknown',   # room_claim iniziale (sostituita da config retained)
    'MQTT_HOST':        '192.168.1.142',
    'MQTT_PORT':        '1883',
    'PUBLISH_INTERVAL': '1.0',
    'FRAME_SKIP':       '1',
    'HEADLESS':         '1',
    'TOPIC':            'gaia/mediapipe/pose',
}

_file_cfg = _load_conf('/etc/gaia/mediapipe.conf')
_cfg = {**_defaults, **_file_cfg, **{k: os.environ[k] for k in _defaults if k in os.environ}}

# device_id stabile = hostname (es. "pi-ingresso", "raspberrypi", "pi-salotto")
DEVICE_ID        = os.getenv("DEVICE_ID", socket.gethostname())
DEVICE_TYPE      = 'mediapipe'
MQTT_HOST        = _cfg['MQTT_HOST']
MQTT_PORT        = int(_cfg['MQTT_PORT'])
PUBLISH_INTERVAL = float(_cfg['PUBLISH_INTERVAL'])
FRAME_SKIP       = int(_cfg['FRAME_SKIP'])
HEADLESS         = _cfg['HEADLESS'] == '1'
TOPIC            = _cfg['TOPIC']
CONFIG_TOPIC     = f'gaia/devices/{DEVICE_ID}/config'
ANNOUNCE_TOPIC   = f'gaia/devices/{DEVICE_ID}/announce'

# room è mutabile a runtime (aggiornata da config retained)
_state = {
    'room':     _cfg['CAMERA_NAME'],   # room claim iniziale
    'verified': False,
}

# ── LOGGING ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(DEVICE_ID)
log.info(f"device_id={DEVICE_ID} room_claim={_state['room']} broker={MQTT_HOST}:{MQTT_PORT}")

# ── MQTT ──────────────────────────────────────────────────────────────────────

def _on_connect(client, userdata, flags, rc, properties=None):
    if rc != 0:
        log.warning(f"MQTT errore rc={rc}")
        return
    log.info("MQTT connesso")

    # Config room (retained)
    client.subscribe(CONFIG_TOPIC, qos=1)
    # OTA updates
    for t in _ota.topics():
        client.subscribe(t, qos=1)
    log.info(f"Subscribed a config + OTA ({_ota.topics()})")

    # Announce: il registry risponde con config retained
    # gethostbyname(gethostname()) risolve spesso a 127.0.1.1 (voce /etc/hosts su
    # Debian/Raspbian) invece dell'IP di rete reale — stesso approccio di
    # agent.py._get_ip() per restare coerenti con quello che mostra Pi Manager.
    try:
        ip = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3).stdout.strip().split()[0]
    except Exception:
        ip = 'unknown'

    announce = {
        'device_id':   DEVICE_ID,
        'type':        DEVICE_TYPE,
        'ip':          ip,
        'room_claim':  _state['room'],
        'ts':          int(time.time() * 1000),
    }
    client.publish(ANNOUNCE_TOPIC, json.dumps(announce), retain=False)
    log.info(f"Announce inviato: room_claim={_state['room']}")


_ota = OtaHandler(
    mqtt_client  = type('M', (), {'publish': lambda self, t, p, **kw: _mqtt.publish(t, json.dumps(p) if isinstance(p, dict) else p)})(),
    device_id    = DEVICE_ID,
    device_type  = 'mediapipe',
    base_dir     = os.path.dirname(os.path.abspath(__file__)),
    service_name = os.environ.get('SERVICE_NAME', None),   # es. SERVICE_NAME=gaia-mediapipe
)


def _on_message(client, userdata, msg):
    """Riceve config dal Device Registry (room) o comandi OTA."""
    topic = msg.topic

    # OTA
    if topic in _ota.topics():
        _ota.handle(topic, msg.payload)
        return

    # Config room
    if topic != CONFIG_TOPIC:
        return
    try:
        cfg = json.loads(msg.payload.decode())
        new_room = cfg.get('room')
        if new_room and new_room != _state['room']:
            log.info(f"Room aggiornata: {_state['room']} → {new_room} (verified={cfg.get('verified', False)})")
            _state['room']     = new_room
            _state['verified'] = cfg.get('verified', False)
        elif new_room:
            _state['verified'] = cfg.get('verified', False)
            log.info(f"Config confermata: room={new_room} verified={_state['verified']}")
    except Exception as e:
        log.error(f"Config parse error: {e}")


def _on_disconnect(client, userdata, rc, properties=None):
    log.warning(f"MQTT disconnesso rc={rc}")


_mqtt = mqtt.Client(client_id=f"gaia-mp-{DEVICE_ID}", clean_session=True)
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)
_mqtt.on_connect    = _on_connect
_mqtt.on_message    = _on_message
_mqtt.on_disconnect = _on_disconnect

try:
    _mqtt.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    _mqtt.loop_start()
except Exception as e:
    log.error(f"MQTT connect fallito: {e} — tentativi in background")
    _mqtt.loop_start()

# ── MEDIAPIPE ─────────────────────────────────────────────────────────────────

_face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=False, max_num_faces=1, refine_landmarks=True,
    min_detection_confidence=0.5, min_tracking_confidence=0.5
)
_hands = mp.solutions.hands.Hands(
    static_image_mode=False, max_num_hands=2,
    min_detection_confidence=0.5, min_tracking_confidence=0.5
)
_pose = mp.solutions.pose.Pose(
    static_image_mode=False,
    min_detection_confidence=0.5, min_tracking_confidence=0.5
)

_GESTURE_MAP = {0: 'fist', 1: 'point', 2: 'victory', 3: 'three', 4: 'open_hand'}


def _analyze(frame):
    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    detected   = False
    emotion    = None      # null = nessun volto visibile
    smile      = 0
    attention  = 'unknown'
    gesture    = 'none'
    pose_state = 'unknown'
    mouth_open = False
    eyes_open  = True

    fr = _face_mesh.process(rgb)
    if fr.multi_face_landmarks:
        detected = True
        lm = fr.multi_face_landmarks[0].landmark
        smile = int(abs((lm[291].x - lm[61].x) * w))
        emotion = 'happy' if smile > 80 else 'neutral'
        mouth_gap = abs((lm[14].y - lm[13].y) * h)
        mouth_open = mouth_gap > 15
        nx = lm[1].x
        attention = 'left' if nx < 0.42 else ('right' if nx > 0.58 else 'center')
        # EAR sulle palpebre (159/145 occhio sx, 386/374 dx), normalizzato sulla distanza interoculare
        eye_dist = abs((lm[263].x - lm[33].x) * w) or 1
        left_ear  = abs((lm[159].y - lm[145].y) * h) / eye_dist
        right_ear = abs((lm[386].y - lm[374].y) * h) / eye_dist
        eyes_open = left_ear > 0.05 and right_ear > 0.05

    hr = _hands.process(rgb)
    if hr.multi_hand_landmarks:
        detected = True
        lm = hr.multi_hand_landmarks[0].landmark
        fingers = sum([lm[8].y < lm[6].y, lm[12].y < lm[10].y,
                       lm[16].y < lm[14].y, lm[20].y < lm[18].y])
        gesture = _GESTURE_MAP.get(fingers, 'open_hand')

    pr = _pose.process(rgb)
    if pr.pose_landmarks:
        detected = True
        lm = pr.pose_landmarks.landmark
        ls, rs = lm[11], lm[12]
        lw, rw = lm[15], lm[16]
        lh, rh = lm[23], lm[24]
        if lw.y < ls.y and rw.y < rs.y:
            pose_state = 'arms_up'
        else:
            torso = abs(((lh.y + rh.y) / 2) - ((ls.y + rs.y) / 2))
            pose_state = 'standing' if torso > 0.25 else 'sitting'

    return {
        'person_detected': detected,
        'emotion':         emotion,
        'smile_score':     smile,
        'attention':       attention,
        'gesture':         gesture,
        'pose':            pose_state,
        'mouth_open':      mouth_open,
        'eyes_open':       eyes_open,
    }

# ── CAMERA ────────────────────────────────────────────────────────────────────

def _open_camera():
    cam = CameraClient()
    if not cam.attach():
        log.error("Camera broker (gaia-camera) non disponibile")
        return None
    log.info("Camera broker collegato (shared memory)")
    return cam


cap = _open_camera()
last_publish = 0.0
frame_id = 0
state = {
    'person_detected': False, 'emotion': None, 'smile_score': 0,
    'attention': 'unknown', 'gesture': 'none', 'pose': 'unknown',
    'mouth_open': False, 'eyes_open': True,
}
_running = True

# ── SIGNAL HANDLER ────────────────────────────────────────────────────────────
# In headless mode non c'è waitKey — usiamo SIGTERM/SIGINT per uscire

def _shutdown(sig, frame):
    global _running
    log.info(f"Segnale {sig} ricevuto, shutdown...")
    _running = False

signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT,  _shutdown)

log.info(f"Loop avviato (headless={HEADLESS})")

# ── LOOP ──────────────────────────────────────────────────────────────────────

while _running:
    if cap is None or not cap.attached:
        log.warning("Camera persa, nuovo tentativo tra 5s...")
        time.sleep(5)
        cap = _open_camera()
        continue

    ret, frame = cap.read()
    if not ret:
        # CameraClient.read() ritenta già internamente sui torn-read; un singolo
        # esito negativo non significa connessione morta — solo cap.attached
        # diventato False (rilevato dal client) indica che serve riagganciarsi.
        log.warning("Frame non letto dalla shared memory")
        time.sleep(0.1)
        continue

    frame_id += 1
    if frame_id % FRAME_SKIP == 0:
        state = _analyze(frame)

    now = time.time()
    if now - last_publish >= PUBLISH_INTERVAL:
        payload = {
            'camera':    _state['room'],
            'node':      _state['room'],
            'device_id': DEVICE_ID,
            'ts':        int(now * 1000),
            **state,
        }
        try:
            _mqtt.publish(TOPIC, json.dumps(payload), retain=False)
            icon = '✓' if state['person_detected'] else '·'
            em = state['emotion'] or 'no-face'
            log.info(f"[{_state['room']}] {icon} em={em} pose={state['pose']} gest={state['gesture']}")
        except Exception as e:
            log.error(f"Publish fallito: {e}")
        last_publish = now

    if not HEADLESS:
        lbl = f"[{_state['room']}] {state['emotion'] or '-'} | {state['pose']} | {state['gesture']}"
        cv2.putText(frame, lbl, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow('GAIA Vision', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

# ── CLEANUP ───────────────────────────────────────────────────────────────────

log.info("Shutdown...")
if cap:
    cap.close()
_face_mesh.close()
_hands.close()
_pose.close()
if not HEADLESS:
    cv2.destroyAllWindows()
_mqtt.loop_stop()
_mqtt.disconnect()
