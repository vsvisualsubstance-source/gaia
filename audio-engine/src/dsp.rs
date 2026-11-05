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
pub const EQ_MID_HZ: f64 = 1200.0;
pub const EQ_HIGH_HZ: f64 = 3000.0;

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
