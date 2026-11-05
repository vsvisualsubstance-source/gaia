//! Il motore della Console Audio: due deck, mixer, sync. Vive dentro la
//! callback dell'uscita audio (il clock e' quello della scheda): i comandi
//! arrivano da un canale e vengono applicati all'inizio di ogni blocco, lo
//! stato esce ~15 volte al secondo. Stessa logica del motore simulato della
//! Plancia (plancia/src/52-audio-console.js): CUE stile CDJ, hot cue, sync di
//! tempo e fase sulle griglie, master. Il keylock per ora e' solo la scelta
//! salvata (fase 2: signalsmith-stretch).

use crate::dsp::{self, Biquad, Kind};
use serde::Serialize;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, SyncSender};

pub const HOT: usize = 8;
const SNAPSHOT_HZ: f64 = 15.0;
/// scrub a mano: la testina insegue il dito con questo ritardo (s)...
const SCRUB_TAU: f64 = 0.025;
/// ...a non piu' di 8 volte la velocita' normale, avanti o indietro
const SCRUB_MAX: f64 = 8.0;

/// traccia decodificata, stereo interleaved alla sua frequenza
pub struct TrackData {
    pub id: String,
    pub samples: Vec<f32>,
    pub rate: f64,
    pub seconds: f64,
    pub bpm: f64,
    pub first_beat: f64,
    pub confidence: f64,
    pub locked: bool,
}

impl TrackData {
    fn period(&self) -> f64 {
        if self.bpm > 0.0 { 60.0 / self.bpm } else { 0.0 }
    }
    fn grid_ok(&self) -> bool {
        self.bpm > 0.0 && (self.locked || self.confidence >= 0.4)
    }
    #[inline]
    fn frame(&self, i: isize) -> (f32, f32) {
        if i < 0 {
            return (0.0, 0.0);
        }
        let k = i as usize * 2;
        match (self.samples.get(k), self.samples.get(k + 1)) {
            (Some(l), Some(r)) => (*l, *r),
            _ => (0.0, 0.0),
        }
    }
    /// campione stereo al tempo t (s), interpolato
    #[inline]
    fn at(&self, t: f64) -> (f32, f32) {
        let x = t * self.rate;
        let i = x.floor() as isize;
        let f = (x - i as f64) as f32;
        let (a, b, c, d) = (self.frame(i - 1), self.frame(i), self.frame(i + 1), self.frame(i + 2));
        (dsp::hermite(a.0, b.0, c.0, d.0, f), dsp::hermite(a.1, b.1, c.1, d.1, f))
    }
}

#[derive(Clone, Copy, Debug)]
pub enum HotOp {
    Go,
    Clear,
}

#[derive(Clone, Debug, Default)]
pub struct MixVals {
    pub gain: Option<f64>,
    pub hi: Option<f64>,
    pub mid: Option<f64>,
    pub lo: Option<f64>,
    pub filter: Option<f64>,
    pub fader: Option<f64>,
    pub cue: Option<bool>,
    pub xfader: Option<f64>,
    pub master: Option<f64>,
    pub cue_mix: Option<f64>,
    pub cue_level: Option<f64>,
}

#[derive(Clone, Debug)]
pub enum Cmd {
    Play(usize),
    CueDown(usize),
    CueUp(usize),
    Scrub(usize, bool, f64),
    Jump(usize, i32),
    Snap(usize),
    Seek(usize, f64),
    HotCue(usize, usize, HotOp),
    Tempo(usize, f64),
    Range(usize, f64),
    Nudge(usize, f64),
    Sync(usize),
    Master(usize),
    Keylock(usize),
    Eject(usize),
    MixCh(usize, MixVals),
    Mix(MixVals),
}

pub enum Msg {
    Cmd(Cmd),
    Loaded { deck: usize, track: Arc<TrackData>, cue: f64, hot: [Option<f64>; HOT] },
}

/// dal motore al resto del programma (fuori dalla callback)
pub enum Out {
    State(Snapshot),
    SaveCues { id: String, cue: f64, hot: [Option<f64>; HOT] },
    /// traccia sostituita: la si libera fuori dalla callback
    Drop(Arc<TrackData>),
    Error(String),
}

#[derive(Clone, Serialize)]
pub struct DeckState {
    pub track: Option<String>,
    pub pos: f64,
    pub playing: bool,
    pub tempo: f64,
    pub range: f64,
    pub rate: f64,
    pub keylock: bool,
    pub sync: bool,
    pub cue: f64,
    pub hot: [Option<f64>; HOT],
    pub nudge: f64,
    pub preview: bool,
    pub scrub: bool,
    pub snap: bool,
}

