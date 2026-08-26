#!/usr/bin/env python3
"""
GAIA LiveStream — il Pi trasmette (mic o libreria locale) via icecast2
LOCALE (gira sullo stesso Pi, nessun server centrale su Core/OPS — vedi
docs/pi-moduli-futuri.md per il design originale centralizzato, superato
da questo requisito). Chiunque apra la pagina web/livestream.html di Gaia
e clicchi play ascolta lo stream nel proprio browser: chi ha il jack del
proprio device collegato a un diffusore (es. Holosonic) lo riproduce lì.

Catena: ffmpeg (ALSA mic, o playlist della libreria locale in loop) →
icecast2 locale (porta 8000, mount fisso {MOUNT}) → chiunque in LAN apra
http://{ip}:8000/{MOUNT} o la pagina Gaia dedicata.

Questo processo NON lancia/gestisce icecast2 stesso (systemd se ne occupa,
vedi gaia-livestream.service `After=/Wants=icecast2.service` — icecast2 è
un demone di sistema leggero, sempre attivo appena installato, come
mosquitto su Core): gestisce solo il source client ffmpeg che vi spinge
audio dentro, on/off e cambio sorgente a comando MQTT.
"""
import json
import os
import random
import shlex
import signal
import socket
import subprocess
import threading
import time
import urllib.request

import paho.mqtt.client as mqtt

import config
from ota import OtaHandler

_running = True
_current_room = config.ROOM
_current_source = config.SOURCE if config.SOURCE in ("mic", "library") else "mic"
_current_mic_device = config.MIC_DEVICE   # può cambiare a caldo se MIC_DEVICE_OPTIONS è configurato
# Label corrispondente a _current_mic_device (per la UI, che manda/mostra
# label non stringhe alsa) — None se si parte dal MIC_DEVICE singolo, non
# da una delle opzioni multiple.
_current_mic_label = next((k for k, v in config.MIC_DEVICE_OPTIONS.items()
                            if v == _current_mic_device), None)
_active = False              # streaming acceso/spento (comando utente)
_ffmpeg: subprocess.Popen | None = None
_lock = threading.Lock()


def _shutdown(sig, frame):
    global _running
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


# ── Playlist libreria locale ────────────────────────────────────────────────
def _build_playlist() -> str | None:
    """Scansiona LIBRARY_DIR, scrive una playlist concat per ffmpeg (formato
    ffmpeg concat demuxer: file '/path' con apici singoli escaped). Ordine
    mescolato ad ogni (ri)avvio della sorgente libreria, per varietà."""
    files = []
    for root, _dirs, names in os.walk(config.LIBRARY_DIR):
        for name in names:
            if name.lower().endswith(config.LIBRARY_EXT):
                files.append(os.path.join(root, name))
    if not files:
        return None
    random.shuffle(files)
    playlist_path = os.path.join(config._BASE, "_playlist.txt")
    with open(playlist_path, "w") as f:
        for path in files:
            f.write(f"file '{path.replace(chr(39), chr(39)+chr(92)+chr(39)+chr(39))}'\n")
    return playlist_path


def _ffmpeg_cmd() -> list | None:
    icecast_url = (f"icecast://source:{config.ICECAST_SOURCE_PASSWORD}@"
                   f"{config.ICECAST_HOST}:{config.ICECAST_PORT}/{config.MOUNT}")
    common = ["-c:a", "libopus", "-b:a", config.BITRATE,
              "-content_type", "application/ogg", "-f", "ogg", icecast_url]
    if _current_source == "library":
        playlist = _build_playlist()
        if not playlist:
            print(f"[LiveStream] Libreria vuota ({config.LIBRARY_DIR}), nessun file audio trovato")
            return None
        return ["ffmpeg", "-nostdin", "-loglevel", "warning",
                "-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", playlist] + common
    return ["ffmpeg", "-nostdin", "-loglevel", "warning",
            "-f", "alsa", "-i", _current_mic_device] + common


def _start_ffmpeg() -> bool:
    """True se ffmpeg è stato effettivamente lanciato. False se non c'era
    nulla da lanciare (es. libreria vuota) — il chiamante non deve trattarlo
    come un crash da riprovare subito, altrimenti il watchdog nel loop
    principale martella _start_ffmpeg ogni ~4s all'infinito finché la
    libreria resta vuota (bug dal vivo 2026-08-14 su vsrasp01)."""
    global _ffmpeg
    _stop_ffmpeg()
    cmd = _ffmpeg_cmd()
    if not cmd:
        return False
    _ffmpeg = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    print(f"[LiveStream] ffmpeg avviato (sorgente={_current_source}): {shlex.join(cmd)}")
    threading.Thread(target=_ffmpeg_log_reader, args=(_ffmpeg,), daemon=True).start()
    return True


def _ffmpeg_log_reader(proc):
    for line in proc.stderr:
        line = line.strip()
        if line:
            print(f"[LiveStream][ffmpeg] {line}")


def _stop_ffmpeg():
    global _ffmpeg
    if _ffmpeg and _ffmpeg.poll() is None:
        _ffmpeg.terminate()
        try:
            _ffmpeg.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _ffmpeg.kill()
    _ffmpeg = None


