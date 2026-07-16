#!/usr/bin/env python3
"""
GAIA Mediaplayer — musica/radio per stanza (docs/core-distribuito.md).

mpv in modalità IPC (--input-ipc-server) pilotato via MQTT:
  gaia/media/{stanza}/command  ← {"action": "play", "url": "..."} | pause |
                                  resume | stop | {"action":"volume","value":0-100}
  gaia/media/{stanza}/status   → retained {state, title, volume, url, ts}

La stanza segue il Device Registry (gaia/devices/{id}/config, retained) come
fa voice: spostando il device i topic si rimappano da soli.
Ogni stanza è indipendente (design mpv+MQTT; Snapcast per il multi-room
sincronizzato è un'evoluzione futura, non questo modulo).
"""
import json
import os
import signal
import socket
import subprocess
import threading
import time

import paho.mqtt.client as mqtt

import config

_running = True
_current_room = config.ROOM
_mpv: subprocess.Popen | None = None
_last_url = None


def _shutdown(sig, frame):
    global _running
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


# ── mpv IPC ───────────────────────────────────────────────────────────────────
def _mpv_start():
    global _mpv
    if not config.IS_WIN and os.path.exists(config.MPV_SOCK):
        os.unlink(config.MPV_SOCK)
    _mpv = subprocess.Popen(
        [config.MPV_BIN, "--idle=yes", "--no-video", "--no-terminal",
         f"--input-ipc-server={config.MPV_SOCK}",
         f"--volume={config.DEFAULT_VOLUME}"],
    )
    if config.IS_WIN:
        time.sleep(2)                        # la pipe non è verificabile con exists
        return
    for _ in range(50):                      # attesa socket (max 5s)
        if os.path.exists(config.MPV_SOCK):
            return
        time.sleep(0.1)
    raise RuntimeError("mpv non ha creato il socket IPC")


def _ipc_win(command: list):
    """IPC su Windows: mpv usa una named pipe, non un socket unix."""
    try:
        with open(config.MPV_SOCK, "r+b", buffering=0) as pipe:
            pipe.write((json.dumps({"command": command}) + "\n").encode())
            deadline = time.time() + 2
            while time.time() < deadline:
                line = pipe.readline()
                if not line:
                    break
                try:
                    d = json.loads(line)
                    if "error" in d:
                        return d
                except ValueError:
                    continue
    except OSError as e:
        print(f"[Media] IPC pipe errore: {e}")
    return None


def _ipc(command: list):
    """Invia un comando IPC a mpv e ritorna la risposta (o None)."""
    if config.IS_WIN:
        return _ipc_win(command)
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(config.MPV_SOCK)
        s.sendall((json.dumps({"command": command}) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        s.close()
        for line in buf.decode("utf8", "ignore").splitlines():
            try:
                d = json.loads(line)
                if "error" in d:
                    return d
            except ValueError:
                continue
    except OSError as e:
        print(f"[Media] IPC errore: {e}")
    return None


def _prop(name):
    r = _ipc(["get_property", name])
    return r.get("data") if r and r.get("error") == "success" else None


# ── MQTT ──────────────────────────────────────────────────────────────────────
def _topic_cmd():    return f"gaia/media/{_current_room}/command"
def _topic_status(): return f"gaia/media/{_current_room}/status"


try:
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=f"gaia-media-{config.DEVICE_ID}")
except AttributeError:                        # paho 1.x di sistema
    _mqtt = mqtt.Client(client_id=f"gaia-media-{config.DEVICE_ID}")
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


def _publish_status():
    paused = _prop("pause")
    idle   = _prop("idle-active")
    state = "stopped" if idle else ("paused" if paused else "playing")
    payload = {
        "state":  state,
        "title":  _prop("media-title") if not idle else None,
        "url":    _last_url if not idle else None,
        "volume": int(_prop("volume") or 0),
        "stanza": _current_room,
        "ts":     int(time.time() * 1000),
    }
    _mqtt.publish(_topic_status(), json.dumps(payload), retain=True)


def _handle_command(payload: bytes):
    global _last_url
    try:
        cmd = json.loads(payload)
    except ValueError:
        print(f"[Media] Comando non JSON: {payload[:60]!r}")
        return
    action = (cmd.get("action") or "").lower()
    print(f"[Media] Comando: {action} {cmd.get('url') or cmd.get('value') or ''}")
    if action == "play" and cmd.get("url"):
        _last_url = cmd["url"]
        _ipc(["loadfile", cmd["url"], "replace"])
        _ipc(["set_property", "pause", False])
    elif action == "pause":
        _ipc(["set_property", "pause", True])
    elif action == "resume":
        _ipc(["set_property", "pause", False])
    elif action == "stop":
        _ipc(["stop"])
    elif action == "volume":
        try:
            vol = max(0, min(100, int(cmd.get("value", config.DEFAULT_VOLUME))))
            _ipc(["set_property", "volume", vol])
        except (TypeError, ValueError):
            pass
    elif action != "status":
        print(f"[Media] Azione sconosciuta: {action}")
    _publish_status()


def _on_connect(client, userdata, flags, rc, properties=None):
    if getattr(rc, "value", rc) not in (0, "Success"):
        print(f"[MQTT] Connessione fallita: rc={rc}")
        return
    client.subscribe(_topic_cmd())
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    _publish_status()
    print(f"[MQTT] Connesso — stanza {_current_room}, cmd={_topic_cmd()}")


def _on_message(client, userdata, msg):
    global _current_room
    if msg.topic == f"gaia/devices/{config.DEVICE_ID}/config":
        try:
            new_room = json.loads(msg.payload).get("room")
        except ValueError:
            return
        if new_room and new_room != _current_room:
            print(f"[Registry] Stanza: {_current_room} → {new_room}")
            client.unsubscribe(_topic_cmd())
            # la vecchia stanza non ha più un player: via il retained
            _mqtt.publish(_topic_status(), "", retain=True)
            _current_room = new_room
            client.subscribe(_topic_cmd())
            _publish_status()
        return
    if msg.topic == _topic_cmd():
        _handle_command(msg.payload)


_mqtt.on_connect = _on_connect
_mqtt.on_message = _on_message


def main():
    _mpv_start()
    print(f"[Media] mpv avviato (socket {config.MPV_SOCK}, vol {config.DEFAULT_VOLUME})")
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    threading.Thread(target=_mqtt.loop_forever,
                     kwargs={"retry_first_connection": True}, daemon=True).start()

    last_status = 0.0
    while _running:
        if time.time() - last_status >= config.STATUS_EVERY_S:
            last_status = time.time()
            try:
                _publish_status()
            except Exception as e:
                print(f"[Media] status errore: {e}")
        time.sleep(0.5)

    _ipc(["quit"])
    if _mpv:
        try:
            _mpv.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _mpv.kill()
    _mqtt.publish(_topic_status(), "", retain=True)
    print("[Media] Terminato.")


if __name__ == "__main__":
    main()
