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
    # Mocap grezzo diretto a TouchDesigner via OSC (bypassa MQTT/Node-RED —
    # è motion capture ad alta frequenza, non un evento "semantico" per il
    # brain). Di default OFF: comportamento identico a prima ovunque finché
    # non viene acceso esplicitamente (pensato per OPS, non per i Pi).
    'OSC_LANDMARKS':    '0',
    'OSC_HOST':         '127.0.0.1',
    'OSC_PORT':         '7000',
    'OSC_INTERVAL':     '0.08',   # ~12Hz, indipendente da PUBLISH_INTERVAL (quello è per MQTT)
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
OSC_LANDMARKS    = _cfg['OSC_LANDMARKS'] == '1'
OSC_HOST         = _cfg['OSC_HOST']
OSC_PORT         = int(_cfg['OSC_PORT'])
OSC_INTERVAL     = float(_cfg['OSC_INTERVAL'])
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

# Import lazy: python-osc non è (e non deve essere) una dipendenza dei Pi,
# solo delle macchine che accendono esplicitamente OSC_LANDMARKS=1.
# _osc_host è un PUNTO DI PARTENZA (OSC_HOST resta utile per un test locale
# senza TD ancora acceso), non la destinazione definitiva: appena arriva
# l'heartbeat di un device 'touchdesigner' su MQTT (_handle_td_status,
# sotto), _osc viene ricreato verso il suo IP reale — mai più un valore
# scritto una volta in config e mai aggiornato (causa di un IP stantio
# trovato in produzione il 2026-08-05: puntava a una macchina che non era
# più TD, il mocap non arrivava e nessun errore lo segnalava).
_osc = None
_osc_host = OSC_HOST
if OSC_LANDMARKS:
    try:
        from pythonosc.udp_client import SimpleUDPClient
        _osc = SimpleUDPClient(_osc_host, OSC_PORT)
        log.info(f"Mocap OSC attivo (default) → {_osc_host}:{OSC_PORT}/gaia/mocap/{DEVICE_ID}/... "
                 f"ogni {OSC_INTERVAL * 1000:.0f}ms — verrà ridiretto al vero IP di TD non appena annuncia")
    except ImportError:
        log.error("OSC_LANDMARKS=1 ma python-osc non installato (pip install python-osc) — mocap disattivato")
        OSC_LANDMARKS = False

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

    # Mocap diretto (bypassa il Core): la destinazione OSC di TD non è più
    # un IP fisso in config (trovato stantio in produzione il 2026-08-05,
    # puntava a una macchina che non era più TD) — si scopre da sola
    # ascoltando l'heartbeat del device agent di TD, stesso schema del
    # Device Registry (la config segue chi è davvero acceso).
    if OSC_LANDMARKS:
        client.subscribe('gaia/device/+/status', qos=0)
        log.info("Subscribed a gaia/device/+/status (scoperta IP TD per il mocap)")

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


_MY_HOSTNAME = socket.gethostname().lower()


def _handle_td_status(payload):
    """Mocap diretto (bypassa il Core): aggiorna la destinazione OSC quando
    un device con role 'touchdesigner' pubblica il proprio heartbeat —
    sostituisce l'IP fisso in config (vedi commento in _on_connect).

    Match sull'HOSTNAME, non solo su role=='touchdesigner': il mocap
    diretto è pensato per un TD sulla STESSA macchina (per questo bypassa
    il Core), e in produzione possono esistere più istanze TD contemporanee
    (osservato dal vivo il 2026-08-05: un'istanza vecchia rimasta accesa su
    un Mac, oltre a quella reale su questa macchina) — un match solo sul
    role manderebbe il mocap alla prima che risponde, non necessariamente
    quella giusta. TD deriva il proprio device_id dall'hostname macchina
    (td-{hostname}, vedi TD4Gaia/gaia_device_agent.py) — stesso confronto
    qui, sull'hostname di QUESTA macchina."""
    global _osc, _osc_host
    try:
        d = json.loads(payload.decode())
    except Exception:
        return
    if d.get('role') != 'touchdesigner':
        return
    td_id = d.get('device_id', '')
    if td_id != f'td-{_MY_HOSTNAME}':
        return
    ip = d.get('ip')
    if not ip or ip == _osc_host:
        return
    from pythonosc.udp_client import SimpleUDPClient
    _osc_host = ip
    _osc = SimpleUDPClient(_osc_host, OSC_PORT)
    log.info(f"Mocap OSC ridiretto verso TD ({d.get('device_id')}, "
             f"stanza={d.get('stanza')}) → {_osc_host}:{OSC_PORT}")