def _icecast_listeners() -> int:
    """Numero ascoltatori dal proprio icecast2 locale (status-json.xsl).
    0 se icecast non risponde o il mount non è (ancora) attivo."""
    try:
        with urllib.request.urlopen(
                f"http://{config.ICECAST_HOST}:{config.ICECAST_PORT}/status-json.xsl",
                timeout=3) as resp:
            data = json.loads(resp.read())
        sources = data.get("icestats", {}).get("source", [])
        if isinstance(sources, dict):
            sources = [sources]
        for s in sources:
            if s.get("listenurl", "").endswith(f"/{config.MOUNT}"):
                return int(s.get("listeners", 0))
    except Exception:
        pass
    return 0


# ── MQTT ──────────────────────────────────────────────────────────────────────
try:
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=f"gaia-livestream-{config.DEVICE_ID}")
except AttributeError:
    _mqtt = mqtt.Client(client_id=f"gaia-livestream-{config.DEVICE_ID}")
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


class _OtaMqttAdapter:
    """OtaHandler (copiato byte-per-byte da yolo/, vedi pi/CLAUDE.md) si
    aspetta un .publish(topic, payload_dict, retain=False) che fa il suo
    json.dumps — qui usiamo direttamente mqtt.Client, che invece vuole
    stringa/bytes già pronti."""
    def publish(self, topic, payload, retain=False):
        _mqtt.publish(topic, json.dumps(payload, default=str), qos=0, retain=retain)


_ota = OtaHandler(mqtt_client=_OtaMqttAdapter(), device_id=config.DEVICE_ID,
                  device_type="livestream", base_dir=config._BASE,
                  service_name="gaia-livestream")


def _publish_state():
    _mqtt.publish(f"gaia/livestream/{_current_room}/state",
                  json.dumps({"active": _active, "source": _current_source,
                              "mount": config.MOUNT, "bitrate": config.BITRATE,
                              "listeners": _icecast_listeners() if _active else 0,
                              "stanza": _current_room,
                              "mic_device": _current_mic_label,
                              "mic_device_options": list(config.MIC_DEVICE_OPTIONS.keys()),
                              "ts": int(time.time() * 1000)}), retain=True)


def _topic_command():
    return f"gaia/livestream/{_current_room}/command"


def _on_connect(client, userdata, flags, rc, properties=None):
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    client.subscribe(_topic_command(), qos=1)
    for t in _ota.topics():
        client.subscribe(t)
    _publish_state()
    print(f"[MQTT] Connesso — stanza {_current_room}, sorgente {_current_source}")


def _on_message(client, userdata, msg):
    global _current_room, _current_source, _current_mic_device, _current_mic_label, _active
    if msg.topic in _ota.topics():
        _ota.handle(msg.topic, msg.payload)
        return
    if msg.topic.endswith("/command"):
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            return
        changed = False
        source = payload.get("source")
        if source in ("mic", "library") and source != _current_source:
            with _lock:
                _current_source = source
            print(f"[LiveStream] Sorgente → {source}")
            changed = True
        mic_device_label = payload.get("mic_device")
        if mic_device_label in config.MIC_DEVICE_OPTIONS:
            new_device = config.MIC_DEVICE_OPTIONS[mic_device_label]
            if new_device != _current_mic_device:
                with _lock:
                    _current_mic_device = new_device
                    _current_mic_label = mic_device_label
                print(f"[LiveStream] Microfono → {mic_device_label} ({new_device})")
                changed = True
        if "active" in payload:
            want = bool(payload["active"])
            if want != _active:
                with _lock:
                    _active = want
                changed = True
        if changed:
            with _lock:
                if _active:
                    _start_ffmpeg()
                else:
                    _stop_ffmpeg()
            _publish_state()
        return
    try:
        new_room = json.loads(msg.payload).get("room")
    except ValueError:
        return
    if new_room and new_room != _current_room:
        _mqtt.publish(f"gaia/livestream/{_current_room}/state", "", retain=True)
        client.unsubscribe(_topic_command())
        _current_room = new_room
        client.subscribe(_topic_command(), qos=1)
        _publish_state()


_mqtt.on_connect = _on_connect
_mqtt.on_message = _on_message


def main():
    global _active
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    threading.Thread(target=_mqtt.loop_forever,
                     kwargs={"retry_first_connection": True}, daemon=True).start()

    # attivo appena il servizio parte — è l'agent (enable/disable) a decidere
    # se questo processo gira o no, quindi se gira lo stream deve partire
    _active = True
    _start_ffmpeg()

    last_beat = last_retry = 0.0
    while _running:
        now = time.time()
        if _active and (not _ffmpeg or _ffmpeg.poll() is not None):
            # riprova con lo stesso ritmo dell'heartbeat, non ogni secondo:
            # se manca la sorgente (libreria vuota) non ha senso martellare
            # _ffmpeg_cmd()/scansione della cartella più volte al secondo —
            # e se ffmpeg è davvero appena crashato, qualche secondo di
            # attesa in più è comunque innocuo (bug watchdog dal vivo
            # 2026-08-14 su vsrasp01: retry ogni ~4s all'infinito a libreria
            # vuota, log spam senza mai risolversi da solo).
            if now - last_retry >= config.HEARTBEAT_EVERY_S:
                last_retry = now
                if _ffmpeg and _ffmpeg.poll() is not None:
                    print(f"[LiveStream] ffmpeg terminato (rc={_ffmpeg.returncode}) — riavvio")
                _start_ffmpeg()
        if now - last_beat >= config.HEARTBEAT_EVERY_S:
            last_beat = now
            _publish_state()
        time.sleep(1)

    _stop_ffmpeg()
    _mqtt.publish(f"gaia/livestream/{_current_room}/state", "", retain=True)
    print("[LiveStream] Terminato.")


if __name__ == "__main__":
    main()