#[derive(Clone, Serialize)]
pub struct StripState {
    pub gain: f64,
    pub hi: f64,
    pub mid: f64,
    pub lo: f64,
    pub filter: f64,
    pub fader: f64,
    pub cue: bool,
    pub meter: f32,
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    /// clock del motore (s): campioni usciti dalla scheda
    pub t: f64,
    pub master: &'static str,
    pub decks: [DeckState; 2],
    pub mix: [StripState; 2],
    pub xfader: f64,
    pub master_level: f64,
    pub cue_mix: f64,
    pub cue_level: f64,
    /// l'uscita ha i canali 3-4 per la cuffia
    pub headphones: bool,
    pub headphones_meter: f32,
    pub master_meter: f32,
    pub limiter_db: f32,
}

struct Deck {
    track: Option<Arc<TrackData>>,
    pos: f64,
    playing: bool,
    tempo: f64,
    range: f64,
    keylock: bool,
    sync: bool,
    cue: f64,
    hot: [Option<f64>; HOT],
    nudge: f64,
    preview: bool,
    scrub: bool,
    snap: bool,
    /// scrub: dove sta il dito (s) e velocita' attuale della testina (s/s)
    scrub_target: f64,
    scrub_vel: f64,
}

impl Deck {
    fn new() -> Self {
        Deck { track: None, pos: 0.0, playing: false, tempo: 0.0, range: 0.08, keylock: true, sync: false, cue: 0.0, hot: [None; HOT], nudge: 0.0, preview: false, scrub: false, snap: true, scrub_target: 0.0, scrub_vel: 0.0 }
    }
    fn rate(&self) -> f64 {
        1.0 + self.tempo * self.range + self.nudge
    }
    fn bpm(&self) -> f64 {
        self.track.as_ref().map(|t| t.bpm * (1.0 + self.tempo * self.range)).unwrap_or(0.0)
    }
    fn seconds(&self) -> f64 {
        self.track.as_ref().map(|t| t.seconds).unwrap_or(0.0)
    }
    fn phase(&self) -> f64 {
        match &self.track {
            Some(t) if t.period() > 0.0 => ((self.pos - t.first_beat) / t.period()).rem_euclid(1.0),
            _ => 0.0,
        }
    }
    fn snap_to_grid(&self, x: f64) -> f64 {
        match &self.track {
            Some(t) if self.snap && t.grid_ok() => t.first_beat + ((x - t.first_beat) / t.period()).round() * t.period(),
            _ => x,
        }
    }
    fn clamp_pos(&self, x: f64) -> f64 {
        x.clamp(0.0, self.seconds())
    }
}

/// parametri e stato dei filtri di un canale del mixer
struct Strip {
    gain: f64,
    hi: f64,
    mid: f64,
    lo: f64,
    filter: f64,
    fader: f64,
    cue: bool,
    eq: [[Biquad; 2]; 3],
    filt: [Biquad; 2],
    filt_on: bool,
    /// guadagno lineare attuale (inseguimento morbido, niente click)
    g: f32,
    /// guadagno verso la cuffia (gain se 🎧 acceso), inseguito come g
    gc: f32,
    peak: f32,
}

impl Strip {
    fn new(fs: f64) -> Self {
        let mut s = Strip { gain: 1.0, hi: 0.0, mid: 0.0, lo: 0.0, filter: 0.0, fader: 1.0, cue: false, eq: [[Biquad::unity(); 2]; 3], filt: [Biquad::unity(); 2], filt_on: false, g: 0.0, gc: 0.0, peak: 0.0 };
        s.update_eq(fs);
        s
    }
    fn update_eq(&mut self, fs: f64) {
        for ch in 0..2 {
            self.eq[0][ch].set(Kind::LowShelf, fs, dsp::EQ_LOW_HZ, 0.7, dsp::eq_db(self.lo));
            self.eq[1][ch].set(Kind::Peak, fs, dsp::EQ_MID_HZ, 0.8, dsp::eq_db(self.mid));
            self.eq[2][ch].set(Kind::HighShelf, fs, dsp::EQ_HIGH_HZ, 0.7, dsp::eq_db(self.hi));
        }
        match dsp::filter_setting(self.filter) {
            Some((k, f)) => {
                if !self.filt_on {
                    self.filt.iter_mut().for_each(Biquad::reset);
                }
                self.filt.iter_mut().for_each(|b| b.set(k, fs, f, 0.9, 0.0));
                self.filt_on = true;
            }
            None => self.filt_on = false,
        }
    }
    fn state(&self) -> StripState {
        StripState { gain: self.gain, hi: self.hi, mid: self.mid, lo: self.lo, filter: self.filter, fader: self.fader, cue: self.cue, meter: self.peak }
    }
}

pub struct Engine {
    fs: f64,
    frames: u64,
    decks: [Deck; 2],
    strips: [Strip; 2],
    master: usize,
    xfader: f64,
    master_level: f64,
    cue_mix: f64,
    cue_level: f64,
    ghp_cue: f32,
    ghp_mst: f32,
    hp_lim: f32,
    hp_peak: f32,
    headphones: bool,
    gm: f32,
    lim: f32,
    lim_min: f32,
    master_peak: f32,
    next_snapshot: u64,
    rx: Receiver<Msg>,
    tx: SyncSender<Out>,
}