def _on_message(client, userdata, msg):
    """Riceve config dal Device Registry (room), comandi OTA, o l'heartbeat
    di un device TD (per il mocap diretto, vedi _handle_td_status)."""
    topic = msg.topic

    # OTA
    if topic in _ota.topics():
        _ota.handle(topic, msg.payload)
        return

    # Mocap: IP di TD scoperto dal vivo, non da un valore fisso in config
    if OSC_LANDMARKS and topic.startswith('gaia/device/') and topic.endswith('/status'):
        _handle_td_status(msg.payload)
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
        # model_asset_buffer invece di model_asset_path: il resolver interno
        # di mediapipe (C++) tratta i path non-POSIX (lettera di unità
        # Windows) come relativi alla resource dir di site-packages e non
        # trova mai il file — leggere i byte in Python evita del tutto la
        # risoluzione del path lato C++, funziona identico su Linux/Pi.
        with open(POSE_MODEL_PATH, 'rb') as f:
            _pose_model_bytes = f.read()
        _pose_landmarker = mp_vision.PoseLandmarker.create_from_options(
            mp_vision.PoseLandmarkerOptions(
                base_options=mp_tasks.BaseOptions(model_asset_buffer=_pose_model_bytes),
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

# Sottoinsiemi "con nome" dei 478 punti del volto, per chi consuma OSC senza
# voler ricostruire l'intera mesh (478 punti anonimi sono difficili da
# interpretare senza la topologia — le mani, con soli 21 punti in ordine
# fisso, sono già gestibili così come sono). Indici presi VERBATIM dalle
# costanti ufficiali di MediaPipe (mp.solutions.face_mesh.FACEMESH_*,
# verificati sull'installazione reale usata in produzione, non a memoria) —
# nomi lasciati identici alle costanti sorgente (left/right = convenzione
# MediaPipe stessa, non verificata qui rispetto a sinistra/destra reali).
_FACE_REGIONS = {
    'lips':          [0, 13, 14, 17, 37, 39, 40, 61, 78, 80, 81, 82, 84, 87, 88, 91, 95, 146, 178, 181, 185, 191, 267, 269, 270, 291, 308, 310, 311, 312, 314, 317, 318, 321, 324, 375, 402, 405, 409, 415],
    'eye_left':      [249, 263, 362, 373, 374, 380, 381, 382, 384, 385, 386, 387, 388, 390, 398, 466],
    'eye_right':     [7, 33, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163, 173, 246],
    'eyebrow_left':  [276, 282, 283, 285, 293, 295, 296, 300, 334, 336],
    'eyebrow_right': [46, 52, 53, 55, 63, 65, 66, 70, 105, 107],
    'nose':          [1, 2, 4, 5, 6, 19, 45, 48, 64, 94, 97, 98, 115, 168, 195, 197, 220, 275, 278, 294, 326, 327, 344, 440],
    'oval':          [10, 21, 54, 58, 67, 93, 103, 109, 127, 132, 136, 148, 149, 150, 152, 162, 172, 176, 234, 251, 284, 288, 297, 323, 332, 338, 356, 361, 365, 377, 378, 379, 389, 397, 400, 454],
}

# Landmark grezzi dell'ultimo frame analizzato — popolati da _analyze() SOLO
# se OSC_LANDMARKS è attivo (altrimenti restano vuoti, zero costo extra) e
# letti da _publish_landmarks_osc() nel loop principale, a un ritmo proprio
# (OSC_INTERVAL) indipendente da PUBLISH_INTERVAL/MQTT.
_last_raw = {'faces': [], 'hands': [], 'poses': []}


def _publish_landmarks_osc(room):
    """Manda viso/mani/pose grezzi direttamente a TouchDesigner via OSC,
    bypassando MQTT/Node-RED: è mocap ad alta frequenza (centinaia di punti
    a ~12Hz), non un evento "semantico" per il brain — instradarlo nella
    stessa pipeline dei pensieri/presenze la rallenterebbe inutilmente.

    Un indirizzo per device_id e per tipo (nord stella di questo progetto:
    "diviso bene per device e per tipo" — così un domani un altro device
    può accendere lo stesso flag senza calpestare gli indirizzi di questo),
    UN messaggio per volto/mano/posa con tutte le coordinate come lista
    invece di centinaia di messaggi singoli — 478 punti volto in un solo
    pacchetto UDP, non 478.

    L'indice nell'indirizzo è il person_id calcolato in _analyze() (stesso
    id di people[] lato MQTT, per vicinanza orizzontale) — NON l'ordine di
    rilevamento grezzo di MediaPipe: face/0, hand/left/0 e pose/0 sono
    garantiti essere la STESSA persona nello stesso frame (best-effort,
    non un'identità persistente tra frame — vedi commento in _analyze).
    device_id è nel path (identifica IL device), room resta solo in
    meta/room perché può cambiare (riassegnazione stanza) senza che
    device_id cambi — chi consuma correla i due via device_id."""
    if not _osc:
        return
    base = f"/gaia/mocap/{DEVICE_ID}"
    try:
        _osc.send_message(f"{base}/meta/room", room)
        _osc.send_message(f"{base}/meta/faces", len(_last_raw['faces']))
        _osc.send_message(f"{base}/meta/hands", len(_last_raw['hands']))
        _osc.send_message(f"{base}/meta/poses", len(_last_raw['poses']))
        for person_id, pts in enumerate(_last_raw['faces']):
            _osc.send_message(f"{base}/face/{person_id}", [c for p in pts for c in p])
            # Gruppi con nome (occhi/sopracciglia/labbra/naso/contorno) in
            # AGGIUNTA alla mesh completa sopra — stesso identico dato, solo
            # più facile da interpretare senza conoscere la topologia dei
            # 478 punti. Vedi _FACE_REGIONS per gli indici (verificati).
            for region, idxs in _FACE_REGIONS.items():
                region_pts = [pts[i] for i in idxs]
                _osc.send_message(f"{base}/face/{person_id}/{region}", [c for p in region_pts for c in p])
        for hd in _last_raw['hands']:
            side = 'left' if hd['handedness'].lower().startswith('l') else 'right'
            _osc.send_message(f"{base}/hand/{side}/{hd['person_id']}", [c for p in hd['points'] for c in p])
        for person_id, pts in enumerate(_last_raw['poses']):
            _osc.send_message(f"{base}/pose/{person_id}", [c for p in pts for c in p])
    except OSError:
        pass  # TouchDesigner non in ascolto — non bloccare il resto del loop


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
    raw_faces = []  # solo se OSC_LANDMARKS: [[(x,y,z), ...478], ...] un elemento per volto
    raw_hands = []  # [{'handedness':'Left'|'Right', 'points':[(x,y,z), ...21]}, ...]
    raw_poses = []  # [[(x,y,z,visibility), ...33], ...]

    fr = _face_mesh.process(rgb)
    for face_lm in (fr.multi_face_landmarks or []):
        faces.append(_face_to_dict(face_lm.landmark, w, h))
        if OSC_LANDMARKS:
            raw_faces.append([(p.x, p.y, p.z) for p in face_lm.landmark])

    hr = _hands.process(rgb)
    if hr.multi_hand_landmarks:
        handedness_list = hr.multi_handedness or [None] * len(hr.multi_hand_landmarks)
        for hand_lm, handed in zip(hr.multi_hand_landmarks, handedness_list):
            lm = hand_lm.landmark
            fingers = sum([lm[8].y < lm[6].y, lm[12].y < lm[10].y,
                           lm[16].y < lm[14].y, lm[20].y < lm[18].y])
            label = handed.classification[0].label if handed else 'unknown'
            hands.append({
                'x': lm[0].x,
                'gesture': _GESTURE_MAP.get(fingers, 'open_hand'),
                'handedness': label,
            })
            if OSC_LANDMARKS:
                raw_hands.append({'handedness': label, 'points': [(p.x, p.y, p.z) for p in lm]})

    if MULTI_PERSON:
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        pr = _pose_landmarker.detect_for_video(mp_image, int(time.time() * 1000))
        for pose_lm in (pr.pose_landmarks or []):
            poses.append(_pose_to_dict(pose_lm))
            if OSC_LANDMARKS:
                raw_poses.append([(p.x, p.y, p.z, getattr(p, 'visibility', 1.0)) for p in pose_lm])
    else:
        pr = _pose_legacy.process(rgb)
        if pr.pose_landmarks:
            poses.append(_pose_to_dict(pr.pose_landmarks.landmark))
            if OSC_LANDMARKS:
                raw_poses.append([(p.x, p.y, p.z, p.visibility) for p in pr.pose_landmarks.landmark])

    # Associazione best-effort persona-per-persona: nessuna delle tre pipeline
    # (FaceMesh/Hands/Pose) condivide un tracking-id tra loro, quindi si
    # appaiano per vicinanza orizzontale (ordinamento per x) — non garantisce
    # identità coerente frame-per-frame, solo un raggruppamento ragionevole
    # quando le persone sono separate lateralmente (tipico inquadratura fissa).
    # Ordinamento per INDICE (non sui dict direttamente) così lo stesso ordine
    # si può riapplicare a raw_faces/raw_poses per l'OSC — prima venivano
    # spediti nell'ordine di rilevamento di MediaPipe, scorrelato da
    # faces_sorted/poses_sorted: un volto e una mano con lo stesso indice
    # OSC potevano appartenere a due persone diverse.
    face_order = sorted(range(len(faces)), key=lambda idx: faces[idx]['x'])
    pose_order = sorted(range(len(poses)), key=lambda idx: poses[idx]['x'])
    faces_sorted = [faces[idx] for idx in face_order]
    poses_sorted = [poses[idx] for idx in pose_order]
    n_people = max(len(faces_sorted), len(poses_sorted), 1 if hands else 0)

    # Ancora (x) di ogni persona: volto se c'è, altrimenti posa, altrimenti None
    anchors = []
    for i in range(n_people):
        face = faces_sorted[i] if i < len(faces_sorted) else None
        pose = poses_sorted[i] if i < len(poses_sorted) else None
        anchors.append(face['x'] if face else (pose['x'] if pose else None))

    # Ogni mano va alla persona con ancora più vicina; se nessuna persona ha
    # un'ancora nota (solo mani rilevate, niente volto/posa) tutte le mani
    # finiscono sulla persona 0. hand_person_ids tiene l'id assegnato per
    # indice originale (allineato a hands/raw_hands) — serve per taggare
    # le mani grezze OSC con lo stesso person_id di volto/posa.
    gestures_per_person = [[] for _ in range(n_people)]
    hand_person_ids = [0] * len(hands)
    known_anchors = [i for i in range(n_people) if anchors[i] is not None]
    for hi, hnd in enumerate(hands):
        if known_anchors:
            nearest = min(known_anchors, key=lambda j: abs(hnd['x'] - anchors[j]))
        else:
            nearest = 0
        gestures_per_person[nearest].append(hnd['gesture'])
        hand_person_ids[hi] = nearest

    if OSC_LANDMARKS:
        # Stesso ordine/id persona usato sotto per people[] — un volto, una
        # posa e una mano con lo stesso person_id sono la stessa persona.
        _last_raw['faces'] = [raw_faces[idx] for idx in face_order]
        _last_raw['poses'] = [raw_poses[idx] for idx in pose_order]
        _last_raw['hands'] = [
            {**raw_hands[hi], 'person_id': hand_person_ids[hi]}
            for hi in range(len(raw_hands))
        ]

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
last_osc = 0.0
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
    if OSC_LANDMARKS and now - last_osc >= OSC_INTERVAL:
        _publish_landmarks_osc(_state['room'])
        last_osc = now

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
