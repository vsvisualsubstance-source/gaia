"""
Vocabolario Asemico — porting Python dell'engine di riferimento
(/media/core/D/gaia-web/asemic.js). REGOLA D'ORO (docs/vocabolario-asemico.md):
il determinismo È la lingua — parola → FNV-1a → mulberry32 → glifo, identico
su ogni piattaforma. Questo file replica ESATTAMENTE la sequenza di chiamate
al PRNG della versione JS: qualsiasi modifica va fatta in coppia con asemic.js
e verificata col test di parità (tools/asemic_parity_test — vedi README).
"""


def fnv1a(text: str) -> int:
    h = 2166136261
    for ch in text.lower():
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def mulberry32(seed: int):
    state = seed & 0xFFFFFFFF

    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


_GLYPH_CACHE: dict = {}


def glyph_for(word: str) -> dict:
    """Stessa costruzione (e stesso ORDINE di chiamate rnd) di asemic.js."""
    key = word.lower()
    if key in _GLYPH_CACHE:
        return _GLYPH_CACHE[key]
    rnd = mulberry32(fnv1a(key))
    strokes = []
    n_strokes = min(5, 2 + len(key) // 3 + (1 if rnd() < 0.3 else 0))
    for _ in range(n_strokes):
        pts = []
        n_pts = 2 + int(rnd() * 3)
        x = 0.05 + rnd() * 0.30
        y = 0.18 + rnd() * 0.64
        for _i in range(n_pts):
            pts.append((x, y))
            x += 0.16 + rnd() * 0.34
            y = max(0.04, min(0.96, y + (rnd() - 0.5) * 0.75))
        length = 0.0
        for i in range(1, len(pts)):
            dx = pts[i][0] - pts[i - 1][0]
            dy = pts[i][1] - pts[i - 1][1]
            length += (dx * dx + dy * dy) ** 0.5
        strokes.append({"pts": pts, "len": length * 1.15})
    # ATTENZIONE all'ordine: in JS il ternario corto-circuita — le rnd() di
    # x/y del punto diacritico si consumano SOLO se il primo test passa.
    if rnd() < 0.28:
        dot = {"x": 0.2 + rnd() * 0.6, "y": 0.06 if rnd() < 0.5 else 0.97}
    else:
        dot = None
    glyph = {
        "strokes": strokes,
        "dot": dot,
        "bar": rnd() < 0.18,
        "wide": 0.75 + rnd() * 0.45,
    }
    _GLYPH_CACHE[key] = glyph
    return glyph


def sample_stroke(pts, steps_per_seg: int = 8):
    """Campiona la polilinea come in canvas: quadratiche verso i punti medi.
    Restituisce la lista di punti (normalizzati 0..1) pronti da scalare."""
    if len(pts) == 2:
        return [pts[0], pts[1]]
    out = [pts[0]]
    prev = pts[0]
    for i in range(1, len(pts) - 1):
        ctrl = pts[i]
        mid = ((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)
        for s in range(1, steps_per_seg + 1):
            t = s / steps_per_seg
            mt = 1 - t
            x = mt * mt * prev[0] + 2 * mt * t * ctrl[0] + t * t * mid[0]
            y = mt * mt * prev[1] + 2 * mt * t * ctrl[1] + t * t * mid[1]
            out.append((x, y))
        prev = mid
    out.append(pts[-1])
    return out
