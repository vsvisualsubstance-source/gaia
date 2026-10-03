#!/usr/bin/env python3
"""
GAIA DMX (base) — servizio Pi per una fixture DMX via Art-Net: palette
nominate + una piccola timeline (sequenza di palette nel tempo, con
crossfade). Pensato per una stanza/fixture NON già coperta da DMX V8 su TD
(quello resta il rig "Consolle", via Electroconcept 2.1.1.2) — stesso
protocollo Art-Net, nodo diverso, nessun conflitto.

A differenza di DMX V8 (TD, kick-detection audio-reattivo, patch multi-
fixture, scan di rete) questo è deliberatamente semplice: un solo target
RGB/RGBW alla volta, nessuna discovery di rete — l'host Art-Net si
configura a mano (config.ARTNET_HOST). Vedi artnet.py per il perché
niente ArtPoll.

Audio-reattività (2026-10-02, opt-in): livello RMS dal microfono locale
(webcam o scheda audio, via ffmpeg+pipewire-alsa) modula la brillantezza
in tempo reale -- niente bande/kick-detection come DMX V8, quello resta
il posto giusto per l'analisi vera. Vedi _audio_capture_loop().

Catena: comando MQTT (palette o timeline) → stato interno (_fade_from/_to,
progresso crossfade) → loop di uscita a config.FPS → ArtNetSender.send().
Stesso schema command/status/device-registry degli altri moduli "leggeri"
del Pi (vedi pi/livestream/main.py, pi/mediaplayer/main.py): paho-mqtt
diretto, non il protocollo gaia_client lato TD (quello è per TouchDesigner,
qui non serve quel livello di complessità).
"""
import audioop
import json
import os
import signal
import subprocess
import threading
import time

import paho.mqtt.client as mqtt

import config
from artnet import ArtNetSender
from ota import OtaHandler

_running = True
_current_room = config.ROOM

_lock = threading.Lock()
_palettes = {}            # nome -> [r,g,b] (o [r,g,b,w])

_brightness = 1.0
_current_palette_name = None   # None se l'output attuale non corrisponde a una palette nota (set_rgb custom, o timeline)

# Blackout = spegnimento garantito, indipendente dal layout canali della
# fixture. Con un canale dimmer separato, RGB=[0,0,0] da solo NON basta a
# garantirlo su ogni fixture reale (dipende da come il driver interno
# combina dimmer e colore, mai verificato per ogni modello) -- quando
# attivo il loop di uscita manda tutti i canali a 0 senza fare il calcolo
# dimmer/RGB, bypassando qualunque dubbio. Si disattiva da sé al primo
# set_palette/set_rgb/avvio timeline successivo (vedi _set_target).
_forced_off = False

# Crossfade: il loop di uscita interpola linearmente da _fade_from a _fade_to
# fra _fade_start e _fade_start+_fade_dur (secondi). _output_rgb è il valore
# live attualmente calcolato/mandato -- usato come punto di partenza del
# PROSSIMO fade, cosi' un cambio durante un fade in corso non scatta mai di
# colpo.
_output_rgb = [0, 0, 0]
_fade_from = [0, 0, 0]
_fade_to = [0, 0, 0]
_fade_start = 0.0
_fade_dur = 0.0

MANUAL_FADE_DEFAULT_S = 0.6
TIMELINE_FADE_DEFAULT_S = 1.0

_timeline_steps = []      # [{"palette"|"rgb", "duration", "fade"}, ...]
_timeline_loop = True
_timeline_running = False
_timeline_index = -1
_timeline_step_started = 0.0
_timelines = {}           # nome preset -> {"steps":[...], "loop": bool}
_current_timeline_name = None   # None se la timeline attiva non è (più) un preset noto (timeline_set custom)

# Audio-reattività: _audio_level è 0-1, già normalizzato (AGC-lite --
# nessun valore assoluto di RMS ha senso fisso: un mic di webcam e uno
# esterno hanno guadagni diversissimi, impossibile tarare un numero fisso
# che funzioni ovunque). Smoothing esponenziale per evitare uno sfarfallio
# frame-a-frame innaturale.
_audio_reactive = False
_audio_level = 0.0
_audio_proc = None
_audio_thread = None
_audio_floor = 200.0    # rumore di fondo stimato (RMS raw, scala int16), si adatta da solo verso il basso
_audio_peak = 4000.0    # picco stimato, si adatta da solo verso l'alto (mai sotto un minimo, vedi funzione)


