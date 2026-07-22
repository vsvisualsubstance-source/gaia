#!/usr/bin/env python3
"""
GAIA Herbarium — le piante suonano (docs/pi-moduli-futuri.md §1).

Catena (v2, 2026-07-20): sensore MIDI (piante o il simulatore, in attesa
della scheda) → OSSERVATO (non collegato direttamente a Carla) → il nostro
motore musicale (music_engine.py: aggancio a scala + accordo dal preset
scelto) → bus MIDI virtuale dedicato → Carla headless (patch.carxp:
Quantization → 3× Yoshimi) → ALSA out.

Perché non più diretto: i sensori mandano numeri A CASO — la musicalità
(scale, accordi, "il tipo di musica") la decide il nostro engine, non un
parametro statico dentro il progetto Carla salvato una volta per sempre.

Bus fisso (permanente da boot, non hotplug): due porte VirMIDI dedicate
(`/etc/modprobe.d/gaia-herbarium-virmidi.conf`, `midi_devs=2`) — la sub-device
con indice PIÙ ALTO è sempre il nostro "bus verso Carla" (engine_out), è
SEMPRE collegata a Carla appena scoperta, e SEMPRE esclusa dai sensori
osservati (altrimenti l'engine sentirebbe le proprie note e andrebbe in
loop). Qualsiasi altra sorgente kernel (VirMIDI a indice più basso per il
simulatore, o in futuro la scheda USB reale) è un "sensore": osservato con
aseqdump per MQTT/XP, MAI collegato direttamente a Carla.

Questo wrapper:
  1. avvia `carla --no-gui patch.carxp` (engine ALSA/pipewire-jack)
  2. HOTPLUG: ogni SCAN_EVERY_S scandisce ALSA seq, trova/collega engine_out
     a Carla, osserva i sensori (aseqdump) senza collegarli a Carla
  3. ogni nota osservata: pubblica su MQTT COME PRIMA
       gaia/herbarium/{stanza}/note   {note, velocity, channel, ts}
       gaia/herbarium/{stanza}/state  heartbeat retained {sources, notes_1m, preset}
     → il brain le trasforma in XP (Druido) e curiosity — E in parallelo
     passa da music_engine.voice() e viene RISUONATA su engine_out → Carla.
  4. preset musicale cambiabile a caldo: gaia/herbarium/{stanza}/music {"preset":"..."}
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
from music_engine import MusicEngine

_running = True
_current_room = config.ROOM
_carla: subprocess.Popen | None = None
_dump: subprocess.Popen | None = None
_sources: list = []          # [(client_id, port, name)] — SOLO sensori (mai engine_out)
_note_times: list = []       # ts delle ultime note (per il rate nel heartbeat)
_lock = threading.Lock()
_wired = False                       # engine_out -> Carla collegato?
_engine = MusicEngine(config.ENGINE_PRESET)
_engine_out_path: str | None = None  # /dev/snd/midiC{card}D{dev} del bus verso Carla
_play_lock = threading.Lock()        # protegge le scritture concorrenti sul device MIDI


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


def _find_engine_out(clients):
    """Il bus fisso verso Carla: tra i client VirMIDI (midi_devs=2, vedi
    /etc/modprobe.d/gaia-herbarium-virmidi.conf), quello con l'indice
    sub-device PIÙ ALTO è sempre il nostro bus — l'indice più basso resta
    libero per il simulatore/sensore reale. Ordinamento robusto ai cambi di
    numero di card tra un boot e l'altro (si guarda solo il sub-device)."""
    candidates = []
    for c in clients:
        m = re.match(r"Virtual Raw MIDI (\d+)-(\d+)", c["name"])
        if m and c["ports"]:
            candidates.append((int(m.group(2)), c["id"], c["ports"][0],
                               int(m.group(1)), c["name"]))
    if not candidates:
        return None
    candidates.sort()
    dev, cid, port, card, name = candidates[-1]
    # pw-link espone questi client con un'etichetta PROPRIA generica e
    # incrementale ("Virtual MIDI Card N", scollegata dal numero di card/
    # device ALSA) — il nome ALSA completo ("Virtual Raw MIDI {card}-{dev}")
    # NON compare da nessuna parte in quella riga, quindi il match falliva
    # sempre in silenzio dopo un riavvio con un numero di card diverso da
    # quello visto la prima volta (bug trovato dal vivo 2026-07-22, cambio
    # periferiche ha spostato virmidi da card 4 a card 0). La parte STABILE
    # è il suffisso della porta, es. "VirMIDI 0-1" — quello sì compare sempre.
    pw_name = f"VirMIDI {card}-{dev}"
    return {"id": cid, "port": port, "card": card, "dev": dev, "name": name, "pw_name": pw_name}


def _pw_wire_audio(env) -> None:
    """Cablaggio audio Carla → sink ALSA (JACK non auto-collega)."""
    try:
        ins = subprocess.run(["pw-link", "-i"], capture_output=True, text=True,
                             timeout=5, env=env).stdout.splitlines()
    except (OSError, subprocess.TimeoutExpired):
        return
    sinks = [l.strip() for l in ins if "alsa_output" in l and "playback_F" in l]
    for ch, suffix in (("audio-out1", "playback_FL"), ("audio-out2", "playback_FR")):
        dst = next((p for p in sinks if p.endswith(suffix)), None)
        if dst:
            r = subprocess.run(["pw-link", f"Carla:{ch}", dst],
                               capture_output=True, text=True, timeout=5, env=env)
            if r.returncode == 0:
                print(f"[Herbarium] Audio collegato: Carla:{ch} → {dst.split(':')[0]}")


