"""
GAIA Herbarium — motore musicale: converte note casuali del sensore in musica.

V2 (2026-07-22): non più "un evento = una nota isolata" ma quattro livelli
come in un vero arrangiamento, ognuno sul PROPRIO canale MIDI (v2.3: un solo
synth SF2 General MIDI multi-timbrico ha sostituito Yoshimi — ogni canale
suona un patch diverso davvero, non solo registro/dinamica sullo stesso
timbro come nella v2.2):

  - MELODIA: ogni evento del sensore muove un CURSORE melodico di pochi
    gradi della scala (non salta a caso) — resta sempre nella scala, si
    muove come una frase, non come rumore.
  - ACCORDO: ogni tanto (non a ogni nota) la melodia si accompagna con un
    accordo pieno sotto — la punteggiatura armonica. Condivide il canale
    della melodia dello stesso evento (vedi sotto).
  - TAPPETO: un accordo lungo tenuto, a orologio proprio (non agli eventi)
    — il fondo che non si ferma mai. Non un tremolo: su un synth con
    sostegno vero (v2.3) ribattere in fretta suona come un ticchettio, non
    come un fondo continuo.
  - PERCUSSIONI (canale 10 fisso, GM standard): un tocco a ritmo proprio
    (indipendente da quello, ora lento, del tappeto), più un accento
    quando scatta un accordo.

Canali (2026-08-11, v2.4 "sei voci"): melodia+accordo e tappeto NON sono
più su canali fissi 1/2 — ruotano tra VOICE_CHANNELS (1-6, sei strumenti
diversi impostati a mano su Carla), ognuno con un proprio cursore
indipendente (melodia+accordo avanzano insieme per ogni evento sensore;
il tappeto avanza per conto suo, sul proprio orologio). Solo le
percussioni restano fisse sul canale 10.

Il sensore manda numeri a caso — questo modulo li rende musicali: nota
grezza -> aggancio alla scala/passo melodico -> preset che fissa scala,
registri, accordo, ritmo e voce percussiva in un colpo solo ("il tipo di
musica"). Ogni evento porta il proprio "channel": main.py lo scrive così
com'è, tutta l'orchestrazione resta qui.
"""
import random
import time

