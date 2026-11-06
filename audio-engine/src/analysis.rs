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
//!
//! Poi (versione 2, 2026-11-06) la griglia si rifinisce sui COLPI DI CASSA veri:
//! 5. inviluppo della cassa a 1 ms (passa-basso 120 Hz, attacco dell'ampiezza):
//!    non si confonde con hi-hat e rullante e non dipende dalla finestra FFT;
//! 6. per ogni battito previsto il colpo piu' forte vicino; retta pesata
//!    tempo = ancora + n * periodo su tutti i colpi del brano, scartando quelli
//!    fuori posto (stima robusta): BPM al millesimo, ancora al decimo di ms;
//!    il BPM intero si tiene solo se spiega i colpi quasi come quello misurato;
//!    le due meta' del brano a confronto dicono se il tempo cambia (dal vivo);
//! 7. battito 1 della battuta: dove cambiano le sezioni (energia a 2 battute)
//!    e dove entra la cassa; cue automatico sul primo battito 1 con la cassa.

use crate::dsp::{Biquad, Kind};
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
    /// primo battito 1 di una battuta con la cassa (cue automatico), se trovato
    #[serde(default)]
    pub first_kick: Option<f64>,
    /// scarto medio dei colpi di cassa dalla griglia (ms): sotto 2-3 = griglia stretta
    #[serde(default)]
    pub residual_ms: f64,
    /// il tempo cambia lungo il brano (suonato dal vivo): griglia da controllare
    #[serde(default)]
    pub variable: bool,
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
    let mut grid = beat_grid(&env, env_rate, rate, range);
    if grid.bpm > 0.0 {
        let (kick, kick_rate, energy) = kick_envelope(mono, rate);
        match refine_on_kicks(&grid, &kick, kick_rate, &energy, mono.len() as f64 / rate as f64) {
            Some(g) => grid = g,
            // adattamento fine non riuscito: almeno la fase della cassa (non degli hi-hat)
            None => {
                let b = 60.0 / grid.bpm;
                grid.first_beat = ((kick_fold_phase(&kick, kick_rate, b) + 0.005).rem_euclid(b) * 10000.0).round() / 10000.0;
                grid.confidence = grid.confidence.min(0.3);
            }
        }
    }
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
    let none = Grid { bpm: 0.0, first_beat: 0.0, confidence: 0.0, first_kick: None, residual_ms: 0.0, variable: false };
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
    Grid { bpm: (bpm * 1000.0).round() / 1000.0, first_beat: (first * 10000.0).round() / 10000.0, confidence, first_kick: None, residual_ms: 0.0, variable: false }
}

/// valori al secondo dell'inviluppo della cassa
const KICK_RATE: f64 = 1000.0;
/// ritardo del massimo dell'attacco rispetto all'inizio del colpo (passa-basso +
/// finestra di salita), misurato sui colpi sintetici: si toglie
const KICK_LAT: f64 = 0.0062;

/// attacco della cassa a ~1 ms: passa-basso 120 Hz (due biquad), ampiezza RMS per
/// blocchi da 1 ms, salita dell'ampiezza in 4 ms (solo positiva). Restituisce anche
/// l'energia per blocco (per il battito 1 della battuta)
fn kick_envelope(x: &[f32], rate: u32) -> (Vec<f64>, f64, Vec<f64>) {
    let hop = (rate as f64 / KICK_RATE).round().max(1.0) as usize;
    let kr = rate as f64 / hop as f64;
    let mut f1 = Biquad::unity();
    f1.set(Kind::LowPass, rate as f64, 120.0, 0.707, 0.0);
    let mut f2 = f1;
    let blocks = x.len() / hop;
    let mut amp = Vec::with_capacity(blocks);
    let mut energy = Vec::with_capacity(blocks);
    for b in 0..blocks {
        let mut e = 0f64;
        for &v in &x[b * hop..(b + 1) * hop] {
            let y = f2.run(f1.run(v)) as f64;
            e += y * y;
        }
        let e = e / hop as f64;
        energy.push(e);
        amp.push(e.sqrt());
    }
    (amp, kr, energy)
}

