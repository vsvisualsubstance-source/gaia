"""
Da frame GLF (polilinea normalizzata) a campioni DAC per un cubo.

Qui sta la sicurezza che sul LaserCube WiFi il cubo non fa da solo (in
modalita' LaserOS la sua Safety Zone non si applica):
- zona di sicurezza per cubo: ogni punto e' riportato dentro la zona e,
  se era fuori, spento -- il fascio non esce mai dal rettangolo;
- intensita' = colore x master x tetto massimo del cubo;
- raggio quasi fermo (figura piu' piccola di STATIC_SPAN) attenuato a
  STATIC_GAIN: mai un punto statico a piena potenza (spec par. 8);
- passi interpolati: i galvo non seguono salti grandi, e gli spostamenti
  a raggio spento hanno una pausa al buio prima di riaccendere.

Regolazioni d'uscita (come Liberation): rotazione e trapezio per il
montaggio, maschere (rettangoli vietati dentro la zona, il fascio si
spegne), calibrazione colore (guadagno per canale, soglia minima dei
diodi) e blank shift (il colore in ritardo di qualche campione rispetto
alla posizione, contro le code). Zona e maschere si controllano DOPO
tutte le trasformazioni.
"""
import math

from laser_proto import DAC_MAX, pack_sample

LIT_STEP = 0.012      # passo massimo a raggio acceso (spazio -1..1, ~25 punti DAC)
BLANK_STEP = 0.05     # passo massimo negli spostamenti al buio
PRE_DWELL = 3         # punti al buio fermi prima di riaccendere
CORNER_DWELL = 1      # punti ripetuti sugli spigoli vivi
CORNER_COS = math.cos(math.radians(45))
STATIC_SPAN = 0.04
STATIC_GAIN = 0.15
# Velocita' degli specchi costante (2026-11-09): col passo fisso, alzando i pps gli specchi
# andavano piu' veloci in proporzione, e gli spigoli non riuscivano a seguire. Sopra 9 kpps
# il passo si stringe; sotto resta LIT_STEP/BLANK_STEP, come prima. Riferimento: 9 kpps, il
# valore a cui l'operatore vede la griglia pulita sul cubo vero.
MAX_LIT_SPEED = 108.0    # spazio -1..1 al secondo a raggio acceso (= LIT_STEP a 9 kpps)
MAX_BLANK_SPEED = 450.0  # al buio (= BLANK_STEP a 9 kpps)
CORNER_TIME = 0.00033     # secondi di sosta sugli spigoli vivi
PRE_TIME = 0.00033       # secondi al buio fermi prima di riaccendere
MIN_REFRESH = 25      # sotto questo ridisegno al secondo il frame viene sfoltito

DEFAULTS = {
    "zone": [-1.0, -1.0, 1.0, 1.0],   # x0, y0, x1, y1
    "scale": 1.0,
    "offset_x": 0.0,
    "offset_y": 0.0,
    "flip_x": False,
    "flip_y": False,
    "master": 1.0,
    "max_intensity": 0.5,
    "rotate": 0.0,                    # gradi, montaggio del cubo
    "keystone_x": 0.0,                # trapezio: larghezza diversa in alto e in basso
    "keystone_y": 0.0,                #           altezza diversa a sinistra e a destra
    "masks": [],                      # [[x0, y0, x1, y1], ...] spazio d'uscita, fascio spento dentro
    "gain_r": 1.0, "gain_g": 1.0, "gain_b": 1.0,
    "color_min": 0.0,                 # soglia dei diodi: un canale acceso parte da qui
    "blank_shift": 0,                 # campioni di ritardo del colore
}
MAX_MASKS = 8


def render(points, cfg, pps):
    """points: [(x, y, r, g, b)] -> bytes di campioni (10 byte l'uno), oppure
    None se il frame e' vuoto o tutto spento (niente da proiettare)."""
    c = {**DEFAULTS, **(cfg or {})}
    pts = _prepare(points, c)
    if not pts or not any(p[2] or p[3] or p[4] for p in pts):
        return None
    budget = max(64, int(pps / MIN_REFRESH))
    k = 1.0
    lit_step = min(LIT_STEP, MAX_LIT_SPEED / max(1, pps))
    blank_step = min(BLANK_STEP, MAX_BLANK_SPEED / max(1, pps))
    corner = max(CORNER_DWELL, round(CORNER_TIME * pps))
    pre = max(PRE_DWELL, round(PRE_TIME * pps))
    for _ in range(10):        # le soste non si accorciano col passo: servono piu' giri
        path = _interpolate(pts, lit_step * k, blank_step * k, corner, pre)
        if len(path) <= budget:
            break
        k *= 1.03 * len(path) / budget
    else:
        path = path[:budget - 1] + [(path[0][0], path[0][1], 0, 0, 0)]
    path = _blank_shift(path, int(c["blank_shift"]))
    return b"".join(_dac(p) for p in path)


def _blank_shift(path, n):
    """Colore di ogni campione preso da n campioni prima (il frame gira in ciclo)."""
    n = max(0, min(10, n))
    if not n or len(path) <= n:
        return path
    return [(p[0], p[1], *path[i - n][2:]) for i, p in enumerate(path)]