# ── Percussioni GM (canale 10, kit "129-009 La Drum" del soundfont
# FluidR3, cambiato dal 129-001 Standard usato fino al 2026-08-10) —
# rimappato dal vivo il 2026-08-11 scandendo nota per nota con l'utente:
# su QUESTO kit sono udibili solo cassa/rullante/tom (35,36,38,40,41,43),
# tutto il resto testato è muto (37,39,42,44,46,49,51,54,56 — niente
# hi-hat/piatti/cowbell/clap/guiro, sembra un kit con solo i pezzi
# "core"). Se si torna al kit Standard, i vecchi valori (clap=39,
# cowbell=56, guiro=73) erano quelli verificati allora, non validi qui.
DRUM_NOTES = {
    "cassa":       36,   # Bass Drum 1 (35 = variante equivalente)
    "rullante":    40,   # Electric Snare (38 = variante equivalente)
    "tom":         41,   # Low Floor Tom
    "tom_basso":   43,   # tom più grave
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

# ── Canali "voce" (2026-08-11): 6 strumenti diversi impostati a mano su
# Carla (canali 1-6, canale 10 riservato alle percussioni GM come sempre).
# Melodia+accordo ruotano insieme di un canale a ogni EVENTO sensore (stessa
# nota "sotto" resta coerente con la sua melodia); il tappeto ruota per
# conto suo, sul proprio orologio — due cursori indipendenti sullo stesso
# pool di 6, così nel tempo tutti gli strumenti vengono usati da entrambi.
VOICE_CHANNELS = [1, 2, 3, 4, 5, 6]

# ── Preset: "il tipo di musica" — un solo nome sceglie tutto il resto ───────
# tappeto (pad): registro basso continuo · melodia: cursore che si muove
# di pochi gradi a ogni evento · accordo: punteggiatura occasionale sotto.
PRESETS = {
    "pentatonica_calma": {
        "root": "do", "scale": "pentatonica_min",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.80,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.60, "pad_hold_s": 10,
        "chord_style": "triade", "chord_prob": 0.15, "chord_velocity": 0.55,
        "note_length_ms": 900,
        "drum_voice": "rullante", "drum_prob": 1.0, "drum_velocity": 0.60, "drum_interval_ms": 550,
    },
    "accordi_maggiori": {
        "root": "do", "scale": "maggiore",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.85,
        "pad_octave": -1, "pad_chord": "triade", "pad_velocity": 0.62, "pad_hold_s": 8,
        "chord_style": "triade", "chord_prob": 0.25, "chord_velocity": 0.65,
        "note_length_ms": 700,
        "drum_voice": "rullante", "drum_prob": 1.0, "drum_velocity": 0.65, "drum_interval_ms": 450,
    },
    "drone_modale": {
        "root": "re", "scale": "dorica",
        "melody_octave": -1, "melody_step_max": 1, "melody_velocity": 0.75,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.70, "pad_hold_s": 11,
        "chord_style": "potenza", "chord_prob": 0.20, "chord_velocity": 0.60,
        "note_length_ms": 1200,
        "drum_voice": "rullante", "drum_prob": 1.0, "drum_velocity": 0.60, "drum_interval_ms": 650,
    },
    "arpeggio_arioso": {
        "root": "fa", "scale": "maggiore",
        "melody_octave": 1, "melody_step_max": 3, "melody_velocity": 0.78,
        "pad_octave": -1, "pad_chord": "triade", "pad_velocity": 0.55, "pad_hold_s": 7,
        "chord_style": "triade", "chord_prob": 0.20, "chord_velocity": 0.55,
        "note_length_ms": 500,
        "drum_voice": "rullante", "drum_prob": 1.0, "drum_velocity": 0.62, "drum_interval_ms": 400,
    },
    "blues_notturno": {
        "root": "la", "scale": "blues",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.80,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.65, "pad_hold_s": 10,
        "chord_style": "triade", "chord_prob": 0.20, "chord_velocity": 0.62,
        "note_length_ms": 850,
        "drum_voice": "tom_basso", "drum_prob": 1.0, "drum_velocity": 0.65, "drum_interval_ms": 600,
    },
    "cromatico_libero": {
        "root": "do", "scale": "cromatica",
        "melody_octave": 0, "melody_step_max": 4, "melody_velocity": 1.0,
        "pad_octave": -1, "pad_chord": "singola", "pad_velocity": 0.50, "pad_hold_s": 9,
        "chord_style": "singola", "chord_prob": 0.0, "chord_velocity": 0.5,
        "note_length_ms": 500,
        "drum_voice": "tom", "drum_prob": 1.0, "drum_velocity": 0.55, "drum_interval_ms": 500,
    },
    # ── Famiglia "ambient" (2026-08-11): musica da sottofondo/relax — note
    # lunghe, accordi rari, percussioni sparse e morbide. Anche più leggeri
    # sul Pi dei preset "attivi" sopra (chord_prob e drum_prob bassi = meno
    # polifonia simultanea, vedi bug XRun risolto lo stesso giorno).
    "ambient_profondo": {
        "root": "re", "scale": "dorica",
        "melody_octave": -1, "melody_step_max": 1, "melody_velocity": 0.55,
        "pad_octave": -2, "pad_chord": "potenza", "pad_velocity": 0.50, "pad_hold_s": 18,
        "chord_style": "potenza", "chord_prob": 0.10, "chord_velocity": 0.40,
        "note_length_ms": 2200,
        "drum_voice": "tom_basso", "drum_prob": 0.20, "drum_velocity": 0.35, "drum_interval_ms": 1400,
    },
    "ambient_cristallino": {
        "root": "sol", "scale": "misolidia",
        "melody_octave": 1, "melody_step_max": 2, "melody_velocity": 0.60,
        "pad_octave": -1, "pad_chord": "triade", "pad_velocity": 0.45, "pad_hold_s": 13,
        "chord_style": "triade", "chord_prob": 0.15, "chord_velocity": 0.45,
        "note_length_ms": 1400,
        "drum_voice": "tom", "drum_prob": 0.15, "drum_velocity": 0.40, "drum_interval_ms": 1200,
    },
    "ambient_notturno": {
        "root": "la", "scale": "minore",
        "melody_octave": 0, "melody_step_max": 1, "melody_velocity": 0.50,
        "pad_octave": -1, "pad_chord": "potenza", "pad_velocity": 0.48, "pad_hold_s": 16,
        "chord_style": "potenza", "chord_prob": 0.12, "chord_velocity": 0.42,
        "note_length_ms": 1900,
        "drum_voice": "rullante", "drum_prob": 0.15, "drum_velocity": 0.35, "drum_interval_ms": 1500,
    },
    "ambient_respiro": {
        "root": "do", "scale": "pentatonica_min",
        "melody_octave": 0, "melody_step_max": 1, "melody_velocity": 0.55,
        "pad_octave": -1, "pad_chord": "singola", "pad_velocity": 0.45, "pad_hold_s": 20,
        "chord_style": "singola", "chord_prob": 0.08, "chord_velocity": 0.40,
        "note_length_ms": 2500,
        "drum_voice": "rullante", "drum_prob": 0.10, "drum_velocity": 0.30, "drum_interval_ms": 1800,
    },
    "ambient_alba": {
        "root": "mi", "scale": "misolidia",
        "melody_octave": 0, "melody_step_max": 2, "melody_velocity": 0.65,
        "pad_octave": -1, "pad_chord": "triade", "pad_velocity": 0.55, "pad_hold_s": 12,
        "chord_style": "triade", "chord_prob": 0.18, "chord_velocity": 0.50,
        "note_length_ms": 1300,
        "drum_voice": "tom_basso", "drum_prob": 0.25, "drum_velocity": 0.45, "drum_interval_ms": 1000,
    },
    # ── Melodico: la melodia in primo piano (passo ampio, velocity alta),
    # accompagnamento ridotto al minimo per non coprirla -- l'opposto della
    # famiglia ambient sopra, dove è il tappeto/atmosfera a dominare.
    "melodico_cantabile": {
        "root": "sol", "scale": "maggiore",
        "melody_octave": 0, "melody_step_max": 3, "melody_velocity": 0.90,
        "pad_octave": -1, "pad_chord": "singola", "pad_velocity": 0.35, "pad_hold_s": 9,
        "chord_style": "triade", "chord_prob": 0.15, "chord_velocity": 0.45,
        "note_length_ms": 650,
        "drum_voice": "rullante", "drum_prob": 0.30, "drum_velocity": 0.50, "drum_interval_ms": 500,
    },
    # ── Drone: quasi statico, molto più sostenuto di drone_modale --
    # melodia che si muove appena, accordi quasi mai, tappeto lunghissimo,
    # percussioni rarissime e profonde. Un fondo continuo, non una frase.
    "drone_infinito": {
        "root": "do", "scale": "minore",
        "melody_octave": -1, "melody_step_max": 1, "melody_velocity": 0.45,
        "pad_octave": -2, "pad_chord": "potenza", "pad_velocity": 0.55, "pad_hold_s": 24,
        "chord_style": "potenza", "chord_prob": 0.05, "chord_velocity": 0.35,
        "note_length_ms": 3000,
        "drum_voice": "tom_basso", "drum_prob": 0.08, "drum_velocity": 0.30, "drum_interval_ms": 2200,
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
        self._voice_idx = 0       # cursore round-robin canale melodia+accordo (VOICE_CHANNELS)
        self._pad_voice_idx = 0   # cursore round-robin canale tappeto (VOICE_CHANNELS, indipendente)
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
    def melody_note(self, raw_note: int, raw_velocity: int, channel: int = 1) -> dict:
        """Un evento del sensore sposta il cursore melodico di un passo
        piccolo (segno e ampiezza dal valore grezzo, non la nota stessa —
        così la melodia resta una FRASE che si muove, non un salto a caso
        ogni volta)."""
        scale = self._scale()
        step_max = max(1, self.cfg.get("melody_step_max", 2))
        step = (raw_note % (2 * step_max + 1)) - step_max   # -step_max..+step_max
        if step == 0:
            step = 1 if raw_note % 2 == 0 else -1
        # Range ristretto 2026-08-11 (era 0-21, troppo esteso su scale
        # pentatoniche/corte -- arrivava a note molto acute o gravi): tiene
        # il cursore entro circa un'ottava e mezza dal punto di partenza (7).
        self._melody_degree = max(1, min(13, self._melody_degree + step))

        note = _degree_to_note(BASE_OCTAVE + self._root_pc(), scale, self._melody_degree)
        note += self.cfg.get("melody_octave", 0) * 12
        note = max(0, min(127, note))
        vel = max(1, min(127, round(raw_velocity * self.cfg.get("melody_velocity", 0.8))))
        return {"note": note, "velocity": vel, "delay_ms": 0,
                "length_ms": self.cfg.get("note_length_ms", 700), "channel": channel}

    # ── Accordo: punteggiatura occasionale, ancorata alla melodia corrente ─
    def maybe_chord(self, channel: int = 1) -> list:
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
                       "length_ms": self.cfg.get("note_length_ms", 700), "channel": channel})
        return out

    # ── Percussioni: un accento quando la melodia si accompagna con un
    # accordo — la stessa punteggiatura armonica, ma sentita anche a ritmo.
    def drum_accent(self) -> dict:
        note = DRUM_NOTES.get(self.cfg.get("drum_voice", "rullante"), 40)
        return {"note": note, "velocity": 127, "delay_ms": 0, "length_ms": 80, "channel": 10}

    def trigger(self, raw_note: int, raw_velocity: int) -> list:
        """Un evento del sensore -> melodia (sempre) + accordo (a volte,
        con un accento percussivo quando scatta). Melodia e accordo dello
        STESSO evento condividono un canale, che ruota a ogni evento tra i
        VOICE_CHANNELS (6 strumenti impostati su Carla)."""
        channel = VOICE_CHANNELS[self._voice_idx % len(VOICE_CHANNELS)]
        self._voice_idx += 1
        notes = [self.melody_note(raw_note, raw_velocity, channel)]
        chord = self.maybe_chord(channel)
        notes += chord
        if chord:
            notes.append(self.drum_accent())
        return notes

    # ── Tappeto (canale a rotazione tra VOICE_CHANNELS, synth SF2 dedicato
    # con patch "Pad" del General MIDI — davvero sostenuto): un vero ACCORDO
    # LUNGO tenuto, non più un tremolo. Il tremolo (ribattere ogni 200-280ms)
    # serviva a simulare un sostenuto su Yoshimi, che decadeva da solo — su
    # questo synth è controproducente: qualsiasi nota ribattuta così in
    # fretta suona come un ticchettio meccanico (percepito come "un piano
    # che fa tic tic"), non come un fondo continuo. Ora che il sostegno è
    # vero, lo strumento tiene la nota da solo: basta suonarla di rado.
    # Cursore di rotazione indipendente da quello di trigger() (2026-08-11):
    # il tappeto scatta sul proprio orologio, non sugli eventi sensore.
    def pad_hold(self) -> list:
        channel = VOICE_CHANNELS[self._pad_voice_idx % len(VOICE_CHANNELS)]
        self._pad_voice_idx += 1
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
                       "length_ms": length_ms, "channel": channel})
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
        note = DRUM_NOTES.get(self.cfg.get("drum_voice", "rullante"), 40)
        # Umanizzato (2026-08-11): velocity non più sempre a tavoletta --
        # piccola variazione per non suonare meccanico colpo dopo colpo.
        vel = random.randint(100, 127)
        return {"note": note, "velocity": vel, "delay_ms": 0, "length_ms": 60, "channel": 10}

    def drum_interval_s(self) -> float:
        """±35% di variazione ad ogni chiamata (2026-08-11, richiesto dal
        vivo: la cassa suonava "sempre a tempo", troppo quantizzata) --
        _drum_loop in main.py chiama questo ad ogni giro, quindi il
        risultato è un tempo che respira invece di un metronomo rigido in
        4/4. La densità media resta quella del preset (drum_interval_ms),
        cambia solo la regolarità colpo per colpo."""
        base = self.cfg.get("drum_interval_ms", 500) / 1000.0
        return base * random.uniform(0.65, 1.35)
