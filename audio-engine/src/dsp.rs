//! Filtri del mixer: biquad (formule RBJ "Audio EQ Cookbook"), EQ a 3 bande
//! stile DJ e filtro unico passa basso / passa alto.

use std::f64::consts::PI;

#[derive(Clone, Copy, Default)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

// scaffali e campana: dal 14/11 l'EQ del canale e' l'isolatore, restano per prove e usi futuri
#[allow(dead_code)]
#[derive(Clone, Copy)]
pub enum Kind {
    LowShelf,
    Peak,
    HighShelf,
    LowPass,
    HighPass,
}

impl Biquad {
    pub fn unity() -> Self {
        Biquad { b0: 1.0, ..Default::default() }
    }

    /// nuovi coefficienti; lo stato resta (niente click a ogni movimento della manopola)
    pub fn set(&mut self, kind: Kind, fs: f64, f0: f64, q: f64, db: f64) {
        let f0 = f0.clamp(10.0, fs * 0.45);
        let w = 2.0 * PI * f0 / fs;
        let (s, c) = (w.sin(), w.cos());
        let a = 10f64.powf(db / 40.0);
        let alpha = s / (2.0 * q);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            Kind::Peak => (1.0 + alpha * a, -2.0 * c, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * c, 1.0 - alpha / a),
            Kind::LowShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * c + k),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * c),
                    a * ((a + 1.0) - (a - 1.0) * c - k),
                    (a + 1.0) + (a - 1.0) * c + k,
                    -2.0 * ((a - 1.0) + (a + 1.0) * c),
                    (a + 1.0) + (a - 1.0) * c - k,
                )
            }
            Kind::HighShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * c + k),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * c),
                    a * ((a + 1.0) + (a - 1.0) * c - k),
                    (a + 1.0) - (a - 1.0) * c + k,
                    2.0 * ((a - 1.0) - (a + 1.0) * c),
                    (a + 1.0) - (a - 1.0) * c - k,
                )
            }
            Kind::LowPass => ((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Kind::HighPass => ((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
        };
        self.b0 = (b0 / a0) as f32;
        self.b1 = (b1 / a0) as f32;
        self.b2 = (b2 / a0) as f32;
        self.a1 = (a1 / a0) as f32;
        self.a2 = (a2 / a0) as f32;
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        // forma diretta II trasposta
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// manopola EQ -1..1 -> dB: a destra fino a +6, a sinistra fino a -24, tutto a sinistra = taglio
pub fn eq_db(v: f64) -> f64 {
    if v >= 0.0 {
        v * 6.0
    } else if v <= -0.98 {
        -70.0
    } else {
        v * 24.0
    }
}

pub const EQ_LOW_HZ: f64 = 250.0;
#[allow(dead_code)] // la campana dei medi di prima; i medi ora sono la banda tra EQ_LOW_HZ e EQ_HIGH_HZ
pub const EQ_MID_HZ: f64 = 1200.0;
pub const EQ_HIGH_HZ: f64 = 3000.0;

/// EQ del canale a ISOLATORE, come sui mixer DJ (14/11/2026). Prima erano uno scaffale
/// basso, una campana e uno scaffale alto spinti fino a -70 dB: un taglio prendeva molto
/// piu' della sua banda (bassi a zero = -11 dB a 1 kHz, alti a zero = -16 dB a 1 kHz,
/// medi a zero = -11 dB a 60 Hz) e i medi sparivano. Ora il suono si divide in tre bande
/// con crossover Linkwitz-Riley del 4° ordine (due Butterworth in serie) a EQ_LOW_HZ e
/// EQ_HIGH_HZ; ogni manopola scala solo la sua banda (a zero = banda via, le altre intatte).
/// I bassi passano da un tutto-passa a EQ_HIGH_HZ (LP + HP LR4) per avere la stessa fase
/// delle altre due: con le manopole al centro la somma ha modulo piatto.
#[derive(Clone, Copy)]
pub struct Isolator {
    lp1: [Biquad; 2],
    hp1: [Biquad; 2],
    lp2: [Biquad; 2],
    hp2: [Biquad; 2],
    ap_lp: [Biquad; 2],
    ap_hp: [Biquad; 2],
    g: [f32; 3],
    target: [f32; 3],
}

impl Isolator {
    pub fn new(fs: f64) -> Self {
        let mut i = Isolator {
            lp1: [Biquad::unity(); 2],
            hp1: [Biquad::unity(); 2],
            lp2: [Biquad::unity(); 2],
            hp2: [Biquad::unity(); 2],
            ap_lp: [Biquad::unity(); 2],
            ap_hp: [Biquad::unity(); 2],
            g: [1.0; 3],
            target: [1.0; 3],
        };
        i.set_rate(fs);
        i
    }

    /// coefficienti dei crossover (lo stato resta)
    pub fn set_rate(&mut self, fs: f64) {
        let q = std::f64::consts::FRAC_1_SQRT_2;
        for k in 0..2 {
            self.lp1[k].set(Kind::LowPass, fs, EQ_LOW_HZ, q, 0.0);
            self.hp1[k].set(Kind::HighPass, fs, EQ_LOW_HZ, q, 0.0);
            self.lp2[k].set(Kind::LowPass, fs, EQ_HIGH_HZ, q, 0.0);
            self.hp2[k].set(Kind::HighPass, fs, EQ_HIGH_HZ, q, 0.0);
            self.ap_lp[k].set(Kind::LowPass, fs, EQ_HIGH_HZ, q, 0.0);
            self.ap_hp[k].set(Kind::HighPass, fs, EQ_HIGH_HZ, q, 0.0);
        }
    }

    /// manopole -1..1 (bassi, medi, alti) -> guadagno di ogni banda; inseguito nel run, niente click
    pub fn set_knobs(&mut self, lo: f64, mid: f64, hi: f64) {
        let lin = |v: f64| {
            let db = eq_db(v);
            if db <= -60.0 { 0.0 } else { 10f64.powf(db / 20.0) as f32 }
        };
        self.target = [lin(lo), lin(mid), lin(hi)];
    }

    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        // ~10 ms a 44,1 kHz per arrivare al nuovo guadagno
        for b in 0..3 {
            self.g[b] += (self.target[b] - self.g[b]) * 0.002;
        }
        let two = |p: &mut [Biquad; 2], v: f32| {
            let v = p[0].run(v);
            p[1].run(v)
        };
        let lo = two(&mut self.lp1, x);
        let rest = two(&mut self.hp1, x);
        let mid = two(&mut self.lp2, rest);
        let hi = two(&mut self.hp2, rest);
        let lo = two(&mut self.ap_lp, lo) + two(&mut self.ap_hp, lo);
        lo * self.g[0] + mid * self.g[1] + hi * self.g[2]
    }
}

/// filtro -1..1: sinistra passa basso (20 kHz -> 200 Hz), destra passa alto (20 Hz -> 6 kHz), centro spento
pub fn filter_setting(v: f64) -> Option<(Kind, f64)> {
    if v < -0.02 {
        Some((Kind::LowPass, 20000.0 * (200.0f64 / 20000.0).powf(-v)))
    } else if v > 0.02 {
        Some((Kind::HighPass, 20.0 * (6000.0f64 / 20.0).powf(v)))
    } else {
        None
    }
}

/// interpolazione cubica (Hermite a 4 punti) tra y1 e y2
#[inline]
pub fn hermite(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * t + c2) * t + c1) * t + y1
}