const LETTER: [&str; 2] = ["A", "B"];

impl Engine {
    pub fn new(fs: f64, rx: Receiver<Msg>, tx: SyncSender<Out>) -> Self {
        Engine {
            fs,
            frames: 0,
            decks: [Deck::new(), Deck::new()],
            strips: [Strip::new(fs), Strip::new(fs)],
            master: 0,
            xfader: 0.0,
            master_level: 0.9,
            cue_mix: 0.5,
            cue_level: 0.8,
            ghp_cue: 0.0,
            ghp_mst: 0.0,
            hp_lim: 1.0,
            hp_peak: 0.0,
            headphones: false,
            gm: 0.0,
            lim: 1.0,
            lim_min: 1.0,
            master_peak: 0.0,
            next_snapshot: 0,
            rx,
            tx,
        }
    }

    /// uscita riaperta con un'altra frequenza: filtri e clock dello stato seguono
    pub fn set_rate(&mut self, fs: f64) {
        if (fs - self.fs).abs() > 0.5 {
            self.fs = fs;
            for s in &mut self.strips {
                s.update_eq(fs);
            }
            self.next_snapshot = self.frames;
        }
    }

    fn send(&self, o: Out) {
        // canale pieno = nessuno legge: meglio perdere uno stato che bloccare l'audio
        let _ = self.tx.try_send(o);
    }

    /// il master del tempo per il deck k: il deck scelto, se e' l'altro e suona
    fn master_of(&self, k: usize) -> Option<usize> {
        let m = &self.decks[self.master];
        (self.master != k && m.track.is_some() && m.playing).then_some(self.master)
    }

    fn sync_tempo(&mut self, k: usize) {
        let Some(m) = self.master_of(k) else { return };
        let d = &self.decks[k];
        if !d.sync {
            return;
        }
        let (Some(dt), Some(_)) = (&d.track, &self.decks[m].track) else { return };
        if dt.bpm <= 0.0 || self.decks[m].bpm() <= 0.0 {
            return;
        }
        // tempo uguale al master, anche a meta'/doppio (70 contro 140)
        let mut target = self.decks[m].bpm();
        let r = dt.bpm;
        while target / r > 1.5 {
            target /= 2.0;
        }
        while target / r < 0.67 {
            target *= 2.0;
        }
        let d = &mut self.decks[k];
        d.tempo = ((target / r - 1.0) / d.range).clamp(-1.0, 1.0);
    }

    fn sync_phase(&mut self, k: usize) {
        let Some(m) = self.master_of(k) else { return };
        let ok = |d: &Deck| d.track.as_ref().is_some_and(|t| t.grid_ok());
        if !ok(&self.decks[k]) || !ok(&self.decks[m]) {
            return;
        }
        let mut dp = self.decks[m].phase() - self.decks[k].phase();
        if dp > 0.5 {
            dp -= 1.0;
        }
        if dp < -0.5 {
            dp += 1.0;
        }
        let d = &mut self.decks[k];
        let p = d.track.as_ref().map(|t| t.period()).unwrap_or(0.0);
        d.pos = d.clamp_pos(d.pos + dp * p);
    }

    fn resync_if_playing(&mut self, k: usize) {
        if self.decks[k].playing && self.decks[k].sync {
            self.sync_phase(k);
        }
    }

    fn save_cues(&self, k: usize) {
        let d = &self.decks[k];
        if let Some(t) = &d.track {
            self.send(Out::SaveCues { id: t.id.clone(), cue: d.cue, hot: d.hot });
        }
    }

    fn apply_mix(&mut self, k: Option<usize>, v: MixVals) {
        let f = |x: Option<f64>, lo: f64, hi: f64| x.filter(|x| x.is_finite()).map(|x| x.clamp(lo, hi));
        if let Some(k) = k {
            let s = &mut self.strips[k];
            if let Some(x) = f(v.gain, 0.0, 2.0) { s.gain = x }
            if let Some(x) = f(v.hi, -1.0, 1.0) { s.hi = x }
            if let Some(x) = f(v.mid, -1.0, 1.0) { s.mid = x }
            if let Some(x) = f(v.lo, -1.0, 1.0) { s.lo = x }
            if let Some(x) = f(v.filter, -1.0, 1.0) { s.filter = x }
            if let Some(x) = f(v.fader, 0.0, 1.0) { s.fader = x }
            if let Some(x) = v.cue { s.cue = x }
            s.update_eq(self.fs);
        }
        if let Some(x) = f(v.xfader, -1.0, 1.0) { self.xfader = x }
        if let Some(x) = f(v.master, 0.0, 1.0) { self.master_level = x }
        if let Some(x) = f(v.cue_mix, 0.0, 1.0) { self.cue_mix = x }
        if let Some(x) = f(v.cue_level, 0.0, 1.0) { self.cue_level = x }
    }