/// il colpo di cassa tra t-w e t+w: (INIZIO del colpo, forza). L'inizio e' dove
/// l'ampiezza bassa supera la meta' della salita (dal minimo prima del picco al picco),
/// risalendo dal picco: stesso punto per casse secche e morbide, al decimo di ms
fn strongest(amp: &[f64], kr: f64, t: f64, w: f64) -> Option<(f64, f64)> {
    let i0 = ((t - w) * kr).floor().max(1.0) as usize;
    let i1 = (((t + w) * kr).ceil() as usize).min(amp.len().saturating_sub(2));
    if i0 >= i1 {
        return None;
    }
    let (mut pk, mut pv) = (i0, 0f64);
    for i in i0..=i1 {
        if amp[i] > pv {
            pv = amp[i];
            pk = i;
        }
    }
    let back = (0.08 * kr) as usize;
    let lo = pk.saturating_sub(back);
    let floor = amp[lo..=pk].iter().cloned().fold(f64::MAX, f64::min);
    let prom = pv - floor;
    if prom <= 0.0 {
        return None;
    }
    // colpo pulito: parte da un livello basso (cassa da sola); sopra un basso continuo
    // il livello prima del colpo e' alto e il punto d'inizio e' incerto: pesa poco
    let clean = (prom / pv).powi(3);
    let level = floor + 0.5 * prom;
    let mut i = pk;
    while i > lo && amp[i - 1] >= level {
        i -= 1;
    }
    // incrocio tra i-1 (sotto) e i (sopra), interpolato
    let (y0, y1) = (amp[i.saturating_sub(1)], amp[i]);
    let fr = if y1 > y0 { ((level - y0) / (y1 - y0)).clamp(0.0, 1.0) } else { 1.0 };
    Some(((i as f64 - 1.0 + fr) / kr - KICK_LAT, prom * clean))
}

/// fase della cassa: ampiezza bassa piegata sul periodo b, a 1 ms. Il picco dell'ampiezza
/// viene poco dopo l'inizio del colpo: si restituisce un po' prima (15 ms)
fn kick_fold_phase(amp: &[f64], kr: f64, b: f64) -> f64 {
    let bins = (b * kr).round().max(8.0) as usize;
    let mut h = vec![0f64; bins];
    for (i, v) in amp.iter().enumerate() {
        if *v > 0.0 {
            h[((i as f64 % (b * kr)) as usize).min(bins - 1)] += v;
        }
    }
    let peak = (0..bins).max_by(|x, y| h[*x].total_cmp(&h[*y])).unwrap_or(0);
    (peak as f64 / kr - 0.015).rem_euclid(b)
}

/// retta pesata t = a + b*n; restituisce (a, b)
fn weighted_line(p: &[(f64, f64, f64)]) -> Option<(f64, f64)> {
    let (mut sw, mut sn, mut st, mut snn, mut snt) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for &(n, t, w) in p {
        sw += w;
        sn += w * n;
        st += w * t;
        snn += w * n * n;
        snt += w * n * t;
    }
    let den = sw * snn - sn * sn;
    if sw <= 0.0 || den.abs() < 1e-12 {
        return None;
    }
    let b = (sw * snt - sn * st) / den;
    Some(((st - b * sn) / sw, b))
}

