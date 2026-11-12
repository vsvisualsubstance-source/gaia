//! Uscita VBAN (VB-Audio, audio in rete su UDP): una copia del mix della
//! Console (lo stesso del tap per le luci: dopo fader e crossfader, prima del
//! master) verso altri PC, dove VBAN Receptor la mette su VB-Cable e
//! TouchDesigner la legge come scheda audio (Controller, PatchDeck).
//!
//! Pacchetto VBAN audio: intestazione di 28 byte + PCM interleaved little endian.
//!   0..4   "VBAN"
//!   4      indice della frequenza (5 bit bassi) | sottoprotocollo audio (0x00)
//!   5      campioni per canale nel pacchetto - 1 (al massimo 256)
//!   6      canali - 1
//!   7      formato: 0x01 = intero 16 bit, codec PCM
//!   8..24  nome del flusso (ASCII, completato con zeri)
//!   24..28 contatore dei pacchetti (u32 little endian)
//! Il ricevente sceglie il flusso per nome e IP del mittente; porta standard 6980.

use std::collections::VecDeque;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub const PORT: u16 = 6980;
pub const MAX_FRAMES: usize = 256;
const CHANNELS: usize = 2;
/// coda massima (campioni interleaved): oltre, si scarta il piu' vecchio (meglio un salto che il ritardo)
const MAX_QUEUE: usize = 48000 / 4 * CHANNELS;

/// frequenze VBAN, nell'ordine dell'indice del protocollo
const RATES: [u32; 21] = [6000, 12000, 24000, 48000, 96000, 192000, 384000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 11025, 22050, 44100, 88200, 176400, 352800, 705600];

pub fn rate_index(rate: f64) -> Option<u8> {
    RATES.iter().position(|&r| (r as f64 - rate).abs() < 1.0).map(|i| i as u8)
}

/// un pacchetto VBAN da campioni stereo interleaved (al massimo MAX_FRAMES frame)
pub fn packet(name: &str, rate_idx: u8, counter: u32, samples: &[f32]) -> Vec<u8> {
    let frames = samples.len() / CHANNELS;
    debug_assert!(frames >= 1 && frames <= MAX_FRAMES);
    let mut p = Vec::with_capacity(28 + samples.len() * 2);
    p.extend_from_slice(b"VBAN");
    p.push(rate_idx & 0x1f);
    p.push((frames - 1) as u8);
    p.push((CHANNELS - 1) as u8);
    p.push(0x01);
    let mut n = [0u8; 16];
    for (d, s) in n.iter_mut().zip(name.bytes().filter(|b| b.is_ascii_graphic() || *b == b' ')) {
        *d = s;
    }
    p.extend_from_slice(&n);
    p.extend_from_slice(&counter.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        p.extend_from_slice(&v.to_le_bytes());
    }
    p
}

/// "192.168.1.73,10.0.0.5:6981" -> indirizzi (porta 6980 se manca)
pub fn parse_targets(s: &str) -> Result<Vec<SocketAddr>, String> {
    let mut out = Vec::new();
    for t in s.split(',').map(str::trim).filter(|t| !t.is_empty()) {
        let with_port = if t.contains(':') { t.to_string() } else { format!("{t}:{PORT}") };
        let a = with_port.to_socket_addrs().map_err(|e| format!("VBAN {t}: {e}"))?.find(|a| a.is_ipv4()).ok_or(format!("VBAN {t}: indirizzo non valido"))?;
        out.push(a);
    }
    if out.is_empty() {
        return Err("--vban senza indirizzi".into());
    }
    Ok(out)
}

/// coda tra la callback audio (push) e il thread che spedisce, con l'interruttore
/// (acceso/spento dalla Plancia, comando net.vban) e il picco del segnale mandato
pub struct Net {
    pub q: Mutex<VecDeque<f32>>,
    pub on: AtomicBool,
    peak: AtomicU32,
}
pub type Queue = Arc<Net>;

pub fn new_queue(on: bool) -> Queue {
    Arc::new(Net { q: Mutex::new(VecDeque::new()), on: AtomicBool::new(on), peak: AtomicU32::new(0) })
}

impl Net {
    pub fn set_on(&self, on: bool) {
        self.on.store(on, Ordering::Relaxed);
        if !on {
            if let Ok(mut q) = self.q.lock() {
                q.clear();
            }
        }
    }
    pub fn is_on(&self) -> bool {
        self.on.load(Ordering::Relaxed)
    }
    /// picco dall'ultima lettura (0..1), poi si riparte da zero
    pub fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0, Ordering::Relaxed))
    }
}