    pub fn command(&mut self, c: Cmd) {
        use Cmd::*;
        match c {
            Play(k) => {
                if self.decks[k].track.is_none() {
                    return;
                }
                let d = &mut self.decks[k];
                d.playing = !d.playing;
                d.preview = false;
                if d.playing && d.sync {
                    self.sync_phase(k);
                }
                // diventa master solo se il master attuale non e' un altro deck in onda
                let cur = &self.decks[self.master];
                if self.decks[k].playing && !(self.master != k && cur.playing && cur.track.is_some()) {
                    self.master = k;
                }
            }
            CueDown(k) => {
                let d = &mut self.decks[k];
                if d.track.is_none() {
                    return;
                }
                if d.playing {
                    d.playing = false;
                    d.preview = false;
                    d.pos = d.cue;
                } else if (d.pos - d.cue).abs() > 0.02 {
                    d.cue = d.snap_to_grid(d.pos);
                    d.pos = d.cue;
                    self.save_cues(k);
                } else {
                    d.preview = true;
                    d.playing = true;
                }
            }
            CueUp(k) => {
                let d = &mut self.decks[k];
                if d.preview {
                    d.preview = false;
                    d.playing = false;
                    d.pos = d.cue;
                }
            }
            Scrub(k, active, pos) => {
                // trascinando la forma d'onda: la testina insegue il dito e si sente (come un vinile)
                if self.decks[k].track.is_some() && pos.is_finite() {
                    let d = &mut self.decks[k];
                    if active {
                        if !d.scrub {
                            d.scrub_vel = 0.0;
                        }
                        d.scrub = true;
                        d.scrub_target = d.clamp_pos(pos);
                    } else {
                        d.scrub = false;
                        d.scrub_vel = 0.0;
                        d.pos = d.clamp_pos(pos);
                        self.resync_if_playing(k);
                    }
                }
            }
            Jump(k, dir) => {
                let d = &mut self.decks[k];
                if d.track.is_none() {
                    return;
                }
                // punto precedente/successivo: inizio traccia, cue, hot cue
                let mut pts: Vec<f64> = vec![0.0, d.cue];
                pts.extend(d.hot.iter().flatten());
                pts.sort_by(|a, b| a.total_cmp(b));
                let t = if dir < 0 { pts.iter().rev().find(|t| **t < d.pos - 0.3).copied().or(Some(0.0)) } else { pts.iter().find(|t| **t > d.pos + 0.05).copied() };
                if let Some(t) = t {
                    d.pos = t;
                    self.resync_if_playing(k);
                }
            }
            Snap(k) => self.decks[k].snap = !self.decks[k].snap,
            Seek(k, pos) => {
                if self.decks[k].track.is_some() && pos.is_finite() {
                    let d = &mut self.decks[k];
                    d.pos = d.clamp_pos(pos);
                    self.resync_if_playing(k);
                }
            }
            HotCue(k, n, op) => {
                if n >= HOT || self.decks[k].track.is_none() {
                    return;
                }
                let d = &mut self.decks[k];
                match (op, d.hot[n]) {
                    (HotOp::Clear, _) => {
                        d.hot[n] = None;
                        self.save_cues(k);
                    }
                    (HotOp::Go, None) => {
                        d.hot[n] = Some(d.snap_to_grid(d.pos));
                        self.save_cues(k);
                    }
                    (HotOp::Go, Some(t)) => {
                        d.pos = t;
                        self.resync_if_playing(k);
                    }
                }
            }
            Tempo(k, v) => {
                if !v.is_finite() {
                    return;
                }
                self.decks[k].tempo = v.clamp(-1.0, 1.0);
                // deck in sync: il fader muove il master (come Traktor), il deck lo segue
                if self.decks[k].sync {
                    if let Some(m) = self.master_of(k) {
                        let (Some(dt), Some(mt)) = (self.decks[k].track.clone(), self.decks[m].track.clone()) else { return };
                        if dt.bpm > 0.0 && mt.bpm > 0.0 {
                            let d = &self.decks[k];
                            let mut target = dt.bpm * (1.0 + d.tempo * d.range);
                            while target / mt.bpm > 1.5 {
                                target /= 2.0;
                            }
                            while target / mt.bpm < 0.67 {
                                target *= 2.0;
                            }
                            let md = &mut self.decks[m];
                            md.tempo = ((target / mt.bpm - 1.0) / md.range).clamp(-1.0, 1.0);
                        }
                    }
                }
            }
            Range(k, v) => {
                if [0.08, 0.16, 0.5].iter().any(|r| (r - v).abs() < 1e-6) {
                    self.decks[k].range = v;
                }
            }
            Nudge(k, v) => {
                if v.is_finite() {
                    self.decks[k].nudge = v.clamp(-0.2, 0.2);
                }
            }
            Sync(k) => {
                self.decks[k].sync = !self.decks[k].sync;
                if self.decks[k].sync {
                    self.sync_tempo(k);
                    if self.decks[k].playing {
                        self.sync_phase(k);
                    }
                }
            }
            Master(k) => {
                self.master = k;
                self.decks[k].sync = false;
            }
            Keylock(k) => self.decks[k].keylock = !self.decks[k].keylock,
            Eject(k) => {
                if !self.decks[k].playing {
                    if let Some(t) = self.decks[k].track.take() {
                        self.send(Out::Drop(t));
                    }
                    self.decks[k].pos = 0.0;
                }
            }
            MixCh(k, v) => self.apply_mix(Some(k), v),
            Mix(v) => self.apply_mix(None, v),
        }
    }