def _shutdown(sig, frame):
    global _running
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


# ── Palette ──────────────────────────────────────────────────────────────────
def _load_palettes():
    global _palettes
    try:
        with open(config.PALETTES_FILE, encoding="utf-8") as f:
            data = json.load(f)
        _palettes = {str(k): [int(c) for c in v] for k, v in data.items()}
        print(f"[DMX] {len(_palettes)} palette caricate da {config.PALETTES_FILE}")
    except Exception as e:
        print(f"[DMX] Impossibile leggere {config.PALETTES_FILE} ({e}), uso un set minimo di default")
        _palettes = {"White": [255, 255, 255], "Off": [0, 0, 0]}


def _load_timelines():
    global _timelines
    try:
        with open(config.TIMELINES_FILE, encoding="utf-8") as f:
            _timelines = json.load(f)
        print(f"[DMX] {len(_timelines)} preset timeline caricati da {config.TIMELINES_FILE}")
    except Exception as e:
        print(f"[DMX] Impossibile leggere {config.TIMELINES_FILE} ({e}), nessun preset timeline")
        _timelines = {}


def _save_timeline(name, steps, loop):
    """Scrive/aggiorna un preset su disco e lo rende subito disponibile
    (nessun restart, nessun reload_timelines separato richiesto) -- un
    solo comando dall'editor web, salva e basta, l'avvio resta un'azione
    separata (timeline_load) cosi' salvare non accende mai le luci da
    solo a sorpresa."""
    if not name or not isinstance(steps, list) or not steps:
        print(f"[DMX] timeline_save: nome o step non validi (name={name!r})")
        return False
    bad = [s for s in steps if _resolve_color(s) is None]
    if bad:
        print(f"[DMX] timeline_save: step non risolvibili, salvataggio annullato: {bad}")
        return False
    with _lock:
        _timelines[name] = {"steps": steps, "loop": bool(loop)}
    try:
        with open(config.TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump(_timelines, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[DMX] timeline_save: scrittura {config.TIMELINES_FILE} fallita ({e})")
        return False
    print(f"[DMX] Preset '{name}' salvato ({len(steps)} step, loop={bool(loop)})")
    return True


def _delete_timeline(name):
    global _current_timeline_name
    if name not in _timelines:
        print(f"[DMX] timeline_delete: preset sconosciuto {name!r}")
        return False
    with _lock:
        del _timelines[name]
        if _current_timeline_name == name:
            _current_timeline_name = None
    try:
        with open(config.TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump(_timelines, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[DMX] timeline_delete: scrittura {config.TIMELINES_FILE} fallita ({e})")
        return False
    print(f"[DMX] Preset '{name}' eliminato")
    return True


def _resolve_color(step_or_cmd):
    """Da un dict comando/step ({"palette": "Fire"} o {"rgb": [r,g,b]}) al
    colore RGB reale, o None se non risolvibile (palette sconosciuta)."""
    if "rgb" in step_or_cmd:
        rgb = step_or_cmd["rgb"]
        if isinstance(rgb, list) and len(rgb) >= 3:
            return [int(rgb[0]), int(rgb[1]), int(rgb[2])]
        return None
    name = step_or_cmd.get("palette")
    if name in _palettes:
        return list(_palettes[name])
    return None


def _set_target(rgb, fade_s, palette_name=None):
    """Punto unico di scrittura del target di output -- usato sia dai
    comandi manuali sia dall'avanzamento della timeline, cosi' il fade
    riparte sempre dal valore REALMENTE in uscita ora (_output_rgb), mai da
    un valore stantio."""
    global _fade_from, _fade_to, _fade_start, _fade_dur, _current_palette_name, _forced_off
    with _lock:
        _fade_from = list(_output_rgb)
        _fade_to = list(rgb)
        _fade_start = time.time()
        _fade_dur = max(0.0, float(fade_s))
        _current_palette_name = palette_name
        _forced_off = False


# ── Timeline ─────────────────────────────────────────────────────────────────
def _timeline_advance_to(index):
    """Fa partire lo step `index` della timeline (wrap/stop gestiti dal
    chiamante) -- punto unico per non duplicare la logica di fade."""
    global _timeline_index, _timeline_step_started
    step = _timeline_steps[index]
    color = _resolve_color(step)
    if color is None:
        print(f"[DMX] Timeline: step {index} non risolvibile ({step}), salto")
        return False
    fade = float(step.get("fade", TIMELINE_FADE_DEFAULT_S))
    _set_target(color, fade, palette_name=step.get("palette"))
    _timeline_index = index
    _timeline_step_started = time.time()
    return True


def _timeline_start():
    global _timeline_running
    if not _timeline_steps:
        print("[DMX] Timeline vuota, nessuno step da avviare")
        return False
    with _lock:
        _timeline_running = True
    _timeline_advance_to(0)
    return True


def _timeline_stop():
    global _timeline_running
    with _lock:
        _timeline_running = False


def _timeline_load(name):
    """Carica un preset da timelines.json e lo avvia subito -- un tap solo
    dal touch menu (vedi web/dmx-touch.html), non due comandi separati."""
    global _timeline_steps, _timeline_loop, _current_timeline_name
    preset = _timelines.get(name)
    if not preset or not isinstance(preset.get("steps"), list) or not preset["steps"]:
        print(f"[DMX] timeline_load: preset sconosciuto o vuoto {name!r}")
        return False
    with _lock:
        _timeline_steps = preset["steps"]
        _timeline_loop = bool(preset.get("loop", True))
        _current_timeline_name = name
    _timeline_start()
    return True


def _timeline_tick(now):
    """Chiamato dal loop di uscita ad ogni frame. Avanza lo step corrente
    se la sua durata è scaduta."""
    if not _timeline_running or not _timeline_steps:
        return
    step = _timeline_steps[_timeline_index]
    duration = float(step.get("duration", 5.0))
    if now - _timeline_step_started < duration:
        return
    nxt = _timeline_index + 1
    if nxt >= len(_timeline_steps):
        if not _timeline_loop:
            _timeline_stop()
            return
        nxt = 0
    _timeline_advance_to(nxt)


# ── Audio-reattività ─────────────────────────────────────────────────────────
# ffmpeg invece di sounddevice/pyaudio: nessuna dipendenza pip nuova (stesso
# principio "modulo leggero" di pi/livestream, che usa ffmpeg per la stessa
# identica ragione), e passa già dal plugin pipewire-alsa come gli altri --
# "default" vede il mic anche se PipeWire lo ha reclamato come sorgente di
# sistema (stesso gotcha documentato in pi/CLAUDE.md).
_AUDIO_CHUNK = 1024   # campioni per lettura, ~64ms a 16kHz -- reattivo ma non frenetico


def _audio_capture_loop():
    global _audio_proc, _audio_level, _audio_floor, _audio_peak
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "quiet",
           "-f", "alsa", "-i", config.AUDIO_DEVICE,
           "-f", "s16le", "-ar", str(config.AUDIO_SAMPLE_RATE), "-ac", "1", "-"]
    try:
        _audio_proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        print("[DMX] ffmpeg non trovato, audio-reattività non disponibile")
        return
    print(f"[DMX] Audio-reattività: cattura da '{config.AUDIO_DEVICE}' avviata")
    chunk_bytes = _AUDIO_CHUNK * 2   # 2 byte/campione, s16le
    try:
        while _audio_reactive and _audio_proc and _audio_proc.poll() is None:
            data = _audio_proc.stdout.read(chunk_bytes)
            if not data:
                break
            rms = audioop.rms(data, 2)
            # AGC-lite: il floor insegue verso il basso (rumore di fondo che
            # cala), il peak verso l'alto (un picco reale alza il soffitto),
            # entrambi lentamente -- cosi' un ambiente silenzioso resta
            # sensibile e uno rumoroso non resta sempre "a tavoletta".
            if rms < _audio_floor:
                _audio_floor += (rms - _audio_floor) * 0.05
            else:
                _audio_floor += (rms - _audio_floor) * 0.002
            _audio_peak = max(_audio_peak * 0.999, rms, _audio_floor + 500)
            span = max(1.0, _audio_peak - _audio_floor)
            level = max(0.0, min(1.0, (rms - _audio_floor) / span))
            with _lock:
                _audio_level = _audio_level * 0.6 + level * 0.4   # smoothing, evita lo sfarfallio
    except Exception as e:
        print(f"[DMX] Audio-reattività: errore cattura ({e})")
    finally:
        if _audio_proc:
            _audio_proc.terminate()
            try:
                _audio_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                _audio_proc.kill()
                _audio_proc.wait(timeout=2)
        with _lock:
            _audio_level = 0.0
        print("[DMX] Audio-reattività: cattura fermata")


def _start_audio():
    global _audio_reactive, _audio_thread
    if _audio_reactive:
        return
    _audio_reactive = True
    _audio_thread = threading.Thread(target=_audio_capture_loop, daemon=True)
    _audio_thread.start()


def _stop_audio():
    global _audio_reactive, _audio_proc
    _audio_reactive = False
    if _audio_proc:
        _audio_proc.terminate()
        _audio_proc = None


# ── Loop di uscita Art-Net ───────────────────────────────────────────────────
_artnet = ArtNetSender(config.ARTNET_HOST, config.ARTNET_PORT,
                       net=config.ARTNET_NET, subnet=config.ARTNET_SUBNET,
                       universe=config.ARTNET_UNIVERSE)


def _output_loop():
    global _output_rgb
    period = 1.0 / max(1.0, config.FPS)
    warned_no_host = False
    while _running:
        now = time.time()
        _timeline_tick(now)
        with _lock:
            t = 1.0 if _fade_dur <= 0 else min(1.0, (now - _fade_start) / _fade_dur)
            frm, to = _fade_from, _fade_to
        rgb = [frm[i] + (to[i] - frm[i]) * t for i in range(3)]
        _output_rgb = rgb
        buf = [0] * 512
        start = max(0, config.START_ADDRESS - 1)
        has_dimmer = config.DIMMER_CHANNEL > 0
        # Audio-reattività: _audio_level (0-1, già AGC+smoothing, vedi
        # _audio_capture_loop) modula la brillantezza impostata -- lo
        # slider/_brightness resta il TETTO massimo, il livello audio decide
        # quanto di quel tetto si vede in ogni istante. Spenta = comportamento
        # di sempre (_brightness da solo).
        eff_brightness = _brightness * _audio_level if _audio_reactive else _brightness
        if _forced_off:
            # buf resta tutto a 0 -- spegnimento garantito, vedi commento su
            # _forced_off. rgb3/rgb_start fittizi solo perché il codice
            # sotto li scrive comunque (riscrive zero su zero, innocuo).
            rgb_start, rgb3 = start, [0, 0, 0]
        elif has_dimmer:
            # Canale dimmer separato (es. "D+RGB 4CH"): RGB grezzo, la
            # luminosità va sul suo canale -- vedi commento in config.py.
            dimmer_idx = start + config.DIMMER_CHANNEL - 1
            if 0 <= dimmer_idx < 512:
                buf[dimmer_idx] = max(0, min(255, round(eff_brightness * 255)))
            rgb_start = start + config.DIMMER_CHANNEL
            rgb3 = [max(0, min(255, round(c))) for c in rgb]
        else:
            # Nessun dimmer separato: luminosità moltiplicata direttamente
            # nei canali colore (comportamento di sempre).
            rgb_start = start
            rgb3 = [max(0, min(255, round(c * eff_brightness))) for c in rgb]
        # Canali oltre i 3 RGB (es. W di una RGBW) -- NUM_CHANNELS conta il
        # totale occupato dalla fixture, dimmer incluso se presente.
        extra = max(0, config.NUM_CHANNELS - 3 - (1 if has_dimmer else 0))
        channels = rgb3 + [0] * extra
        for i, v in enumerate(channels):
            if rgb_start + i < 512:
                buf[rgb_start + i] = v
        if config.ARTNET_HOST:
            _artnet.send(buf)
        elif not warned_no_host:
            print("[DMX] ARTNET_HOST non impostato — nessun pacchetto Art-Net inviato "
                  "(imposta /etc/gaia/dmx.conf, timeline/palette restano comunque attivi in stato)")
            warned_no_host = True
        time.sleep(period)


# ── MQTT ──────────────────────────────────────────────────────────────────────
try:
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=f"gaia-dmx-{config.DEVICE_ID}")
except AttributeError:
    _mqtt = mqtt.Client(client_id=f"gaia-dmx-{config.DEVICE_ID}")
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


class _OtaMqttAdapter:
    def publish(self, topic, payload, retain=False):
        _mqtt.publish(topic, json.dumps(payload, default=str), qos=0, retain=retain)


_ota = OtaHandler(mqtt_client=_OtaMqttAdapter(), device_id=config.DEVICE_ID,
                  device_type="dmx", base_dir=config._BASE,
                  service_name="gaia-dmx")


def _publish_status():
    with _lock:
        out = [round(c) for c in _output_rgb]
        payload = {
            "device_id": config.DEVICE_ID,
            "stanza": _current_room,
            "artnet_configured": bool(config.ARTNET_HOST),
            "palettes": sorted(_palettes.keys()),
            "current_palette": _current_palette_name,
            "output_rgb": out,
            "brightness": round(_brightness, 3),
            "timeline_defined": len(_timeline_steps),
            "timeline_running": _timeline_running,
            "timeline_loop": _timeline_loop,
            "timeline_step_index": _timeline_index if _timeline_running else None,
            # Contenuto intero (non solo i nomi): piccolo (pochi preset,
            # pochi step ciascuno) e cosi' l'editor web puo' mostrare/
            # modificare un preset esistente senza un comando dedicato
            # per leggerlo -- sempre la stessa fonte "verita'" di quando
            # viene davvero eseguito, nessuna cache lato pagina che
            # rischia di disallinearsi.
            "timeline_presets": _timelines,
            "current_timeline_preset": _current_timeline_name,
            "audio_reactive": _audio_reactive,
            "audio_level": round(_audio_level, 3),
            "ts": int(time.time() * 1000),
        }
    _mqtt.publish(f"gaia/dmx/{_current_room}/status", json.dumps(payload), retain=True)


def _topic_command():
    return f"gaia/dmx/{_current_room}/command"


def _on_connect(client, userdata, flags, rc, properties=None):
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    client.subscribe(_topic_command(), qos=1)
    for t in _ota.topics():
        client.subscribe(t)
    _publish_status()
    print(f"[MQTT] Connesso — stanza {_current_room}")


def _on_message(client, userdata, msg):
    global _current_room, _brightness, _timeline_steps, _timeline_loop, _forced_off, _current_timeline_name
    if msg.topic in _ota.topics():
        _ota.handle(msg.topic, msg.payload)
        return
    if msg.topic.endswith("/command"):
        try:
            cmd = json.loads(msg.payload)
        except ValueError:
            return
        action = cmd.get("action")
        if action == "set_palette":
            color = _resolve_color(cmd)
            if color is None:
                print(f"[DMX] set_palette: palette sconosciuta {cmd.get('palette')!r}")
            else:
                _timeline_stop()
                _set_target(color, cmd.get("fade", MANUAL_FADE_DEFAULT_S), palette_name=cmd.get("palette"))
        elif action == "set_rgb":
            color = _resolve_color(cmd)
            if color is None:
                print(f"[DMX] set_rgb: payload non valido {cmd}")
            else:
                _timeline_stop()
                _set_target(color, cmd.get("fade", MANUAL_FADE_DEFAULT_S), palette_name=None)
        elif action == "blackout":
            _timeline_stop()
            _set_target([0, 0, 0], 0.0, palette_name=None)
            _forced_off = True
        elif action == "set_brightness":
            try:
                with _lock:
                    _brightness = max(0.0, min(1.0, float(cmd.get("value", 1.0))))
            except (TypeError, ValueError):
                pass
        elif action == "timeline_set":
            steps = cmd.get("steps")
            if isinstance(steps, list) and steps:
                with _lock:
                    _timeline_steps = steps
                    _timeline_loop = bool(cmd.get("loop", True))
                    _current_timeline_name = None   # non è (più) un preset noto
                print(f"[DMX] Timeline impostata: {len(steps)} step, loop={_timeline_loop}")
            else:
                print("[DMX] timeline_set: 'steps' mancante o vuoto")
        elif action == "timeline_start":
            _timeline_start()
        elif action == "timeline_stop":
            _timeline_stop()
        elif action == "timeline_load":
            name = cmd.get("name", "")
            if not _timeline_load(name):
                print(f"[DMX] timeline_load: preset sconosciuto {name!r} (disponibili: {', '.join(_timelines)})")
        elif action == "timeline_save":
            _save_timeline(cmd.get("name", ""), cmd.get("steps"), cmd.get("loop", True))
        elif action == "timeline_delete":
            _delete_timeline(cmd.get("name", ""))
        elif action == "reload_palettes":
            _load_palettes()
        elif action == "reload_timelines":
            _load_timelines()
        elif action == "audio_reactive_start":
            _start_audio()
        elif action == "audio_reactive_stop":
            _stop_audio()
        else:
            print(f"[DMX] Azione sconosciuta: {action!r}")
        _publish_status()
        return
    try:
        new_room = json.loads(msg.payload).get("room")
    except ValueError:
        return
    if new_room and new_room != _current_room:
        _mqtt.publish(f"gaia/dmx/{_current_room}/status", "", retain=True)
        client.unsubscribe(_topic_command())
        _current_room = new_room
        client.subscribe(_topic_command(), qos=1)
        _publish_status()


_mqtt.on_connect = _on_connect
_mqtt.on_message = _on_message


# ── Webserver locale per il mini menu touch ─────────────────────────────────
# Serve web/dmx-touch.html (copia in www/, vedi nota sotto) direttamente da
# questo Pi, cosi' il kiosk non dipende da OPS/Node-RED per il semplice
# HTML/JS -- resta comunque una dipendenza reale dal broker MQTT di Core
# (192.168.1.142:9001, hardcoded nella pagina) per il controllo vero, ma
# Core e' molto piu' stabile di OPS/Node-RED in questo progetto (vedi
# pi/CLAUDE.md e il changelog TD4Gaia per i precedenti di OPS giu').
# www/ e' una COPIA (dmx-touch.html + vendor/mqtt.min.js): tenerla allineata
# a web/dmx-touch.html e web/vendor/mqtt.min.js a mano se quella pagina
# cambia, stessa convenzione di duplicazione gia' in uso per ota.py fra i
# moduli Pi (vedi pi/CLAUDE.md).
def _start_local_webserver():
    import http.server
    www_dir = os.path.join(config._BASE, "www")
    if not os.path.isdir(www_dir):
        print(f"[DMX] {www_dir} non trovato, webserver locale non avviato")
        return
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=www_dir, **kw)
    try:
        httpd = http.server.ThreadingHTTPServer(("0.0.0.0", config.TOUCH_PORT), handler)
    except OSError as e:
        print(f"[DMX] Webserver locale: porta {config.TOUCH_PORT} non disponibile ({e})")
        return
    print(f"[DMX] Webserver locale su :{config.TOUCH_PORT} ({www_dir})")
    httpd.serve_forever()


def main():
    _load_palettes()
    _load_timelines()
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    threading.Thread(target=_mqtt.loop_forever,
                     kwargs={"retry_first_connection": True}, daemon=True).start()
    threading.Thread(target=_output_loop, daemon=True).start()
    if config.TOUCH_PORT:
        threading.Thread(target=_start_local_webserver, daemon=True).start()

    last_status = 0.0
    while _running:
        now = time.time()
        if now - last_status >= config.STATUS_EVERY_S:
            last_status = now
            _publish_status()
        time.sleep(1)

    _stop_audio()
    _artnet.close()
    _mqtt.publish(f"gaia/dmx/{_current_room}/status", "", retain=True)
    print("[DMX] Terminato.")


if __name__ == "__main__":
    main()
