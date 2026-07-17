#!/usr/bin/env python3
"""
GAIA Screen — superficie asemica per display DSI (v4 + mood v2 + herbarium).

Il piccolo schermo del Pi "vive": in quiete respira il sigillo della propria
stanza; quando Gaia parla nella stanza scrive i glifi in ciano (banda alta),
quando l'umano parla scrive il comando in blu (banda bassa). Stesso engine
deterministico della Welcome (parità JS/Python verificata).

Herbarium: quando le piante suonano, ogni nota diventa una parola del
solfeggio (do, dodiesis, re…) e la pianta "scrive" la pagina in verde foglia
— alfabeto deterministico di 12 glifi. Le note arrivano via UDP localhost
da gaia-herbarium: nel bosco (nessun Core, nessun broker) funziona uguale.

Rendering: pygame su KMSDRM (framebuffer, niente X/Wayland) — ~30MB, adatto
a girare accanto a yolo/mediapipe/voice.

Topic: gaia/voice/tts/{stanza} (out) · gaia/voice/command/{stanza} (in)
       gaia/mediapipe/pose (v3: gesture → glifi) · gaia/brain/state (v2: mood)
"""
import json
import math
import os
import signal
import socket
import threading
import time

os.environ.setdefault("SDL_VIDEODRIVER", "kmsdrm")
os.environ.setdefault("SDL_NOMOUSE", "1")

import pygame
import paho.mqtt.client as mqtt

import config
from asemic_engine import glyph_for, sample_stroke

INK_IN = (88, 166, 255)          # umano: sempre blu (identità, non stato)

# v2: l'inchiostro di Gaia segue il mood (da gaia/brain/state). Stessi valori
# di web/asemic.js MOOD_INKS / palette Arte Viva — tenere allineati.
MOOD_INKS = {
    "neutra":    ((0, 255, 204),   1.0),
    "calm":      ((80, 230, 190),  0.8),
    "stress":    ((255, 115, 85),  1.35),
    "social":    ((255, 195, 100), 1.15),
    "curiosity": ((190, 135, 255), 1.05),
}
MOOD_ALIAS = {"serena": "calm", "sofferente": "stress", "instabile": "stress",
              "viva": "social", "stabile": "neutra", "neutrale": "neutra"}
_mood = {"ink": [0.0, 255.0, 204.0], "target": None, "speed": 1.0, "speed_t": 1.0}


def ink_out() -> tuple:
    return tuple(int(c) for c in _mood["ink"])


def _lerp_mood():
    t = _mood["target"]
    if t is None:
        return
    k = 0.04
    for i in range(3):
        _mood["ink"][i] += (t[i] - _mood["ink"][i]) * k
    _mood["speed"] += (_mood["speed_t"] - _mood["speed"]) * k
    if all(abs(_mood["ink"][i] - t[i]) < 1 for i in range(3)):
        _mood["ink"] = [float(c) for c in t]
        _mood["speed"] = _mood["speed_t"]
        _mood["target"] = None
FPS = 30
CELL = config.CELL
WRITE_MS_PER_GLYPH = 260
HOLD_MS = 10000
FADE_MS = 5000
MAX_SENTENCES = 3

_running = True
_sentences: list = []


def _shutdown(sig, frame):
    global _running
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


# ── Layout frase (variante compatta per 800×480) ─────────────────────────────
def make_sentence(text: str, direction: str, W: int, H: int) -> dict | None:
    words = text.strip().split()[:18]
    if not words:
        return None
    max_w = W * 0.92
    lines, line_w = [[]], 0.0
    for w in words:
        g = glyph_for(w)
        adv = CELL * g["wide"] * 0.82 + CELL * 0.22
        if line_w + adv > max_w and lines[-1]:
            if len(lines) == 2:
                break
            lines.append([])
            line_w = 0.0
        lines[-1].append((w, g, adv))
        line_w += adv
    y0 = H * (0.16 if direction == "out" else 0.38 if direction == "rune" else 0.60)
    items, order = [], 0
    for li, line in enumerate(lines):
        tot = sum(a for _, _, a in line)
        x = (W - tot) / 2
        for w, g, adv in line:
            items.append({"g": g, "x": x, "y": y0 + li * CELL * 1.5, "order": order})
            order += 1
            x += adv
    return {"items": items, "dir": direction, "born": time.time() * 1000,
            "write_ms": (WRITE_MS_PER_GLYPH * len(items) + 400) / _mood["speed"]}


