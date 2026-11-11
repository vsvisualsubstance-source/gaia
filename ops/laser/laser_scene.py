"""
Scene laser interne al gateway (modalita' "scene"): contenuto senza
sorgenti esterne, scelto dalla Plancia (live o dalla timeline laser).

Una scena arriva gia' vettoriale dalla Plancia (template o SVG importato,
convertiti nel browser) e il gateway la anima a ogni frame:

  {"id": "spirale", "name": "Spirale",
   "strokes": [{"pts": [[x, y], ...], "closed": bool, "rgb": [r, g, b] | null}],
   "color": {"mode": "fixed"|"cycle"|"palette"|"stroke", "rgb": [r, g, b],
             "palette": [[r, g, b], ...], "rate": Hz},
   "anim":  {"rotate": gradi/s, "rotate_y": gradi/s (attorno all'asse verticale), "scale": 0..1, "pulse": 0..1, "pulse_hz": Hz,
             "pulse_shape": forma, "swing": gradi, "swing_hz": Hz, "swing_shape": forma,
             "orbit": 0..1, "orbit_hz": Hz, "draw_hz": Hz (0 = figura intera)},
   "tempo": {"sync": bool, "bpm": BPM di riferimento},
   "frames": [{"strokes": [...]}, ...], "frame_fps": fps     (facoltativi: animazione, es. da ILDA)
   "audio": {"amount": 0..1, "to": "scale"|"brightness"}}

x, y in -1..1 (y in alto), colori 0..1. Forme (pulsazione e oscillazione della
rotazione, idee di Copilot 2/11): sine, triangle, saw, square, ease (avanti e
indietro con accelerazione). "tempo.sync": tutte le velocita' scalano con il
BPM dello show (bpm / tempo.bpm): l'orologio della scena lo fa il gateway. L'audio viene dal controller
attraverso i meter dei rig di DMX Master (dmx_rigs: level 0..1 e kick).
La stessa matematica e' in plancia/src/99-laser-scenes.js per l'anteprima.
"""
import colorsys
import math

PERSPECTIVE = 0.25     # rotazione Y: il lato che si avvicina si allarga un po' (0 = proiezione piatta)


def spin_y(x, y, c, s):
    """Rotazione attorno all'asse verticale (c, s = cos, sin dell'angolo): la figura gira come una
    moneta, con un filo di prospettiva. A 90 gradi e' di taglio (una riga verticale)."""
    f = 1.0 / (1.0 - PERSPECTIVE * x * s)
    return x * c * f, y * f

MAX_POINTS = 2000      # punti di tutta la scena (come arrivano, prima dell'interpolazione)
MAX_FRAMES = 120       # animazioni (ILDA): frame al massimo
MAX_FRAME_POINTS = 12000   # punti di tutti i frame insieme (la scena sta nel layout condiviso)
COLOR_MODES = ("fixed", "cycle", "palette", "stroke")
WAVES = ("sine", "triangle", "saw", "square", "ease")


def wave(x, shape="sine"):
    """Onda -1..1 di periodo 1; "sine" = sin(2 pi x) come prima delle forme."""
    p = x - math.floor(x)
    if shape == "triangle":
        return 4 * abs(p - 0.5) - 1          # +1 a inizio giro, -1 a meta'
    if shape == "saw":
        return 2 * p - 1
    if shape == "square":
        return 1.0 if p < 0.5 else -1.0
    if shape == "ease":
        u = p * 2 if p < 0.5 else 2 - p * 2
        e = 2 * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 2 / 2
        return 2 * e - 1
    return math.sin(2 * math.pi * x)


def tempo_rate(sc, bpm):
    """Quanto corre l'orologio della scena: 1, o bpm / bpm di riferimento se a tempo."""
    tp = sc.get("tempo") or {}
    if not tp.get("sync") or not bpm:
        return 1.0
    return max(0.1, min(10.0, float(bpm) / tp["bpm"]))


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


def _clean_strokes(raw, limit):
    strokes, total = [], 0
    for st in raw or []:
        if not isinstance(st, dict):
            continue
        pts = []
        for p in st.get("pts") or []:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append([_num(p[0], -1, 1, 0.0), _num(p[1], -1, 1, 0.0)])
        if not pts or total + len(pts) > limit:
            continue
        total += len(pts)
        strokes.append({"pts": pts, "closed": bool(st.get("closed")),
                        "rgb": _rgb(st["rgb"]) if st.get("rgb") else None})
    return strokes, total


