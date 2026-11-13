//! Ingresso VBAN: audio in rete da un altro PC (es. il Controller sulla .73 col mixer del
//! DJ) come sorgente della copia per le luci (VB-Cable -> DMX Master), al posto del mix
//! della Console. E' il giro inverso dell'uscita (vban.rs): tutto l'audio fra le macchine
//! viaggia con una sola tecnologia (docs/console-audio.md).
//!
//! Si accetta qualsiasi formato PCM del protocollo (8/16/24/32 bit interi, float 32/64),
//! qualsiasi frequenza e numero di canali (mono -> stereo, oltre 2 si tengono i primi 2).
//! Il flusso si sceglie per nome (vuoto o "*" = qualsiasi). I campioni vanno in una coda
//! e la callback audio li legge alla frequenza del motore con un ricampionatore lineare
//! che tiene la coda intorno a TARGET_S (piccole correzioni di velocita', al massimo 0,5%).
//!
//! Sorgente delle luci: "console" (default) o "net". Con "net" e la rete muta da piu' di
//! STALE_S le luci tornano da sole sul mix della Console: mai luci al buio per un cavo.

use std::collections::VecDeque;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const RATES: [u32; 21] = [6000, 12000, 24000, 48000, 96000, 192000, 384000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 11025, 22050, 44100, 88200, 176400, 352800, 705600];
/// riempimento della coda a cui tende il ricampionatore (latenza aggiunta)
const TARGET_S: f64 = 0.04;
/// oltre questo si scarta il piu' vecchio
const MAX_S: f64 = 0.5;
/// senza pacchetti da tanto: la rete e' muta
pub const STALE_S: f64 = 0.5;
/// correzione massima della velocita' per tenere la coda al livello giusto
const MAX_ADJ: f64 = 0.005;

/// un pacchetto audio VBAN letto: frequenza, contatore, campioni stereo interleaved
#[derive(Debug, PartialEq)]
pub struct Packet {
    pub rate: f64,
    pub counter: u32,
    pub name: String,
    pub stereo: Vec<f32>,
}

/// legge un pacchetto VBAN audio PCM; None se non e' audio VBAN valido
pub fn parse(b: &[u8]) -> Option<Packet> {
    if b.len() < 28 || &b[0..4] != b"VBAN" {
        return None;
    }
    if b[4] & 0xe0 != 0 || b[7] & 0xf0 != 0 {
        return None; // non audio (seriale, testo...) o codec diverso da PCM
    }
    let rate = *RATES.get((b[4] & 0x1f) as usize)? as f64;
    let frames = b[5] as usize + 1;
    let ch = b[6] as usize + 1;
    let (size, conv): (usize, fn(&[u8]) -> f32) = match b[7] & 0x07 {
        0 => (1, |s| (s[0] as f32 - 128.0) / 128.0),
        1 => (2, |s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0),
        2 => (3, |s| i32::from_le_bytes([0, s[0], s[1], s[2]]) as f32 / 2147483648.0),
        3 => (4, |s| i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2147483648.0),
        4 => (4, |s| f32::from_le_bytes([s[0], s[1], s[2], s[3]])),
        5 => (8, |s| f64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]) as f32),
        _ => return None,
    };
    let data = &b[28..];
    if data.len() < frames * ch * size {
        return None;
    }
    let name = String::from_utf8_lossy(&b[8..24]).trim_end_matches('\0').to_string();
    let counter = u32::from_le_bytes([b[24], b[25], b[26], b[27]]);
    let mut stereo = Vec::with_capacity(frames * 2);
    for f in 0..frames {
        let at = |c: usize| conv(&data[(f * ch + c) * size..]).clamp(-1.0, 1.0);
        let l = at(0);
        let r = if ch > 1 { at(1) } else { l };
        stereo.push(l);
        stereo.push(r);
    }
    Some(Packet { rate, counter, name, stereo })
}

struct Ring {
    buf: VecDeque<f32>,
    rate: f64,
    frac: f64,
    primed: bool,
    last_rx: Option<Instant>,
    from: Option<SocketAddr>,
    /// un altro mittente con lo stesso nome, ignorato finche' il primo e' vivo
    other: Option<(SocketAddr, Instant)>,
    name: String,
    packets: u64,
    lost: u64,
    underruns: u64,
    next_counter: Option<u32>,
}

