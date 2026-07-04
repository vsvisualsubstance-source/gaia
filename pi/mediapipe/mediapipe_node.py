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
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision
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
    # Tutti questi hanno default = comportamento identico a prima (1 persona,
    # Pose legacy) — pensati per essere alzati via env solo su device con più
    # CPU disponibile (es. minipc), lasciando i Pi invariati.
    'MAX_FACES':        '1',
    'MAX_HANDS':        '2',
    'POSE_COMPLEXITY':  '1',   # legacy mp.solutions.pose: 0=lite 1=full 2=heavy
    'MULTI_PERSON':     '0',   # 1 = usa Tasks API PoseLandmarker (multi-persona)
    'MAX_POSES':        '2',   # usato solo se MULTI_PERSON=1
    'POSE_MODEL_PATH':  '',    # bundle .task richiesto se MULTI_PERSON=1
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
MAX_FACES        = int(_cfg['MAX_FACES'])
MAX_HANDS        = int(_cfg['MAX_HANDS'])
POSE_COMPLEXITY  = int(_cfg['POSE_COMPLEXITY'])
MULTI_PERSON     = _cfg['MULTI_PERSON'] == '1'
MAX_POSES        = int(_cfg['MAX_POSES'])
POSE_MODEL_PATH  = _cfg['POSE_MODEL_PATH']
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
    static_image_mode=False, max_num_faces=MAX_FACES, refine_landmarks=True,
    min_detection_confidence=0.5, min_tracking_confidence=0.5
)
_hands = mp.solutions.hands.Hands(
    static_image_mode=False, max_num_hands=MAX_HANDS,
    min_detection_confidence=0.5, min_tracking_confidence=0.5
)

