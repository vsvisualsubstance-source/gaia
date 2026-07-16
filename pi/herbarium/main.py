#!/usr/bin/env python3
"""
GAIA Herbarium — le piante suonano (docs/pi-moduli-futuri.md §1).

Catena: sensore MIDI (piante) → Carla headless col patch dell'utente
(patch.carxp: MIDI Enforce Scale → Quantization → 3× Yoshimi) → ALSA out.

Questo wrapper:
  1. avvia `carla --no-gui patch.carxp` (engine ALSA, come nei test originali)
  2. HOTPLUG: ogni SCAN_EVERY_S scandisce ALSA seq e collega qualsiasi
     sorgente MIDI hardware (kernel client ≠ System/Through) all'ingresso
     di Carla — colleghi le piante e suonano, senza nomi hardcoded
  3. osserva le stesse sorgenti con aseqdump e pubblica ogni nota su MQTT:
       gaia/herbarium/{stanza}/note   {note, velocity, channel, ts}
       gaia/herbarium/{stanza}/state  heartbeat retained {sources, notes_1m}
     → il brain le trasforma in XP (Druido) e curiosity: la pianta è un
     sensore di GAIA oltre che uno strumento.
"""
import json
import os
import re
import shlex
import signal
import socket
import subprocess
import threading
import time

import paho.mqtt.client as mqtt

import config

_running = True
_current_room = config.ROOM
_carla: subprocess.Popen | None = None
_dump: subprocess.Popen | None = None
_sources: list = []          # [(client_id, port, name)]
_note_times: list = []       # ts delle ultime note (per il rate nel heartbeat)
_lock = threading.Lock()
_wired = False


def _shutdown(sig, frame):
    global _running
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


# ── ALSA seq: scoperta e cablaggio ────────────────────────────────────────────
def _seq_clients() -> list:
    """[(id, name, type, [porte])] da aconnect -l."""
    out = subprocess.run(["aconnect", "-l"], capture_output=True, text=True,
                         timeout=5).stdout
    clients, cur = [], None
    for line in out.splitlines():
        m = re.match(r"client (\d+): '(.*?)' \[type=(\w+)", line)
        if m:
            cur = {"id": int(m.group(1)), "name": m.group(2),
                   "type": m.group(3), "ports": []}
            clients.append(cur)
            continue
        m = re.match(r"\s+(\d+) '", line)
        if m and cur is not None:
            cur["ports"].append(int(m.group(1)))
    return clients


def _find_carla_in(clients):
    for c in clients:
        if "carla" in c["name"].lower() and c["ports"]:
            return f"{c['id']}:{c['ports'][0]}"
    return None


def _hw_sources(clients) -> list:
    """Sorgenti MIDI hardware: kernel client che non sia System/Through."""
    out = []
    for c in clients:
        if c["type"] != "kernel" or not c["ports"]:
            continue
        if c["name"] in ("System", "Midi Through"):
            continue
        out.append((c["id"], c["ports"][0], c["name"]))
    return out


def _pw_wire(srcs) -> bool:
    """Cablaggio nel grafo PipeWire: Carla col driver JACK non ha porte ALSA
    seq — le sorgenti hardware ci arrivano via Midi-Bridge con pw-link."""
    env = {**os.environ, "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000")}
    try:
        ins = subprocess.run(["pw-link", "-i"], capture_output=True, text=True,
                             timeout=5, env=env).stdout.splitlines()
        if not any(l.strip() == "Carla:events-in" for l in ins):
            return False
        outs = subprocess.run(["pw-link", "-o"], capture_output=True, text=True,
                              timeout=5, env=env).stdout.splitlines()
    except (OSError, subprocess.TimeoutExpired):
        return False
    for _cid, _port, name in srcs:
        for out in outs:
            if "Midi-Bridge" in out and name in out:
                r = subprocess.run(["pw-link", out.strip(), "Carla:events-in"],
                                   capture_output=True, text=True, timeout=5, env=env)
                if r.returncode == 0:
                    print(f"[Herbarium] Sorgente MIDI collegata (pw): {name} → Carla")
    # audio: le uscite di Carla verso il sink ALSA (JACK non auto-collega)
    sinks = [l.strip() for l in ins if "alsa_output" in l and "playback_F" in l]
    for ch, suffix in (("audio-out1", "playback_FL"), ("audio-out2", "playback_FR")):
        dst = next((p for p in sinks if p.endswith(suffix)), None)
        if dst:
            r = subprocess.run(["pw-link", f"Carla:{ch}", dst],
                               capture_output=True, text=True, timeout=5, env=env)
            if r.returncode == 0:
                print(f"[Herbarium] Audio collegato: Carla:{ch} → {dst.split(':')[0]}")
    return True