pub struct Input {
    ring: Mutex<Ring>,
    /// true = luci dalla rete (se viva), false = dalla Console
    net: AtomicBool,
    peak: AtomicU32,
    pub filter: String,
    pub port: u16,
}
pub type Shared = Arc<Input>;

pub struct Status {
    pub net: bool,
    pub fresh: bool,
    pub from: Option<SocketAddr>,
    /// altro mittente con lo stesso nome visto negli ultimi 2 s (ignorato)
    pub other: Option<SocketAddr>,
    pub name: String,
    pub rate: f64,
    pub level: f32,
    pub lost: u64,
    pub underruns: u64,
}

impl Input {
    pub fn new(filter: &str, port: u16, net: bool) -> Shared {
        let f = filter.trim();
        Arc::new(Input {
            ring: Mutex::new(Ring { buf: VecDeque::new(), rate: 0.0, frac: 0.0, primed: false, last_rx: None, from: None, other: None, name: String::new(), packets: 0, lost: 0, underruns: 0, next_counter: None }),
            net: AtomicBool::new(net),
            peak: AtomicU32::new(0),
            filter: if f == "*" { String::new() } else { f.to_string() },
            port,
        })
    }

    pub fn set_net(&self, on: bool) {
        self.net.store(on, Ordering::Relaxed);
    }

    pub fn wants_net(&self) -> bool {
        self.net.load(Ordering::Relaxed)
    }

    fn accepts(&self, name: &str) -> bool {
        self.filter.is_empty() || self.filter.eq_ignore_ascii_case(name)
    }

    /// un pacchetto arrivato (dal thread di rete)
    pub fn feed(&self, p: &Packet, from: SocketAddr, now: Instant) {
        if !self.accepts(&p.name) {
            return;
        }
        let Ok(mut r) = self.ring.lock() else { return };
        let stale = r.last_rx.is_none_or(|t| now.duration_since(t).as_secs_f64() > STALE_S);
        // un mittente alla volta: il primo vivo tiene il posto, gli altri si segnalano soltanto
        if !stale && r.from.is_some_and(|f| f.ip() != from.ip()) {
            r.other = Some((from, now));
            return;
        }
        if (r.rate - p.rate).abs() > 0.5 || stale {
            r.buf.clear();
            r.frac = 0.0;
            r.primed = false;
            r.rate = p.rate;
            r.next_counter = None;
        }
        if let Some(n) = r.next_counter {
            r.lost += p.counter.wrapping_sub(n).min(1000) as u64;
        }
        r.next_counter = Some(p.counter.wrapping_add(1));
        let pk = p.stereo.iter().fold(0f32, |m, s| m.max(s.abs())).min(1.0);
        self.peak.fetch_max(pk.to_bits(), Ordering::Relaxed);
        r.buf.extend(p.stereo.iter().copied());
        let max = (MAX_S * r.rate) as usize * 2;
        let over = r.buf.len().saturating_sub(max);
        if over > 0 {
            r.buf.drain(..over + over % 2);
        }
        r.last_rx = Some(now);
        r.from = Some(from);
        r.name = p.name.clone();
        r.packets += 1;
    }

    /// `frames` frame stereo alla frequenza `fs` in `out`. false = rete non usata (sorgente
    /// Console, o rete muta: chi chiama usa il mix della Console)
    pub fn pull(&self, out: &mut Vec<f32>, frames: usize, fs: f64, now: Instant) -> bool {
        out.clear();
        if !self.wants_net() {
            return false;
        }
        let Ok(mut r) = self.ring.lock() else { return false };
        if r.rate <= 0.0 || r.last_rx.is_none_or(|t| now.duration_since(t).as_secs_f64() > STALE_S) {
            return false;
        }
        let target = TARGET_S * r.rate;
        let fill = (r.buf.len() / 2) as f64;
        if !r.primed && fill >= target {
            r.primed = true;
        }
        let base = r.rate / fs;
        let adj = (((fill - target) / target) * 0.01).clamp(-MAX_ADJ, MAX_ADJ);
        let step = base * (1.0 + adj);
        if !r.primed || fill < frames as f64 * step + 2.0 {
            if r.primed {
                r.underruns += 1;
                r.primed = false;
            }
            out.resize(frames * 2, 0.0);
            return true; // rete viva ma in ritardo: silenzio, non il mix della Console
        }
        let mut pos = r.frac;
        for _ in 0..frames {
            let i = pos as usize;
            let t = (pos - i as f64) as f32;
            for c in 0..2 {
                let a = r.buf[i * 2 + c];
                let b = r.buf[(i + 1) * 2 + c];
                out.push(a + (b - a) * t);
            }
            pos += step;
        }
        let used = pos as usize;
        r.buf.drain(..used * 2);
        r.frac = pos - used as f64;
        true
    }