def _prepare(points, c):
    x0, y0, x1, y1 = c["zone"]
    x0, x1 = sorted((max(-1.0, min(1.0, x0)), max(-1.0, min(1.0, x1))))
    y0, y1 = sorted((max(-1.0, min(1.0, y0)), max(-1.0, min(1.0, y1))))
    gain = max(0.0, min(1.0, c["master"])) * max(0.0, min(1.0, c["max_intensity"]))
    sx = -c["scale"] if c["flip_x"] else c["scale"]
    sy = -c["scale"] if c["flip_y"] else c["scale"]
    a = math.radians(c["rotate"])
    ca, sa = math.cos(a), math.sin(a)
    kx, ky = c["keystone_x"], c["keystone_y"]
    masks = [m for m in (c["masks"] or [])[:MAX_MASKS] if len(m) == 4]
    gains = [max(0.0, min(1.0, c[k])) for k in ("gain_r", "gain_g", "gain_b")]
    cmin = max(0.0, min(0.3, c["color_min"]))
    out = []
    for x, y, r, g, b in points:
        px, py = x * sx, y * sy
        px, py = px * ca - py * sa, px * sa + py * ca
        px, py = px * (1 + kx * py), py * (1 + ky * px)
        tx, ty = px + c["offset_x"], py + c["offset_y"]
        inside = x0 <= tx <= x1 and y0 <= ty <= y1 and not any(
            min(m[0], m[2]) <= tx <= max(m[0], m[2]) and min(m[1], m[3]) <= ty <= max(m[1], m[3]) for m in masks)
        tx, ty = min(max(tx, x0), x1), min(max(ty, y0), y1)
        if inside and gain > 0:
            r, g, b = (0 if v <= 0 else (cmin + v / 255 * (1 - cmin)) * 255 * k for v, k in zip((r, g, b), gains))
            out.append((tx, ty, r * gain, g * gain, b * gain))
        else:
            out.append((tx, ty, 0, 0, 0))
    lit = [p for p in out if p[2] or p[3] or p[4]]
    if lit:
        span = max(max(p[0] for p in lit) - min(p[0] for p in lit),
                   max(p[1] for p in lit) - min(p[1] for p in lit))
        if span < STATIC_SPAN:
            out = [(p[0], p[1], p[2] * STATIC_GAIN, p[3] * STATIC_GAIN, p[4] * STATIC_GAIN)
                   for p in out]
    return out


def _lit(p):
    return p[2] > 0 or p[3] > 0 or p[4] > 0


def _interpolate(pts, lit_step, blank_step, corner=CORNER_DWELL, pre=PRE_DWELL):
    """Percorso chiuso: dall'ultimo punto torna al primo al buio, cosi' il
    frame ripetuto in ciclo resta continuo."""
    path = [(pts[0][0], pts[0][1], 0, 0, 0)] * pre
    prev = path[-1]
    seq = pts + [(pts[0][0], pts[0][1], 0, 0, 0)]
    for i, q in enumerate(seq):
        lit = _lit(q)
        d = math.hypot(q[0] - prev[0], q[1] - prev[1])
        n = max(1, math.ceil(d / (lit_step if lit else blank_step)))
        if lit and not _lit(prev) and d > 0:
            # spostamento al buio fino all'attacco, pausa, poi si accende
            n2 = max(1, math.ceil(d / blank_step))
            for j in range(1, n2 + 1):
                t = j / n2
                path.append((prev[0] + (q[0] - prev[0]) * t, prev[1] + (q[1] - prev[1]) * t, 0, 0, 0))
            path.extend([(q[0], q[1], 0, 0, 0)] * pre)
            path.append(q)
        else:
            for j in range(1, n + 1):
                t = j / n
                path.append((prev[0] + (q[0] - prev[0]) * t, prev[1] + (q[1] - prev[1]) * t,
                             q[2], q[3], q[4]))
        if lit and i + 1 < len(seq) and _sharp(prev, q, seq[i + 1]):
            path.extend([q] * corner)
        prev = q
    return path


def _sharp(a, b, c):
    ux, uy, vx, vy = b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]
    nu, nv = math.hypot(ux, uy), math.hypot(vx, vy)
    if nu == 0 or nv == 0:
        return False
    return (ux * vx + uy * vy) / (nu * nv) < CORNER_COS


def _dac(p):
    x = int(round((p[0] + 1) * 0.5 * DAC_MAX))
    y = int(round((p[1] + 1) * 0.5 * DAC_MAX))
    k = DAC_MAX / 255.0
    return pack_sample(min(max(x, 0), DAC_MAX), min(max(y, 0), DAC_MAX),
                       min(DAC_MAX, int(p[2] * k)), min(DAC_MAX, int(p[3] * k)),
                       min(DAC_MAX, int(p[4] * k)))


def circle(radius=0.5, n=600, rgb=(255, 255, 255)):
    """Cerchio di prova: figura sempre in movimento, come il mittente di
    riferimento della specifica (mai un punto fermo)."""
    return [(radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n), *rgb)
            for i in range(n)]