# Pose: l'API legacy (mp.solutions.pose.Pose) rileva UNA sola persona per
# costruzione — per il multi-persona serve la Tasks API (PoseLandmarker con
# num_poses), che richiede un bundle .task scaricato a parte (~9MB, vedi
# README). Default MULTI_PERSON=0 → nessun cambiamento rispetto a prima.
_pose_legacy = None
_pose_landmarker = None
if MULTI_PERSON:
    if not POSE_MODEL_PATH or not os.path.exists(POSE_MODEL_PATH):
        log.error(f"MULTI_PERSON=1 ma POSE_MODEL_PATH non valido: {POSE_MODEL_PATH!r} — fallback a Pose singola")
        MULTI_PERSON = False
    else:
        _pose_landmarker = mp_vision.PoseLandmarker.create_from_options(
            mp_vision.PoseLandmarkerOptions(
                base_options=mp_tasks.BaseOptions(model_asset_path=POSE_MODEL_PATH),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_poses=MAX_POSES,
                min_pose_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        )
        log.info(f"Pose multi-persona attiva (Tasks API, num_poses={MAX_POSES})")
if not MULTI_PERSON:
    _pose_legacy = mp.solutions.pose.Pose(
        static_image_mode=False, model_complexity=POSE_COMPLEXITY,
        min_detection_confidence=0.5, min_tracking_confidence=0.5
    )

_GESTURE_MAP = {0: 'fist', 1: 'point', 2: 'victory', 3: 'three', 4: 'open_hand'}


def _face_to_dict(lm, w, h):
    """Estrae i campi derivati per UN volto (lista landmark FaceMesh)."""
    smile = int(abs((lm[291].x - lm[61].x) * w))
    mouth_gap = abs((lm[14].y - lm[13].y) * h)
    mouth_open = mouth_gap > 15
    # Arricchimento emozione: sorriso marcato → happy; bocca aperta senza
    # sorriso → surprised; altrimenti neutral (nessuna nuova geometria
    # inventata, riusa solo i segnali già calcolati sopra).
    if smile > 80:
        emotion = 'happy'
    elif mouth_open and smile < 40:
        emotion = 'surprised'
    else:
        emotion = 'neutral'
    nx = lm[1].x
    attention = 'left' if nx < 0.42 else ('right' if nx > 0.58 else 'center')
    eye_dist = abs((lm[263].x - lm[33].x) * w) or 1
    left_ear  = abs((lm[159].y - lm[145].y) * h) / eye_dist
    right_ear = abs((lm[386].y - lm[374].y) * h) / eye_dist
    eyes_open = left_ear > 0.05 and right_ear > 0.05
    return {
        'x': nx, 'emotion': emotion, 'smile_score': smile,
        'attention': attention, 'mouth_open': mouth_open, 'eyes_open': eyes_open,
    }


def _pose_to_dict(lm):
    """Estrae i campi derivati per UNA posa (lista landmark Pose, 33 punti)."""
    ls, rs = lm[11], lm[12]
    lw, rw = lm[15], lm[16]
    lh, rh = lm[23], lm[24]
    if lw.y < ls.y and rw.y < rs.y:
        pose_state = 'arms_up'
    else:
        torso = abs(((lh.y + rh.y) / 2) - ((ls.y + rs.y) / 2))
        pose_state = 'standing' if torso > 0.25 else 'sitting'
    x = (ls.x + rs.x) / 2
    return {'x': x, 'pose': pose_state}


def _analyze(frame):
    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    faces = []
    hands = []
    poses = []

    fr = _face_mesh.process(rgb)
    for face_lm in (fr.multi_face_landmarks or []):
        faces.append(_face_to_dict(face_lm.landmark, w, h))

    hr = _hands.process(rgb)
    if hr.multi_hand_landmarks:
        handedness_list = hr.multi_handedness or [None] * len(hr.multi_hand_landmarks)
        for hand_lm, handed in zip(hr.multi_hand_landmarks, handedness_list):
            lm = hand_lm.landmark
            fingers = sum([lm[8].y < lm[6].y, lm[12].y < lm[10].y,
                           lm[16].y < lm[14].y, lm[20].y < lm[18].y])
            hands.append({
                'x': lm[0].x,
                'gesture': _GESTURE_MAP.get(fingers, 'open_hand'),
                'handedness': handed.classification[0].label if handed else 'unknown',
            })

    if MULTI_PERSON:
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        pr = _pose_landmarker.detect_for_video(mp_image, int(time.time() * 1000))
        for pose_lm in (pr.pose_landmarks or []):
            poses.append(_pose_to_dict(pose_lm))
    else:
        pr = _pose_legacy.process(rgb)
        if pr.pose_landmarks:
            poses.append(_pose_to_dict(pr.pose_landmarks.landmark))

    # Associazione best-effort persona-per-persona: nessuna delle tre pipeline
    # (FaceMesh/Hands/Pose) condivide un tracking-id tra loro, quindi si
    # appaiano per vicinanza orizzontale (ordinamento per x) — non garantisce
    # identità coerente frame-per-frame, solo un raggruppamento ragionevole
    # quando le persone sono separate lateralmente (tipico inquadratura fissa).
    faces_sorted = sorted(faces, key=lambda f: f['x'])
    poses_sorted = sorted(poses, key=lambda p: p['x'])
    n_people = max(len(faces_sorted), len(poses_sorted), 1 if hands else 0)

    # Ancora (x) di ogni persona: volto se c'è, altrimenti posa, altrimenti None
    anchors = []
    for i in range(n_people):
        face = faces_sorted[i] if i < len(faces_sorted) else None
        pose = poses_sorted[i] if i < len(poses_sorted) else None
        anchors.append(face['x'] if face else (pose['x'] if pose else None))

    # Ogni mano va alla persona con ancora più vicina; se nessuna persona ha
    # un'ancora nota (solo mani rilevate, niente volto/posa) tutte le mani
    # finiscono sulla persona 0.
    gestures_per_person = [[] for _ in range(n_people)]
    known_anchors = [i for i in range(n_people) if anchors[i] is not None]
    for hnd in hands:
        if known_anchors:
            nearest = min(known_anchors, key=lambda j: abs(hnd['x'] - anchors[j]))
        else:
            nearest = 0
        gestures_per_person[nearest].append(hnd['gesture'])

    people = []
    for i in range(n_people):
        face = faces_sorted[i] if i < len(faces_sorted) else None
        pose = poses_sorted[i] if i < len(poses_sorted) else None
        people.append({
            'id':          i,
            'x':           anchors[i],
            'emotion':     face['emotion'] if face else None,
            'smile_score': face['smile_score'] if face else 0,
            'attention':   face['attention'] if face else 'unknown',
            'mouth_open':  face['mouth_open'] if face else False,
            'eyes_open':   face['eyes_open'] if face else True,
            'pose':        pose['pose'] if pose else 'unknown',
            'gestures':    gestures_per_person[i],
        })

    primary = people[0] if people else None
    return {
        'person_detected': bool(people),
        'emotion':         primary['emotion'] if primary else None,
        'smile_score':     primary['smile_score'] if primary else 0,
        'attention':       primary['attention'] if primary else 'unknown',
        'gesture':         primary['gestures'][0] if primary and primary['gestures'] else 'none',
        'pose':            primary['pose'] if primary else 'unknown',
        'mouth_open':      primary['mouth_open'] if primary else False,
        'eyes_open':       primary['eyes_open'] if primary else True,
        'people_count':    len(people),
        'people':          [{k: v for k, v in p.items() if k != 'x'} for p in people],
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
    'people_count': 0, 'people': [],
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
if _pose_legacy:
    _pose_legacy.close()
if _pose_landmarker:
    _pose_landmarker.close()
if not HEADLESS:
    cv2.destroyAllWindows()
_mqtt.loop_stop()
_mqtt.disconnect()