#[cfg(test)]
mod tests {
    use super::*;

    /// guadagno in regime di un biquad per una sinusoide a f
    fn gain_at(mut b: Biquad, fs: f64, f: f64) -> f64 {
        let n = (fs * 0.5) as usize;
        let mut peak = 0f32;
        for i in 0..n {
            let y = b.run((2.0 * PI * f * i as f64 / fs).sin() as f32);
            if i > n / 2 {
                peak = peak.max(y.abs());
            }
        }
        peak as f64
    }

    #[test]
    fn shelf_e_taglio() {
        let fs = 48000.0;
        let mut lo = Biquad::unity();
        lo.set(Kind::LowShelf, fs, EQ_LOW_HZ, 0.7, eq_db(-1.0));
        assert!(gain_at(lo, fs, 60.0) < 0.01, "bassi tagliati");
        assert!((gain_at(lo, fs, 8000.0) - 1.0).abs() < 0.05, "alti intatti");
        let mut flat = Biquad::unity();
        flat.set(Kind::Peak, fs, EQ_MID_HZ, 0.8, 0.0);
        assert!((gain_at(flat, fs, 1000.0) - 1.0).abs() < 0.01, "0 dB = neutro");
    }

    /// guadagno in dB dell'isolatore per una sinusoide a f
    fn iso_db(mut i: Isolator, fs: f64, f: f64) -> f64 {
        let n = (fs * 0.6) as usize;
        let mut peak = 0f32;
        for k in 0..n {
            let y = i.run((2.0 * PI * f * k as f64 / fs).sin() as f32);
            if k > n / 2 {
                peak = peak.max(y.abs());
            }
        }
        20.0 * (peak.max(1e-9) as f64).log10()
    }

