#!/usr/bin/env python3
"""
GAIA Scene Worker — coscienza spaziale (F5, docs/gaia-semantico.md).

Ogni SCENE_INTERVAL secondi:
  1. legge i profili device da Node-RED (GET /gaia/devices/profiles)
  2. per ogni camera con endpoint MJPEG raggiungibile cattura UN frame
  3. lo descrive con un VLM locale (Ollama, default moondream)
  4. pubblica gaia/scene/{room} → il brain memorizza com'è fatta la stanza

Gira come servizio del local_agent (nessun sudo richiesto). Env:
  MQTT_HOST/MQTT_PORT, SCENE_INTERVAL (s, default 900),
  SCENE_MODEL (default moondream), OLLAMA_URL, PROFILES_URL
"""
import base64
import json
import os
import socket
import time
import urllib.request

import paho.mqtt.client as mqtt

MQTT_HOST      = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT      = int(os.environ.get("MQTT_PORT", "1883"))
SCENE_INTERVAL = int(os.environ.get("SCENE_INTERVAL", "900"))
SCENE_MODEL    = os.environ.get("SCENE_MODEL", "moondream")
OLLAMA_URL     = os.environ.get("OLLAMA_URL", "http://localhost:11434")
PROFILES_URL   = os.environ.get("PROFILES_URL", "http://localhost:1880/gaia/devices/profiles")
INFER_TIMEOUT  = int(os.environ.get("SCENE_INFER_TIMEOUT", "360"))
# Override endpoint per device (JSON): es. il Pi dietro NAT è raggiungibile
# dal Core solo via tailscale — {"pi-fd75d8": "http://100.76.11.49:8766/video"}
try:
    ENDPOINT_OVERRIDES = json.loads(os.environ.get("SCENE_ENDPOINT_OVERRIDES", "{}"))
except ValueError:
    ENDPOINT_OVERRIDES = {}

PROMPT = ("Describe this room in one short paragraph: type of room, furniture, "
          "layout, lighting, notable objects. Be concrete and factual.")


def get_profiles() -> dict:
    with urllib.request.urlopen(PROFILES_URL, timeout=10) as r:
        return json.loads(r.read())


def grab_jpeg(mjpeg_url: str, timeout: float = 8.0) -> bytes | None:
    """Estrae UN frame JPEG da uno stream MJPEG multipart."""
    try:
        req = urllib.request.Request(mjpeg_url)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            buf = b""
            deadline = time.time() + timeout
            while time.time() < deadline:
                chunk = r.read(4096)
                if not chunk:
                    break
                buf += chunk
                start = buf.find(b"\xff\xd8")
                end = buf.find(b"\xff\xd9", start + 2)
                if start != -1 and end != -1:
                    return buf[start:end + 2]
    except (OSError, socket.timeout) as e:
        print(f"[Scene] {mjpeg_url}: non raggiungibile ({e})")
    return None


def describe(jpeg: bytes) -> str | None:
    body = json.dumps({
        "model": SCENE_MODEL,
        "prompt": PROMPT,
        "images": [base64.b64encode(jpeg).decode()],
        "stream": False,
        "options": {"num_predict": 120},
    }).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=INFER_TIMEOUT) as r:
            return json.loads(r.read()).get("response", "").strip() or None
    except OSError as e:
        print(f"[Scene] Ollama errore: {e}")
        return None


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="gaia-scene-worker")
    client.reconnect_delay_set(min_delay=2, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, 60)
    client.loop_start()
    print(f"[Scene] Worker attivo — modello {SCENE_MODEL}, intervallo {SCENE_INTERVAL}s")

    while True:
        try:
            profiles = get_profiles()
        except OSError as e:
            print(f"[Scene] Profili non disponibili: {e}")
            time.sleep(60)
            continue

        for did, p in profiles.items():
            cam = (p.get("services") or {}).get("camera") or {}
            mjpeg = ENDPOINT_OVERRIDES.get(did) or (cam.get("endpoints") or {}).get("mjpeg")
            room = p.get("room_assigned") or p.get("room")
            if not mjpeg or not room or cam.get("state") != "active":
                continue
            jpeg = grab_jpeg(mjpeg)
            if not jpeg:
                continue
            t0 = time.time()
            desc = describe(jpeg)
            if not desc:
                continue
            payload = {"room": room, "device_id": did, "description": desc,
                       "model": SCENE_MODEL, "infer_s": round(time.time() - t0, 1),
                       "ts": int(time.time() * 1000)}
            client.publish(f"gaia/scene/{room}", json.dumps(payload), retain=True)
            print(f"[Scene] {room} ({payload['infer_s']}s): {desc[:90]}...")

        time.sleep(SCENE_INTERVAL)


if __name__ == "__main__":
    main()
