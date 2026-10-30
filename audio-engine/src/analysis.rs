//! Analisi di una traccia: BPM, griglia dei battiti, forma d'onda, volume.
//!
//! Griglia come Traktor: BPM costante + un'ancora (il primo battito). Va bene
//! per la musica elettronica e per quasi tutto il pop; per i brani suonati
//! con tempo che cambia si corregge a mano (library.rs: griglia bloccata).
//!
//! Metodo:
//! 1. inviluppo degli attacchi: flusso spettrale (STFT, log-magnitudo,
//!    solo aumenti), con piu' peso alle basse (cassa), 200 valori al secondo;
//! 2. tempo grezzo: autocorrelazione dell'inviluppo con armoniche
//!    (L, 2L, 3L, 4L), scelta nell'intervallo di BPM (Traktor: 88-175);
//! 3. tempo fine e fase: per BPM vicini (passo 0,005) si "piega" tutto
//!    l'inviluppo sul periodo; il BPM giusto da' il picco piu' netto e il
//!    picco e' la fase della griglia;
//! 4. BPM intero se ci si e' a meno di 0,03 (quasi tutta l'elettronica).

use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};

/// valori dell'inviluppo al secondo
const ENV_RATE: f64 = 200.0;
const FFT_SIZE: usize = 2048;
/// punti al secondo della forma d'onda dettagliata (per banda)
pub const WAVE_RATE: f64 = 50.0;
const OVERVIEW_POINTS: usize = 1000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct BpmRange {
    pub min: f64,
    pub max: f64,
}