    #[test]
    fn isolatore_piatto_e_tagli_puliti() {
        let fs = 44100.0;
        let mk = |lo: f64, mid: f64, hi: f64| {
            let mut i = Isolator::new(fs);
            i.set_knobs(lo, mid, hi);
            i.g = i.target; // gia' a regime
            i
        };
        for f in [40.0, 100.0, 250.0, 600.0, 1000.0, 3000.0, 6000.0, 12000.0] {
            let d = iso_db(mk(0.0, 0.0, 0.0), fs, f);
            assert!(d.abs() < 0.2, "al centro piatto: {f} Hz {d:.2} dB");
        }
        // bassi a zero: via i bassi, i medi restano (prima -11 dB a 1 kHz)
        assert!(iso_db(mk(-1.0, 0.0, 0.0), fs, 50.0) < -35.0);
        assert!(iso_db(mk(-1.0, 0.0, 0.0), fs, 1000.0) > -0.5);
        // alti a zero: i medi restano (prima -16 dB a 1 kHz)
        assert!(iso_db(mk(0.0, 0.0, -1.0), fs, 1000.0) > -0.6);
        assert!(iso_db(mk(0.0, 0.0, -1.0), fs, 12000.0) < -35.0);
        // medi a zero: bassi e alti restano (prima -11 dB a 60 Hz, -17 dB a 10 kHz)
        assert!(iso_db(mk(0.0, -1.0, 0.0), fs, 60.0) > -0.5);
        assert!(iso_db(mk(0.0, -1.0, 0.0), fs, 10000.0) > -0.6);
        assert!(iso_db(mk(0.0, -1.0, 0.0), fs, 1000.0) < -20.0);
        // a destra +6 dB sulla banda
        let up = iso_db(mk(0.0, 1.0, 0.0), fs, 1000.0);
        assert!((up - 6.0).abs() < 0.8, "medi +6: {up:.2}");
    }

    #[test]
    fn filtro() {
        let fs = 48000.0;
        let (k, f) = filter_setting(-1.0).unwrap();
        let mut b = Biquad::unity();
        b.set(k, fs, f, 0.9, 0.0);
        assert!(gain_at(b, fs, 5000.0) < 0.05);
        assert!(filter_setting(0.0).is_none());
    }

    #[test]
    fn hermite_passa_dai_punti() {
        assert_eq!(hermite(0.0, 1.0, 2.0, 3.0, 0.0), 1.0);
        assert!((hermite(0.0, 1.0, 2.0, 3.0, 0.5) - 1.5).abs() < 1e-6);
    }
}