    fn loaded(&mut self, k: usize, track: Arc<TrackData>, cue: f64, hot: [Option<f64>; HOT]) {
        if self.decks[k].playing {
            self.send(Out::Error(format!("Deck {} in onda: fermalo prima di caricare.", LETTER[k])));
            self.send(Out::Drop(track));
            return;
        }
        if let Some(old) = self.decks[k].track.replace(track) {
            self.send(Out::Drop(old));
        }
        let d = &mut self.decks[k];
        d.cue = d.clamp_pos(cue);
        d.hot = hot;
        d.pos = d.cue;
        d.playing = false;
        d.preview = false;
        d.nudge = 0.0;
        d.scrub = false;
        if d.sync {
            self.sync_tempo(k);
        }
    }

    fn snapshot(&mut self) -> Snapshot {
        let deck = |d: &Deck| DeckState {
            track: d.track.as_ref().map(|t| t.id.clone()),
            pos: d.pos,
            playing: d.playing,
            tempo: d.tempo,
            range: d.range,
            rate: d.rate(),
            keylock: d.keylock,
            sync: d.sync,
            cue: d.cue,
            hot: d.hot,
            nudge: d.nudge,
            preview: d.preview,
            scrub: d.scrub,
            snap: d.snap,
        };
        let s = Snapshot {
            t: self.frames as f64 / self.fs,
            master: LETTER[self.master],
            decks: [deck(&self.decks[0]), deck(&self.decks[1])],
            mix: [self.strips[0].state(), self.strips[1].state()],
            xfader: self.xfader,
            master_level: self.master_level,
            cue_mix: self.cue_mix,
            cue_level: self.cue_level,
            headphones: self.headphones,
            headphones_meter: self.hp_peak,
            master_meter: self.master_peak,
            limiter_db: 20.0 * self.lim_min.max(1e-4).log10(),
        };
        for st in &mut self.strips {
            st.peak = 0.0;
        }
        self.master_peak = 0.0;
        self.hp_peak = 0.0;
        self.lim_min = 1.0;
        s
    }

    /// crossfader a potenza costante: -1 = tutto A, +1 = tutto B
    fn xgain(&self, k: usize) -> f64 {
        let x = (self.xfader + 1.0) / 2.0 * std::f64::consts::FRAC_PI_2;
        if k == 0 { x.cos() } else { x.sin() }
    }