def draw_glyph(surface, item, reveal: float, alpha: float, ink, cell: float = None):
    g = item["g"]
    cell = cell or CELL
    w, h = cell * g["wide"], cell
    ox, oy = item["x"], item["y"]
    col = tuple(int(c * alpha) for c in ink)     # sfondo nero: alpha = scala colore
    n = len(g["strokes"])
    for si, st in enumerate(g["strokes"]):
        sp = max(0.0, min(1.0, reveal * n - si))
        if sp <= 0:
            continue
        pts = sample_stroke(st["pts"])
        upto = max(2, int(len(pts) * sp))
        seg = [(ox + px * w, oy + py * h) for px, py in pts[:upto]]
        pygame.draw.aalines(surface, col, False, seg)
        if sp >= 0.999:  # secondo passaggio = tratto più pieno
            pygame.draw.lines(surface, col, False, seg, 2)
    if g["dot"] and reveal >= 0.95:
        pygame.draw.circle(surface, col, (int(ox + g["dot"]["x"] * w), int(oy + g["dot"]["y"] * h)), 2)
    if g["bar"] and reveal >= 0.85:
        pygame.draw.line(surface, col, (ox + w * 0.12, oy + h * 1.06), (ox + w * 0.74, oy + h * 1.06), 1)


# ── MQTT ──────────────────────────────────────────────────────────────────────
_pending: list = []       # (text, dir) accodati dal thread MQTT


def _on_connect(client, userdata, flags, rc, properties=None):
    client.subscribe(f"gaia/voice/tts/{config.ROOM}")
    client.subscribe(f"gaia/voice/command/{config.ROOM}")
    client.subscribe("gaia/brain/state")     # v2: mood → inchiostro
    client.subscribe("gaia/mediapipe/pose")  # v3: gesture → glifi
    client.subscribe("gaia/rpg/levelup")     # v5: runa nuova in oro
    print(f"[Screen] MQTT connesso — stanza {config.ROOM}")


# v3: il gesto diventa parola scritta. Stesse parole di web/welcome.html.
GESTURE_WORDS = {"fist": "pugno", "point": "indice", "victory": "vittoria",
                 "three": "tre", "open_hand": "saluto"}
_gesture_last: dict = {}     # parola → ts ultimo disegno (cooldown 30s)


# ── RPG (v5): le rune — asset sbloccato → parola italiana → glifo in oro ─────
# Stessa mappa di web/welcome.html e dashboard: la runa è identica ovunque.
RUNE_WORDS = {"base_grid": "fondamenta", "ambient_particles_low": "polvere",
              "shield_dome": "scudo", "rune_circle": "cerchio",
              "glyph_trail": "sentiero", "crystal_garden": "giardino",
              "starfield": "stelle", "phoenix_core": "fenice"}
INK_RUNE = (255, 214, 90)


# ── Herbarium: le piante scrivono ─────────────────────────────────────────────
# nota MIDI → parola del solfeggio → glifo (alfabeto deterministico di 12 segni)
NOTE_WORDS = ["do", "dodiesis", "re", "rediesis", "mi", "fa", "fadiesis",
              "sol", "soldiesis", "la", "ladiesis", "si"]
INK_HERB = (120, 240, 110)           # verde foglia — distinto dal teal calm
HERB_FADE_MS = 14000
HERB_REVEAL_MS = 420
_herb_pending: list = []             # (note, velocity) dal thread UDP
_herb_glyphs: list = []              # {"g","x","y","cell","vel","born"}
_herb_cursor = {"x": None, "y": 0.0, "last": 0.0}


def _herb_udp_listener():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(("127.0.0.1", config.HERB_UDP_PORT))
    except OSError as e:
        print(f"[Screen] Herbarium UDP non disponibile: {e}")
        return
    print(f"[Screen] In ascolto note herbarium su udp:{config.HERB_UDP_PORT}")
    while True:
        try:
            data, _ = sock.recvfrom(512)
            n = json.loads(data)
            _herb_pending.append((int(n["note"]), int(n.get("velocity", 90))))
        except (ValueError, KeyError, TypeError):
            continue
        except OSError:
            return


