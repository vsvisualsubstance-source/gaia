#!/usr/bin/env python3
"""
GAIA Mediaplayer — musica/radio per stanza (docs/core-distribuito.md).

mpv in modalità IPC (--input-ipc-server) pilotato via MQTT:
  gaia/media/{stanza}/command  ← {"action": "play", "url": "..."} | pause |
                                  resume | stop | {"action":"volume","value":0-100}
                                  {"action":"queue","urls":[...],"mode":"shuffle"|"sequential"}
                                  next | prev
  gaia/media/{stanza}/status   → retained {state, title, volume, url, ts, queue?}

La stanza segue il Device Registry (gaia/devices/{id}/config, retained) come
fa voice: spostando il device i topic si rimappano da soli.
Ogni stanza è indipendente (design mpv+MQTT; Snapcast per il multi-room
sincronizzato è un'evoluzione futura, non questo modulo).

Coda/autoplay (2026-07-23): "queue" carica una playlist di URL (in genere
la libreria locale servita via HTTP da Node-RED, ma qualsiasi lista di URL
funziona) e la fa avanzare da sola — il loop principale osserva la
transizione "stava suonando" → "idle" di mpv (fine naturale del brano, non
uno stop esplicito) e carica il prossimo. "shuffle" pesca a caso (evita
l'immediata ripetizione), "sequential" segue l'ordine e ricomincia in loop.
Un comando "play"/"stop" esplicito azzera la coda: l'autoplay non deve
"rubare" il controllo quando l'utente vuole ascoltare una cosa sola.
"""
import json
import os
import random
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

# ── Coda/autoplay ─────────────────────────────────────────────────────────────
_queue: list[str] = []
_queue_mode: str | None = None     # None | "shuffle" | "sequential"
_queue_pos: int = -1
_queue_recent: list[int] = []      # ultimi indici scelti in shuffle, per non ripetere subito
_was_playing = False               # per rilevare la transizione playing→idle (fine naturale)


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
    args = [config.MPV_BIN, "--idle=yes", "--no-video", "--no-terminal",
            "--force-window=no",
            f"--input-ipc-server={config.MPV_SOCK}",
            f"--volume={config.DEFAULT_VOLUME}"]
    if config.MPV_AUDIO_DEVICE:
        args.append(f"--audio-device={config.MPV_AUDIO_DEVICE}")
    _mpv = subprocess.Popen(args)
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
    if _queue_mode:
        payload["queue"] = {"mode": _queue_mode, "index": _queue_pos, "total": len(_queue)}
    _mqtt.publish(_topic_status(), json.dumps(payload), retain=True)


def _clear_queue():
    global _queue, _queue_mode, _queue_pos, _queue_recent
    _queue, _queue_mode, _queue_pos, _queue_recent = [], None, -1, []


def _pick_next_index() -> int | None:
    """Prossimo indice in coda secondo la modalità corrente. None se la coda è vuota."""
    if not _queue:
        return None
    if _queue_mode == "sequential":
        return (_queue_pos + 1) % len(_queue)
    # shuffle: pesca a caso evitando gli ultimi scelti (se la coda è abbastanza lunga)
    avoid = set(_queue_recent[-min(len(_queue) - 1, 5):]) if len(_queue) > 1 else set()
    choices = [i for i in range(len(_queue)) if i not in avoid] or list(range(len(_queue)))
    return random.choice(choices)


def _load_queue_index(idx: int):
    global _last_url, _queue_pos
    _queue_pos = idx
    _queue_recent.append(idx)
    del _queue_recent[:-8]
    _last_url = _queue[idx]
    _ipc(["loadfile", _last_url, "replace"])
    _ipc(["set_property", "pause", False])


def _advance_queue():
    """Chiamata quando mpv passa da 'playing' a 'idle' da solo (brano finito) —
    non per uno stop esplicito (quello azzera la coda in _handle_command)."""
    idx = _pick_next_index()
    if idx is not None:
        print(f"[Media] Autoplay: avanzo a {idx + 1}/{len(_queue)}")
        _load_queue_index(idx)


def _handle_command(payload: bytes):
    global _last_url, _queue, _queue_mode
    try:
        cmd = json.loads(payload)
    except ValueError:
        print(f"[Media] Comando non JSON: {payload[:60]!r}")
        return
    action = (cmd.get("action") or "").lower()
    print(f"[Media] Comando: {action} {cmd.get('url') or cmd.get('value') or ''}")
    if action == "play" and cmd.get("url"):
        _clear_queue()
        _last_url = cmd["url"]
        _ipc(["loadfile", cmd["url"], "replace"])
        _ipc(["set_property", "pause", False])
    elif action == "queue" and cmd.get("urls"):
        _clear_queue()
        _queue = list(cmd["urls"])
        _queue_mode = "sequential" if cmd.get("mode") == "sequential" else "shuffle"
        start = cmd.get("start_index")
        idx = start if isinstance(start, int) and 0 <= start < len(_queue) else _pick_next_index()
        if idx is not None:
            _load_queue_index(idx)
    elif action == "next":
        if _queue:
            _advance_queue()
    elif action == "prev":
        if _queue and _queue_mode == "sequential":
            _load_queue_index((_queue_pos - 1) % len(_queue))
        elif _queue:
            _advance_queue()   # in shuffle "indietro" non ha un vero senso: un'altra pesca
    elif action == "pause":
        _ipc(["set_property", "pause", True])
    elif action == "resume":
        _ipc(["set_property", "pause", False])
    elif action == "stop":
        _clear_queue()
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
    global _was_playing
    _mpv_start()
    print(f"[Media] mpv avviato (socket {config.MPV_SOCK}, vol {config.DEFAULT_VOLUME})")
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    threading.Thread(target=_mqtt.loop_forever,
                     kwargs={"retry_first_connection": True}, daemon=True).start()

    last_status = 0.0
    while _running:
        # Watchdog: se mpv muore (chiuso a mano, crash) lo si rilancia —
        # senza, il wrapper resta vivo ma sordo (successo su OPS 2026-07-16).
        if _mpv and _mpv.poll() is not None:
            print(f"[Media] mpv terminato (rc={_mpv.returncode}) — riavvio")
            try:
                _mpv_start()
                print("[Media] mpv riavviato")
            except Exception as e:
                print(f"[Media] riavvio mpv fallito: {e}")
                time.sleep(5)
        # Autoplay: rilevata la transizione playing→idle (brano finito da solo,
        # non uno stop esplicito — quello passa da _handle_command e azzera
        # _queue_mode prima che questo controllo scatti). Controllato ogni giro
        # (0.5s), non solo a ogni STATUS_EVERY_S: altrimenti fino a qualche
        # secondo di silenzio tra un brano e l'altro.
        try:
            idle = bool(_prop("idle-active"))
            if _was_playing and idle and _queue_mode:
                _advance_queue()
            _was_playing = not idle
        except Exception as e:
            print(f"[Media] autoplay-check errore: {e}")

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