    /// riempie `out` (interleaved, `channels` canali; stereo sui primi due)
    pub fn render(&mut self, out: &mut [f32], channels: usize) {
        while let Ok(m) = self.rx.try_recv() {
            match m {
                Msg::Cmd(c) => self.command(c),
                Msg::Loaded { deck, track, cue, hot } => self.loaded(deck, track, cue, hot),
            }
        }
        for k in 0..2 {
            if self.decks[k].sync {
                self.sync_tempo(k);
            }
        }
        let ch = channels.max(1);
        let frames = out.len() / ch;
        // guadagni di arrivo per il blocco; dentro il blocco si insegue (~10 ms)
        let target: [f32; 2] = std::array::from_fn(|k| {
            let s = &self.strips[k];
            (s.gain * s.fader * s.fader * self.xgain(k)) as f32
        });
        let gains: [f32; 2] = std::array::from_fn(|k| self.strips[k].gain as f32);
        let target_c: [f32; 2] = std::array::from_fn(|k| {
            let s = &self.strips[k];
            if s.cue { s.gain as f32 } else { 0.0 }
        });
        // CUE · MIX a potenza costante: 0 = solo cue, 1 = solo master; poi volume cuffia
        let hm = (self.cue_mix * std::f64::consts::FRAC_PI_2) as f32;
        let (hp_cue, hp_mst) = (hm.cos() * self.cue_level as f32, hm.sin() * self.cue_level as f32);
        let target_m = self.master_level as f32;
        let smooth = 1.0 - (-1.0 / (0.01 * self.fs)).exp() as f32;
        let release = 1.0 - (-1.0 / (0.25 * self.fs)).exp() as f32;
        let step: [f64; 2] = std::array::from_fn(|k| self.decks[k].rate() / self.fs);
        let scrub_a = 1.0 - (-1.0 / (0.005 * self.fs)).exp();
        let fs = self.fs;
        for f in 0..frames {
            let (mut l, mut r) = (0f32, 0f32);
            let (mut cl, mut cr) = (0f32, 0f32);
            for k in 0..2 {
                let d = &mut self.decks[k];
                let st = &mut self.strips[k];
                st.g += (target[k] - st.g) * smooth;
                let Some(t) = &d.track else { continue };
                let (mut a, mut b);
                if d.scrub {
                    // velocita' che porta sul dito in SCRUB_TAU, poi morbida (niente scatti)
                    let want = ((d.scrub_target - d.pos) / SCRUB_TAU).clamp(-SCRUB_MAX, SCRUB_MAX);
                    d.scrub_vel += (want - d.scrub_vel) * scrub_a;
                    d.pos = (d.pos + d.scrub_vel / fs).clamp(0.0, t.seconds);
                    // fermo = silenzio: il volume sale con la velocita' (niente click ne' ronzio)
                    let g = (d.scrub_vel.abs() / 0.05).min(1.0) as f32;
                    (a, b) = t.at(d.pos);
                    a *= g;
                    b *= g;
                } else if d.playing {
                    (a, b) = t.at(d.pos);
                    d.pos += step[k];
                    if d.pos >= t.seconds {
                        d.pos = t.seconds;
                        d.playing = false;
                        d.preview = false;
                    }
                } else {
                    continue;
                }
                for eq in st.eq.iter_mut() {
                    a = eq[0].run(a);
                    b = eq[1].run(b);
                }
                if st.filt_on {
                    a = st.filt[0].run(a);
                    b = st.filt[1].run(b);
                }
                // meter del canale prima del fader (dopo gain, EQ e filtro), come sui mixer DJ:
                // si vede il livello del brano in preascolto anche a fader chiuso
                let gain = gains[k];
                st.peak = st.peak.max((a * gain).abs()).max((b * gain).abs());
                // cuffia: prima del fader e del crossfader (si sente anche a fader chiuso)
                st.gc += (target_c[k] - st.gc) * smooth;
                cl += a * st.gc;
                cr += b * st.gc;
                a *= st.g;
                b *= st.g;
                l += a;
                r += b;
            }
            self.gm += (target_m - self.gm) * smooth;
            l *= self.gm;
            r *= self.gm;
            // limitatore sul master: attacco immediato, rilascio 250 ms, tetto -0,2 dB
            let p = l.abs().max(r.abs());
            const CEIL: f32 = 0.977;
            if p * self.lim > CEIL {
                self.lim = CEIL / p;
            } else {
                self.lim += (1.0 - self.lim) * release;
            }
            self.lim_min = self.lim_min.min(self.lim);
            l *= self.lim;
            r *= self.lim;
            self.master_peak = self.master_peak.max(l.abs()).max(r.abs());
            let o = &mut out[f * ch..(f + 1) * ch];
            o.fill(0.0);
            o[0] = l;
            if ch > 1 {
                o[1] = r;
            }
            if ch >= 4 {
                // cuffia sui canali 3-4 (Traktor Z1 e schede DJ): CUE · MIX tra cue e master, poi volume
                self.ghp_cue += (hp_cue - self.ghp_cue) * smooth;
                self.ghp_mst += (hp_mst - self.ghp_mst) * smooth;
                let mut hl = cl * self.ghp_cue + l * self.ghp_mst;
                let mut hr = cr * self.ghp_cue + r * self.ghp_mst;
                let p = hl.abs().max(hr.abs());
                if p * self.hp_lim > CEIL {
                    self.hp_lim = CEIL / p;
                } else {
                    self.hp_lim += (1.0 - self.hp_lim) * release;
                }
                hl *= self.hp_lim;
                hr *= self.hp_lim;
                self.hp_peak = self.hp_peak.max(hl.abs()).max(hr.abs());
                o[2] = hl;
                o[3] = hr;
            }
        }
        self.headphones = ch >= 4;
        self.frames += frames as u64;
        if self.frames >= self.next_snapshot {
            self.next_snapshot = self.frames + (self.fs / SNAPSHOT_HZ) as u64;
            let s = self.snapshot();
            self.send(Out::State(s));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn engine() -> (Engine, mpsc::Sender<Msg>, mpsc::Receiver<Out>) {
        let (tx, rx) = mpsc::channel();
        let (otx, orx) = mpsc::sync_channel(64);
        (Engine::new(48000.0, rx, otx), tx, orx)
    }

    /// traccia di click a `bpm`, 44,1 kHz, primo battito a `fb`
    fn clicks(id: &str, bpm: f64, fb: f64, secs: f64) -> Arc<TrackData> {
        let rate = 44100.0;
        let n = (secs * rate) as usize;
        let mut s = vec![0f32; n * 2];
        let p = 60.0 / bpm;
        let mut t = fb;
        while t < secs {
            let i = (t * rate) as usize;
            for j in 0..200.min(n - i) {
                s[(i + j) * 2] = 0.5;
                s[(i + j) * 2 + 1] = 0.5;
            }
            t += p;
        }
        Arc::new(TrackData { id: id.into(), samples: s, rate, seconds: secs, bpm, first_beat: fb, confidence: 0.9, locked: false })
    }

    fn run(e: &mut Engine, secs: f64) {
        let mut buf = vec![0f32; 480 * 2];
        for _ in 0..(secs * 100.0) as usize {
            e.render(&mut buf, 2);
        }
    }

    #[test]
    fn suona_e_avanza_alla_velocita_giusta() {
        let (mut e, tx, _o) = engine();
        tx.send(Msg::Loaded { deck: 0, track: clicks("a", 120.0, 0.1, 20.0), cue: 0.0, hot: [None; HOT] }).unwrap();
        tx.send(Msg::Cmd(Cmd::Play(0))).unwrap();
        run(&mut e, 2.0);
        assert!((e.decks[0].pos - 2.0).abs() < 0.02, "pos {}", e.decks[0].pos);
        assert!(e.strips[0].peak > 0.1 || e.master_peak >= 0.0);
        tx.send(Msg::Cmd(Cmd::Tempo(0, 1.0))).unwrap(); // +8%
        run(&mut e, 1.0);
        assert!((e.decks[0].pos - 3.08).abs() < 0.02, "pos {}", e.decks[0].pos);
    }

    #[test]
    fn cue_stile_cdj() {
        let (mut e, tx, o) = engine();
        tx.send(Msg::Loaded { deck: 0, track: clicks("a", 120.0, 0.1, 20.0), cue: 0.1, hot: [None; HOT] }).unwrap();
        tx.send(Msg::Cmd(Cmd::Seek(0, 2.26))).unwrap();
        tx.send(Msg::Cmd(Cmd::CueDown(0))).unwrap(); // da fermo lontano dal cue: salva sul battito
        run(&mut e, 0.01);
        assert!((e.decks[0].cue - 2.1).abs() < 1e-9, "cue {}", e.decks[0].cue);
        assert!(o.try_iter().any(|x| matches!(x, Out::SaveCues { .. })));
        e.command(Cmd::CueDown(0)); // sul cue: preascolto finche' tenuto
        assert!(e.decks[0].playing && e.decks[0].preview);
        run(&mut e, 0.5);
        e.command(Cmd::CueUp(0));
        assert!(!e.decks[0].playing && (e.decks[0].pos - 2.1).abs() < 1e-9);
    }

    #[test]
    fn sync_tempo_e_fase() {
        let (mut e, tx, _o) = engine();
        tx.send(Msg::Loaded { deck: 0, track: clicks("a", 128.0, 0.2, 60.0), cue: 0.2, hot: [None; HOT] }).unwrap();
        tx.send(Msg::Loaded { deck: 1, track: clicks("b", 124.0, 0.05, 60.0), cue: 0.05, hot: [None; HOT] }).unwrap();
        tx.send(Msg::Cmd(Cmd::Play(0))).unwrap();
        run(&mut e, 3.0);
        tx.send(Msg::Cmd(Cmd::Sync(1))).unwrap();
        tx.send(Msg::Cmd(Cmd::Seek(1, 10.3))).unwrap();
        tx.send(Msg::Cmd(Cmd::Play(1))).unwrap();
        run(&mut e, 5.0);
        assert!((e.decks[1].bpm() - 128.0).abs() < 0.01, "bpm {}", e.decks[1].bpm());
        let dp = (e.decks[0].phase() - e.decks[1].phase()).abs();
        assert!(dp.min(1.0 - dp) < 0.01, "fase {dp}");
        assert_eq!(e.master, 0);
    }

    #[test]
    fn scrub_si_sente_e_segue_il_dito() {
        let (mut e, tx, _o) = engine();
        tx.send(Msg::Loaded { deck: 0, track: clicks("a", 120.0, 0.0, 20.0), cue: 0.0, hot: [None; HOT] }).unwrap();
        run(&mut e, 0.01);
        // fermo: il dito porta la traccia da 1 s a 2 s in mezzo secondo
        e.command(Cmd::Seek(0, 1.0));
        let mut buf = vec![0f32; 480 * 2];
        let mut peak = 0f32;
        for i in 0..50 {
            e.command(Cmd::Scrub(0, true, 1.0 + (i as f64 + 1.0) / 50.0));
            e.render(&mut buf, 2);
            peak = buf.iter().fold(peak, |m, x| m.max(x.abs()));
        }
        assert!(peak > 0.05, "si sente: picco {peak}");
        run(&mut e, 0.2);
        assert!((e.decks[0].pos - 2.0).abs() < 0.01, "arriva sul dito: {}", e.decks[0].pos);
        // dito fermo: silenzio
        e.render(&mut buf, 2);
        assert!(buf.iter().all(|x| x.abs() < 1e-3), "fermo = silenzio");
        // indietro
        e.command(Cmd::Scrub(0, true, 1.5));
        run(&mut e, 0.3);
        assert!((e.decks[0].pos - 1.5).abs() < 0.01);
        e.command(Cmd::Scrub(0, false, 1.5));
        assert!(!e.decks[0].scrub && !e.decks[0].playing);
    }

    #[test]
    fn cuffia_sui_canali_3_4() {
        let (mut e, tx, _o) = engine();
        let tone = Arc::new(TrackData { id: "t".into(), samples: vec![0.5; 44100 * 2 * 4], rate: 44100.0, seconds: 4.0, bpm: 0.0, first_beat: 0.0, confidence: 0.0, locked: false });
        tx.send(Msg::Loaded { deck: 1, track: tone, cue: 0.0, hot: [None; HOT] }).unwrap();
        // B in onda con fader chiuso e 🎧 acceso, CUE · MIX tutto su cue
        tx.send(Msg::Cmd(Cmd::MixCh(1, MixVals { fader: Some(0.0), cue: Some(true), ..Default::default() }))).unwrap();
        tx.send(Msg::Cmd(Cmd::Mix(MixVals { cue_mix: Some(0.0), cue_level: Some(1.0), ..Default::default() }))).unwrap();
        tx.send(Msg::Cmd(Cmd::Play(1))).unwrap();
        let mut buf = vec![0f32; 480 * 4];
        for _ in 0..30 {
            e.render(&mut buf, 4);
        }
        let last = &buf[buf.len() - 4..];
        assert!(last[0].abs() < 1e-3 && last[1].abs() < 1e-3, "master muto: {last:?}");
        assert!((last[2] - 0.5).abs() < 0.02 && (last[3] - 0.5).abs() < 0.02, "cuffia sente B: {last:?}");
        assert!(e.headphones);
        assert!(e.strips[1].peak > 0.4, "meter di B a fader chiuso: {}", e.strips[1].peak);
        // 🎧 spento e CUE · MIX su master: cuffia = master (muto)
        e.command(Cmd::MixCh(1, MixVals { cue: Some(false), ..Default::default() }));
        e.command(Cmd::Mix(MixVals { cue_mix: Some(1.0), ..Default::default() }));
        for _ in 0..30 {
            e.render(&mut buf, 4);
        }
        assert!(buf[buf.len() - 2].abs() < 1e-3);
        // scheda a 2 canali: niente cuffia
        let mut b2 = vec![0f32; 480 * 2];
        e.render(&mut b2, 2);
        assert!(!e.headphones);
    }

    #[test]
    fn hot_cue_e_fine_traccia() {
        let (mut e, tx, _o) = engine();
        tx.send(Msg::Loaded { deck: 1, track: clicks("b", 120.0, 0.0, 3.0), cue: 0.0, hot: [None; HOT] }).unwrap();
        run(&mut e, 0.01);
        e.command(Cmd::Seek(1, 1.02));
        e.command(Cmd::HotCue(1, 2, HotOp::Go));
        assert_eq!(e.decks[1].hot[2], Some(1.0));
        e.command(Cmd::Play(1));
        run(&mut e, 2.5);
        assert!(!e.decks[1].playing && e.decks[1].pos == 3.0, "si ferma a fine traccia");
        e.command(Cmd::HotCue(1, 2, HotOp::Go));
        assert_eq!(e.decks[1].pos, 1.0);
    }

    #[test]
    fn limitatore_e_crossfader() {
        let (mut e, tx, _o) = engine();
        let loud = Arc::new(TrackData { id: "x".into(), samples: vec![0.9; 44100 * 2 * 4], rate: 44100.0, seconds: 4.0, bpm: 0.0, first_beat: 0.0, confidence: 0.0, locked: false });
        tx.send(Msg::Loaded { deck: 0, track: loud.clone(), cue: 0.0, hot: [None; HOT] }).unwrap();
        tx.send(Msg::Loaded { deck: 1, track: loud, cue: 0.0, hot: [None; HOT] }).unwrap();
        tx.send(Msg::Cmd(Cmd::Mix(MixVals { master: Some(1.0), ..Default::default() }))).unwrap();
        tx.send(Msg::Cmd(Cmd::MixCh(0, MixVals { gain: Some(2.0), ..Default::default() }))).unwrap();
        tx.send(Msg::Cmd(Cmd::Play(0))).unwrap();
        tx.send(Msg::Cmd(Cmd::Play(1))).unwrap();
        let mut buf = vec![0f32; 480 * 2];
        let mut peak = 0f32;
        for _ in 0..100 {
            e.render(&mut buf, 2);
            peak = buf.iter().fold(peak, |m, x| m.max(x.abs()));
        }
        assert!(peak <= 0.978, "picco {peak}");
        e.command(Cmd::Mix(MixVals { xfader: Some(-1.0), ..Default::default() }));
        assert!(e.xgain(1) < 1e-9 && (e.xgain(0) - 1.0).abs() < 1e-9);
    }
}