impl Default for BpmRange {
    fn default() -> Self {
        BpmRange { min: 88.0, max: 175.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Grid {
    pub bpm: f64,
    /// secondi del primo battito (ancora della griglia)
    pub first_beat: f64,
    /// 0..1: quanto e' netto il picco della griglia
    pub confidence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Wave {
    /// panoramica: picco 0..255 per punto
    pub overview: Vec<u8>,
    /// dettaglio, WAVE_RATE punti/s: basse, medie, alte 0..255 (base64 di
    /// byte interleaved l,m,h)
    pub detail_b64: String,
}

pub struct Analysis {
    pub grid: Grid,
    pub wave: Wave,
    pub rms_db: f64,
    pub peak_db: f64,
}

pub fn analyze(mono: &[f32], rate: u32, range: BpmRange) -> Analysis {
    let (env, env_rate) = onset_envelope(mono, rate);
    let grid = beat_grid(&env, env_rate, rate, range);
    let wave = waveform(mono, rate);
    let (rms_db, peak_db) = levels(mono);
    Analysis { grid, wave, rms_db, peak_db }
}

/// inviluppo e sua frequenza reale (rate / hop: con hop intero non e' 200 esatto)
fn onset_envelope(x: &[f32], rate: u32) -> (Vec<f64>, f64) {
    let hop = (rate as f64 / ENV_RATE).round() as usize;
    let n = FFT_SIZE;
    let env_rate = rate as f64 / hop as f64;
    if x.len() < n + hop {
        return (Vec::new(), env_rate);
    }
    let window: Vec<f32> = (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos())
        .collect();
    let fft = FftPlanner::<f32>::new().plan_fft_forward(n);
    let bins = n / 2;
    let bin_hz = rate as f64 / n as f64;
    let low_cut = (150.0 / bin_hz).ceil() as usize; // cassa e basso
    let mut prev = vec![0f32; bins];
    let mut buf = vec![Complex::new(0f32, 0f32); n];
    let frames = (x.len() - n) / hop;
    let mut flux = Vec::with_capacity(frames);
    for f in 0..frames {
        let s = &x[f * hop..f * hop + n];
        for i in 0..n {
            buf[i] = Complex::new(s[i] * window[i], 0.0);
        }
        fft.process(&mut buf);
        let (mut lo, mut all) = (0f64, 0f64);
        for k in 1..bins {
            let m = (1.0 + 100.0 * buf[k].norm()).ln();
            let d = m - prev[k];
            prev[k] = m;
            if d > 0.0 {
                all += d as f64;
                if k < low_cut {
                    lo += d as f64;
                }
            }
        }
        flux.push(all + 4.0 * lo * (bins as f64 / low_cut.max(1) as f64).sqrt() / 8.0);
    }
    // toglie la media locale (~0,5 s) e tiene solo gli attacchi
    let w = (ENV_RATE * 0.25) as usize;
    let mut out = vec![0f64; flux.len()];
    let mut acc: f64 = flux[..w.min(flux.len())].iter().sum();
    let mut cnt = w.min(flux.len());
    for i in 0..flux.len() {
        if i + w < flux.len() {
            acc += flux[i + w];
            cnt += 1;
        }
        if i > w {
            acc -= flux[i - w - 1];
            cnt -= 1;
        }
        out[i] = (flux[i] - acc / cnt as f64).max(0.0);
    }
    (out, env_rate)
}

fn interp(v: &[f64], x: f64) -> f64 {
    let i = x.floor() as usize;
    if i + 1 >= v.len() {
        return 0.0;
    }
    let f = x - i as f64;
    v[i] * (1.0 - f) + v[i + 1] * f
}

fn fold_range(mut bpm: f64, r: BpmRange) -> f64 {
    while bpm < r.min && bpm > 0.0 {
        bpm *= 2.0;
    }
    while bpm >= r.max {
        bpm /= 2.0;
    }
    bpm
}

fn beat_grid(env: &[f64], env_rate: f64, rate: u32, range: BpmRange) -> Grid {
    let none = Grid { bpm: 0.0, first_beat: 0.0, confidence: 0.0 };
    if env.len() < (env_rate * 10.0) as usize {
        return none;
    }
    // 2. autocorrelazione per i ritardi da 40 a 220 BPM
    let max_lag = (60.0 * env_rate / 40.0) as usize * 4 + 2;
    let mean = env.iter().sum::<f64>() / env.len() as f64;
    let e: Vec<f64> = env.iter().map(|v| v - mean).collect();
    let acf: Vec<f64> = (0..max_lag.min(e.len() / 2))
        .map(|l| e[..e.len() - l].iter().zip(&e[l..]).map(|(a, b)| a * b).sum())
        .collect();
    let score = |bpm: f64| {
        let lag = 60.0 * env_rate / bpm;
        (1..=4).map(|h| interp(&acf, lag * h as f64) / h as f64).sum::<f64>()
    };
    let mut best = (0.0, f64::MIN);
    let mut b = range.min;
    while b < range.max {
        let s = score(b);
        if s > best.1 {
            best = (b, s);
        }
        b += 0.05;
    }
    let coarse = fold_range(best.0, range);

    // 3. tempo fine e fase: inviluppo piegato sul periodo
    const BINS: usize = 96;
    let fold = |bpm: f64| -> (f64, f64) {
        let period = 60.0 * env_rate / bpm;
        let mut h = [0f64; BINS];
        for (i, v) in env.iter().enumerate() {
            if *v <= 0.0 {
                continue;
            }
            let pos = (i as f64 % period) / period * BINS as f64;
            let k = pos.floor() as usize % BINS;
            let f = pos - pos.floor();
            h[k] += v * (1.0 - f);
            h[(k + 1) % BINS] += v * f;
        }
        let total: f64 = h.iter().sum();
        let (k, peak) = h.iter().enumerate().fold((0, 0f64), |m, (k, v)| if *v > m.1 { (k, *v) } else { m });
        // vertice della parabola sui tre bin attorno al picco
        let (a, c) = (h[(k + BINS - 1) % BINS], h[(k + 1) % BINS]);
        let den = a - 2.0 * peak + c;
        let off = if den.abs() > 1e-12 { 0.5 * (a - c) / den } else { 0.0 };
        let phase = ((k as f64 + off) / BINS as f64).rem_euclid(1.0);
        (peak / total.max(1e-12), phase)
    };
    let mut fine = (coarse, 0.0, 0.0); // bpm, nettezza, fase
    let mut b = coarse - 1.5;
    while b <= coarse + 1.5 {
        let (sharp, phase) = fold(b);
        if sharp > fine.1 {
            fine = (b, sharp, phase);
        }
        b += 0.005;
    }
    // 4. intero se vicino
    let mut bpm = fine.0;
    if (bpm - bpm.round()).abs() < 0.03 {
        bpm = bpm.round();
        let (sharp, phase) = fold(bpm);
        fine = (bpm, sharp, phase);
    }
    let period_s = 60.0 / bpm;
    // indice dell'inviluppo -> secondi: la finestra FFT parte a i*hop e, col
    // logaritmo, l'attacco fa salire il flusso appena ci entra, a circa
    // FFT_SIZE - 1,5 hop dall'inizio (misurato coi click sintetici: costante
    // per tutti i tempi, ~39 ms a 44,1 kHz)
    let hop = rate as f64 / env_rate;
    let latency = (FFT_SIZE as f64 - 1.5 * hop) / rate as f64;
    let first = (fine.2 * period_s + latency).rem_euclid(period_s);
    // nettezza: 1/BINS = piatto (nessun battito), ~0,1+ = griglia evidente
    let confidence = ((fine.1 - 1.0 / BINS as f64) / 0.12).clamp(0.0, 1.0);
    Grid { bpm: (bpm * 1000.0).round() / 1000.0, first_beat: (first * 10000.0).round() / 10000.0, confidence }
}

fn waveform(x: &[f32], rate: u32) -> Wave {
    // tre bande con filtri a un polo: basse < 200 Hz, alte > 2 kHz
    let a_lo = 1.0 - (-2.0 * std::f32::consts::PI * 200.0 / rate as f32).exp();
    let a_mid = 1.0 - (-2.0 * std::f32::consts::PI * 2000.0 / rate as f32).exp();
    let step = (rate as f64 / WAVE_RATE).round() as usize;
    let n = x.len() / step.max(1);
    let mut detail = Vec::with_capacity(n * 3);
    let (mut lp1, mut lp2) = (0f32, 0f32);
    let mut peaks = Vec::with_capacity(n);
    for c in 0..n {
        let (mut l, mut m, mut h, mut p) = (0f32, 0f32, 0f32, 0f32);
        for &s in &x[c * step..(c + 1) * step] {
            lp1 += a_lo * (s - lp1);
            lp2 += a_mid * (s - lp2);
            l = l.max(lp1.abs());
            m = m.max((lp2 - lp1).abs());
            h = h.max((s - lp2).abs());
            p = p.max(s.abs());
        }
        let q = |v: f32| (v.min(1.0) * 255.0).round() as u8;
        detail.extend_from_slice(&[q(l), q(m), q(h)]);
        peaks.push(p);
    }
    let per = (peaks.len() as f64 / OVERVIEW_POINTS as f64).max(1.0);
    let overview = (0..OVERVIEW_POINTS.min(peaks.len()))
        .map(|i| {
            let (a, b) = ((i as f64 * per) as usize, (((i + 1) as f64 * per) as usize).min(peaks.len()));
            (peaks[a..b.max(a + 1).min(peaks.len())].iter().cloned().fold(0f32, f32::max).min(1.0) * 255.0).round() as u8
        })
        .collect();
    Wave { overview, detail_b64: base64(&detail) }
}

fn levels(x: &[f32]) -> (f64, f64) {
    let (mut sum, mut peak) = (0f64, 0f32);
    for &s in x {
        sum += (s as f64) * (s as f64);
        peak = peak.max(s.abs());
    }
    let rms = (sum / x.len().max(1) as f64).sqrt();
    let db = |v: f64| if v > 0.0 { (20.0 * v.log10() * 10.0).round() / 10.0 } else { -120.0 };
    (db(rms), db(peak as f64))
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// click di cassa sintetici a BPM noto, con un po' di rumore
    pub fn clicks_pub(bpm: f64, first: f64, secs: f64, rate: u32) -> Vec<f32> {
        clicks(bpm, first, secs, rate)
    }

    fn clicks(bpm: f64, first: f64, secs: f64, rate: u32) -> Vec<f32> {
        let n = (secs * rate as f64) as usize;
        let mut x = vec![0f32; n];
        let mut seed = 12345u32;
        for s in x.iter_mut() {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            *s = ((seed >> 9) as f32 / (1u32 << 23) as f32 - 0.5) * 0.02;
        }
        let period = 60.0 / bpm;
        let mut t = first;
        while t < secs - 0.2 {
            let i0 = (t * rate as f64) as usize;
            for k in 0..(0.08 * rate as f64) as usize {
                let tt = k as f32 / rate as f32;
                x[i0 + k] += (2.0 * std::f32::consts::PI * 55.0 * tt).sin() * (-tt * 40.0).exp() * 0.8;
            }
            t += period;
        }
        x
    }

    #[test]
    fn bpm_and_phase_of_synthetic_kicks() {
        for (bpm, first) in [(128.0, 0.31), (174.0, 0.05), (95.5, 0.6), (122.0, 0.0)] {
            let x = clicks(bpm, first, 60.0, 44100);
            let a = analyze(&x, 44100, BpmRange::default());
            assert!((a.grid.bpm - bpm).abs() < 0.02, "bpm {bpm}: trovato {}", a.grid.bpm);
            let period = 60.0 / bpm;
            let d = (a.grid.first_beat - first).rem_euclid(period);
            let err = d.min(period - d);
            assert!(err < 0.012, "fase {bpm}: atteso {first}, trovato {} (errore {err:.4} s)", a.grid.first_beat);
            assert!(a.grid.confidence > 0.3, "confidenza {bpm}: {}", a.grid.confidence);
        }
    }

    #[test]
    fn range_folds_half_and_double() {
        let r = BpmRange { min: 88.0, max: 175.0 };
        assert_eq!(fold_range(64.0, r), 128.0);
        assert_eq!(fold_range(256.0, r), 128.0);
        assert_eq!(fold_range(174.0, r), 174.0);
    }

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
    }
}

#[cfg(test)]
mod calib {
    use super::*;
    #[test]
    #[ignore]
    fn print_phase_offsets() {
        for (bpm, first) in [(128.0, 0.31), (174.0, 0.05), (95.5, 0.6), (122.0, 0.0), (140.0, 0.2)] {
            let x = super::tests::clicks_pub(bpm, first, 60.0, 44100);
            let a = analyze(&x, 44100, BpmRange::default());
            let p = 60.0 / bpm;
            let mut d = (a.grid.first_beat - first).rem_euclid(p);
            if d > p / 2.0 { d -= p; }
            println!("bpm {bpm}: trovato {} errore fase {:+.4} s conf {:.2}", a.grid.bpm, d, a.grid.confidence);
        }
    }
}
