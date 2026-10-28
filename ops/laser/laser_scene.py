"""
Scene laser interne al gateway (modalita' "scene"): contenuto senza
sorgenti esterne, scelto dalla Plancia (live o dalla timeline laser).

Una scena arriva gia' vettoriale dalla Plancia (template o SVG importato,
convertiti nel browser) e il gateway la anima a ogni frame:

  {"id": "spirale", "name": "Spirale",
   "strokes": [{"pts": [[x, y], ...], "closed": bool, "rgb": [r, g, b] | null}],
   "color": {"mode": "fixed"|"cycle"|"palette"|"stroke", "rgb": [r, g, b],
             "palette": [[r, g, b], ...], "rate": Hz},
   "anim":  {"rotate": gradi/s, "scale": 0..1, "pulse": 0..1, "pulse_hz": Hz,
             "orbit": 0..1, "orbit_hz": Hz, "draw_hz": Hz (0 = figura intera)},
   "audio": {"amount": 0..1, "to": "scale"|"brightness"}}

x, y in -1..1 (y in alto), colori 0..1. L'audio viene dal controller
attraverso i meter dei rig di DMX Master (dmx_rigs: level 0..1 e kick).
La stessa matematica e' in plancia/src/99-laser-scenes.js per l'anteprima.
"""
import colorsys
import math

MAX_POINTS = 2000      # punti di tutta la scena (come arrivano, prima dell'interpolazione)
COLOR_MODES = ("fixed", "cycle", "palette", "stroke")


def _num(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if math.isnan(v):
        return default
    return max(lo, min(hi, v))


def _rgb(v, default=(1.0, 1.0, 1.0)):
    if not isinstance(v, (list, tuple)) or len(v) < 3:
        return list(default)
    return [_num(x, 0, 1, 1.0) for x in v[:3]]


def clean_scene(s):
    """Valida e limita una scena arrivata via MQTT; ValueError se inservibile."""
    if not isinstance(s, dict):
        raise ValueError("scena non valida")
    strokes, total = [], 0
    for st in s.get("strokes") or []:
        if not isinstance(st, dict):
            continue
        pts = []
        for p in st.get("pts") or []:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append([_num(p[0], -1, 1, 0.0), _num(p[1], -1, 1, 0.0)])
        if not pts or total + len(pts) > MAX_POINTS:
            continue
        total += len(pts)
        strokes.append({"pts": pts, "closed": bool(st.get("closed")),
                        "rgb": _rgb(st["rgb"]) if st.get("rgb") else None})
    if not strokes:
        raise ValueError("scena senza forme")
    c, a, au = s.get("color") or {}, s.get("anim") or {}, s.get("audio") or {}
    pal = [_rgb(x) for x in (c.get("palette") or []) if isinstance(x, (list, tuple))][:16]
    return {
        "id": str(s.get("id") or "")[:64], "name": str(s.get("name") or "Scena")[:64], "strokes": strokes,
        "color": {"mode": c.get("mode") if c.get("mode") in COLOR_MODES else "fixed",
                  "rgb": _rgb(c.get("rgb")), "palette": pal or [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                  "rate": _num(c.get("rate"), 0, 10, 0.2)},
        "anim": {"rotate": _num(a.get("rotate"), -720, 720, 0), "scale": _num(a.get("scale"), 0.05, 1, 0.8),
                 "pulse": _num(a.get("pulse"), 0, 1, 0), "pulse_hz": _num(a.get("pulse_hz"), 0, 10, 0.5),
                 "orbit": _num(a.get("orbit"), 0, 1, 0), "orbit_hz": _num(a.get("orbit_hz"), 0, 5, 0.2),
                 "draw_hz": _num(a.get("draw_hz"), 0, 5, 0)},
        "audio": {"amount": _num(au.get("amount"), 0, 1, 0),
                  "to": au.get("to") if au.get("to") in ("scale", "brightness") else "scale"},
    }


def _stroke_rgb(sc, i, t):
    c = sc["color"]
    if c["mode"] == "cycle":
        return list(colorsys.hsv_to_rgb((t * c["rate"] + i * 0.12) % 1.0, 1.0, 1.0))
    if c["mode"] == "palette":
        pal = c["palette"]
        return pal[(int(t * c["rate"] * len(pal)) + i) % len(pal)]
    if c["mode"] == "stroke":
        return sc["strokes"][i]["rgb"] or c["rgb"]
    return c["rgb"]


def animate(sc, t, level=0.0, kick=0.0):
    """Punti (x, y, r, g, b) del frame al tempo t (s). level 0..1 = audio,
    kick 0..1 = lampo del colpo (decade). Colori 0..255 per laser_render."""
    a, au = sc["anim"], sc["audio"]
    s = a["scale"] * (1 - a["pulse"] * 0.5 + a["pulse"] * 0.5 * math.sin(2 * math.pi * a["pulse_hz"] * t))
    bright = 1.0
    react = min(1.0, level + 0.5 * kick) * au["amount"]
    if au["to"] == "scale":
        s *= 1 + 0.6 * react
    else:
        bright = (1 - au["amount"]) + react
    ang = math.radians(a["rotate"] * t)
    ca, sa = math.cos(ang), math.sin(ang)
    ox = a["orbit"] * 0.5 * math.cos(2 * math.pi * a["orbit_hz"] * t)
    oy = a["orbit"] * 0.5 * math.sin(2 * math.pi * a["orbit_hz"] * t)
    total = sum(len(st["pts"]) + (1 if st["closed"] else 0) for st in sc["strokes"])
    budget = total if a["draw_hz"] <= 0 else max(2, int(total * ((t * a["draw_hz"]) % 1.0)))
    out = []
    for i, st in enumerate(sc["strokes"]):
        if budget <= 0:
            break
        r, g, b = (max(0, min(255, int(v * 255 * bright))) for v in _stroke_rgb(sc, i, t))
        pts = st["pts"] + ([st["pts"][0]] if st["closed"] else [])
        pts = pts[:budget]
        budget -= len(pts)
        for j, (x, y) in enumerate(pts):
            px = (x * ca - y * sa) * s + ox
            py = (x * sa + y * ca) * s + oy
            if j == 0:
                out.append((px, py, 0, 0, 0))       # attacco al buio
            out.append((px, py, r, g, b))
    return out