def clean_scene(s):
    """Valida e limita una scena arrivata via MQTT; ValueError se inservibile."""
    if not isinstance(s, dict):
        raise ValueError("scena non valida")
    frames, budget = [], MAX_FRAME_POINTS
    for f in (s.get("frames") or [])[:MAX_FRAMES]:
        st, n = _clean_strokes((f or {}).get("strokes") if isinstance(f, dict) else None, min(MAX_POINTS, budget))
        if st:
            frames.append({"strokes": st})
            budget -= n
        if budget <= 0:
            break
    strokes = frames[0]["strokes"] if frames else _clean_strokes(s.get("strokes"), MAX_POINTS)[0]
    if not strokes:
        raise ValueError("scena senza forme")
    c, a, au = s.get("color") or {}, s.get("anim") or {}, s.get("audio") or {}
    pal = [_rgb(x) for x in (c.get("palette") or []) if isinstance(x, (list, tuple))][:16]
    return {
        "id": str(s.get("id") or "")[:64], "name": str(s.get("name") or "Scena")[:64], "strokes": strokes,
        "color": {"mode": c.get("mode") if c.get("mode") in COLOR_MODES else "fixed",
                  "rgb": _rgb(c.get("rgb")), "palette": pal or [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                  "rate": _num(c.get("rate"), 0, 10, 0.2)},
        "anim": {"rotate": _num(a.get("rotate"), -720, 720, 0), "rotate_y": _num(a.get("rotate_y"), -720, 720, 0), "scale": _num(a.get("scale"), 0.05, 1, 0.8),
                 "pulse": _num(a.get("pulse"), 0, 1, 0), "pulse_hz": _num(a.get("pulse_hz"), 0, 10, 0.5),
                 "orbit": _num(a.get("orbit"), 0, 1, 0), "orbit_hz": _num(a.get("orbit_hz"), 0, 5, 0.2),
                 "draw_hz": _num(a.get("draw_hz"), 0, 5, 0),
                 "pulse_shape": a.get("pulse_shape") if a.get("pulse_shape") in WAVES else "sine",
                 "swing": _num(a.get("swing"), 0, 180, 0), "swing_hz": _num(a.get("swing_hz"), 0, 10, 0.25),
                 "swing_shape": a.get("swing_shape") if a.get("swing_shape") in WAVES else "sine"},
        "tempo": {"sync": bool((s.get("tempo") or {}).get("sync")), "bpm": _num((s.get("tempo") or {}).get("bpm"), 40, 300, 120)},
        **({"frames": frames, "frame_fps": _num(s.get("frame_fps"), 1, 60, 25)} if len(frames) > 1 else {}),
        "audio": {"amount": _num(au.get("amount"), 0, 1, 0),
                  "to": au.get("to") if au.get("to") in ("scale", "brightness") else "scale"},
    }


def _stroke_rgb(sc, i, t, strokes=None):
    c = sc["color"]
    if c["mode"] == "cycle":
        return list(colorsys.hsv_to_rgb((t * c["rate"] + i * 0.12) % 1.0, 1.0, 1.0))
    if c["mode"] == "palette":
        pal = c["palette"]
        return pal[(int(t * c["rate"] * len(pal)) + i) % len(pal)]
    if c["mode"] == "stroke":
        return (strokes or sc["strokes"])[i]["rgb"] or c["rgb"]
    return c["rgb"]


def animate(sc, t, level=0.0, kick=0.0):
    """Punti (x, y, r, g, b) del frame al tempo t (s). level 0..1 = audio,
    kick 0..1 = lampo del colpo (decade). Colori 0..255 per laser_render."""
    a, au = sc["anim"], sc["audio"]
    s = a["scale"] * (1 - a["pulse"] * 0.5 + a["pulse"] * 0.5 * wave(a["pulse_hz"] * t, a.get("pulse_shape", "sine")))
    bright = 1.0
    react = min(1.0, level + 0.5 * kick) * au["amount"]
    if au["to"] == "scale":
        s *= 1 + 0.6 * react
    else:
        bright = (1 - au["amount"]) + react
    ang = math.radians(a["rotate"] * t + a.get("swing", 0) * wave(a.get("swing_hz", 0) * t, a.get("swing_shape", "sine")))
    ca, sa = math.cos(ang), math.sin(ang)
    ay = math.radians(a.get("rotate_y", 0) * t)
    cy, sy = math.cos(ay), math.sin(ay)
    ox = a["orbit"] * 0.5 * math.cos(2 * math.pi * a["orbit_hz"] * t)
    oy = a["orbit"] * 0.5 * math.sin(2 * math.pi * a["orbit_hz"] * t)
    strokes = sc["strokes"]
    if sc.get("frames"):                    # animazione: il frame del momento (a velocita' frame_fps)
        strokes = sc["frames"][int(t * sc["frame_fps"]) % len(sc["frames"])]["strokes"]
    total = sum(len(st["pts"]) + (1 if st["closed"] else 0) for st in strokes)
    budget = total if a["draw_hz"] <= 0 else max(2, int(total * ((t * a["draw_hz"]) % 1.0)))
    out = []
    for i, st in enumerate(strokes):
        if budget <= 0:
            break
        r, g, b = (max(0, min(255, int(v * 255 * bright))) for v in _stroke_rgb(sc, i, t, strokes))
        pts = st["pts"] + ([st["pts"][0]] if st["closed"] else [])
        pts = pts[:budget]
        budget -= len(pts)
        for j, (x, y) in enumerate(pts):
            if ay:
                x, y = spin_y(x, y, cy, sy)
            px = (x * ca - y * sa) * s + ox
            py = (x * sa + y * ca) * s + oy
            if j == 0:
                out.append((px, py, 0, 0, 0))       # attacco al buio
            out.append((px, py, r, g, b))
    return out


# ---------------------------------------------------------------- effetti dal vivo
# Sopra alla scena (come gli effetti di Liberation), per tutti i cubi in modalita'
# scene: rotazione aggiunta (nel piano e attorno all'asse verticale), zoom, onda, tinta e luminosita'. La zona di sicurezza
# si applica dopo (laser_render), quindi nemmeno lo zoom ne esce.
# tint_h/tint_s: colore scelto sulla ruota; tint_s 0 = colori della scena, 1 = tutto in quel colore
FX_DEFAULTS = {"rotate": 0.0, "rotate_y": 0.0, "zoom": 1.0, "hue": 0.0, "wave": 0.0, "wave_hz": 1.0, "bright": 1.0, "tint_h": 0.0, "tint_s": 0.0}
FX_LIMITS = {"rotate": (-720, 720), "rotate_y": (-720, 720), "zoom": (0.2, 2.0), "hue": (0, 1), "wave": (0, 1), "wave_hz": (0.05, 8), "bright": (0, 1), "tint_h": (0, 1), "tint_s": (0, 1)}


def clean_fx(values, fx=None):
    """Nuovi valori degli effetti dentro i limiti; chiavi sconosciute ignorate."""
    out = dict(fx or FX_DEFAULTS)
    for k, v in (values or {}).items():
        if k in FX_LIMITS:
            out[k] = _num(v, *FX_LIMITS[k], FX_DEFAULTS[k])
    return out


def apply_fx(pts, fx, t, angle_deg, angle_y_deg=0.0):
    """pts (x, y, r, g, b) -> pts con gli effetti; angle_deg = rotazione accumulata nel piano,
    angle_y_deg = attorno all'asse verticale (gradi)."""
    if fx == FX_DEFAULTS and not angle_deg and not angle_y_deg:
        return pts
    a = math.radians(angle_deg)
    ca, sa, z = math.cos(a), math.sin(a), fx["zoom"]
    ay = math.radians(angle_y_deg)
    cy, sy = math.cos(ay), math.sin(ay)
    wave, wh, hue, br = fx["wave"], fx["wave_hz"], fx["hue"], fx["bright"]
    ts = fx["tint_s"]
    tint = colorsys.hsv_to_rgb(fx["tint_h"], 1.0, 1.0)
    out = []
    for x, y, r, g, b in pts:
        if ay:
            x, y = spin_y(x, y, cy, sy)
        px, py = (x * ca - y * sa) * z, (x * sa + y * ca) * z
        if wave:
            px += wave * 0.25 * math.sin(2 * math.pi * (wh * t + py))
        if (r or g or b) and (hue or br < 1 or ts):
            if hue:
                h, sv, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                r, g, b = (int(c * 255) for c in colorsys.hsv_to_rgb((h + hue) % 1.0, sv, v))
            if ts:                 # il colore cambia, la luminosita' del punto no
                m = max(r, g, b)
                r, g, b = int(r + (tint[0] * m - r) * ts), int(g + (tint[1] * m - g) * ts), int(b + (tint[2] * m - b) * ts)
            r, g, b = int(r * br), int(g * br), int(b * br)
        out.append((px, py, r, g, b))
    return out

