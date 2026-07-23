"""
GAIA Herbarium — motore musicale: converte note casuali del sensore in musica.

V2 (2026-07-22): non più "un evento = una nota isolata" ma quattro livelli
come in un vero arrangiamento, ognuno sul PROPRIO canale MIDI (v2.3: un solo
synth SF2 General MIDI multi-timbrico ha sostituito Yoshimi — ogni canale
suona un patch diverso davvero, non solo registro/dinamica sullo stesso
timbro come nella v2.2):

  - MELODIA (canale 1): ogni evento del sensore muove un CURSORE melodico
    di pochi gradi della scala (non salta a caso) — resta sempre nella
    scala, si muove come una frase, non come rumore.
  - ACCORDO (canale 1): ogni tanto (non a ogni nota) la melodia si
    accompagna con un accordo pieno sotto — la punteggiatura armonica.
  - TAPPETO (canale 2): un accordo lungo tenuto, a orologio proprio (non
    agli eventi) — il fondo che non si ferma mai. Non un tremolo: su un
    synth con sostegno vero (v2.3) ribattere in fretta suona come un
    ticchettio, non come un fondo continuo.
  - PERCUSSIONI (canale 10, GM standard): un tocco a ritmo proprio
    (indipendente da quello, ora lento, del tappeto), più un accento
    quando scatta un accordo.

Il sensore manda numeri a caso — questo modulo li rende musicali: nota
grezza -> aggancio alla scala/passo melodico -> preset che fissa scala,
registri, accordo, ritmo e voce percussiva in un colpo solo ("il tipo di
musica"). Ogni evento porta il proprio "channel": main.py lo scrive così
com'è, tutta l'orchestrazione resta qui.
"""
import random
import time

# ── Percussioni GM (canale 10, kit "129-001 Standard" del soundfont
# FluidR3) — 39 (Hand Clap) e 40 (Electric Snare) verificati DIRETTAMENTE
# dall'utente nella tastiera virtuale di Carla il 2026-07-22: le note
# "standard" GM (36 kick, 75 claves, 76/77 woodblock...) non risultavano
# udibili in questo kit specifico, queste due sì.
DRUM_NOTES = {
    "clap":        39,   # Hand Clap
    "snare":       40,   # Electric Snare
    "cowbell":     56,
    "guiro":       73,
}

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
    "singola":  [0],           # solo la fondamentale
    "potenza":  [0, 4],        # "power chord": fondamentale + quinta diatonica
    "triade":   [0, 2, 4],     # fondamentale-terza-quinta della scala
    "settima":  [0, 2, 4, 6],  # + settima
}
CHORD_STEP_MS = 25   # micro-strimpellata: le note dell'accordo non sono a capello simultanee

# ── Preset: "il tipo di musica" — un solo nome sceglie tutto il resto ───────
# tappeto (pad): registro basso continuo · melodia: cursore che si muove
# di pochi gradi a ogni evento · accordo: punteggiatura occasionale sotto.
PRESETS = {
    "pentatonica_calma": {
        "root": "do", "scale": "pentatonica_min",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.80,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.60, "pad_hold_s": 10,
        "chord_style": "triade", "chord_prob": 0.20, "chord_velocity": 0.55,
        "note_length_ms": 900,
        "drum_voice": "clap", "drum_prob": 1.0, "drum_velocity": 0.60, "drum_interval_ms": 550,
    },
    "accordi_maggiori": {
        "root": "do", "scale": "maggiore",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.85,
        "pad_octave": -1, "pad_chord": "triade", "pad_velocity": 0.62, "pad_hold_s": 8,
        "chord_style": "triade", "chord_prob": 0.45, "chord_velocity": 0.65,
        "note_length_ms": 700,
        "drum_voice": "snare", "drum_prob": 1.0, "drum_velocity": 0.65, "drum_interval_ms": 450,
    },
    "drone_modale": {
        "root": "re", "scale": "dorica",
        "melody_octave": -1, "melody_step_max": 1, "melody_velocity": 0.75,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.70, "pad_hold_s": 14,
        "chord_style": "potenza", "chord_prob": 0.30, "chord_velocity": 0.60,
        "note_length_ms": 1600,
        "drum_voice": "snare", "drum_prob": 1.0, "drum_velocity": 0.60, "drum_interval_ms": 650,
    },
    "arpeggio_arioso": {
        "root": "fa", "scale": "maggiore",
        "melody_octave": 1, "melody_step_max": 3, "melody_velocity": 0.78,
        "pad_octave": -1, "pad_chord": "triade", "pad_velocity": 0.55, "pad_hold_s": 7,
        "chord_style": "triade", "chord_prob": 0.35, "chord_velocity": 0.55,
        "note_length_ms": 500,
        "drum_voice": "clap", "drum_prob": 1.0, "drum_velocity": 0.62, "drum_interval_ms": 400,
    },
    "blues_notturno": {
        "root": "la", "scale": "blues",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.80,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.65, "pad_hold_s": 12,
        "chord_style": "settima", "chord_prob": 0.30, "chord_velocity": 0.62,
        "note_length_ms": 1100,
        "drum_voice": "guiro", "drum_prob": 1.0, "drum_velocity": 0.65, "drum_interval_ms": 600,
    },
    "cromatico_libero": {
        "root": "do", "scale": "cromatica",
        "melody_octave": 0, "melody_step_max": 4, "melody_velocity": 1.0,
        "pad_octave": -1, "pad_chord": "singola", "pad_velocity": 0.50, "pad_hold_s": 9,
        "chord_style": "singola", "chord_prob": 0.0, "chord_velocity": 0.5,
        "note_length_ms": 500,
        "drum_voice": "cowbell", "drum_prob": 1.0, "drum_velocity": 0.55, "drum_interval_ms": 500,
    },
}
DEFAULT_PRESET = "pentatonica_calma"   # scala pentatonica: qualsiasi nota
                                       # suona bene con qualsiasi altra — la
                                       # scelta più sicura per un input casuale

