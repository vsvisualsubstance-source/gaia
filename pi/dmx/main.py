#!/usr/bin/env python3
"""
GAIA DMX (base) — servizio Pi per N fixture DMX via Art-Net nello stesso
universo: palette nominate + una piccola timeline (sequenza di palette nel
tempo, con crossfade) PER FIXTURE. Pensato per una stanza/fixture NON già
coperta da DMX V8 su TD (quello resta il rig "Consolle", via Electroconcept
2.1.1.2) — stesso protocollo Art-Net, nodo diverso, nessun conflitto.

A differenza di DMX V8 (TD, kick-detection audio-reattivo, scan/patch di
rete) questo è deliberatamente semplice: fixture dichiarate a mano
(fixtures.json, vedi config.FIXTURES_FILE — con una sola fixture il
comportamento è identico a prima del 2026-10-03, zero cambi richiesti),
nessuna discovery di rete — l'host Art-Net si configura a mano
(config.ARTNET_HOST). Vedi artnet.py per il perché niente ArtPoll.

Audio-reattività (2026-10-02, opt-in, per fixture): livello RMS dal
microfono locale (webcam o scheda audio, via ffmpeg+pipewire-alsa) modula
la brillantezza in tempo reale. Il microfono è UNO per device (non per
fixture): la cattura resta un thread condiviso, ogni fixture decide solo
se applicarne il livello o no. Vedi _audio_capture_loop().

Gain + 3 bande (2026-10-05, richiesto esplicitamente per quando l'audio
non arriva dal Controller via MQTT/Touch LAN ma da una scheda audio
esterna con livello di linea sconosciuto): un guadagno manuale pre-RMS
(_audio_gain) e tre filtri passa-basso/passa-alto a un polo (niente FFT,
pesi minimi) che separano basso/medio/alto, ciascuno col proprio
guadagno regolabile e il proprio livello 0-1 esposto in status per un
VU-meter. Restano SOLO per taratura/monitoraggio: la brillantezza
audio-reattiva delle fixture continua a seguire il solo livello master
(_audio_level) come da sempre — tre comportamenti reattivi separati per
banda restano deliberatamente fuori scope qui, quello è il lavoro di
DMX V8 su TD.

Catena: comando MQTT (palette o timeline, con "fixture":"<id>") → stato
della Fixture (fade_from/to, progresso crossfade) → loop di uscita a
config.FPS che scrive i canali di TUTTE le fixture in un solo buffer e
manda UN pacchetto Art-Net → ArtNetSender.send(). Stesso schema
command/status/device-registry degli altri moduli "leggeri" del Pi (vedi
pi/livestream/main.py, pi/mediaplayer/main.py): paho-mqtt diretto, non il
protocollo gaia_client lato TD (quello è per TouchDesigner, qui non serve
quel livello di complessità).
"""
import array
import audioop
import json
import math
import os
import re
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
_timelines = {}           # nome preset -> {"steps":[...], "loop": bool} -- condivisi fra tutte le fixture

MANUAL_FADE_DEFAULT_S = 0.6
TIMELINE_FADE_DEFAULT_S = 1.0


class Fixture:
    """Una fixture DMX indipendente nello stesso universo Art-Net -- ha il
    proprio layout canali (dove nel buffer scrive) e il proprio stato
    (palette/timeline/brillantezza/audio-reattività), ma condivide
    palette/preset timeline (sono nomi/colori, non stato) e il microfono
    (uno per device) col resto delle fixture dello stesso servizio."""

    def __init__(self, fid, start_address, num_channels, dimmer_channel):
        self.id = fid
        self.start_address = start_address
        self.num_channels = num_channels
        self.dimmer_channel = dimmer_channel

        self.brightness = 1.0
        self.current_palette_name = None   # None se l'output attuale non corrisponde a una palette nota
        # Blackout = spegnimento garantito, indipendente dal layout canali
        # della fixture -- vedi commento su _forced_off più sotto nel loop
        # di uscita. Si disattiva da sé al primo set_palette/set_rgb/avvio
        # timeline successivo (vedi _set_target).
        self.forced_off = False

        # Crossfade: il loop di uscita interpola linearmente da fade_from a
        # fade_to fra fade_start e fade_start+fade_dur (secondi). output_rgb
        # è il valore live attualmente calcolato/mandato -- usato come
        # punto di partenza del PROSSIMO fade, cosi' un cambio durante un
        # fade in corso non scatta mai di colpo.
        self.output_rgb = [0, 0, 0]
        self.fade_from = [0, 0, 0]
        self.fade_to = [0, 0, 0]
        self.fade_start = 0.0
        self.fade_dur = 0.0

        self.timeline_steps = []      # [{"palette"|"rgb", "duration", "fade"}, ...]
        self.timeline_loop = True
        self.timeline_running = False
        self.timeline_index = -1
        self.timeline_step_started = 0.0
        self.current_timeline_name = None   # None se la timeline attiva non è (più) un preset noto

        self.audio_reactive = False   # applica _audio_level (condiviso) alla propria brillantezza


