"""
GAIA Herbarium — motore musicale: converte note casuali del sensore in musica.

Il sensore (pianta, o il simulatore mentre aspettiamo la scheda) manda numeri
a caso — questo modulo li rende musicali:
  nota grezza -> aggancio alla scala (nota più vicina appartenente alla scala
  scelta) -> eventuale accordo (impilando gradi della scala, non semitoni
  fissi: resta diatonico qualsiasi sia la scala) -> preset che fissa scala,
  accordo, registro e dinamica in un colpo solo ("il tipo di musica").

Puro Python, senza MIDI/hardware: testabile da solo, e riusabile domani da
qualsiasi sorgente (MIDI reale, il simulatore, o in futuro OSC) — chi genera
le note grezze non deve sapere nulla di scale o accordi, chiama solo
MusicEngine.voice(nota, velocity).
"""
import time

# ── Scale (offset in semitoni dalla fondamentale, entro l'ottava) ───────────
SCALES = {
    "cromatica":          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],   # nessun vincolo
    "maggiore":           [0, 2, 4, 5, 7, 9, 11],
    "minore":             [0, 2, 3, 5, 7, 8, 10],
    "pentatonica_magg":   [0, 2, 4, 7, 9],
    "pentatonica_min":    [0, 3, 5, 7, 10],
    "blues":              [0, 3, 5, 6, 7, 10],
    "dorica":             [0, 2, 3, 5, 7, 9, 10],
    "misolidia":          [0, 2, 4, 5, 7, 9, 10],
}

# Fondamentali — stesse parole del solfeggio già usate per l'Herbarium sullo
# schermo (pi/screen NOTE_WORDS): un solo vocabolario per "nota" in tutto GAIA.
ROOT_NOTES = {
    "do": 0, "dodiesis": 1, "re": 2, "rediesis": 3, "mi": 4, "fa": 5,
    "fadiesis": 6, "sol": 7, "soldiesis": 8, "la": 9, "ladiesis": 10, "si": 11,
}

# ── Stili di accordo: gradi della SCALA da impilare (non semitoni fissi —
# così un accordo "1-3-5" resta diatonico sia in maggiore che in minore) ────
CHORD_STYLES = {
    "singola":  [0],           # solo la nota agganciata — comportamento di oggi
    "potenza":  [0, 4],        # "power chord": fondamentale + quinta (grado 4 = 5th diatonica)
    "triade":   [0, 2, 4],     # fondamentale-terza-quinta della scala
    "settima":  [0, 2, 4, 6],  # + settima
    "arpeggio": [0, 2, 4],     # come triade ma suonata in sequenza, non insieme
}
ARPEGGIO_STEP_MS = 70   # distanza tra le note di un arpeggio

# ── Preset: "il tipo di musica" — un solo nome sceglie tutto il resto ───────
PRESETS = {
    "pentatonica_calma": {
        "root": "do", "scale": "pentatonica_min", "chord": "singola",
        "octave_shift": 0, "velocity_scale": 0.80, "note_length_ms": 900,
    },
    "accordi_maggiori": {
        "root": "do", "scale": "maggiore", "chord": "triade",
        "octave_shift": 0, "velocity_scale": 0.90, "note_length_ms": 700,
    },
    "drone_modale": {
        "root": "re", "scale": "dorica", "chord": "potenza",
        "octave_shift": -12, "velocity_scale": 0.85, "note_length_ms": 1600,
    },
    "arpeggio_arioso": {
        "root": "fa", "scale": "maggiore", "chord": "arpeggio",
        "octave_shift": 12, "velocity_scale": 0.75, "note_length_ms": 500,
    },
    "blues_notturno": {
        "root": "la", "scale": "blues", "chord": "settima",
        "octave_shift": -12, "velocity_scale": 0.80, "note_length_ms": 1100,
    },
    "cromatico_libero": {
        "root": "do", "scale": "cromatica", "chord": "singola",
        "octave_shift": 0, "velocity_scale": 1.0, "note_length_ms": 500,
    },
}
DEFAULT_PRESET = "pentatonica_calma"   # scala pentatonica: qualsiasi nota
                                       # suona bene con qualsiasi altra — la
                                       # scelta più sicura per un input casuale


def _snap_to_scale(raw_note: int, root_pc: int, scale: list) -> int:
    """Nota MIDI più vicina appartenente a (fondamentale + scala), a parità
    di distanza sceglie verso il basso. Cerca semitono per semitono verso
    l'esterno finché non trova un membro della scala."""
    pc = (raw_note - root_pc) % 12
    if pc in scale:
        return raw_note
    for dist in range(1, 7):
        if (pc - dist) % 12 in scale:
            return raw_note - dist
        if (pc + dist) % 12 in scale:
            return raw_note + dist
    return raw_note   # non dovrebbe succedere (scala cromatica copre tutto)


def _degree_to_note(root_note: int, scale: list, degree: int) -> int:
    """Nota MIDI del grado N della scala, sopra root_note (grado 0 = radice
    stessa ottava, grado len(scale) = radice un'ottava sopra, ecc.)."""
    octave, idx = divmod(degree, len(scale))
    return root_note + octave * 12 + scale[idx]


class MusicEngine:
    def __init__(self, preset: str = DEFAULT_PRESET):
        self.preset_name = None
        self.cfg = {}
        self.set_preset(preset)

    def set_preset(self, name: str) -> bool:
        if name not in PRESETS:
            return False
        self.preset_name = name
        self.cfg = dict(PRESETS[name])
        return True

    def set_params(self, **kwargs):
        """Override puntuale (es. solo root o solo chord) senza cambiare preset."""
        for k in ("root", "scale", "chord", "octave_shift", "velocity_scale", "note_length_ms"):
            if k in kwargs and kwargs[k] is not None:
                self.cfg[k] = kwargs[k]

    def voice(self, raw_note: int, raw_velocity: int) -> list:
        """Nota grezza -> lista di {note, velocity, delay_ms, length_ms} da
        suonare. Una nota sola per 'singola'/'potenza' sbagliato? No: 'potenza'
        e 'triade'/'settima' restituiscono più note (accordo), 'arpeggio'
        restituisce le stesse note ma con delay crescente (strimpellate)."""
        root_pc = ROOT_NOTES.get(self.cfg["root"], 0)
        scale = SCALES.get(self.cfg["scale"], SCALES["cromatica"])
        degrees = CHORD_STYLES.get(self.cfg["chord"], [0])

        snapped = _snap_to_scale(raw_note, root_pc, scale)
        snapped += self.cfg.get("octave_shift", 0)
        vscale = self.cfg.get("velocity_scale", 1.0)
        length = self.cfg.get("note_length_ms", 700)
        arpeggio = self.cfg["chord"] == "arpeggio"

        notes = []
        for i, deg in enumerate(degrees):
            note = _degree_to_note(snapped, scale, deg)
            note = max(0, min(127, note))
            # ogni tono oltre la fondamentale un po' più piano: l'accordo
            # "respira" invece di essere un blocco piatto
            vel = raw_velocity * vscale * (1.0 if i == 0 else 0.82)
            vel = max(1, min(127, round(vel)))
            delay = i * ARPEGGIO_STEP_MS if arpeggio else 0
            notes.append({"note": note, "velocity": vel, "delay_ms": delay, "length_ms": length})
        return notes