    pub fn status(&self, now: Instant) -> Status {
        let level = f32::from_bits(self.peak.swap(0, Ordering::Relaxed));
        let r = self.ring.lock();
        match r {
            Ok(r) => Status {
                net: self.wants_net(),
                fresh: r.last_rx.is_some_and(|t| now.duration_since(t).as_secs_f64() <= STALE_S),
                from: r.from,
                other: r.other.filter(|(_, t)| now.duration_since(*t).as_secs_f64() <= 2.0).map(|(a, _)| a),
                name: r.name.clone(),
                rate: r.rate,
                level,
                lost: r.lost,
                underruns: r.underruns,
            },
            Err(_) => Status { net: self.wants_net(), fresh: false, from: None, other: None, name: String::new(), rate: 0.0, level, lost: 0, underruns: 0 },
        }
    }
}

/// "Controller" o "Controller:6981" -> (nome, porta); "*" = qualsiasi nome
pub fn parse_spec(s: &str) -> Result<(String, u16), String> {
    match s.rsplit_once(':') {
        Some((n, p)) => Ok((n.to_string(), p.parse().map_err(|_| format!("--vban-in: porta non valida in {s}"))?)),
        None => Ok((s.to_string(), crate::vban::PORT)),
    }
}

/// thread che riceve i pacchetti sulla porta
pub fn start(input: Shared) -> Result<(), String> {
    let sock = UdpSocket::bind(("0.0.0.0", input.port)).map_err(|e| format!("VBAN in, porta {}: {e}", input.port))?;
    sock.set_read_timeout(Some(Duration::from_millis(250))).ok();
    thread::Builder::new()
        .name("vban-in".into())
        .spawn(move || {
            let mut buf = vec![0u8; 2048];
            loop {
                match sock.recv_from(&mut buf) {
                    Ok((n, from)) => {
                        if let Some(p) = parse(&buf[..n]) {
                            input.feed(&p, from, Instant::now());
                        }
                    }
                    Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                    Err(_) => thread::sleep(Duration::from_millis(50)),
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from() -> SocketAddr {
        "192.168.1.73:6980".parse().unwrap()
    }

    #[test]
    fn parses_our_own_packets_and_other_formats() {
        let s: Vec<f32> = (0..512).map(|i| ((i as f32) / 600.0) - 0.4).collect();
        let b = crate::vban::packet("Controller", 3, 7, &s);
        let p = parse(&b).unwrap();
        assert_eq!((p.rate, p.counter, p.name.as_str(), p.stereo.len()), (48000.0, 7, "Controller", 512));
        assert!(p.stereo.iter().zip(&s).all(|(a, b)| (a - b).abs() < 1e-4));
        // mono float 32 a 44,1 kHz
        let mut m = b"VBAN".to_vec();
        m.extend_from_slice(&[16, 1, 0, 0x04]);
        m.extend_from_slice(&[0u8; 16]);
        m.extend_from_slice(&0u32.to_le_bytes());
        m.extend_from_slice(&0.5f32.to_le_bytes());
        m.extend_from_slice(&(-0.25f32).to_le_bytes());
        let p = parse(&m).unwrap();
        assert_eq!(p.rate, 44100.0);
        assert_eq!(p.stereo, vec![0.5, 0.5, -0.25, -0.25]);
        // non audio o troppo corto
        m[4] = 0x20;
        assert!(parse(&m).is_none());
        assert!(parse(&b[..40]).is_none());
    }

    #[test]
    fn name_filter_and_fallback_to_console() {
        let inp = Input::new("Controller", 6980, true);
        let t0 = Instant::now();
        let s = vec![0.5f32; 512];
        inp.feed(&parse(&crate::vban::packet("Altro", 3, 0, &s)).unwrap(), from(), t0);
        let mut out = Vec::new();
        assert!(!inp.pull(&mut out, 480, 48000.0, t0), "nome diverso: niente rete");
        for k in 0..20 {
            inp.feed(&parse(&crate::vban::packet("controller", 3, k, &s)).unwrap(), from(), t0);
        }
        assert!(inp.pull(&mut out, 480, 48000.0, t0) && out.len() == 960);
        assert!(out.iter().all(|x| (x - 0.5).abs() < 1e-3), "{}", out[0]);
        // rete muta: si torna alla Console
        assert!(!inp.pull(&mut out, 480, 48000.0, t0 + Duration::from_secs(1)));
        // sorgente Console: la rete non si usa anche se viva
        inp.set_net(false);
        assert!(!inp.pull(&mut out, 480, 48000.0, t0));
        let st = inp.status(t0);
        assert_eq!((st.name.as_str(), st.rate, st.lost), ("controller", 48000.0, 0));
    }

    #[test]
    fn one_sender_at_a_time() {
        let inp = Input::new("Controller", 6980, true);
        let t0 = Instant::now();
        let a: SocketAddr = "192.168.1.73:6980".parse().unwrap();
        let b: SocketAddr = "192.168.1.240:50000".parse().unwrap();
        for k in 0..20 {
            inp.feed(&parse(&crate::vban::packet("Controller", 3, k, &[0.5f32; 512])).unwrap(), a, t0);
            inp.feed(&parse(&crate::vban::packet("Controller", 16, k, &[-0.9f32; 512])).unwrap(), b, t0);
        }
        let mut out = Vec::new();
        assert!(inp.pull(&mut out, 480, 48000.0, t0));
        assert!(out.iter().all(|x| (x - 0.5).abs() < 1e-3), "solo il primo mittente");
        let st = inp.status(t0);
        assert_eq!((st.from, st.other, st.rate), (Some(a), Some(b), 48000.0));
        assert!((st.level - 0.5).abs() < 1e-3, "il livello e' quello del mittente usato: {}", st.level);
        // il primo tace: il secondo prende il posto
        let t1 = t0 + Duration::from_secs(1);
        for k in 0..20 {
            inp.feed(&parse(&crate::vban::packet("Controller", 16, 100 + k, &[-0.9f32; 512])).unwrap(), b, t1);
        }
        assert_eq!(inp.status(t1).from, Some(b));
    }

    #[test]
    fn resamples_and_holds_the_queue() {
        // 44,1 kHz in rete, motore a 48 kHz: un'ora simulata a blocchi, la coda resta vicina al target
        let inp = Input::new("", 6980, true);
        let t = Instant::now();
        let mut out = Vec::new();
        let mut counter = 0u32;
        let mut produced = 0.0f64;
        let mut consumed = 0usize;
        for blk in 0..20000 {
            // la rete arriva a 256 frame per pacchetto, alla sua frequenza (con 50 ppm di differenza)
            let due = (blk + 1) as f64 * 480.0 / 48000.0 * 44100.0 * 1.00005;
            while produced + 256.0 <= due {
                let s: Vec<f32> = (0..512).map(|i| ((counter as usize * 256 + i / 2) as f32 * 0.01).sin() * 0.5).collect();
                inp.feed(&parse(&crate::vban::packet("x", 16, counter, &s)).unwrap(), from(), t);
                counter += 1;
                produced += 256.0;
            }
            assert!(inp.pull(&mut out, 480, 48000.0, t));
            consumed += out.len() / 2;
        }
        let st = inp.status(t);
        let fill = inp.ring.lock().unwrap().buf.len() as f64 / 2.0 / 44100.0;
        assert!(fill > 0.02 && fill < 0.08, "coda {fill:.3} s");
        assert!(st.underruns <= 1, "underrun {}", st.underruns);
        assert_eq!(consumed, 20000 * 480);
    }
}