_fixtures = {}        # id -> Fixture
_default_fixture_id = None   # primo id in ordine -- usato quando un comando non specifica "fixture"


def _load_fixtures():
    """fixtures.json se esiste (più fixture dichiarate a mano, mai
    indovinate — i canali non devono sovrapporsi, controllo fatto qui a
    caldo, non lasciato all'uscita Art-Net che si limiterebbe a
    sovrascrivere in silenzio); altrimenti UNA fixture 'a' dalle vecchie
    variabili DMX_NUM_CHANNELS/DMX_START_ADDRESS/DMX_DIMMER_CHANNEL --
    stesso comportamento di prima del multi-fixture, zero cambi richiesti
    per un setup a fixture singola."""
    global _fixtures, _default_fixture_id
    raw = None
    if os.path.exists(config.FIXTURES_FILE):
        try:
            with open(config.FIXTURES_FILE, encoding="utf-8") as f:
                raw = json.load(f)
            raw.pop("_nota", None)
        except Exception as e:
            print(f"[DMX] Impossibile leggere {config.FIXTURES_FILE} ({e}), fixture singola di default")
            raw = None
    if not raw:
        raw = {"a": {"start_address": config.START_ADDRESS,
                      "num_channels": config.NUM_CHANNELS,
                      "dimmer_channel": config.DIMMER_CHANNEL}}

    fixtures = {}
    spans = []   # (start, end_esclusivo, fid) per il controllo di sovrapposizione
    for fid, spec in sorted(raw.items()):
        start = int(spec.get("start_address", 1))
        num = int(spec.get("num_channels", 3))
        dimmer = int(spec.get("dimmer_channel", 0))
        end = start + num
        for s2, e2, fid2 in spans:
            if start < e2 and s2 < end:
                print(f"[DMX] fixtures.json: '{fid}' (canali {start}-{end-1}) sovrappone "
                      f"'{fid2}' (canali {s2}-{e2-1}) — '{fid}' ignorata")
                break
        else:
            spans.append((start, end, fid))
            fixtures[fid] = Fixture(fid, start, num, dimmer)

    if not fixtures:
        # non dovrebbe succedere (il fallback singolo non si sovrappone con
        # nulla), ma meglio una fixture che nessuna in caso di bug sopra
        fixtures["a"] = Fixture("a", config.START_ADDRESS, config.NUM_CHANNELS, config.DIMMER_CHANNEL)

    _fixtures = fixtures
    _default_fixture_id = sorted(_fixtures)[0]
    print(f"[DMX] {len(_fixtures)} fixture: " +
          ", ".join(f"{fid}(ch {f.start_address}-{f.start_address+f.num_channels-1}"
                     f"{',dimmer '+str(f.dimmer_channel) if f.dimmer_channel else ''})"
                     for fid, f in sorted(_fixtures.items())))


def _fixture_for(cmd):
    """Risolve la fixture target di un comando -- 'fixture' nel payload,
    altrimenti quella di default (prima in ordine alfabetico, cosi' un
    setup a fixture singola 'a' non deve mai specificarlo)."""
    fid = cmd.get("fixture", _default_fixture_id)
    fx = _fixtures.get(fid)
    if fx is None:
        print(f"[DMX] fixture sconosciuta {fid!r} (disponibili: {', '.join(_fixtures)})")
    return fx


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


