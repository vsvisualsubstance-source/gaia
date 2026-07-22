import os
import sys

# ==============================================================================
# OTTIMIZZAZIONE CPU INTEL (Da eseguire PRIMA di importare cv2/insightface)
# ==============================================================================
# Forziamo ONNX Runtime e OpenMP a usare più thread paralleli sulla CPU dell'i5
os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"

import cv2
import numpy as np
import base64
import json
import time
import faiss
import paho.mqtt.client as mqtt
from insightface.app import FaceAnalysis

# =========================
# CONFIG
# =========================
MQTT_HOST = "localhost"
TOPIC_IN = "gaia/+/snapshot"       
TOPIC_OUT = "gaia/vision/identity"
TOPIC_CONTROL = "gaia/vision/control"

FACE_DIR = "faces"
THRESHOLD = 0.28  # Abbassato da 0.35: crop YOLO a 160x160 raggiungevano max 0.33

# =========================
# INSIGHTFACE INIT
# =========================
app = FaceAnalysis(name="buffalo_l")
# ctx_id=0 indica l'uso della CPU. det_size ridotto a 320 ottimizza la velocità su crop YOLO
app.prepare(ctx_id=0, det_size=(320, 320))

names = []
index = faiss.IndexFlatIP(512)

# =========================
# UTILS
# =========================
def normalize(v):
    v = np.array(v, dtype="float32")
    return v / (np.linalg.norm(v) + 1e-10)

def add_face(name, emb):
    emb = normalize(emb).astype("float32").reshape(1, -1)
    names.append(name)
    index.add(emb)

def get_embedding(img):
    start_time = time.time()
    # Upscala crop piccole: InsightFace lavora meglio su immagini ≥320px
    h, w = img.shape[:2]
    if max(h, w) < 320:
        scale = 320 / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    faces = app.get(img)
    elapsed = (time.time() - start_time) * 1000
    print(f"[PERF] Inference InsightFace: {elapsed:.2f} ms")
    
    if not faces:
        return None

    emb = np.array(faces[0].embedding, dtype="float32")
    if emb.shape[0] != 512:
        print("[ERR] embedding size:", emb.shape)
        return None

    return normalize(emb)

# =========================
# LOAD / RELOAD DATASET
# =========================
def load_faces_from_disk():
    global names, index
    print("[DB] Loading dataset from disk...")
    
    if not os.path.exists(FACE_DIR):
        print("[DB] faces folder not found")
        return

    names = []
    index = faiss.IndexFlatIP(512)
    total = 0

    for person in os.listdir(FACE_DIR):
        person_path = os.path.join(FACE_DIR, person)
        if not os.path.isdir(person_path):
            continue

        count = 0
        for file in os.listdir(person_path):
            if not file.lower().endswith((".jpg", ".jpeg", ".png")):
                continue

            img_path = os.path.join(person_path, file)
            img = cv2.imread(img_path)
            if img is None:
                continue

            emb = get_embedding(img)
            if emb is None:
                continue

            add_face(person, emb)
            count += 1
            total += 1

        print(f"[DB] {person}: {count} images loaded")

    print(f"[DB] TOTAL embeddings loaded: {total}")

# =========================
# RECOGNITION
# =========================
def recognize(emb):
    if len(names) == 0:
        return "unknown", 0.0

    emb = emb.reshape(1, -1).astype("float32")
    D, I = index.search(emb, 1)

    score = float(D[0][0])
    idx = int(I[0][0])

    if score > THRESHOLD:
        return names[idx], score

    return "unknown", score