# ROOT_NOTES è una CLASSE di altezza (0-11, "che nota" a prescindere
# dall'ottava) — sommata direttamente come nota MIDI assoluta risulterebbe
# quasi sub-udibile (0 = C in ottava -1). BASE_OCTAVE la porta al Do
# centrale prima di applicare gradi/ottave: root_note reale = BASE_OCTAVE + pc.
BASE_OCTAVE = 60


def _degree_to_note(root_note: int, scale: list, degree: int) -> int:
    """Nota MIDI del grado N della scala, sopra root_note (grado 0 = radice
    stessa ottava, grado len(scale) = radice un'ottava sopra, ecc.). Accetta
    gradi negativi (sotto la radice)."""
    octave, idx = divmod(degree, len(scale))
    return root_note + octave * 12 + scale[idx]


class MusicEngine:
    def __init__(self, preset: str = DEFAULT_PRESET):
        self.preset_name = None
        self.cfg = {}
        self._melody_degree = 7   # cursore melodico: grado di partenza (~1 ottava sopra radice)
        self._pad_idx = 0         # cursore round-robin del tremolo del tappeto
        self.set_preset(preset)

    def set_preset(self, name: str) -> bool:
        if name not in PRESETS:
            return False
        self.preset_name = name
        self.cfg = dict(PRESETS[name])
        return True

    def _root_pc(self) -> int:
        return ROOT_NOTES.get(self.cfg["root"], 0)

    def _scale(self) -> list:
        return SCALES.get(self.cfg["scale"], SCALES["cromatica"])

    # ── Melodia: il cursore si muove di pochi gradi, non salta a caso ──────
    def melody_note(self, raw_note: int, raw_velocity: int) -> dict:
        """Un evento del sensore sposta il cursore melodico di un passo
        piccolo (segno e ampiezza dal valore grezzo, non la nota stessa —
        così la melodia resta una FRASE che si muove, non un salto a caso
        ogni volta)."""
        scale = self._scale()
        step_max = max(1, self.cfg.get("melody_step_max", 2))
        step = (raw_note % (2 * step_max + 1)) - step_max   # -step_max..+step_max
        if step == 0:
            step = 1 if raw_note % 2 == 0 else -1
        self._melody_degree = max(0, min(21, self._melody_degree + step))

        note = _degree_to_note(BASE_OCTAVE + self._root_pc(), scale, self._melody_degree)
        note += self.cfg.get("melody_octave", 0) * 12
        note = max(0, min(127, note))
        vel = max(1, min(127, round(raw_velocity * self.cfg.get("melody_velocity", 0.8))))
        return {"note": note, "velocity": vel, "delay_ms": 0,
                "length_ms": self.cfg.get("note_length_ms", 700), "channel": 1}

    # ── Accordo: punteggiatura occasionale, ancorata alla melodia corrente ─
    def maybe_chord(self) -> list:
        if random.random() > self.cfg.get("chord_prob", 0.0):
            return []
        scale = self._scale()
        degrees = CHORD_STYLES.get(self.cfg.get("chord_style", "triade"), [0, 2, 4])
        base_degree = self._melody_degree - (self._melody_degree % len(scale))  # radice dell'accordo sotto la melodia
        vel_base = self.cfg.get("chord_velocity", 0.6)
        out = []
        for i, deg in enumerate(degrees):
            note = _degree_to_note(BASE_OCTAVE + self._root_pc(), scale, base_degree + deg)
            note = max(0, min(127, note))
            vel = max(1, min(127, round(125 * vel_base * (1.0 if i == 0 else 0.85))))
            out.append({"note": note, "velocity": vel, "delay_ms": i * CHORD_STEP_MS,
                       "length_ms": self.cfg.get("note_length_ms", 700), "channel": 1})
        return out

    # ── Percussioni: un accento quando la melodia si accompagna con un
    # accordo — la stessa punteggiatura armonica, ma sentita anche a ritmo.
    def drum_accent(self) -> dict:
        note = DRUM_NOTES.get(self.cfg.get("drum_voice", "clap"), 39)
        return {"note": note, "velocity": 127, "delay_ms": 0, "length_ms": 80, "channel": 10}

    def trigger(self, raw_note: int, raw_velocity: int) -> list:
        """Un evento del sensore -> melodia (sempre) + accordo (a volte,
        con un accento percussivo quando scatta)."""
        notes = [self.melody_note(raw_note, raw_velocity)]
        chord = self.maybe_chord()
        notes += chord
        if chord:
            notes.append(self.drum_accent())
        return notes

    # ── Tappeto (canale 2, synth SF2 dedicato con patch "Pad" del General
    # MIDI — davvero sostenuto): un vero ACCORDO LUNGO tenuto, non più un
    # tremolo. Il tremolo (ribattere ogni 200-280ms) serviva a simulare un
    # sostenuto su Yoshimi, che decadeva da solo — su questo synth è
    # controproducente: qualsiasi nota ribattuta così in fretta suona come
    # un ticchettio meccanico (percepito come "un piano che fa tic tic"),
    # non come un fondo continuo. Ora che il sostegno è vero, lo strumento
    # tiene la nota da solo: basta suonarla di rado.
    def pad_hold(self) -> list:
        scale = self._scale()
        degrees = CHORD_STYLES.get(self.cfg.get("pad_chord", "potenza"), [0, 4])
        vel = max(1, min(127, round(130 * self.cfg.get("pad_velocity", 0.3))))
        hold_s = self.cfg.get("pad_hold_s", 10)
        length_ms = round(hold_s * 1000 * 0.92)   # quasi fino al prossimo giro, non incollato
        out = []
        for i, deg in enumerate(degrees):
            note = _degree_to_note(BASE_OCTAVE + self._root_pc(), scale, deg)
            note += self.cfg.get("pad_octave", -2) * 12
            note = max(0, min(127, note))
            out.append({"note": note, "velocity": vel, "delay_ms": i * 40,
                       "length_ms": length_ms, "channel": 2})
        return out

    def pad_hold_s(self) -> float:
        return self.cfg.get("pad_hold_s", 10)

    # ── Percussioni (canale 10, GM): un tocco sincronizzato allo stesso
    # orologio proprio (drum_interval_ms — indipendente da quello, ora
    # molto più lento, del tappeto), non a ogni giro (drum_prob), per
    # restare un ritmo, non un rumore di fondo. Velocity sempre al
    # massimo (127): un transiente breve si perde nell'ambiente molto più
    # facilmente di una nota sostenuta anche a parità di ampiezza di
    # picco, quindi qui non ha senso lasciare margine dinamico come per
    # melodia/tappeto.
    def drum_tick(self) -> dict | None:
        if random.random() > self.cfg.get("drum_prob", 0.0):
            return None
        note = DRUM_NOTES.get(self.cfg.get("drum_voice", "clap"), 39)
        return {"note": note, "velocity": 127, "delay_ms": 0, "length_ms": 60, "channel": 10}

    def drum_interval_s(self) -> float:
        return self.cfg.get("drum_interval_ms", 500) / 1000.0