def _sync_wiring():
    """Collega le sorgenti a Carla e (ri)avvia l'osservatore note.
    Riprova finché il cablaggio non riesce: Carla impiega ~25s a caricare
    i 3 Yoshimi e ai primi scan le sue porte non esistono ancora."""
    global _sources, _dump, _wired
    clients = _seq_clients()
    carla_in = _find_carla_in(clients)
    srcs = _hw_sources(clients)
    changed = srcs != _sources
    if not changed and _wired and _dump is not None and _dump.poll() is None:
        return
    with _lock:
        _sources = srcs
    if changed:
        _wired = False
    if srcs and not _wired:
        if carla_in:
            for cid, port, name in srcs:
                subprocess.run(["aconnect", f"{cid}:{port}", carla_in],
                               capture_output=True, timeout=5)
                print(f"[Herbarium] Sorgente MIDI collegata: {name} ({cid}:{port}) → Carla")
            _wired = True
        elif _pw_wire(srcs):
            _wired = True
    # osservatore note (indipendente dal synth: MQTT anche se Carla non c'è)
    if changed or (_dump is not None and _dump.poll() is not None):
        if _dump and _dump.poll() is None:
            _dump.terminate()
        if srcs:
            ports = ",".join(f"{cid}:{port}" for cid, port, _ in srcs)
            _dump = subprocess.Popen(["aseqdump", "-p", ports],
                                     stdout=subprocess.PIPE, text=True)
            threading.Thread(target=_dump_reader, args=(_dump,), daemon=True).start()


_udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


def _dump_reader(proc):
    """aseqdump → eventi nota su MQTT (formato: '... Note on 0, note 60, velocity 90')
    + copia locale UDP per gaia-screen (funziona anche senza broker, nel bosco)."""
    for line in proc.stdout:
        m = re.search(r"Note on\s+(\d+), note (\d+), velocity (\d+)", line)
        if not m:
            continue
        ch, note, vel = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if vel == 0:
            continue                     # note-on a velocity 0 = note-off
        now = time.time()
        with _lock:
            _note_times.append(now)
            del _note_times[:-200]
        payload = json.dumps({"note": note, "velocity": vel,
                              "channel": ch, "ts": int(now * 1000)})
        _mqtt.publish(f"gaia/herbarium/{_current_room}/note", payload)
        try:
            _udp.sendto(payload.encode(), ("127.0.0.1", config.UDP_PORT))
        except OSError:
            pass


# ── MQTT ──────────────────────────────────────────────────────────────────────
try:
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=f"gaia-herbarium-{config.DEVICE_ID}")
except AttributeError:
    _mqtt = mqtt.Client(client_id=f"gaia-herbarium-{config.DEVICE_ID}")
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


def _publish_state():
    now = time.time()
    with _lock:
        notes_1m = sum(1 for t in _note_times if now - t < 60)
        srcs = [name for _, _, name in _sources]
    _mqtt.publish(f"gaia/herbarium/{_current_room}/state",
                  json.dumps({"sources": srcs, "notes_1m": notes_1m,
                              "stanza": _current_room,
                              "ts": int(now * 1000)}), retain=True)


def _on_connect(client, userdata, flags, rc, properties=None):
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    _publish_state()
    print(f"[MQTT] Connesso — stanza {_current_room}")


def _on_message(client, userdata, msg):
    global _current_room
    try:
        new_room = json.loads(msg.payload).get("room")
    except ValueError:
        return
    if new_room and new_room != _current_room:
        _mqtt.publish(f"gaia/herbarium/{_current_room}/state", "", retain=True)
        _current_room = new_room
        _publish_state()


_mqtt.on_connect = _on_connect
_mqtt.on_message = _on_message


def main():
    global _carla
    _carla = subprocess.Popen(shlex.split(config.CARLA_BIN) + ["--no-gui", config.PATCH])
    print(f"[Herbarium] Carla headless avviato con {config.PATCH}")
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    threading.Thread(target=_mqtt.loop_forever,
                     kwargs={"retry_first_connection": True}, daemon=True).start()

    last_scan = last_beat = 0.0
    while _running:
        now = time.time()
        if _carla.poll() is not None:
            print(f"[Herbarium] Carla terminato (rc={_carla.returncode}) — riavvio")
            _carla = subprocess.Popen(shlex.split(config.CARLA_BIN) + ["--no-gui", config.PATCH])
            time.sleep(3)
        if now - last_scan >= config.SCAN_EVERY_S:
            last_scan = now
            try:
                _sync_wiring()
            except Exception as e:
                print(f"[Herbarium] wiring: {e}")
        if now - last_beat >= config.HEARTBEAT_EVERY_S:
            last_beat = now
            _publish_state()
        time.sleep(1)

    if _dump and _dump.poll() is None:
        _dump.terminate()
    _carla.terminate()
    try:
        _carla.wait(timeout=8)
    except subprocess.TimeoutExpired:
        _carla.kill()
    _mqtt.publish(f"gaia/herbarium/{_current_room}/state", "", retain=True)
    print("[Herbarium] Terminato.")


if __name__ == "__main__":
    main()
