"""
GAIA YOLO Node — main loop

Usa mqtt.topic_frame / topic_events / ecc. (proprietà dinamiche)
così quando il Device Registry aggiorna la room, i topic cambiano
automaticamente senza restart.
"""

import cv2
import time
import base64
import signal
import logging
import config

from detector import Detector
from tracker import Tracker
from mqtt_client import MqttClient
from camera_client import CameraClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('gaia-yolo')

# ── INIT ──────────────────────────────────────────────────────────────────────

log.info(f"device_id={config.DEVICE_ID} node_id_claim={config.NODE_ID}")

detector = Detector(config.YOLO_MODEL)
tracker  = Tracker(max_age=15)

mqtt = MqttClient(
    host=config.MQTT_HOST,
    port=config.MQTT_PORT,
    device_id=config.DEVICE_ID,
    node_id_claim=config.NODE_ID,
)

cam = CameraClient()
if not cam.attach():
    log.warning("Camera broker (gaia-camera) non disponibile all'avvio, riproverò nel loop")

last_snapshot_time = {}
last_seen          = {}
last_event_time    = {}
last_summary       = None
last_heartbeat     = 0
frame_id           = 0
_running           = True

def _shutdown(sig, frame):
    global _running
    log.info(f"Segnale {sig} ricevuto, shutdown...")
    _running = False

signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT,  _shutdown)

# ── HELPERS ───────────────────────────────────────────────────────────────────

def encode_person_crop(frame, box, quality=40):
    x1, y1, x2, y2 = map(int, box)
    h, w = frame.shape[:2]
    crop = frame[max(0,y1):min(h,y2), max(0,x1):min(w,x2)]
    if crop.size == 0:
        return None
    crop = cv2.resize(crop, (160, 160))
    ok, buf = cv2.imencode('.jpg', crop, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return base64.b64encode(buf).decode('utf-8') if ok else None


def publish_event(event_type, track_id, extra=None):
    now = time.time()
    key = f"{event_type}_{track_id}"
    if now - last_event_time.get(key, 0) < config.EVENT_COOLDOWN_SEC:
        return
    last_event_time[key] = now
    payload = {
        'node':      mqtt.node_id,       # dinamico
        'location':  config.LOCATION,
        'zone':      config.ZONE,
        'camera':    config.CAMERA_NAME,
        'event':     event_type,
        'track_id':  track_id,
        'timestamp': now,
    }
    if extra:
        payload.update(extra)
    mqtt.publish(mqtt.topic_events, payload)  # topic dinamico

# ── MAIN LOOP ─────────────────────────────────────────────────────────────────

log.info("Loop avviato (headless, no finestre video)")

while _running:

    # Camera broker recovery
    if not cam.attached:
        log.warning("Camera broker non disponibile, riprovo tra 5s...")
        time.sleep(5)
        cam.attach()
        continue

    ret, frame = cam.read()
    if not ret:
        log.warning("Frame non letto")
        time.sleep(0.1)
        continue

    timestamp = time.time()
    frame_id += 1

    # ── HEARTBEAT ─────────────────────────────────────────────────────────────

    if timestamp - last_heartbeat > config.HEARTBEAT_INTERVAL:
        mqtt.publish(mqtt.topic_heartbeat, {   # topic dinamico
            'node':      mqtt.node_id,
            'location':  config.LOCATION,
            'zone':      config.ZONE,
            'camera':    config.CAMERA_NAME,
            'status':    'online',
            'timestamp': timestamp,
        })
        last_heartbeat = timestamp

    # ── YOLO ──────────────────────────────────────────────────────────────────

    if frame_id % config.FRAME_SKIP == 0:
        detections = detector.infer(frame, conf_thres=config.CONFIDENCE_THRESHOLD, imgsz=config.YOLO_IMGSZ)
        tracks = tracker.update(detections, timestamp)
    else:
        tracks = tracker.update([], timestamp)

    persons     = []
    obj_counter = {}

    # ── TRACKS ────────────────────────────────────────────────────────────────

    for t in tracks:
        cls_name = t['class']
        track_id = t['track_id']

        if cls_name != 'person':
            # tracker.update() restituisce solo track non scadute (age <= max_age):
            # contale tutte, non solo quelle viste nell'esatto frame corrente,
            # altrimenti con FRAME_SKIP>1 l'oggetto sparisce e ricompare a ogni ciclo
            obj_counter[cls_name] = obj_counter.get(cls_name, 0) + 1
            continue

        conf  = float(t.get('conf', 0))
        hits  = int(t.get('hits', 1))
        age   = int(t.get('age', 0))

        # Track confermata solo dopo MIN_CONFIRMED_HITS rilevamenti
        confirmed = hits >= config.MIN_CONFIRMED_HITS

        if confirmed:
            # Person enter: prima volta che raggiungiamo la soglia
            if track_id not in last_seen:
                publish_event('person_entered', track_id)

            # Aggiorna last_seen solo se vista nel frame corrente
            if age == 0:
                last_seen[track_id] = timestamp

            # Snapshot per face recognition — ripetuto ogni SNAPSHOT_REFRESH_S
            # finché il track vive (non più once-per-track: il face service
            # merita più di un tentativo per persona)
            if (conf >= config.SNAPSHOT_CONF_THRESHOLD
                    and age == 0
                    and timestamp - last_snapshot_time.get(track_id, 0) >= config.SNAPSHOT_REFRESH_S):
                snap = encode_person_crop(frame, t['box'])
                if snap:
                    mqtt.publish(mqtt.topic_snapshot, {
                        'node':      mqtt.node_id,
                        'location':  config.LOCATION,
                        'zone':      config.ZONE,
                        'camera':    config.CAMERA_NAME,
                        'track_id':  track_id,
                        'timestamp': timestamp,
                        'conf':      conf,
                        'image':     snap,
                    })
                    last_snapshot_time[track_id] = timestamp

            # Conta ogni persona confermata ancora tracciata (non scaduta), non solo
            # quelle viste nell'esatto frame corrente: con FRAME_SKIP>1 la maggior parte
            # dei cicli non ha una detection fresca, e limitarsi ad age==0 faceva
            # sparire/ricomparire la persona ad ogni ciclo (persons_count 1/0/1/0...)
            persons.append({'track_id': track_id, 'conf': conf, 'box': t['box']})

    # ── PERSON LEFT ───────────────────────────────────────────────────────────

    for tid in list(last_seen):
        if timestamp - last_seen[tid] > config.PERSON_TIMEOUT:
            publish_event('person_left', tid)
            del last_seen[tid]
            last_snapshot_time.pop(tid, None)

    # ── FRAME SUMMARY ─────────────────────────────────────────────────────────

    active = sorted(p['track_id'] for p in persons)
    state  = {'persons_count': len(persons), 'persons': active, 'objects': obj_counter}

    if state != last_summary:
        mqtt.publish(mqtt.topic_frame, {   # topic dinamico
            'node':          mqtt.node_id,
            'location':      config.LOCATION,
            'zone':          config.ZONE,
            'camera':        config.CAMERA_NAME,
            'timestamp':     timestamp,
            'persons_count': len(persons),
            'persons':       active,
            'objects':       obj_counter,
        })
        last_summary = state.copy()
        log.info(f"[{mqtt.node_id}] persons={len(persons)} objects={list(obj_counter.keys())}")