/// la griglia sui colpi di cassa veri (vedi l'intestazione, punti 5-7); None = si tiene la prima
fn refine_on_kicks(g: &Grid, k: &[f64], kr: f64, energy: &[f64], secs: f64) -> Option<Grid> {
    let mut b = 60.0 / g.bpm;
    // fase di partenza dalla CASSA, non dall'inviluppo generale (che puo' agganciarsi
    // agli hi-hat in levare): inviluppo della cassa piegato sul periodo, a 1 ms
    let mut a = kick_fold_phase(k, kr, b);
    // soglia: i colpi sotto un quarto dei colpi forti (90esimo percentile) non contano
    let mut inl: Vec<(f64, f64, f64)> = Vec::new();
    for round in 0..4 {
        let w = if round == 0 { 0.2 * b } else { 0.12 * b };
        let n_max = ((secs - a) / b).floor() as i64;
        let mut pts: Vec<(f64, f64, f64)> = (0..=n_max)
            .filter_map(|n| strongest(k, kr, a + b * n as f64, w).map(|(t, v)| (n as f64, t, v)))
            .collect();
        if pts.len() < 16 {
            return None;
        }
        let mut strengths: Vec<f64> = pts.iter().map(|p| p.2).collect();
        strengths.sort_by(|x, y| x.total_cmp(y));
        let p90 = strengths[(strengths.len() * 9 / 10).min(strengths.len() - 1)];
        pts.retain(|p| p.2 >= 0.25 * p90);
        // retta, poi via i colpi fuori posto (scarto oltre 3 MAD, almeno 6 ms) e di nuovo
        let (mut a1, mut b1) = weighted_line(&pts)?;
        for _ in 0..3 {
            let mut res: Vec<f64> = pts.iter().map(|&(n, t, _)| (t - (a1 + b1 * n)).abs()).collect();
            res.sort_by(|x, y| x.total_cmp(y));
            let mad = res[res.len() / 2] * 1.4826;
            let lim = (3.0 * mad).max(0.006);
            pts.retain(|&(n, t, _)| (t - (a1 + b1 * n)).abs() <= lim);
            if pts.len() < 16 {
                return None;
            }
            (a1, b1) = weighted_line(&pts)?;
        }
        if (60.0 / b1 - g.bpm).abs() > 1.0 {
            return None; // il tempo dei colpi non e' quello dell'inviluppo: si tiene la prima griglia
        }
        a = a1;
        b = b1;
        inl = pts;
    }
    // scarto pesato come la retta: i colpi puliti contano, quelli sopra il basso poco
    let rms = |a: f64, b: f64| { let w: f64 = inl.iter().map(|p| p.2).sum::<f64>().max(1e-12); (inl.iter().map(|&(n, t, wt)| wt * (t - (a + b * n)).powi(2)).sum::<f64>() / w).sqrt() };
    // ancora con la MEDIANA PESATA degli scarti (pendenza dalla retta): coi gruppi di colpi
    // distinti (cassa pulita contro cassa sopra il basso) sta sul gruppo piu' forte, non in mezzo
    let wmed = |v: &mut Vec<(f64, f64)>| -> f64 {
        v.sort_by(|x, y| x.0.total_cmp(&y.0));
        let half = v.iter().map(|p| p.1).sum::<f64>() / 2.0;
        let mut acc = 0.0;
        for p in v.iter() { acc += p.1; if acc >= half { return p.0; } }
        v.last().map(|p| p.0).unwrap_or(0.0)
    };
    a += wmed(&mut inl.iter().map(|&(n, t, w)| (t - (a + b * n), w)).collect());
    // dispersione robusta (mediana pesata degli scarti assoluti)
    let spread = |a: f64, b: f64| wmed(&mut inl.iter().map(|&(n, t, w)| ((t - (a + b * n)).abs(), w)).collect());
    let _ = rms;
    let mut r0 = spread(a, b);
    // BPM intero se spiega i colpi quasi come quello misurato
    let bpm_fit = 60.0 / b;
    if (bpm_fit - bpm_fit.round()).abs() < 0.02 {
        let bi = 60.0 / bpm_fit.round();
        let wsum: f64 = inl.iter().map(|p| p.2).sum();
        let ai = inl.iter().map(|&(n, t, w)| w * (t - bi * n)).sum::<f64>() / wsum;
        let ai = ai + wmed(&mut inl.iter().map(|&(n, t, w)| (t - (ai + bi * n), w)).collect());
        let ri = spread(ai, bi);
        if ri <= r0 + 0.0015 {
            a = ai;
            b = bi;
            r0 = ri;
        }
    }
    // il tempo cambia? le due meta' del brano a confronto
    let mid = inl[inl.len() / 2].0;
    let half = |first: bool| weighted_line(&inl.iter().copied().filter(|p| (p.0 < mid) == first).collect::<Vec<_>>());
    let variable = match (half(true), half(false)) {
        (Some((_, b1)), Some((_, b2))) => (60.0 / b1 - 60.0 / b2).abs() > 0.08,
        _ => false,
    };
    // copertura: colpi trovati sui battiti tra il primo e l'ultimo colpo
    let span = inl.last()?.0 - inl.first()?.0 + 1.0;
    let coverage = (inl.len() as f64 / span).min(1.0);
    // affidabilita': copertura dei colpi per la dispersione robusta (3 ms ottimo, 30 ms limite)
    let mut confidence = (coverage * (1.0 - r0 / 0.03).clamp(0.2, 1.0)).clamp(0.0, 1.0);
    if variable {
        confidence *= 0.5;
    }
    // battito 1: ancora riportata al primo battito >= 0, poi la posizione nella battuta
    // dove cambiano le sezioni (energia di 2 battute prima e dopo) e dove entra la cassa
    a = a.rem_euclid(b);
    let beats = ((secs - a) / b).floor() as usize + 1;
    let e_beat: Vec<f64> = (0..beats)
        .map(|n| {
            let i0 = ((a + b * n as f64) * kr) as usize;
            let i1 = (((a + b * (n as f64 + 1.0)) * kr) as usize).min(energy.len());
            if i0 >= i1 { 0.0 } else { energy[i0..i1].iter().sum::<f64>() / (i1 - i0) as f64 }
        })
        .collect();
    // cambio di sezione: energia di 2 battute dopo contro 2 battute prima; contano solo
    // i picchi (i battiti accanto a un cambio danno quasi lo stesso valore)
    let nov: Vec<f64> = (0..beats)
        .map(|n| {
            if n < 8 || n + 8 > beats {
                return 0.0;
            }
            let before: f64 = e_beat[n - 8..n].iter().sum();
            let after: f64 = e_beat[n..n + 8].iter().sum();
            (after - before).abs() / (after + before + 1e-12)
        })
        .collect();
    let mut score = [0f64; 4];
    for n in 1..beats.saturating_sub(1) {
        if nov[n] > 0.02 && nov[n] >= nov[n - 1] && nov[n] > nov[n + 1] {
            score[n % 4] += nov[n];
        }
    }
    let first_strong = inl.iter().find(|p| p.2 >= 0.5 * inl.iter().map(|q| q.2).fold(0.0, f64::max)).map(|p| p.0 as i64);
    let to_idx = |t: f64| ((t - a) / b).round() as i64;
    if let Some(fs) = first_strong.map(|n| inl.iter().find(|p| p.0 as i64 == n).map(|p| to_idx(p.1)).unwrap_or(0)) {
        let top = score.iter().cloned().fold(0.0, f64::max);
        score[fs.rem_euclid(4) as usize] += 0.35 * top.max(1e-9);
    }
    let j = (0..4).max_by(|x, y| score[*x].total_cmp(&score[*y])).unwrap_or(0);
    let first_beat = a + j as f64 * b;
    // cue: primo battito 1 dal primo colpo forte in poi
    let first_kick = first_strong.and_then(|n| inl.iter().find(|p| p.0 as i64 == n)).map(|p| {
        let mut i = to_idx(p.1);
        while (i - j as i64).rem_euclid(4) != 0 {
            i += 1;
        }
        ((a + b * i as f64) * 10000.0).round() / 10000.0
    });
    Some(Grid {
        bpm: ((60.0 / b) * 1000.0).round() / 1000.0,
        first_beat: (first_beat * 10000.0).round() / 10000.0,
        confidence,
        first_kick,
        residual_ms: (r0 * 1000.0 * 10.0).round() / 10.0,
        variable,
    })
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
            assert!(err < 0.002, "fase {bpm}: atteso {first}, trovato {} (errore {err:.4} s)", a.grid.first_beat);
            assert!(a.grid.confidence > 0.3, "confidenza {bpm}: {}", a.grid.confidence);
        }
    }

    // ---- brani piu' veri: cassa, hi-hat in levare, rullante, sezioni, intro, tempo che cambia ----

    struct Song {
        rate: u32,
        x: Vec<f32>,
    }
    impl Song {
        fn new(secs: f64, rate: u32) -> Self {
            let mut x = vec![0f32; (secs * rate as f64) as usize];
            let mut seed = 777u32;
            for s in x.iter_mut() {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                *s = ((seed >> 9) as f32 / (1u32 << 23) as f32 - 0.5) * 0.02;
            }
            Song { rate, x }
        }
        fn kick(&mut self, t: f64, gain: f32) {
            let r = self.rate as f64;
            let i0 = (t * r) as usize;
            for k in 0..(0.12 * r) as usize {
                let tt = k as f32 / self.rate as f32;
                if let Some(s) = self.x.get_mut(i0 + k) {
                    // la frequenza scende da 110 a 50 Hz come una cassa vera
                    let f = 50.0 + 60.0 * (-tt * 30.0).exp();
                    *s += (2.0 * std::f32::consts::PI * f * tt).sin() * (-tt * 25.0).exp() * 0.8 * gain;
                }
            }
        }
        /// rumore filtrato in alto (hi-hat) o largo (rullante)
        fn noise(&mut self, t: f64, len: f64, gain: f32, seed0: u32) {
            let r = self.rate as f64;
            let i0 = (t * r) as usize;
            let mut seed = seed0 ^ i0 as u32;
            let mut prev = 0f32;
            for k in 0..(len * r) as usize {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let n = (seed >> 9) as f32 / (1u32 << 23) as f32 - 0.5;
                let hp = n - prev; // un passa-alto grossolano
                prev = n;
                let env = (-(k as f32 / self.rate as f32) * 40.0).exp();
                if let Some(s) = self.x.get_mut(i0 + k) {
                    *s += hp * env * gain;
                }
            }
        }
        /// basso continuo (sezione piena) tra t0 e t1
        fn bass(&mut self, t0: f64, t1: f64, gain: f32) {
            let r = self.rate as f64;
            for i in (t0 * r) as usize..((t1 * r) as usize).min(self.x.len()) {
                self.x[i] += (2.0 * std::f32::consts::PI * 70.0 * (i as f32 / self.rate as f32)).sin() * gain;
            }
        }
    }
    fn phase_err(found: f64, want: f64, period: f64) -> f64 {
        let d = (found - want).rem_euclid(period);
        d.min(period - d)
    }

    #[test]
    fn la_cassa_non_l_hihat() {
        // hi-hat forti in levare e rullante sul 2 e 4: la griglia deve stare sulla cassa
        let (bpm, first, rate) = (126.0, 0.42, 44100);
        let p = 60.0 / bpm;
        let mut s = Song::new(90.0, rate);
        let mut t = first;
        let mut n = 0;
        while t < 89.0 {
            s.kick(t, 1.0);
            s.noise(t + p / 2.0, 0.05, 1.6, 9);
            if n % 2 == 1 {
                s.noise(t, 0.15, 0.9, 3);
            }
            t += p;
            n += 1;
        }
        let a = analyze(&s.x, rate, BpmRange::default());
        assert!((a.grid.bpm - bpm).abs() < 0.002, "bpm {}", a.grid.bpm);
        let e = phase_err(a.grid.first_beat, first, p);
        // forme di cassa diverse: l'inizio misurato varia di ~2-3 ms (un mix sdoppia oltre ~10 ms)
        assert!(e < 0.004, "fase sulla cassa: errore {e:.4} s (first_beat {})", a.grid.first_beat);
        assert!(a.grid.residual_ms < 3.0, "scarto {} ms", a.grid.residual_ms);
    }

    #[test]
    fn bpm_con_decimali_e_48k() {
        for (bpm, rate) in [(123.456, 48000u32), (97.13, 44100), (140.0, 48000)] {
            let p = 60.0 / bpm;
            let mut s = Song::new(180.0, rate);
            let mut t = 0.137;
            while t < 179.0 {
                s.kick(t, 1.0);
                t += p;
            }
            let a = analyze(&s.x, rate, BpmRange::default());
            assert!((a.grid.bpm - bpm).abs() < 0.002, "bpm {bpm} a {rate}: trovato {}", a.grid.bpm);
            let e = phase_err(a.grid.first_beat, 0.137, p);
            assert!(e < 0.004, "fase {bpm} a {rate}: errore {e:.4} s");
            // tre minuti dopo il battito previsto sta ancora sul colpo vero (deriva < 3 ms)
            let n = ((170.0 - 0.137) / p).round();
            let want = 0.137 + n * p;
            let pred = a.grid.first_beat + (((want - a.grid.first_beat) / (60.0 / a.grid.bpm)).round()) * 60.0 / a.grid.bpm;
            // deriva = errore dopo 3 minuti meno errore all'inizio (lo scarto fisso della forma della cassa non conta)
            let e0 = { let mut d = (a.grid.first_beat - 0.137).rem_euclid(p); if d > p / 2.0 { d -= p; } d };
            let drift = (pred - want) - e0;
            assert!(drift.abs() < 0.0015, "deriva a 3 minuti {bpm}: {:.4} s", drift);
        }
    }

    #[test]
    fn battito_1_dalle_sezioni_e_cue_sulla_cassa() {
        // 8 s di intro senza cassa (solo hi-hat), poi cassa; il battito 1 e' il 3 colpo
        // (indice 2 dall'ancora) e ogni 16 battiti dal battito 1 cambia la sezione (basso)
        let (bpm, rate) = (124.0, 44100);
        let p = 60.0 / bpm;
        let mut s = Song::new(150.0, rate);
        let a0 = 0.2;
        let bar1 = a0 + 2.0 * p; // battito 1 della battuta
        let mut n = 0;
        loop {
            let t = a0 + n as f64 * p;
            if t > 148.0 {
                break;
            }
            s.noise(t + p / 2.0, 0.04, 0.5, 5);
            if t >= 8.0 {
                s.kick(t, 1.0);
            }
            n += 1;
        }
        // sezioni: basso acceso a blocchi di 16 battiti, a partire da un battito 1 dopo l'intro
        let start = bar1 + (((8.0 - bar1) / (4.0 * p)).ceil()) * 4.0 * p;
        let mut t = start;
        let mut on = true;
        while t < 148.0 {
            if on {
                s.bass(t, (t + 16.0 * p).min(148.0), 0.25);
            }
            on = !on;
            t += 16.0 * p;
        }
        let a = analyze(&s.x, rate, BpmRange::default());
        assert!((a.grid.bpm - bpm).abs() < 0.002, "bpm {}", a.grid.bpm);
        let e = phase_err(a.grid.first_beat, bar1, 4.0 * p);
        assert!(e < 0.004, "battito 1: atteso {bar1:.4} (mod battuta), trovato {} (errore {e:.4})", a.grid.first_beat);
        let fk = a.grid.first_kick.expect("cue automatico");
        assert!(fk >= 7.9 && fk < 8.0 + 4.0 * p + 0.01, "cue automatico dopo l'intro: {fk:.3} s");
        assert!(phase_err(fk, bar1, 4.0 * p) < 0.004, "cue su un battito 1: {fk:.4}");
    }

    #[test]
    fn tempo_che_cambia_segnato() {
        // dal vivo: da 118 a 124 BPM in tre minuti
        let rate = 44100;
        let mut s = Song::new(180.0, rate);
        let mut t = 0.3;
        while t < 179.0 {
            s.kick(t, 1.0);
            let bpm = 118.0 + 6.0 * t / 180.0;
            t += 60.0 / bpm;
        }
        let a = analyze(&s.x, rate, BpmRange::default());
        assert!(a.grid.variable, "tempo che cambia non segnato (bpm {}, conf {})", a.grid.bpm, a.grid.confidence);
        assert!(a.grid.confidence < 0.6, "confidenza troppo alta per un tempo che cambia: {}", a.grid.confidence);
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

#[cfg(test)]
mod profilo {
    use super::*;
    /// profilo di un brano vero, piegato sul battito: dove cade l'energia bassa (cassa o
    /// basso), il suo attacco, e l'inviluppo generale. PROFILO=percorso cargo test -- --ignored --nocapture
    #[test]
    #[ignore]
    fn profilo_brano() {
        let Ok(p) = std::env::var("PROFILO") else { return };
        let d = crate::decode::decode(std::path::Path::new(&p)).unwrap();
        let x = d.mono();
        let rate = d.rate;
        let (env, er) = onset_envelope(&x, rate);
        let g = beat_grid(&env, er, rate, BpmRange::default());
        let (k, kr, energy) = kick_envelope(&x, rate);
        let b = 60.0 / g.bpm;
        let nb = 32usize;
        let (mut ek, mut en, mut ef) = (vec![0f64; nb], vec![0f64; nb], vec![0f64; nb]);
        for (i, v) in k.iter().enumerate() {
            let ph = ((i as f64 / kr - g.first_beat).rem_euclid(b) / b * nb as f64) as usize % nb;
            ek[ph] += v;
            en[ph] += energy[i];
        }
        for (i, v) in env.iter().enumerate() {
            let ph = ((i as f64 / er - g.first_beat).rem_euclid(b) / b * nb as f64) as usize % nb;
            ef[ph] += v;
        }
        let norm = |v: &Vec<f64>| { let m = v.iter().cloned().fold(0.0, f64::max).max(1e-12); v.iter().map(|x| (x / m * 9.0).round() as u8).collect::<Vec<_>>() };
        println!("bpm {} first_beat {} (fase 0 = ancora vecchia, 32 passi per battito)", g.bpm, g.first_beat);
        println!("attacco basse : {:?}", norm(&ek));
        println!("energia basse : {:?}", norm(&en));
        println!("flusso (tutto): {:?}", norm(&ef));
        let a = analyze(&x, rate, BpmRange::default());
        let mut dd = (a.grid.first_beat - g.first_beat).rem_euclid(b);
        if dd > b / 2.0 { dd -= b; }
        println!("nuova: bpm {} first_beat {} -> fase {:+.0} ms ({:.1} passi) scarto {} ms", a.grid.bpm, a.grid.first_beat, dd * 1000.0, dd / b * nb as f64, a.grid.residual_ms);
    }
}

#[cfg(test)]
mod scarti {
    use super::*;
    /// scarti colpo per colpo dalla griglia nuova: SCARTI=percorso cargo test -- --ignored --nocapture
    #[test]
    #[ignore]
    fn scarti_brano() {
        let Ok(p) = std::env::var("SCARTI") else { return };
        let d = crate::decode::decode(std::path::Path::new(&p)).unwrap();
        let x = d.mono();
        let a = analyze(&x, d.rate, BpmRange::default());
        let (amp, kr, _) = kick_envelope(&x, d.rate);
        let b = 60.0 / a.grid.bpm;
        let mut res = Vec::new();
        let mut n = 0.0;
        while a.grid.first_beat + n * b < x.len() as f64 / d.rate as f64 - 1.0 {
            let t = a.grid.first_beat + n * b;
            if let Some((o, s)) = strongest(&amp, kr, t, 0.12 * b) { res.push(((o - t) * 1000.0, s)); }
            n += 1.0;
        }
        let mut h = std::collections::BTreeMap::new();
        for (r, _) in &res { *h.entry(((*r / 5.0).round() * 5.0) as i64).or_insert(0) += 1; }
        println!("bpm {} scarto {} ms; istogramma scarti (ms -> battiti): {:?}", a.grid.bpm, a.grid.residual_ms, h);
        let q = res.len() / 4;
        println!("primo quarto: {:?}", res[..q.min(16)].iter().map(|r| r.0.round()).collect::<Vec<_>>());
        println!("meta':        {:?}", res[res.len()/2..res.len()/2 + 16.min(res.len()/2)].iter().map(|r| r.0.round()).collect::<Vec<_>>());
    }
}