def _herb_place(note: int, vel: int, W: int, H: int, now: float):
    """La pianta scrive: cursore che avanza e va a capo come su una pagina.
    Note gravi = segni più grandi; dopo 30s di silenzio riparte dall'alto."""
    word = NOTE_WORDS[note % 12]
    g = glyph_for(word)
    octave = max(0, min(8, note // 12 - 1))
    cell = CELL * (1.25 - octave * 0.07)
    cur = _herb_cursor
    if cur["x"] is None or now - cur["last"] > 30000:
        cur["x"], cur["y"] = W * 0.04, H * 0.08
    if now - cur["last"] > 5000:
        print(f"[Screen] Herbarium scrive: {word} (nota {note})")
    adv = cell * g["wide"] * 0.82 + cell * 0.25
    if cur["x"] + adv > W * 0.96:
        cur["x"] = W * 0.04
        cur["y"] += CELL * 1.6
        if cur["y"] > H * 0.86:
            cur["y"] = H * 0.08
    _herb_glyphs.append({"g": g, "x": cur["x"], "y": cur["y"], "cell": cell,
                         "vel": vel, "born": now})
    cur["x"] += adv
    cur["last"] = now


def _on_message(client, userdata, msg):
    if msg.topic == "gaia/rpg/levelup":
        try:
            p = json.loads(msg.payload)
        except ValueError:
            return
        word = RUNE_WORDS.get(p.get("asset") or "", "ascesa")
        _pending.append((word, "rune"))
        return
    if msg.topic == "gaia/mediapipe/pose":
        try:
            p = json.loads(msg.payload)
        except ValueError:
            return
        if p.get("camera") != config.ROOM:
            return
        word = GESTURE_WORDS.get(p.get("gesture") or "")
        if not word:
            return
        now = time.time()
        if now - _gesture_last.get(word, 0) < 30:
            return
        _gesture_last[word] = now
        _pending.append((word, "in"))
        return
    if msg.topic == "gaia/brain/state":
        try:
            mood = json.loads(msg.payload).get("mood") or "neutra"
        except ValueError:
            return
        key = MOOD_ALIAS.get(mood, mood if mood in MOOD_INKS else "neutra")
        ink, speed = MOOD_INKS[key]
        _mood["target"], _mood["speed_t"] = ink, speed
        return
    try:
        p = json.loads(msg.payload)
        text = (p.get("text") or "").strip()
    except ValueError:
        text = msg.payload.decode("utf8", "ignore").strip()
    if not text:
        return
    direction = "out" if "/tts/" in msg.topic else "in"
    _pending.append((text, direction))


def main():
    pygame.display.init()
    screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
    pygame.mouse.set_visible(False)
    W, H = screen.get_size()
    print(f"[Screen] Display {W}x{H} (driver {pygame.display.get_driver()})")

    # compatibile paho 1.x (python3-paho-mqtt di sistema) e 2.x
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id=f"gaia-screen-{config.DEVICE_ID}")
    except AttributeError:
        client = mqtt.Client(client_id=f"gaia-screen-{config.DEVICE_ID}")
    client.on_connect = _on_connect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=2, max_delay=30)
    client.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    client.loop_start()

    threading.Thread(target=_herb_udp_listener, daemon=True).start()

    sigil = glyph_for(config.ROOM)      # il "nome" della stanza come sigillo
    clock = pygame.time.Clock()

    while _running:
        now = time.time() * 1000
        _lerp_mood()

        while _pending:
            text, direction = _pending.pop(0)
            s = make_sentence(text, direction, W, H)
            if s:
                _sentences.append(s)
                del _sentences[:-MAX_SENTENCES]

        _sentences[:] = [s for s in _sentences
                         if now - s["born"] < s["write_ms"] + HOLD_MS + FADE_MS]

        while _herb_pending:
            note, vel = _herb_pending.pop(0)
            _herb_place(note, vel, W, H, now)
        _herb_glyphs[:] = [h for h in _herb_glyphs if now - h["born"] < HERB_FADE_MS]

        screen.fill((0, 0, 0))

        # sigillo della stanza che respira (sempre, più fioco se si scrive)
        t = now / 1000.0
        breath = 0.10 + 0.07 * (0.5 + 0.5 * math.sin(t * 0.6))
        if _sentences or _herb_glyphs:
            breath *= 0.4
        sig_cell = 140
        sw = sig_cell * sigil["wide"]
        sig_item = {"g": sigil, "x": (W - sw) / 2, "y": H / 2 - 70, "order": 0}
        draw_glyph(screen, sig_item, 1.0, breath, ink_out(), cell=sig_cell)

        # la pianta scrive: velocity = intensità dell'inchiostro
        for hgl in _herb_glyphs:
            age = now - hgl["born"]
            reveal = min(1.0, age / HERB_REVEAL_MS)
            alpha = 0.35 + 0.6 * min(1.0, hgl["vel"] / 110)
            if age > HERB_FADE_MS - 4000:
                alpha *= (HERB_FADE_MS - age) / 4000
            draw_glyph(screen, hgl, reveal, alpha, INK_HERB, cell=hgl["cell"])

        for s in _sentences:
            age = now - s["born"]
            phase = 1.0
            if age > s["write_ms"] + HOLD_MS:
                phase = max(0.0, 1 - (age - s["write_ms"] - HOLD_MS) / FADE_MS)
            ink = (INK_RUNE if s["dir"] == "rune"
                   else ink_out() if s["dir"] == "out" else INK_IN)
            base_alpha = 0.95 if s["dir"] in ("in", "rune") else 0.85
            per_glyph = s["write_ms"] / max(len(s["items"]), 1)
            for item in s["items"]:
                g_age = age - item["order"] * per_glyph
                if g_age <= 0:
                    continue
                reveal = min(1.0, g_age / (per_glyph * 1.6))
                draw_glyph(screen, item, reveal, base_alpha * phase, ink)

        pygame.display.flip()
        clock.tick(FPS)

    client.loop_stop()
    pygame.quit()
    print("[Screen] Terminato.")


if __name__ == "__main__":
    main()