def _save_palette(name, rgb):
    """Aggiunge/sovrascrive una palette personalizzata e la rende subito
    disponibile -- stesso identico schema di _save_timeline (persisti +
    aggiorna lo stato in memoria, nessuna distinzione fra palette
    "di base" e personalizzate, sono solo nome->colore in un unico file)."""
    if not name or not isinstance(rgb, list) or len(rgb) < 3:
        print(f"[DMX] palette_save: nome o rgb non validi (name={name!r}, rgb={rgb!r})")
        return False
    try:
        color = [max(0, min(255, int(c))) for c in rgb[:3]]
    except (TypeError, ValueError):
        print(f"[DMX] palette_save: valori rgb non numerici {rgb!r}")
        return False
    with _lock:
        _palettes[name] = color
    try:
        with open(config.PALETTES_FILE, "w", encoding="utf-8") as f:
            json.dump(_palettes, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[DMX] palette_save: scrittura {config.PALETTES_FILE} fallita ({e})")
        return False
    print(f"[DMX] Palette '{name}' salvata (rgb={color})")
    return True


def _delete_palette(name):
    if name not in _palettes:
        print(f"[DMX] palette_delete: palette sconosciuta {name!r}")
        return False
    with _lock:
        del _palettes[name]
    try:
        with open(config.PALETTES_FILE, "w", encoding="utf-8") as f:
            json.dump(_palettes, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[DMX] palette_delete: scrittura {config.PALETTES_FILE} fallita ({e})")
        return False
    print(f"[DMX] Palette '{name}' eliminata")
    return True


def _load_timelines():
    global _timelines
    try:
        with open(config.TIMELINES_FILE, encoding="utf-8") as f:
            _timelines = json.load(f)
        print(f"[DMX] {len(_timelines)} preset timeline caricati da {config.TIMELINES_FILE}")
    except Exception as e:
        print(f"[DMX] Impossibile leggere {config.TIMELINES_FILE} ({e}), nessun preset timeline")
        _timelines = {}


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


def _save_timeline(name, steps, loop):
    """Scrive/aggiorna un preset su disco e lo rende subito disponibile
    (nessun restart, nessun reload_timelines separato richiesto) -- un
    solo comando dall'editor web, salva e basta, l'avvio resta un'azione
    separata (timeline_load) cosi' salvare non accende mai le luci da
    solo a sorpresa. Condiviso fra tutte le fixture, non serve "fixture"."""
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
    if name not in _timelines:
        print(f"[DMX] timeline_delete: preset sconosciuto {name!r}")
        return False
    with _lock:
        del _timelines[name]
        for fx in _fixtures.values():
            if fx.current_timeline_name == name:
                fx.current_timeline_name = None
    try:
        with open(config.TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump(_timelines, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[DMX] timeline_delete: scrittura {config.TIMELINES_FILE} fallita ({e})")
        return False
    print(f"[DMX] Preset '{name}' eliminato")
    return True


def _set_target(fx, rgb, fade_s, palette_name=None):
    """Punto unico di scrittura del target di output di UNA fixture --
    usato sia dai comandi manuali sia dall'avanzamento della timeline,
    cosi' il fade riparte sempre dal valore REALMENTE in uscita ora
    (fx.output_rgb), mai da un valore stantio."""
    with _lock:
        fx.fade_from = list(fx.output_rgb)
        fx.fade_to = list(rgb)
        fx.fade_start = time.time()
        fx.fade_dur = max(0.0, float(fade_s))
        fx.current_palette_name = palette_name
        fx.forced_off = False


# ── Timeline ─────────────────────────────────────────────────────────────────
def _timeline_advance_to(fx, index):
    """Fa partire lo step `index` della timeline di `fx` (wrap/stop gestiti
    dal chiamante) -- punto unico per non duplicare la logica di fade."""
    step = fx.timeline_steps[index]
    color = _resolve_color(step)
    if color is None:
        print(f"[DMX] {fx.id}: Timeline step {index} non risolvibile ({step}), salto")
        return False
    fade = float(step.get("fade", TIMELINE_FADE_DEFAULT_S))
    _set_target(fx, color, fade, palette_name=step.get("palette"))
    fx.timeline_index = index
    fx.timeline_step_started = time.time()
    return True


def _timeline_start(fx):
    if not fx.timeline_steps:
        print(f"[DMX] {fx.id}: Timeline vuota, nessuno step da avviare")
        return False
    with _lock:
        fx.timeline_running = True
    _timeline_advance_to(fx, 0)
    return True


def _timeline_stop(fx):
    with _lock:
        fx.timeline_running = False


def _timeline_load(fx, name):
    """Carica un preset da timelines.json su `fx` e lo avvia subito -- un
    tap solo dal touch menu (vedi web/dmx-touch.html), non due comandi
    separati."""
    preset = _timelines.get(name)
    if not preset or not isinstance(preset.get("steps"), list) or not preset["steps"]:
        print(f"[DMX] timeline_load: preset sconosciuto o vuoto {name!r}")
        return False
    with _lock:
        fx.timeline_steps = preset["steps"]
        fx.timeline_loop = bool(preset.get("loop", True))
        fx.current_timeline_name = name
    _timeline_start(fx)
    return True


def _timeline_tick(fx, now):
    """Chiamato dal loop di uscita ad ogni frame per ogni fixture. Avanza
    lo step corrente se la sua durata è scaduta."""
    if not fx.timeline_running or not fx.timeline_steps:
        return
    step = fx.timeline_steps[fx.timeline_index]
    duration = float(step.get("duration", 5.0))
    if now - fx.timeline_step_started < duration:
        return
    nxt = fx.timeline_index + 1
    if nxt >= len(fx.timeline_steps):
        if not fx.timeline_loop:
            _timeline_stop(fx)
            return
        nxt = 0
    _timeline_advance_to(fx, nxt)


# ── Audio-reattività (un microfono per device, opt-in per fixture) ──────────
# ffmpeg invece di sounddevice/pyaudio: nessuna dipendenza pip nuova (stesso
# principio "modulo leggero" di pi/livestream, che usa ffmpeg per la stessa
# identica ragione), e passa già dal plugin pipewire-alsa come gli altri --
# "default" vede il mic anche se PipeWire lo ha reclamato come sorgente di
# sistema (stesso gotcha documentato in pi/CLAUDE.md).
_AUDIO_CHUNK = 1024   # campioni per lettura, ~64ms a 16kHz -- reattivo ma non frenetico

_audio_level = 0.0       # 0-1, già AGC+smoothing -- condiviso, ogni fixture decide solo se applicarlo
_audio_capture_on = False
_audio_proc = None
_audio_thread = None
_audio_floor = 200.0     # rumore di fondo stimato (RMS raw, scala int16), si adatta da solo verso il basso
_audio_peak = 4000.0     # picco stimato, si adatta da solo verso l'alto (mai sotto un minimo, vedi funzione)

# Gain manuale pre-RMS (moltiplica i campioni grezzi prima di qualunque
# calcolo) + 3 bande, SOLO per taratura/monitoraggio (vedi nota in cima al
# file) -- non pilotano nessuna fixture. Persistiti in config.AUDIO_TUNE_FILE,
# caricati da _load_audio_tune() all'avvio.
_audio_gain = 1.0
_audio_band_gain = {"low": 1.0, "mid": 1.0, "high": 1.0}
_audio_bands = {"low": 0.0, "mid": 0.0, "high": 0.0}         # 0-1, AGC+smoothing, per i VU-meter
_audio_band_floor = {"low": 200.0, "mid": 200.0, "high": 200.0}
_audio_band_peak = {"low": 4000.0, "mid": 4000.0, "high": 4000.0}

# Dispositivo audio EFFETTIVO (mutabile a runtime, 2026-10-05) --
# config.AUDIO_DEVICE resta solo il default/fallback al primo avvio (env/
# conf, come sempre); una volta scelto da MQTT/UI il valore vive qui e
# viene persistito in config.AUDIO_TUNE_FILE insieme a gain/bande, cosi'
# la scelta sopravvive a un restart del servizio.
_audio_device = config.AUDIO_DEVICE
_audio_devices_cache = []   # [{"id","label"}, ...], popolata da _scan_audio_devices()

# Tagli fissi (non esposti via MQTT, solo due costanti ragionevoli per
# basso/medio/alto su musica -- niente FFT, due filtri passa-basso a un
# polo: low = lowpass(250Hz), high = segnale - lowpass(3000Hz),
# mid = lowpass(3000Hz) - lowpass(250Hz). Stato del filtro reinizializzato
# ad ogni avvio cattura (_audio_capture_loop), non serve persisterlo.
_BAND_LOW_HZ = 250.0
_BAND_HIGH_HZ = 3000.0


def _scan_audio_devices():
    """Elenco dispositivi di cattura audio reali via `arecord -l` (alsa-
    utils, già presente -- nessuna dipendenza pip nuova, stesso principio
    "modulo leggero" di ffmpeg sopra). "default" resta sempre la prima
    opzione: passa dal plugin pipewire-alsa (vedi nota audio-reattività in
    testa al file), funziona sempre anche con un solo dispositivo. Le
    schede reali si aggiungono come plughw:CARD=N,DEV=M -- stesso formato
    che ffmpeg -f alsa -i accetta direttamente. Cache aggiornata
    all'avvio e su richiesta esplicita (azione audio_rescan_devices, utile
    se si collega una scheda USB senza riavviare il servizio)."""
    global _audio_devices_cache
    devices = [{"id": "default", "label": "Automatico (default)"}]
    try:
        out = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=3).stdout
        for line in out.splitlines():
            # short-name può contenere spazi (es. "USB Audio") -- .+? non
            # greedy invece di \S+, altrimenti la riga non combacia mai
            # per schede con nome composto (bug trovato dal vivo 2026-10-05,
            # unica scheda reale su Pi Ingresso scartata silenziosamente).
            m = re.match(r"card (\d+): .+? \[(.*?)\], device (\d+): .+? \[(.*?)\]", line)
            if m:
                card, card_name, dev, dev_name = m.groups()
                devices.append({
                    "id": f"plughw:CARD={card},DEV={dev}",
                    "label": f"{card_name} — {dev_name} (card {card})",
                })
    except Exception as e:
        print(f"[DMX] audio: scan dispositivi fallita ({e}), resta solo 'default'")
    _audio_devices_cache = devices
    print(f"[DMX] {len(devices)} dispositivo/i audio trovati")


def _load_audio_tune():
    global _audio_gain, _audio_device
    try:
        with open(config.AUDIO_TUNE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        _audio_gain = float(d.get("gain", 1.0))
        for b, v in (d.get("bands") or {}).items():
            if b in _audio_band_gain:
                _audio_band_gain[b] = float(v)
        _audio_device = d.get("device") or _audio_device
        print(f"[DMX] Audio tune caricato: gain={_audio_gain}, bands={_audio_band_gain}, device={_audio_device!r}")
    except Exception:
        pass   # nessun file ancora salvato, restano i default


def _save_audio_tune():
    try:
        with open(config.AUDIO_TUNE_FILE, "w", encoding="utf-8") as f:
            json.dump({"gain": _audio_gain, "bands": _audio_band_gain, "device": _audio_device}, f, indent=2)
    except OSError as e:
        print(f"[DMX] audio_tune: scrittura {config.AUDIO_TUNE_FILE} fallita ({e})")


def _agc_level(rms, floor, peak):
    """Stesso identico AGC-lite già in uso per il livello master (floor
    insegue in basso veloce/in alto lento, peak il contrario) --
    fattorizzato qui per riuso su master + 3 bande senza quadruplicare la
    logica."""
    if rms < floor:
        floor += (rms - floor) * 0.05
    else:
        floor += (rms - floor) * 0.002
    peak = max(peak * 0.999, rms, floor + 500)
    span = max(1.0, peak - floor)
    level = max(0.0, min(1.0, (rms - floor) / span))
    return level, floor, peak


def _audio_capture_loop():
    global _audio_proc, _audio_level, _audio_floor, _audio_peak, _audio_capture_on
    device = _audio_device   # letto una volta sola -- un cambio mentre questo loop gira si applica al prossimo restart (vedi audio_set_device)
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "quiet",
           "-f", "alsa", "-i", device,
           "-f", "s16le", "-ar", str(config.AUDIO_SAMPLE_RATE), "-ac", "1", "-"]
    try:
        _audio_proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        print("[DMX] ffmpeg non trovato, audio-reattività non disponibile")
        return
    print(f"[DMX] Audio-reattività: cattura da '{device}' avviata")
    chunk_bytes = _AUDIO_CHUNK * 2   # 2 byte/campione, s16le
    # Filtri a un polo per basso/alto (vedi _BAND_LOW_HZ/_BAND_HIGH_HZ) --
    # alpha = dt/(RC+dt), costanti per tutta la cattura (sample rate fisso).
    # Stato (lp_low/lp_high) reinizializzato ad ogni avvio: non serve
    # persisterlo, un transiente di pochi campioni all'avvio è innocuo.
    dt = 1.0 / config.AUDIO_SAMPLE_RATE
    alpha_low = dt / (1.0 / (2 * math.pi * _BAND_LOW_HZ) + dt)
    alpha_high = dt / (1.0 / (2 * math.pi * _BAND_HIGH_HZ) + dt)
    lp_low = lp_high = 0.0
    try:
        while _audio_capture_on and _audio_proc and _audio_proc.poll() is None:
            data = _audio_proc.stdout.read(chunk_bytes)
            if not data:
                break
            samples = array.array("h")
            samples.frombytes(data)
            gain = _audio_gain
            if gain != 1.0:
                for i in range(len(samples)):
                    samples[i] = max(-32768, min(32767, int(samples[i] * gain)))
            # Livello master: stesso identico calcolo di sempre, solo sui
            # campioni già scalati dal gain -- audioop.rms resta il più
            # veloce per questo (C, non Python puro).
            rms = audioop.rms(samples.tobytes(), 2)
            level, _audio_floor, _audio_peak = _agc_level(rms, _audio_floor, _audio_peak)
            with _lock:
                _audio_level = _audio_level * 0.6 + level * 0.4   # smoothing, evita lo sfarfallio

            # 3 bande, SOLO per taratura/monitoraggio (vedi nota in testa al
            # file) -- un singolo passaggio sui campioni, due filtri passa-
            # basso in cascata: low = lp_low, mid = lp_high-lp_low,
            # high = campione-lp_high.
            sum_low = sum_mid = sum_high = 0.0
            for s in samples:
                lp_low += alpha_low * (s - lp_low)
                lp_high += alpha_high * (s - lp_high)
                mid_v = lp_high - lp_low
                high_v = s - lp_high
                sum_low += lp_low * lp_low
                sum_mid += mid_v * mid_v
                sum_high += high_v * high_v
            n = len(samples)
            if n:
                for band, total in (("low", sum_low), ("mid", sum_mid), ("high", sum_high)):
                    rms_b = (total / n) ** 0.5 * _audio_band_gain[band]
                    lvl, _audio_band_floor[band], _audio_band_peak[band] = _agc_level(
                        rms_b, _audio_band_floor[band], _audio_band_peak[band])
                    with _lock:
                        _audio_bands[band] = _audio_bands[band] * 0.6 + lvl * 0.4
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
            for band in _audio_bands:
                _audio_bands[band] = 0.0
        # Bandiera riportata giù QUI, non solo da _stop_audio_if_unused --
        # se il thread muore per un motivo imprevisto (ffmpeg sparito,
        # eccezione sopra) mentre una fixture crede ancora che
        # audio_reactive sia "on", senza questo la bandiera resterebbe
        # bloccata su True con nessuna cattura reale dietro: _start_audio()
        # non verrebbe mai richiamato (pensa sia già attiva) e
        # _audio_level resterebbe fermo per sempre. Il watchdog nel loop
        # di uscita (vedi _output_loop) la rialza da solo se serve ancora.
        _audio_capture_on = False
        print("[DMX] Audio-reattività: cattura fermata")


def _start_audio():
    """Avvia la cattura condivisa se non già attiva -- chiamata ogni volta
    che una fixture chiede audio_reactive_start, no-op se un'altra fixture
    l'aveva già accesa."""
    global _audio_capture_on, _audio_thread
    if _audio_capture_on:
        return
    _audio_capture_on = True
    _audio_thread = threading.Thread(target=_audio_capture_loop, daemon=True)
    _audio_thread.start()


def _stop_audio_if_unused():
    """Ferma la cattura SOLO se nessuna fixture la vuole più -- audio_reactive
    è per fixture, il microfono è uno per device.

    Bug reale trovato dal vivo (2026-10-03): qui si chiamava .terminate()
    e si azzerava _audio_proc nello stesso momento, da un thread DIVERSO
    da quello che possiede il processo (_audio_capture_loop, che gira in
    un suo thread). Se questa funzione svuotava _audio_proc PRIMA che
    _audio_capture_loop arrivasse al proprio `finally` (corsa tra i due
    thread, nessuna garanzia sull'ordine), quel `finally` trovava
    `_audio_proc` già None e saltava .wait()/.kill() -- il processo
    terminato restava uno zombie mai raccolto (confermato con `ps`:
    "[ffmpeg] <defunct>"). Fix: solo il thread che possiede il processo
    (_audio_capture_loop) lo termina/aspetta/azzera; questa funzione si
    limita ad abbassare la bandiera -- il loop la controlla ad ogni
    iterazione (già cosi') e chiude da solo entro una lettura (~64ms)."""
    if any(fx.audio_reactive for fx in _fixtures.values()):
        return
    global _audio_capture_on
    _audio_capture_on = False


# ── Loop di uscita Art-Net ───────────────────────────────────────────────────
_artnet = ArtNetSender(config.ARTNET_HOST, config.ARTNET_PORT,
                       net=config.ARTNET_NET, subnet=config.ARTNET_SUBNET,
                       universe=config.ARTNET_UNIVERSE)


def _write_fixture_channels(buf, fx, now):
    """Calcola il fade corrente di `fx` e scrive i suoi canali in `buf`
    (buffer condiviso da 512 canali, UNA fixture non tocca i canali delle
    altre -- i loro start_address/num_channels non si sovrappongono mai,
    verificato in _load_fixtures)."""
    with _lock:
        t = 1.0 if fx.fade_dur <= 0 else min(1.0, (now - fx.fade_start) / fx.fade_dur)
        frm, to = fx.fade_from, fx.fade_to
    rgb = [frm[i] + (to[i] - frm[i]) * t for i in range(3)]
    fx.output_rgb = rgb
    start = max(0, fx.start_address - 1)
    has_dimmer = fx.dimmer_channel > 0
    # Audio-reattività: _audio_level (0-1, già AGC+smoothing, vedi
    # _audio_capture_loop) modula la brillantezza impostata -- lo
    # slider/brightness resta il TETTO massimo, il livello audio decide
    # quanto di quel tetto si vede in ogni istante. Spenta = comportamento
    # di sempre (brightness da solo).
    eff_brightness = fx.brightness * _audio_level if fx.audio_reactive else fx.brightness
    if fx.forced_off:
        # buf resta a 0 sui canali di questa fixture -- spegnimento
        # garantito, vedi commento su forced_off nella classe Fixture.
        # rgb3/rgb_start fittizi solo perché il codice sotto li scrive
        # comunque (riscrive zero su zero, innocuo).
        rgb_start, rgb3 = start, [0, 0, 0]
    elif has_dimmer:
        # Canale dimmer separato (es. "D+RGB 4CH"): RGB grezzo, la
        # luminosità va sul suo canale -- vedi commento in config.py.
        dimmer_idx = start + fx.dimmer_channel - 1
        if 0 <= dimmer_idx < 512:
            buf[dimmer_idx] = max(0, min(255, round(eff_brightness * 255)))
        rgb_start = start + fx.dimmer_channel
        rgb3 = [max(0, min(255, round(c))) for c in rgb]
    else:
        # Nessun dimmer separato: luminosità moltiplicata direttamente nei
        # canali colore (comportamento di sempre).
        rgb_start = start
        rgb3 = [max(0, min(255, round(c * eff_brightness))) for c in rgb]
    # Canali oltre i 3 RGB (es. W di una RGBW) -- num_channels conta il
    # totale occupato dalla fixture, dimmer incluso se presente.
    extra = max(0, fx.num_channels - 3 - (1 if has_dimmer else 0))
    channels = rgb3 + [0] * extra
    for i, v in enumerate(channels):
        if rgb_start + i < 512:
            buf[rgb_start + i] = v


def _output_loop():
    period = 1.0 / max(1.0, config.FPS)
    warned_no_host = False
    last_audio_check = 0.0
    while _running:
        now = time.time()
        buf = [0] * 512
        for fx in _fixtures.values():
            _timeline_tick(fx, now)
            _write_fixture_channels(buf, fx, now)
        if config.ARTNET_HOST:
            _artnet.send(buf)
        elif not warned_no_host:
            print("[DMX] ARTNET_HOST non impostato — nessun pacchetto Art-Net inviato "
                  "(imposta /etc/gaia/dmx.conf, timeline/palette restano comunque attivi in stato)")
            warned_no_host = True
        # Watchdog audio-reattività: se una fixture vuole audio_reactive ma
        # la cattura condivisa non sta girando (thread morto per un motivo
        # imprevisto -- vedi commento nel finally di _audio_capture_loop),
        # la rialza da sola. Controllato 1 volta/secondo, non ad ogni
        # frame: _start_audio() è un no-op se già attiva, ma non ha senso
        # valutare la condizione 30 volte/secondo.
        if now - last_audio_check >= 1.0:
            last_audio_check = now
            if any(fx.audio_reactive for fx in _fixtures.values()) and not _audio_capture_on:
                print("[DMX] Audio-reattività: richiesta ma non attiva, riavvio cattura")
                _start_audio()
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


def _fixture_status(fx):
    with _lock:
        out = [round(c) for c in fx.output_rgb]
        return {
            "start_address": fx.start_address,
            "num_channels": fx.num_channels,
            "dimmer_channel": fx.dimmer_channel,
            "current_palette": fx.current_palette_name,
            "output_rgb": out,
            "brightness": round(fx.brightness, 3),
            "timeline_defined": len(fx.timeline_steps),
            "timeline_running": fx.timeline_running,
            "timeline_loop": fx.timeline_loop,
            "timeline_step_index": fx.timeline_index if fx.timeline_running else None,
            "current_timeline_preset": fx.current_timeline_name,
            "audio_reactive": fx.audio_reactive,
        }


def _publish_status():
    payload = {
        "device_id": config.DEVICE_ID,
        "stanza": _current_room,
        "artnet_configured": bool(config.ARTNET_HOST),
        "palettes": sorted(_palettes.keys()),
        "palettes_rgb": _palettes,   # nome->[r,g,b] completo -- l'editor web lo usa per gli swatch/eliminazione, zero comandi dedicati per leggerli
        # Contenuto intero (non solo i nomi): piccolo (pochi preset, pochi
        # step ciascuno) e cosi' l'editor web puo' mostrare/modificare un
        # preset esistente senza un comando dedicato per leggerlo -- sempre
        # la stessa fonte "verita'" di quando viene davvero eseguito,
        # nessuna cache lato pagina che rischia di disallinearsi.
        "timeline_presets": _timelines,
        "default_fixture": _default_fixture_id,
        "fixtures": {fid: _fixture_status(fx) for fid, fx in _fixtures.items()},
        "audio_level": round(_audio_level, 3),   # condiviso, vedi classe Fixture
        "audio_device": _audio_device,           # quale sorgente sta ascoltando (o ascolterebbe) la cattura -- scelta runtime, non piu' solo config
        "audio_devices": _audio_devices_cache,    # [{"id","label"}, ...] -- per il <select> lato UI
        "audio_capturing": _audio_capture_on,    # cattura REALMENTE attiva ora, non solo "qualcuno la vuole"
        "audio_gain": round(_audio_gain, 2),
        "audio_band_gain": {b: round(v, 2) for b, v in _audio_band_gain.items()},
        "audio_bands": {b: round(v, 3) for b, v in _audio_bands.items()},   # VU-meter, solo monitoraggio
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
    global _current_room
    if msg.topic in _ota.topics():
        _ota.handle(msg.topic, msg.payload)
        return
    if msg.topic.endswith("/command"):
        try:
            cmd = json.loads(msg.payload)
        except ValueError:
            return
        action = cmd.get("action")
        # Azioni condivise (non su una fixture specifica) -- gestite prima,
        # cosi' non serve risolvere una fixture per forza.
        if action == "reload_palettes":
            _load_palettes()
        elif action == "reload_timelines":
            _load_timelines()
        elif action == "timeline_save":
            _save_timeline(cmd.get("name", ""), cmd.get("steps"), cmd.get("loop", True))
        elif action == "timeline_delete":
            _delete_timeline(cmd.get("name", ""))
        elif action == "palette_save":
            _save_palette(cmd.get("name", ""), cmd.get("rgb"))
        elif action == "palette_delete":
            _delete_palette(cmd.get("name", ""))
        elif action == "audio_tune":
            # Condivisa (non per fixture): gain + guadagno per banda, utile
            # quando l'audio arriva da una scheda esterna con livello di
            # linea diverso dal mic di riferimento (vedi nota in testa al
            # file). Ogni campo è opzionale, si aggiorna solo quello presente.
            global _audio_gain
            changed = False
            if "gain" in cmd:
                try:
                    _audio_gain = max(0.1, min(5.0, float(cmd["gain"])))
                    changed = True
                except (TypeError, ValueError):
                    print(f"[DMX] audio_tune: gain non valido {cmd.get('gain')!r}")
            for band in ("low", "mid", "high"):
                if band in cmd:
                    try:
                        _audio_band_gain[band] = max(0.1, min(5.0, float(cmd[band])))
                        changed = True
                    except (TypeError, ValueError):
                        print(f"[DMX] audio_tune: {band} non valido {cmd.get(band)!r}")
            if changed:
                _save_audio_tune()
        elif action == "audio_set_device":
            # Condivisa: un device per Pi, non per fixture. Il device.id
            # deve combaciare con uno di quelli in audio_devices (status),
            # "default" è sempre valido. Cambio a runtime: se la cattura è
            # attiva ora, basta abbassare la bandiera -- il watchdog in
            # _output_loop la riaccende da sola entro ~1s leggendo il nuovo
            # _audio_device (vedi _audio_capture_loop), stessa machinery
            # già testata per il recupero da crash, nessuna nuova corsa fra
            # thread introdotta.
            device = cmd.get("device")
            if device:
                global _audio_device
                _audio_device = device
                _save_audio_tune()
                if _audio_capture_on:
                    _audio_capture_on = False
                print(f"[DMX] audio_set_device: {device!r}")
            else:
                print("[DMX] audio_set_device: 'device' mancante")
        elif action == "audio_rescan_devices":
            _scan_audio_devices()
        else:
            fx = _fixture_for(cmd)
            if fx is None:
                _publish_status()
                return
            if action == "set_palette":
                color = _resolve_color(cmd)
                if color is None:
                    print(f"[DMX] set_palette: palette sconosciuta {cmd.get('palette')!r}")
                else:
                    _timeline_stop(fx)
                    _set_target(fx, color, cmd.get("fade", MANUAL_FADE_DEFAULT_S), palette_name=cmd.get("palette"))
            elif action == "set_rgb":
                color = _resolve_color(cmd)
                if color is None:
                    print(f"[DMX] set_rgb: payload non valido {cmd}")
                else:
                    _timeline_stop(fx)
                    _set_target(fx, color, cmd.get("fade", MANUAL_FADE_DEFAULT_S), palette_name=None)
            elif action == "blackout":
                _timeline_stop(fx)
                _set_target(fx, [0, 0, 0], 0.0, palette_name=None)
                fx.forced_off = True
            elif action == "set_brightness":
                try:
                    with _lock:
                        fx.brightness = max(0.0, min(1.0, float(cmd.get("value", 1.0))))
                except (TypeError, ValueError):
                    pass
            elif action == "timeline_set":
                steps = cmd.get("steps")
                if isinstance(steps, list) and steps:
                    with _lock:
                        fx.timeline_steps = steps
                        fx.timeline_loop = bool(cmd.get("loop", True))
                        fx.current_timeline_name = None   # non è (più) un preset noto
                    print(f"[DMX] {fx.id}: Timeline impostata: {len(steps)} step, loop={fx.timeline_loop}")
                else:
                    print("[DMX] timeline_set: 'steps' mancante o vuoto")
            elif action == "timeline_start":
                _timeline_start(fx)
            elif action == "timeline_stop":
                _timeline_stop(fx)
            elif action == "timeline_load":
                name = cmd.get("name", "")
                if not _timeline_load(fx, name):
                    print(f"[DMX] timeline_load: preset sconosciuto {name!r} (disponibili: {', '.join(_timelines)})")
            elif action == "audio_reactive_start":
                fx.audio_reactive = True
                _start_audio()
            elif action == "audio_reactive_stop":
                fx.audio_reactive = False
                _stop_audio_if_unused()
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
# Serve web/dmx-touch.html E web/dmx-editor.html (copie in www/, vedi nota
# sotto) direttamente da questo Pi, cosi' il kiosk — e il link "✏️" verso
# l'editor dentro dmx-touch.html — non dipendono da OPS/Node-RED per il
# semplice HTML/JS (2026-10-05: prima solo dmx-touch.html) -- resta
# comunque una dipendenza reale dal broker MQTT di Core (192.168.1.142:9001,
# hardcoded nella pagina) per il controllo vero, ma Core e' molto piu'
# stabile di OPS/Node-RED in questo progetto (vedi pi/CLAUDE.md e il
# changelog TD4Gaia per i precedenti di OPS giu').
# www/ e' una COPIA (dmx-touch.html + dmx-editor.html + vendor/mqtt.min.js):
# tenerla allineata a web/dmx-touch.html, web/dmx-editor.html e
# web/vendor/mqtt.min.js a mano se quelle pagine cambiano, stessa
# convenzione di duplicazione gia' in uso per ota.py fra i moduli Pi (vedi
# pi/CLAUDE.md).
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
    _load_fixtures()
    _load_palettes()
    _load_timelines()
    _load_audio_tune()
    _scan_audio_devices()
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

    global _audio_capture_on
    _audio_capture_on = False
    _artnet.close()
    _mqtt.publish(f"gaia/dmx/{_current_room}/status", "", retain=True)
    print("[DMX] Terminato.")


if __name__ == "__main__":
    main()