def _pw_wire_engine_out(eng_out) -> bool:
    """Cablaggio MIDI nel grafo PipeWire: il bus verso Carla arriva via
    Midi-Bridge (Carla col driver JACK non ha porte ALSA seq dirette)."""
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
    wired = False
    for out in outs:
        if "Midi-Bridge" in out and eng_out["pw_name"] in out:
            r = subprocess.run(["pw-link", out.strip(), "Carla:events-in"],
                               capture_output=True, text=True, timeout=5, env=env)
            if r.returncode == 0:
                print(f"[Herbarium] Bus motore collegato (pw) → Carla")
                wired = True
    _pw_wire_audio(env)
    return wired


def _sync_wiring():
    """Collega il bus motore a Carla (fisso, persistente — non hotplug) e
    osserva i SENSORI (mai collegati direttamente a Carla: il grezzo passa
    dal motore musicale, non suona da solo). Riprova finché Carla non è
    pronta (~25s per i 3 Yoshimi) e finché il bus VirMIDI non esiste."""
    global _sources, _dump, _wired, _engine_out_path
    clients = _seq_clients()
    carla_in = _find_carla_in(clients)
    eng_out = _find_engine_out(clients)

    if eng_out and not _wired:
        path = f"/dev/snd/midiC{eng_out['card']}D{eng_out['dev']}"
        ok = False
        if carla_in:
            r = subprocess.run(["aconnect", f"{eng_out['id']}:{eng_out['port']}", carla_in],
                               capture_output=True, timeout=5)
            ok = r.returncode == 0
            if ok:
                print(f"[Herbarium] Bus motore collegato: {eng_out['name']} → Carla")
        else:
            ok = _pw_wire_engine_out(eng_out)
        if ok:
            _wired = True
            _engine_out_path = path

    # sensori: qualsiasi kernel client TRANNE il bus motore stesso (altrimenti
    # l'engine sentirebbe le proprie note e andrebbe in loop)
    all_hw = _hw_sources(clients)
    srcs = [s for s in all_hw if not (eng_out and s[0] == eng_out["id"])]
    changed = srcs != _sources
    with _lock:
        _sources = srcs

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
    + copia locale UDP per gaia-screen (funziona anche senza broker, nel bosco)
    + RISUONATA sul bus verso Carla passando dal motore musicale (scala/accordo)."""
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
        _play_notes(note, vel)


def _play_notes(raw_note: int, raw_velocity: int):
    """Nota grezza del sensore -> music_engine (scala/accordo dal preset) ->
    suonata sul bus verso Carla. Ogni tono ha il suo delay (per l'arpeggio)
    e il suo timer di note-off (durata fissa dal preset, non quella reale del
    sensore: input casuale, meglio una durata prevedibile e musicale)."""
    if not _engine_out_path:
        return
    for entry in _engine.voice(raw_note, raw_velocity):
        threading.Timer(entry["delay_ms"] / 1000.0, _write_note,
                        args=(entry["note"], entry["velocity"], entry["length_ms"])).start()


def _write_note(note: int, velocity: int, length_ms: int):
    path = _engine_out_path
    if not path:
        return
    note = max(0, min(127, int(note)))
    velocity = max(1, min(127, int(velocity)))
    with _play_lock:
        try:
            with open(path, "wb", buffering=0) as f:
                f.write(bytes([0x90, note, velocity]))
        except OSError as e:
            print(f"[Herbarium] Scrittura MIDI fallita ({path}): {e}")
            return
    threading.Timer(length_ms / 1000.0, _write_note_off, args=(path, note)).start()


def _write_note_off(path: str, note: int):
    with _play_lock:
        try:
            with open(path, "wb", buffering=0) as f:
                f.write(bytes([0x80, note, 0]))
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
                              "stanza": _current_room, "preset": _engine.preset_name,
                              "ts": int(now * 1000)}), retain=True)


def _topic_music():
    return f"gaia/herbarium/{_current_room}/music"


def _on_connect(client, userdata, flags, rc, properties=None):
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    client.subscribe(_topic_music(), qos=1)
    _publish_state()
    print(f"[MQTT] Connesso — stanza {_current_room}, preset {_engine.preset_name}")


def _on_message(client, userdata, msg):
    global _current_room
    if msg.topic.endswith("/music"):
        try:
            preset = json.loads(msg.payload).get("preset")
        except ValueError:
            return
        if preset and _engine.set_preset(preset):
            print(f"[Herbarium] Preset musicale → {preset}")
            _publish_state()
        else:
            print(f"[Herbarium] Preset sconosciuto: {preset!r}")
        return
    try:
        new_room = json.loads(msg.payload).get("room")
    except ValueError:
        return
    if new_room and new_room != _current_room:
        _mqtt.publish(f"gaia/herbarium/{_current_room}/state", "", retain=True)
        client.unsubscribe(_topic_music())
        _current_room = new_room
        client.subscribe(_topic_music(), qos=1)
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
