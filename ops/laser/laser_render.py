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
    "zone_poly": [],                  # [[x, y], ...] (almeno 3): il fascio resta dentro questa forma
    "mask_polys": [],                 # [[[x, y], ...], ...]: forme dove il fascio si spegne
    "gain_r": 1.0, "gain_g": 1.0, "gain_b": 1.0,
    "color_min": 0.0,                 # soglia dei diodi: un canale acceso parte da qui
    "blank_shift": 0,                 # campioni di ritardo del colore
}
MAX_MASKS = 8
MAX_POLY_POINTS = 48


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
    zone_poly = [tuple(p[:2]) for p in (c["zone_poly"] or [])[:MAX_POLY_POINTS]]
    if len(zone_poly) < 3:
        zone_poly = None
    mask_polys = [[tuple(p[:2]) for p in m[:MAX_POLY_POINTS]] for m in (c["mask_polys"] or [])[:MAX_MASKS]]
    mask_polys = [m for m in mask_polys if len(m) >= 3]
    mask_rects = [[(min(m[0], m[2]), min(m[1], m[3])), (max(m[0], m[2]), min(m[1], m[3])),
                   (max(m[0], m[2]), max(m[1], m[3])), (min(m[0], m[2]), max(m[1], m[3]))] for m in masks]
    zone_rect = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    banned = [(_bbox(m), m) for m in mask_rects + mask_polys]
    groups = [(_bbox(p), _edges(p)) for p in [zone_rect] + mask_rects + mask_polys]
    zone_group = (_bbox(zone_poly), _edges(zone_poly)) if zone_poly else None

    def allowed(x, y):
        return (x0 <= x <= x1 and y0 <= y <= y1
                and (zone_poly is None or _in_poly(x, y, zone_poly))
                and not any(b[0] <= x <= b[2] and b[1] <= y <= b[3] and _in_poly(x, y, m) for b, m in banned))

    gains = [max(0.0, min(1.0, c[k])) for k in ("gain_r", "gain_g", "gain_b")]
    cmin = max(0.0, min(0.3, c["color_min"]))
    raw = []
    for x, y, r, g, b in points:
        px, py = x * sx, y * sy
        px, py = px * ca - py * sa, px * sa + py * ca
        px, py = px * (1 + kx * py), py * (1 + ky * px)
        tx, ty = px + c["offset_x"], py + c["offset_y"]
        if gain > 0 and (r > 0 or g > 0 or b > 0):
            r, g, b = (0 if v <= 0 else (cmin + v / 255 * (1 - cmin)) * 255 * k for v, k in zip((r, g, b), gains))
            raw.append((tx, ty, r * gain, g * gain, b * gain))
        else:
            raw.append((tx, ty, 0, 0, 0))
    # il controllo vale su tutta la linea, non solo sui suoi estremi (2026-11-09: una linea di
    # due punti attraversava accesa le maschere): si taglia esattamente sui bordi
    out = [(min(max(p[0], x0), x1), min(max(p[1], y0), y1), p[2], p[3], p[4]) for p in _cut(raw, groups, zone_group, allowed)]
    lit = [p for p in out if p[2] or p[3] or p[4]]
    if lit:
        span = max(max(p[0] for p in lit) - min(p[0] for p in lit),
                   max(p[1] for p in lit) - min(p[1] for p in lit))
        if span < STATIC_SPAN:
            out = [(p[0], p[1], p[2] * STATIC_GAIN, p[3] * STATIC_GAIN, p[4] * STATIC_GAIN)
                   for p in out]
    return out


def _edges(poly):
    return [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]


def _in_poly(x, y, poly):
    """Punto nel poligono (pari/dispari). Poligono degenere: fuori, cioe' spento per la zona."""
    inside = False
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside


def _bbox(poly):
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _crossings(a, b, groups):
    """Valori 0..1 lungo a-b dove la linea attraversa uno dei bordi. Le forme il cui riquadro
    non tocca la linea si saltano: e' esatto e fa risparmiare quasi tutto il calcolo."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    lox, hix = min(a[0], b[0]), max(a[0], b[0])
    loy, hiy = min(a[1], b[1]), max(a[1], b[1])
    out = []
    for box, edges in groups:
        if hix < box[0] or lox > box[2] or hiy < box[1] or loy > box[3]:
            continue
        for (px, py), (qx, qy) in edges:
            ex, ey = qx - px, qy - py
            den = dx * ey - dy * ex
            if abs(den) < 1e-12:
                continue
            t = ((px - a[0]) * ey - (py - a[1]) * ex) / den
            u = ((px - a[0]) * dy - (py - a[1]) * dx) / den
            if 1e-9 < t < 1 - 1e-9 and -1e-9 <= u <= 1 + 1e-9:
                out.append(t)
    return sorted(out)


ZONE_SHORT2 = 0.03 ** 2    # sotto questa lunghezza (1,5% del campo), con i due estremi dentro, la zona non si ricontrolla


def _cut(points, groups, zone_group, allowed):
    """Ogni tratto acceso viene spezzato sui bordi: ogni pezzo e' tutto dentro o tutto fuori.
    Un pezzo vietato diventa spostamento al buio; quello dopo riparte dal suo inizio."""
    out = []
    prev = None
    for p in points:
        if prev is None or not _lit(p):
            if _lit(p) and not allowed(p[0], p[1]):
                p = (p[0], p[1], 0, 0, 0)
            out.append(p)
            prev = p
            continue
        gs = groups
        if zone_group and not ((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2 < ZONE_SHORT2
                               and allowed(prev[0], prev[1]) and allowed(p[0], p[1])):
            gs = groups + [zone_group]
        ts = [0.0] + _crossings(prev, p, gs) + [1.0]
        for t0, t1 in zip(ts, ts[1:]):
            ax, ay = prev[0] + (p[0] - prev[0]) * t0, prev[1] + (p[1] - prev[1]) * t0
            bx, by = prev[0] + (p[0] - prev[0]) * t1, prev[1] + (p[1] - prev[1]) * t1
            if allowed((ax + bx) / 2, (ay + by) / 2):
                if not (out and _lit(out[-1])):
                    out.append((ax, ay, 0, 0, 0))
                    out.append((ax, ay, p[2], p[3], p[4]))
                out.append((bx, by, p[2], p[3], p[4]))
            else:
                out.append((bx, by, 0, 0, 0))
        prev = p
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
        if not lit and _lit(prev):
            # fine di una linea: si resta accesi fermi finche' gli specchi arrivano in fondo
            path.extend([prev] * corner)
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