pub fn push(q: &Queue, samples: &[f32]) {
    if !q.is_on() {
        return;
    }
    // per float non negativi l'ordine dei bit e' quello dei valori: fetch_max basta
    let p = samples.iter().fold(0f32, |m, s| m.max(s.abs())).min(1.0);
    q.peak.fetch_max(p.to_bits(), Ordering::Relaxed);
    if let Ok(mut d) = q.q.lock() {
        d.extend(samples.iter().copied());
        let over = d.len().saturating_sub(MAX_QUEUE);
        if over > 0 {
            d.drain(..over + over % CHANNELS);
        }
    }
}

/// thread che svuota la coda in pacchetti da 256 frame e li manda a tutti gli indirizzi.
/// rate: frequenza del motore (letta a ogni giro: cambia se cambia la scheda)
pub fn start(q: Queue, targets: Vec<SocketAddr>, name: String, rate: Arc<Mutex<f64>>, run: Arc<AtomicBool>) -> Result<(), String> {
    let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("VBAN: {e}"))?;
    thread::spawn(move || {
        let mut counter: u32 = 0;
        let mut buf: Vec<f32> = Vec::with_capacity(MAX_FRAMES * CHANNELS);
        let mut warned = false;
        while run.load(Ordering::Relaxed) {
            let r = rate.lock().map(|r| *r).unwrap_or(48000.0);
            let Some(idx) = rate_index(r) else {
                if !warned {
                    eprintln!("VBAN: frequenza {r} Hz non prevista dal protocollo, niente invio");
                    warned = true;
                }
                if let Ok(mut d) = q.q.lock() {
                    d.clear();
                }
                thread::sleep(Duration::from_millis(50));
                continue;
            };
            loop {
                buf.clear();
                if let Ok(mut d) = q.q.lock() {
                    if d.len() < MAX_FRAMES * CHANNELS {
                        break;
                    }
                    buf.extend(d.drain(..MAX_FRAMES * CHANNELS));
                } else {
                    break;
                }
                let p = packet(&name, idx, counter, &buf);
                counter = counter.wrapping_add(1);
                for t in &targets {
                    let _ = sock.send_to(&p, t);   // un PC spento non deve fermare gli altri
                }
            }
            thread::sleep(Duration::from_millis(2));
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_and_samples() {
        let s = [0.0f32, 1.0, -1.0, 0.5];
        let p = packet("Gaia", rate_index(48000.0).unwrap(), 7, &s);
        assert_eq!(&p[0..4], b"VBAN");
        assert_eq!(p[4], 3, "48 kHz = indice 3");
        assert_eq!(p[5], 1, "2 frame -> 1");
        assert_eq!(p[6], 1, "stereo -> 1");
        assert_eq!(p[7], 1, "int16 PCM");
        assert_eq!(&p[8..12], b"Gaia");
        assert!(p[12..24].iter().all(|&b| b == 0));
        assert_eq!(u32::from_le_bytes(p[24..28].try_into().unwrap()), 7);
        assert_eq!(p.len(), 28 + 8);
        assert_eq!(i16::from_le_bytes([p[30], p[31]]), 32767);
        assert_eq!(i16::from_le_bytes([p[32], p[33]]), -32767);
        assert_eq!(rate_index(44100.0), Some(16));
        assert_eq!(rate_index(45000.0), None);
    }

    #[test]
    fn targets_and_queue() {
        let t = parse_targets("127.0.0.1, 127.0.0.1:7000").unwrap();
        assert_eq!(t[0].port(), PORT);
        assert_eq!(t[1].port(), 7000);
        assert!(parse_targets("").is_err());
        let q = new_queue(true);
        push(&q, &vec![0.1; MAX_QUEUE + 10]);
        assert_eq!(q.q.lock().unwrap().len(), MAX_QUEUE);
        assert!((q.take_peak() - 0.1).abs() < 1e-6);
        assert_eq!(q.take_peak(), 0.0, "il picco riparte da zero dopo la lettura");
        q.set_on(false);
        assert!(q.q.lock().unwrap().is_empty(), "spento: coda svuotata");
        push(&q, &[0.5, 0.5]);
        assert!(q.q.lock().unwrap().is_empty(), "spento: niente in coda");
        assert_eq!(q.take_peak(), 0.0);
    }

    #[test]
    fn sends_real_packets() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        rx.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let q = new_queue(true);
        let run = Arc::new(AtomicBool::new(true));
        start(q.clone(), vec![rx.local_addr().unwrap()], "Prova".into(), Arc::new(Mutex::new(48000.0)), run.clone()).unwrap();
        push(&q, &vec![0.25; MAX_FRAMES * CHANNELS * 2]);
        let mut b = [0u8; 2048];
        let (n, _) = rx.recv_from(&mut b).unwrap();
        assert_eq!(n, 28 + MAX_FRAMES * CHANNELS * 2);
        assert_eq!(b[5], 255);
        let (_, _) = rx.recv_from(&mut b).unwrap();
        assert_eq!(u32::from_le_bytes(b[24..28].try_into().unwrap()), 1, "secondo pacchetto, contatore 1");
        run.store(false, Ordering::Relaxed);
    }
}
