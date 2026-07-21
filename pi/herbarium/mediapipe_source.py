#!/usr/bin/env python3
"""
GAIA Herbarium — sorgente MediaPipe: "la stanza suona in risposta a chi la
abita", in alternativa al sensore vero o al simulatore (plant_simulator.py).

Legge gaia/mediapipe/pose e trasforma presenza/gesti/emozioni in note
grezze sulla stessa porta MIDI del sensore — nessuna logica di scala/accordo
qui: quella resta SEMPRE di music_engine.py (dal lato di gaia-herbarium),
questo script decide solo "cosa succede -> quale nota grezza".

Campi mediapipe usati (vedi pi/mediapipe/README.md — solo segnali categorici/
derivati, niente coordinate mano grezze):
  attention (center/left/right)  -> registro di base (sinistra grave, destra acuta)
  gesture (fist/point/...)       -> scostamento fisso per gesto (stesso spirito
                                     del vocabolario GESTURE_WORDS asemico)
  smile_score (0-100)            -> più sorriso, nota più acuta + più energica
  pose (sitting/standing/...)    -> sitting un'ottava sotto
  people_count                   -> più persone, più energia (velocity)

Una nota per ogni CAMBIO di stato (non a ogni tick — mediapipe pubblica ogni
~1s anche da fermo), con un intervallo minimo anti-raffica.

Selezionabile in ALTERNATIVA a plant_simulator.py — mai insieme (Conflicts=
nella unit systemd): scriverebbero sulla stessa porta e si confonderebbero.
"""
import json
import re
import subprocess
import sys
import time

import paho.mqtt.client as mqtt

import config

GESTURE_OFFSETS = {"fist": 0, "point": 3, "victory": 5, "three": 7, "open_hand": 10}
ATTENTION_BASE = {"center": 60, "left": 52, "right": 68, "unknown": 60}
MIN_INTERVAL_S = 1.5   # anti-raffica: la stanza non deve mitragliare note

_last: dict = {}
_last_note_ts = 0.0
_path: str | None = None


def _seq_clients() -> list:
    out = subprocess.run(["aconnect", "-l"], capture_output=True, text=True, timeout=5).stdout
    clients = []
    for line in out.splitlines():
        m = re.match(r"client (\d+): '(.*?)' \[type=(\w+)", line)
        if m:
            clients.append({"id": int(m.group(1)), "name": m.group(2), "type": m.group(3)})
    return clients


def _find_lowest_virmidi():
    """La porta '-0': indice sub-device più basso tra i client VirMIDI —
    la stessa che userebbe plant_simulator.py (mai insieme, vedi Conflicts=)."""
    candidates = []
    for c in _seq_clients():
        m = re.match(r"Virtual Raw MIDI (\d+)-(\d+)", c["name"])
        if m:
            candidates.append((int(m.group(2)), int(m.group(1))))
    if not candidates:
        return None
    candidates.sort()
    dev, card = candidates[0]
    return f"/dev/snd/midiC{card}D{dev}"


def _write_note(note: int, vel: int):
    note = max(0, min(127, note))
    vel = max(1, min(127, vel))
    try:
        with open(_path, "wb", buffering=0) as f:
            f.write(bytes([0x90, note, vel]))
        time.sleep(0.08)
        with open(_path, "wb", buffering=0) as f:
            f.write(bytes([0x80, note, 0]))
    except OSError as e:
        print(f"[MediapipeSource] scrittura fallita: {e}", file=sys.stderr)


def _on_message(client, userdata, msg):
    global _last_note_ts
    try:
        p = json.loads(msg.payload)
    except ValueError:
        return
    # se questo Pi ha una stanza nota, ascolta solo la propria camera —
    # altrimenti (stanza vuota) reagisce a chiunque, utile nei test
    if config.ROOM and p.get("camera") not in (None, config.ROOM):
        return
    if not p.get("person_detected"):
        _last.clear()
        return

    now = time.time()
    gesture   = p.get("gesture") or "none"
    emotion   = p.get("emotion") or "neutral"
    attention = p.get("attention") or "center"
    pose      = p.get("pose") or "standing"
    smile     = p.get("smile_score") or 0
    people    = p.get("people_count") or 1

    state = (gesture, emotion, attention, pose)
    changed = state != (_last.get("gesture"), _last.get("emotion"),
                        _last.get("attention"), _last.get("pose"))
    _last.update(gesture=gesture, emotion=emotion, attention=attention, pose=pose)

    if not changed or (now - _last_note_ts) < MIN_INTERVAL_S:
        return
    _last_note_ts = now

    note = ATTENTION_BASE.get(attention, 60)
    note += GESTURE_OFFSETS.get(gesture, 0)
    note += round(smile / 100 * 12)          # più sorriso, più acuto
    if pose == "sitting":
        note -= 12
    vel = 50 + min(60, people * 15) + round(smile / 100 * 20)

    print(f"[MediapipeSource] {gesture}/{emotion}/{attention}/{pose} "
          f"smile={smile} people={people} -> nota {note} vel {vel}")
    _write_note(note, vel)


def main():
    global _path
    subprocess.run(["sudo", "modprobe", "snd-virmidi", "midi_devs=2"], capture_output=True)
    time.sleep(1)
    _path = _find_lowest_virmidi()
    if not _path:
        print("[MediapipeSource] Nessuna porta VirMIDI trovata — snd-virmidi caricato?",
              file=sys.stderr)
        sys.exit(1)
    print(f"[MediapipeSource] Sorgente attiva su {_path} (stanza: {config.ROOM or 'tutte'})")

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id=f"gaia-herb-mediapipe-{config.DEVICE_ID}")
    except AttributeError:
        client = mqtt.Client(client_id=f"gaia-herb-mediapipe-{config.DEVICE_ID}")
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=2, max_delay=30)
    client.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)

    def _on_connect(c, u, f, rc, properties=None):
        c.subscribe("gaia/mediapipe/pose")
        print("[MediapipeSource] MQTT connesso, in ascolto di gaia/mediapipe/pose")

    client.on_connect = _on_connect
    client.loop_forever(retry_first_connection=True)


if __name__ == "__main__":
    main()
