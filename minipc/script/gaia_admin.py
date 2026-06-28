#!/usr/bin/env python3
"""
gaia_admin.py — HTTP API per il pannello di tuning GAIA
Porta: 8765
Endpoints:
  GET  /api/status          → stats live + config + speakers + faces
  POST /api/config          → aggiorna soglie
  POST /api/calibrate       → avvia auto-calibrazione microfono
  POST /api/enroll/voice    → avvia enrollment voce
  POST /api/enroll/face     → prepara cattura volto
  POST /api/speaker/<n>/delete → rimuovi speaker
"""

import json, os, threading, logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import paho.mqtt.client as mqtt

MQTT_BROKER = "localhost"
MQTT_PORT   = 1883
HTTP_PORT   = 8765

DB_PATH     = os.path.expanduser("~/core-node-0/script/voice_db.json")
CONFIG_PATH = os.path.expanduser("~/core-node-0/script/listener_config.json")
FACES_DIR   = "/media/core/D/face-env/faces"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("gaia_admin")

# ── Stato condiviso ───────────────────────────────────────────────────────────
_state: dict = {"stats": {}, "calibrate_result": {}}
_mqtt: mqtt.Client | None = None

# ── MQTT ──────────────────────────────────────────────────────────────────────
def _on_connect(c, u, f, rc, p):
    log.info(f"MQTT connesso (rc={rc})")
    c.subscribe("gaia/voce/stats")
    c.subscribe("gaia/admin/calibrate_result")

def _on_message(c, u, msg):
    try:
        payload = json.loads(msg.payload.decode())
        if msg.topic == "gaia/voce/stats":
            _state["stats"] = payload
        elif msg.topic == "gaia/admin/calibrate_result":
            _state["calibrate_result"] = payload
    except:
        pass

def _start_mqtt():
    global _mqtt
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    _mqtt.on_connect = _on_connect
    _mqtt.on_message = _on_message
    _mqtt.connect(MQTT_BROKER, MQTT_PORT, 60)
    _mqtt.loop_forever()

# ── Dati ─────────────────────────────────────────────────────────────────────
def get_speakers() -> list[str]:
    if not os.path.exists(DB_PATH):
        return []
    try:
        with open(DB_PATH) as f:
            return list(json.load(f).keys())
    except:
        return []

def get_faces() -> list[dict]:
    if not os.path.exists(FACES_DIR):
        return []
    result = []
    for name in sorted(os.listdir(FACES_DIR)):
        d = os.path.join(FACES_DIR, name)
        if os.path.isdir(d):
            imgs = len([f for f in os.listdir(d) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
            result.append({"name": name, "images": imgs})
    return result

def get_config() -> dict:
    defaults = {
        "device_id": "gaia-main", "device_hint": "Polycom",
        "voice_threshold": 300, "silence_frames": 25, "speaker_threshold": 0.72,
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                defaults.update(json.load(f))
        except:
            pass
    return defaults

def remove_speaker(name: str):
    if not os.path.exists(DB_PATH):
        return
    try:
        with open(DB_PATH) as f:
            db = json.load(f)
        db.pop(name, None)
        with open(DB_PATH, "w") as f:
            json.dump(db, f, indent=2)
        if _mqtt:
            _mqtt.publish("gaia/admin/reload_speakers", "{}")
        log.info(f"Speaker rimosso: {name}")
    except Exception as e:
        log.warning(f"remove_speaker error: {e}")

# ── HTTP handler ──────────────────────────────────────────────────────────────
class AdminHandler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors(); self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/status":
            self._json({
                "stats":            _state["stats"],
                "calibrate_result": _state["calibrate_result"],
                "config":           get_config(),
                "speakers":         get_speakers(),
                "faces":            get_faces(),
            })
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        path   = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if path == "/api/config":
            if _mqtt:
                _mqtt.publish("gaia/admin/config", json.dumps(body))
            self._json({"ok": True})

        elif path == "/api/calibrate":
            if _mqtt:
                _mqtt.publish("gaia/admin/calibrate", "{}")
            self._json({"ok": True, "message": "Calibrazione avviata — silenzio per 5s"})

        elif path == "/api/enroll/voice":
            name = body.get("name", "").strip()
            if not name:
                self._json({"ok": False, "error": "nome obbligatorio"}, 400); return
            payload = {"name": name, "samples": body.get("samples", 3), "duration_s": body.get("duration_s", 5)}
            if _mqtt:
                _mqtt.publish("gaia/admin/voice_enroll", json.dumps(payload))
            self._json({"ok": True, "name": name})

        elif path == "/api/enroll/face":
            name = body.get("name", "").strip()
            if not name:
                self._json({"ok": False, "error": "nome obbligatorio"}, 400); return
            if _mqtt:
                _mqtt.publish("gaia/vision/control", json.dumps({"cmd": "save_face", "name": name}))
            self._json({"ok": True, "name": name, "message": "Punta la telecamera verso la persona"})

        elif path.endswith("/delete") and "/api/speaker/" in path:
            name = path.split("/")[-2]
            remove_speaker(name)
            self._json({"ok": True})

        else:
            self.send_response(404); self.end_headers()

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, *_):
        pass  # sopprimi spam HTTP nei log

if __name__ == "__main__":
    threading.Thread(target=_start_mqtt, daemon=True).start()
    log.info(f"Gaia Admin API → http://0.0.0.0:{HTTP_PORT}")
    HTTPServer(("0.0.0.0", HTTP_PORT), AdminHandler).serve_forever()
