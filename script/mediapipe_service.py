import cv2
import mediapipe as mp
import paho.mqtt.client as mqtt
import json
import time

# ========================
# CONFIG
# ========================
MQTT_BROKER = "localhost"
MQTT_PORT   = 1883

# Topic unico combinato — corrisponde a quello che ascolta Node-RED
TOPIC_MEDIAPIPE = "gaia/mediapipe/pose"

CAMERA_ID = 0
CAMERA    = "salotto"   # identificativo stanza / room
FPS_LIMIT = 2

# ========================
# MQTT
# ========================
client = mqtt.Client()

def mqtt_connect():
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_start()
        print("MQTT connected")
    except Exception as e:
        print("MQTT error:", e)

# ========================
# MEDIAPIPE
# ========================
mp_face_mesh = mp.solutions.face_mesh
mp_pose      = mp.solutions.pose

face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=2,
    refine_landmarks=True,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6
)

pose = mp_pose.Pose(
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6
)

# ========================
# EMOTION
# ========================
def estimate_emotion(lm):
    try:
        upper_lip    = lm.landmark[13]
        lower_lip    = lm.landmark[14]
        mouth_left   = lm.landmark[61]
        mouth_right  = lm.landmark[291]
        left_eyebrow = lm.landmark[105]
        right_eyebrow = lm.landmark[334]

        mouth_open   = abs(upper_lip.y - lower_lip.y)
        mouth_width  = abs(mouth_left.x - mouth_right.x)
        eyebrow_diff = abs(left_eyebrow.y - right_eyebrow.y)

        if mouth_open > 0.03 and mouth_width > 0.2:
            return "happy", 0.85
        elif eyebrow_diff > 0.02:
            return "surprised", 0.8
        elif mouth_open < 0.01:
            return "sad", 0.7
        else:
            return "neutral", 0.6
    except:
        return "unknown", 0.0

# ========================
# POSE
# ========================
def classify_pose(lm):
    try:
        ls = lm.landmark[mp_pose.PoseLandmark.LEFT_SHOULDER]
        rs = lm.landmark[mp_pose.PoseLandmark.RIGHT_SHOULDER]
        lh = lm.landmark[mp_pose.PoseLandmark.LEFT_HIP]
        rh = lm.landmark[mp_pose.PoseLandmark.RIGHT_HIP]

        shoulder_y = (ls.y + rs.y) / 2
        hip_y      = (lh.y + rh.y) / 2

        if hip_y - shoulder_y > 0.3:
            return "standing"
        elif abs(ls.y - lh.y) < 0.1:
            return "sitting"
        else:
            return "moving"
    except:
        return "unknown"

# ========================
# START
# ========================
mqtt_connect()

cap = cv2.VideoCapture(CAMERA_ID)
print(f"MediaPipe service started — camera={CAMERA} → topic={TOPIC_MEDIAPIPE}")

last_time = 0

try:
    while True:
        now = time.time()
        if now - last_time < 1.0 / FPS_LIMIT:
            continue
        last_time = now

        ret, frame = cap.read()
        if not ret:
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        face     = face_mesh.process(rgb)
        pose_res = pose.process(rgb)

        # Raccoglie tutti i dati del frame e pubblica UN solo messaggio
        frame_data = {
            "ts":              int(time.time() * 1000),
            "camera":          CAMERA,
            "node":            CAMERA,
            "person_detected": False,
        }

        # Emozione dal primo volto rilevato
        if face.multi_face_landmarks:
            lm = face.multi_face_landmarks[0]
            emotion, conf = estimate_emotion(lm)
            frame_data["emotion"]          = emotion
            frame_data["confidence"]       = conf
            frame_data["person_detected"]  = True
            frame_data["faces_count"]      = len(face.multi_face_landmarks)

        # Pose corporea
        if pose_res.pose_landmarks:
            frame_data["pose"]             = classify_pose(pose_res.pose_landmarks)
            frame_data["person_detected"]  = True

        # Pubblica solo se c'è almeno una persona
        if frame_data["person_detected"]:
            client.publish(TOPIC_MEDIAPIPE, json.dumps(frame_data))

except KeyboardInterrupt:
    print("Stopped")

finally:
    cap.release()
    client.disconnect()