# =========================
# MQTT CALLBACKS
# =========================
def on_message(client, userdata, msg):
    try:
        # 1. Gestione comandi di controllo
        if msg.topic == TOPIC_CONTROL:
            payload = json.loads(msg.payload.decode())
            cmd = payload.get("cmd")
            if cmd == "reload":
                load_faces_from_disk()
            elif cmd == "save_face":
                global _save_face_name
                _save_face_name = payload.get("name", "").strip() or None
                if _save_face_name:
                    print(f"[ENROLL] Pronto a catturare volto per: {_save_face_name}")
            return

        # 2. Gestione Riconoscimento Snapshot
        if msg.topic.startswith("gaia/") and msg.topic.endswith("/snapshot"):
            payload = json.loads(msg.payload.decode())
            
            if "image" not in payload:
                return

            img_b64 = payload["image"]
            img_bytes = base64.b64decode(img_b64)
            img_np = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(img_np, cv2.IMREAD_COLOR)

            if frame is None:
                print("[WARN] Errore decodifica immagine da MQTT")
                return

            # Estrazione del nome telecamera dal topic
            topic_parts = msg.topic.split('/')
            camera_name = topic_parts[1]

            # --------------------------------==================================
            # DIAGNOSTICA: SALVATAGGIO IMMAGINE RICEVUTA
            # Salva il frame nella stessa cartella dello script per verificarlo
            # --------------------------------==================================
            filename = f"debug_{camera_name}.jpg"
            cv2.imwrite(filename, frame)
            print(f"[DIAGNOSTICA] Immagine salvata come: {filename} (Risoluzione: {frame.shape[1]}x{frame.shape[0]})")
            # --------------------------------==================================

            # Cattura per enrollment se richiesta
            if _save_face_name:
                save_face_snapshot(_save_face_name, frame)
                _save_face_name = None  # consuma il flag

            emb = get_embedding(frame)

            if emb is None:
                name, score = "unknown", 0.0
            else:
                name, score = recognize(emb)

            out = {
                "track_id": payload.get("track_id"),
                "camera": camera_name,
                "name": name,
                "confidence": round(score, 4),
                "timestamp": payload.get("timestamp", time.time())
            }

            client.publish(TOPIC_OUT, json.dumps(out))
            print(f"[MATCH] {camera_name} -> {name} ({score:.2f})")

    except Exception as e:
        print("[ERROR] Callback exception:", e)
# =========================
# SAVE FACE (admin enrollment)
# =========================
_save_face_name: str | None = None  # se impostato, il prossimo snapshot viene salvato come training

def save_face_snapshot(name: str, frame) -> bool:
    """Salva il frame nella cartella faces/<name>/ per espandere il DB."""
    person_dir = os.path.join(FACE_DIR, name)
    os.makedirs(person_dir, exist_ok=True)
    existing = [f for f in os.listdir(person_dir) if f.lower().endswith(('.jpg', '.png'))]
    idx = len(existing)
    path = os.path.join(person_dir, f"snap_{idx:04d}.jpg")
    ok = cv2.imwrite(path, frame)
    if ok:
        print(f"[ENROLL] Salvato: {path}")
        load_faces_from_disk()  # reload immediato
    return ok

# =========================
# STARTUP
# =========================
load_faces_from_disk()

# Configurazione formale API v2 per Paho MQTT
client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
client.on_message = on_message


def _on_connect(c, userdata, flags, reason_code, properties=None):
    # Le subscribe DEVONO stare qui: se fatte una sola volta dopo connect(),
    # a ogni riavvio del broker paho si riconnette ma senza sottoscrizioni →
    # servizio "attivo" ma sordo (successo davvero il 2026-07-06 dopo un
    # restart di mosquitto: snapshot mai processati finché non riavviato).
    c.subscribe(TOPIC_IN)
    c.subscribe(TOPIC_CONTROL)
    print(f"[MQTT] connesso (rc={reason_code}), subscribe a {TOPIC_IN} + {TOPIC_CONTROL}")


client.on_connect = _on_connect
client.reconnect_delay_set(min_delay=2, max_delay=30)
client.connect(MQTT_HOST, 1883, 60)

print("GAIA Face Service running on Intel i5...")
client.loop_forever()
