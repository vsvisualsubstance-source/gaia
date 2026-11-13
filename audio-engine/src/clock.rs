//! Orologio dello show, lato master (docs/show-clock.md).
//!
//! Stesso contratto MQTT dell'orologio di TD (gaia_client/show_clock.py):
//!   gaia/show/clock/state        retained, master -> tutti: a ogni cambio e almeno 1/s
//!   gaia/show/clock/command      chiunque -> master {"action","value"}
//!   gaia/show/clock/ping         follower -> master; risposta su .../pong/<from> (eco)
//! in piu':
//!   gaia/show/clock/timeline     retained, da chi tiene le cue (TD DMX): durata, loop,
//!                                active, cue della traccia principale. Il master la usa
//!                                per la cue corrente e per go / back / cue n.
//!   "prio" nello stato: 2 = motore audio, 1 (o assente) = TD. Un TD in ruolo "auto"
//!   segue chi ha prio piu' alta e, se tace, fa da master di riserva dalla sua posizione.
//!
//! Il tempo: contatore ad alta precisione (Instant = QueryPerformanceCounter), corretto
//! lentamente sul clock della scheda audio (campioni contati dal motore), cosi' la musica
//! e lo show non si allontanano anche in ore di show. Senza scheda: correzione 1.0.

use crate::engine::AudioCounter;
use rumqttc::{Client, Event, MqttOptions, Packet, QoS};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const TOPIC: &str = "gaia/show/clock";
pub const PRIO: i64 = 2;
const HEARTBEAT_S: f64 = 1.0;
/// all'avvio: quanto aspetto lo stato "vivo" di un altro master (TD di riserva) da cui
/// riprendere la posizione, prima di pubblicare il mio
const ADOPT_S: f64 = 2.0;
/// stato mio rimasto nel broker (riavvio del motore): lo riprendo in corsa se e' piu'
/// giovane di cosi', altrimenti riparto fermo dalla stessa posizione
const RESUME_MAX_S: f64 = 120.0;
const MAIN_TRACK: &str = "luci";

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Cue {
    pub time: f64,
    pub label: String,
    pub scene: String,
    pub fade: f64,
}

/// Trasporto dello show: posizione, play, durata, loop e cue. `now` = secondi monotoni.
pub struct Transport {
    playing: bool,
    pos0: f64,
    t0: f64,
    disc: f64,
    length: f64,
    looping: bool,
    active: bool,
    timeline: String,
    name: Value,
    bpm: Value,
    cues: Vec<Cue>,
    provider: String,
    cmd_seq: u64,
    cmd: Value,
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

impl Transport {
    pub fn new() -> Self {
        Transport {
            playing: false,
            pos0: 0.0,
            t0: 0.0,
            disc: 1.0,
            length: 0.0,
            looping: false,
            active: false,
            timeline: "show".into(),
            name: Value::Null,
            bpm: Value::Null,
            cues: Vec::new(),
            provider: String::new(),
            cmd_seq: 0,
            cmd: Value::Null,
        }
    }

    fn wrap(&self, p: f64) -> f64 {
        if self.length > 0.0 {
            if self.looping {
                p.rem_euclid(self.length)
            } else {
                p.clamp(0.0, self.length)
            }
        } else {
            p.max(0.0)
        }
    }

    pub fn pos(&self, now: f64) -> f64 {
        let mut p = self.pos0;
        if self.playing {
            p += (now - self.t0).max(0.0) * self.disc;
        }
        self.wrap(p)
    }

    #[cfg(test)]
    pub fn playing(&self) -> bool {
        self.playing
    }

    pub fn rate(&self) -> f64 {
        self.disc
    }

    fn rebase(&mut self, now: f64) {
        self.pos0 = self.pos(now);
        self.t0 = now;
    }

    fn seek(&mut self, now: f64, p: f64) {
        self.t0 = now;
        self.pos0 = self.wrap(p.max(0.0));
    }

    fn set_playing(&mut self, now: f64, on: bool) {
        self.rebase(now);
        self.playing = on;
    }

    /// correzione sul clock audio (rapporto campioni / tempo), senza salti di posizione
    pub fn set_disc(&mut self, now: f64, d: f64) {
        self.rebase(now);
        self.disc = d;
    }

    /// fine corsa senza loop: si ferma sull'ultimo istante (come TD). true = cambiato
    pub fn tick(&mut self, now: f64) -> bool {
        if self.playing && !self.looping && self.length > 0.0 {
            let raw = self.pos0 + (now - self.t0).max(0.0) * self.disc;
            if raw >= self.length {
                self.pos0 = self.length;
                self.t0 = now;
                self.playing = false;
                return true;
            }
        }
        false
    }

    /// indice (0-based) dell'ultima cue con tempo <= pos, -1 prima della prima
    pub fn cue_at(&self, pos: f64) -> i64 {
        let mut idx = -1;
        for (i, c) in self.cues.iter().enumerate() {
            if c.time <= pos {
                idx = i as i64;
            }
        }
        idx
    }

    fn jump_to_cue(&mut self, now: f64, j: usize, action: &str) -> String {
        let c = self.cues[j].clone();
        self.seek(now, c.time);
        self.cmd_seq += 1;
        self.cmd = json!({"seq": self.cmd_seq, "action": action,
            "cue": {"index": j + 1, "scene": c.scene, "fade": c.fade, "label": c.label, "time": c.time}});
        format!("cue {} @ {:.1}s", if c.label.is_empty() { (j + 1).to_string() } else { c.label }, c.time)
    }

    /// comando di trasporto (stesse azioni di show_logic.clock_command di TD)
    pub fn command(&mut self, now: f64, action: &str, value: &Value) -> Result<String, String> {
        let a = action.trim().to_lowercase();
        let msg = match a.as_str() {
            "play" => {
                let on = match value {
                    Value::Null => true,
                    Value::String(s) if s.is_empty() => true,
                    v => num(v).map(|x| x >= 0.5).unwrap_or(true),
                };
                self.set_playing(now, on);
                (if on { "play" } else { "pause" }).to_string()
            }
            "pause" => {
                self.set_playing(now, false);
                "pause".into()
            }
            "toggle" => {
                let on = !self.playing;
                self.set_playing(now, on);
                (if on { "play" } else { "pause" }).to_string()
            }
            "stop" => {
                self.playing = false;
                self.seek(now, 0.0);
                "stop".into()
            }
            "seek" => {
                let t = num(value).ok_or("seek senza secondi")?;
                let t = if self.length > 0.0 { t.clamp(0.0, self.length) } else { t.max(0.0) };
                self.seek(now, t);
                format!("seek {t:.2}s")
            }
            "go" | "back" => {
                if self.cues.is_empty() {
                    return Err(format!("nessun cue nella traccia {MAIN_TRACK}"));
                }
                let idx = self.cue_at(self.pos(now));
                let step = if a == "go" { 1 } else { -1 };
                let j = (idx + step).clamp(0, self.cues.len() as i64 - 1) as usize;
                self.jump_to_cue(now, j, &a)
            }
            "cue" => {
                let n = num(value).ok_or("cue senza numero")? as i64;
                if n < 1 || n as usize > self.cues.len() {
                    return Err(format!("cue {} non esiste ({} cue)", n, self.cues.len()));
                }
                self.jump_to_cue(now, n as usize - 1, "cue")
            }
            _ => return Err(format!("azione {a:?} sconosciuta")),
        };
        if !matches!(a.as_str(), "go" | "back" | "cue") {
            self.cmd_seq += 1;
            self.cmd = json!({"seq": self.cmd_seq, "action": a});
        }
        Ok(msg)
    }

    /// documento della timeline da TD (gaia/show/clock/timeline). true = cambiato
    pub fn set_timeline(&mut self, now: f64, d: &Value) -> bool {
        let before = (self.length, self.looping, self.active, self.cues.clone(), self.name.clone(), self.bpm.clone());
        self.rebase(now);
        if let Some(l) = d.get("length").and_then(num) {
            self.length = l.max(0.0);
        }
        if let Some(l) = d.get("loop") {
            self.looping = num(l).map(|x| x >= 0.5).unwrap_or(false);
        }
        if let Some(a) = d.get("active") {
            self.active = num(a).map(|x| x >= 0.5).unwrap_or(false);
        }
        if let Some(t) = d.get("timeline").and_then(Value::as_str) {
            self.timeline = t.to_string();
        }
        self.name = d.get("name").cloned().unwrap_or(Value::Null);
        self.bpm = d.get("bpm").cloned().unwrap_or(Value::Null);
        if let Some(cs) = d.get("cues").and_then(Value::as_array) {
            let mut v: Vec<Cue> = cs
                .iter()
                .filter_map(|c| {
                    Some(Cue {
                        time: c.get("time").and_then(num)?,
                        label: c.get("label").and_then(Value::as_str).unwrap_or("").to_string(),
                        scene: c.get("scene").and_then(Value::as_str).unwrap_or("").to_string(),
                        fade: c.get("fade").and_then(num).unwrap_or(0.0),
                    })
                })
                .collect();
            v.sort_by(|a, b| a.time.total_cmp(&b.time));
            self.cues = v;
        }
        if let Some(f) = d.get("from").and_then(Value::as_str) {
            self.provider = f.to_string();
        }
        self.pos0 = self.wrap(self.pos0);
        before != (self.length, self.looping, self.active, self.cues.clone(), self.name.clone(), self.bpm.clone())
    }

    /// riprende posizione e play da un altro master (o dal mio stato precedente)
    pub fn adopt(&mut self, now: f64, playing: bool, pos: f64) {
        self.playing = playing;
        self.seek(now, pos);
    }

    /// campi dello stato (senza v/master/seq/sent_ms, che aggiunge chi pubblica)
    pub fn state(&self, now: f64) -> Value {
        let pos = self.pos(now);
        let idx = self.cue_at(pos);
        let cue = if idx >= 0 { self.cues.get(idx as usize) } else { None };
        json!({
            "timeline": self.timeline, "name": self.name, "bpm": self.bpm,
            "playing": self.playing, "pos": (pos * 1000.0).round() / 1000.0, "rate": self.disc,
            "length": self.length, "loop": self.looping, "active": self.active,
            "cue": {"index": idx + 1, "count": self.cues.len(),
                    "label": cue.map(|c| c.label.as_str()).unwrap_or(""),
                    "scene": cue.map(|c| c.scene.as_str()).unwrap_or(""),
                    "time": cue.map(|c| c.time).unwrap_or(0.0), "track": MAIN_TRACK},
            "timeline_from": self.provider,
            "cmd": self.cmd,
        })
    }

    /// chiavi che, se cambiano, fanno pubblicare subito (come _master_tick di TD)
    fn signature(&self, now: f64) -> (bool, bool, u64, i64, u64, u64) {
        (self.playing, self.looping, self.length.to_bits(), self.cue_at(self.pos(now)), self.cmd_seq, self.cues.len() as u64)
    }
}

/// correzione lenta sul clock della scheda audio. Ogni campione e' (istante del blocco audio,
/// campioni prodotti fino li'), preso dal thread audio stesso: niente errore di lettura a
/// blocchi. Il rapporto e' la pendenza della retta sui campioni degli ultimi DISC_WINDOW_S.
struct Discipline {
    samples: Vec<(f64, u64, u64)>, // (istante, frames, fs bits)
    /// inizio della corsa attuale della scheda: i primi DISC_WARM_S si scartano (all'avvio
    /// l'uscita riempie i suoi buffer piu' in fretta del tempo reale)
    warm: Option<f64>,
}

const DISC_WINDOW_S: f64 = 60.0;
const DISC_MIN_S: f64 = 20.0;
const DISC_MAX_PPM: f64 = 300.0;
const DISC_WARM_S: f64 = 5.0;

impl Discipline {
    /// nuovo campione (una volta al secondo); Some(rapporto) quando la finestra e' buona
    fn sample(&mut self, at: f64, frames: u64, fs_bits: u64) -> Option<f64> {
        let fs = f64::from_bits(fs_bits);
        if let Some(&(t, f, b)) = self.samples.last() {
            if at <= t && frames == f {
                return None; // nessun blocco nuovo da allora
            }
            let dt = at - t;
            let ok = b == fs_bits && fs > 0.0 && frames > f && dt > 0.0 && {
                let r = (frames - f) as f64 / (dt * fs);
                (r - 1.0).abs() < 0.01 // scheda ferma, cambio uscita o thread in ritardo: si riparte
            };
            if !ok {
                self.samples.clear();
                self.warm = Some(at);
                return None;
            }
        }
        match self.warm {
            None => {
                self.warm = Some(at);
                return None;
            }
            Some(w) if at - w < DISC_WARM_S => return None,
            _ => {}
        }
        self.samples.push((at, frames, fs_bits));
        while self.samples.len() > 2 && at - self.samples[0].0 > DISC_WINDOW_S {
            self.samples.remove(0);
        }
        let (t0, f0, _) = self.samples[0];
        if at - t0 < DISC_MIN_S || fs <= 0.0 || self.samples.len() < 5 {
            return None;
        }
        // minimi quadrati: campioni = a + pendenza * tempo
        let n = self.samples.len() as f64;
        let (mut sx, mut sy) = (0.0, 0.0);
        for &(t, f, _) in &self.samples {
            sx += t - t0;
            sy += (f - f0) as f64;
        }
        let (mx, my) = (sx / n, sy / n);
        let (mut sxy, mut sxx) = (0.0, 0.0);
        for &(t, f, _) in &self.samples {
            let (x, y) = (t - t0 - mx, (f - f0) as f64 - my);
            sxy += x * y;
            sxx += x * x;
        }
        let r = sxy / sxx / fs;
        ((r - 1.0).abs() * 1e6 <= DISC_MAX_PPM).then_some(r)
    }
}

pub struct ClockOpts {
    pub id: String,
    /// prefisso dei topic (default TOPIC; diverso solo per le prove)
    pub topic: String,
    pub host: String,
    pub port: u16,
}

pub fn parse_broker(s: &str) -> Result<(String, u16), String> {
    let s = s.trim().trim_start_matches("mqtt://");
    match s.rsplit_once(':') {
        Some((h, p)) => Ok((h.to_string(), p.parse().map_err(|_| format!("porta del broker non valida: {s}"))?)),
        None => Ok((s.to_string(), 1883)),
    }
}

fn epoch_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct Shared {
    tr: Transport,
    seq: u64,
    dirty: bool,
    ready: bool,       // finita l'attesa iniziale: pubblico
    adopted: bool,     // posizione gia' ripresa (da un master vivo o dal mio stato)
    resume: Option<(bool, f64)>, // dallo stato di un altro master rimasto nel broker
    other: Option<(String, f64)>, // altro master con la mia prio o piu' alta, visto a...
}

/// avvia l'orologio: un thread per MQTT, uno per il tempo. Non blocca.
pub fn start(o: ClockOpts, audio: Arc<AudioCounter>) {
    let now = crate::engine::mono;
    let sh = Arc::new(Mutex::new(Shared { tr: Transport::new(), seq: 0, dirty: true, ready: false, adopted: false, resume: None, other: None }));
    let mut mo = MqttOptions::new(format!("{}-clock", o.id), o.host.clone(), o.port);
    mo.set_keep_alive(Duration::from_secs(5));
    mo.set_clean_session(true);
    let (client, mut conn) = Client::new(mo, 256);
    println!("orologio dello show: master {} su {}:{} ({})", o.id, o.host, o.port, o.topic);
    let topic = o.topic.clone();

    // --- MQTT: iscrizioni a ogni (ri)connessione, messaggi in arrivo
    {
        let sh = sh.clone();
        let client = client.clone();
        let id = o.id.clone();
        let topic = topic.clone();
        thread::Builder::new().name("clock-mqtt".into()).spawn(move || {
            let mut was_err = false;
            for ev in conn.iter() {
                match ev {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        if was_err {
                            println!("orologio: broker di nuovo raggiungibile");
                        }
                        was_err = false;
                        for t in ["state", "command", "ping", "timeline"] {
                            let _ = client.try_subscribe(format!("{topic}/{t}"), QoS::AtMostOnce);
                        }
                        if let Ok(mut s) = sh.lock() {
                            s.dirty = true;
                        }
                    }
                    Ok(Event::Incoming(Packet::Publish(p))) => {
                        let Ok(d) = serde_json::from_slice::<Value>(&p.payload) else { continue };
                        if !d.is_object() {
                            continue;
                        }
                        let sub = p.topic.strip_prefix(topic.as_str()).unwrap_or("").trim_start_matches('/');
                        let t = now();
                        match sub {
                            "ping" => {
                                if let Some(from) = d.get("from").and_then(Value::as_str) {
                                    let _ = client.try_publish(format!("{topic}/pong/{from}"), QoS::AtMostOnce, false, p.payload.to_vec());
                                }
                            }
                            "command" => {
                                let action = d.get("action").and_then(Value::as_str).unwrap_or("").to_string();
                                let value = d.get("value").cloned().unwrap_or(Value::Null);
                                let from = d.get("from").and_then(Value::as_str).unwrap_or("?").to_string();
                                if let Ok(mut s) = sh.lock() {
                                    match s.tr.command(t, &action, &value) {
                                        Ok(m) => println!("orologio: {m} (da {from})"),
                                        Err(e) => println!("orologio: comando {action} rifiutato: {e} (da {from})"),
                                    }
                                    s.dirty = true;
                                }
                            }
                            "timeline" => {
                                if let Ok(mut s) = sh.lock() {
                                    if s.tr.set_timeline(t, &d) {
                                        s.dirty = true;
                                    }
                                }
                            }
                            "state" => {
                                let master = d.get("master").and_then(Value::as_str).unwrap_or("");
                                let Ok(mut s) = sh.lock() else { continue };
                                let playing = d.get("playing").and_then(Value::as_bool).unwrap_or(false);
                                let pos = d.get("pos").and_then(num).unwrap_or(0.0);
                                if master == id {
                                    // il mio stato di prima del riavvio (stesso PC: l'ora e' confrontabile)
                                    if p.retain && !s.adopted {
                                        let age = d.get("sent_ms").and_then(Value::as_u64).map(|m| epoch_ms().saturating_sub(m) as f64 / 1000.0);
                                        let run = playing && age.is_some_and(|a| a < RESUME_MAX_S);
                                        let rate = d.get("rate").and_then(num).unwrap_or(1.0);
                                        let p2 = if run { pos + age.unwrap_or(0.0) * rate } else { pos };
                                        s.tr.adopt(t, run, p2);
                                        s.adopted = true;
                                        println!("orologio: riprendo il mio stato ({} @ {:.2}s)", if run { "play" } else { "fermo" }, p2);
                                    }
                                    continue;
                                }
                                let prio = d.get("prio").and_then(Value::as_i64).unwrap_or(1);
                                if prio >= PRIO {
                                    s.other = Some((master.to_string(), t));
                                } else if !s.ready {
                                    if p.retain {
                                        if s.adopted {
                                            continue;
                                        }
                                        // da un altro PC: l'ora non e' confrontabile, riparto fermo li'
                                        s.resume = Some((false, pos));
                                    } else {
                                        // master di riserva vivo (TD): riprendo esattamente da lui
                                        s.tr.adopt(t, playing, pos);
                                        s.adopted = true;
                                        s.ready = true;
                                        s.dirty = true;
                                        println!("orologio: riprendo da {master} ({} @ {:.2}s)", if playing { "play" } else { "fermo" }, pos);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        if !was_err {
                            eprintln!("orologio: broker non raggiungibile ({e}), riprovo");
                        }
                        was_err = true;
                        thread::sleep(Duration::from_secs(1));
                    }
                }
            }
        }).expect("thread orologio");
    }

    // --- tempo: fine corsa, correzione audio, pubblicazione
    thread::Builder::new().name("clock-tick".into()).spawn(move || {
        let t_start = now();
        let mut last_pub = -1e9;
        let mut sig = None;
        let mut disc = Discipline { samples: Vec::new(), warm: None };
        let mut next_disc = 0.0;
        let mut warned = -1e9;
        loop {
            thread::sleep(Duration::from_millis(5));
            let t = now();
            let Ok(mut s) = sh.lock() else { return };
            if !s.ready {
                if t - t_start < ADOPT_S {
                    continue;
                }
                if !s.adopted {
                    if let Some((pl, pos)) = s.resume.take() {
                        s.tr.adopt(t, pl, pos);
                        println!("orologio: riparto fermo a {pos:.2}s (stato lasciato da un altro master)");
                    }
                    s.adopted = true;
                }
                s.ready = true;
                s.dirty = true;
            }
            if s.tr.tick(t) {
                s.dirty = true;
            }
            if t >= next_disc {
                next_disc = t + 1.0;
                let fs = audio.fs.load(Ordering::Relaxed);
                if let Some(r) = audio.load().and_then(|(frames, at)| disc.sample(at, frames, fs)) {
                    let cur = s.tr.rate();
                    let r2 = cur + 0.1 * (r - cur);
                    if (r2 - cur).abs() > 1e-7 {
                        s.tr.set_disc(t, r2);
                    }
                }
            }
            if let Some((who, at)) = &s.other {
                if t - at < 3.0 && t - warned > 10.0 {
                    warned = t;
                    eprintln!("orologio: ATTENZIONE anche {who} pubblica come master con la stessa priorita'");
                }
            }
            let sg = s.tr.signature(t);
            if s.dirty || sig != Some(sg) || t - last_pub >= HEARTBEAT_S {
                s.seq += 1;
                let mut st = s.tr.state(t);
                let m = st.as_object_mut().expect("stato");
                m.insert("v".into(), json!(1));
                m.insert("master".into(), json!(o.id));
                m.insert("prio".into(), json!(PRIO));
                m.insert("kind".into(), json!("audio"));
                m.insert("seq".into(), json!(s.seq));
                m.insert("sent_ms".into(), json!(epoch_ms()));
                let body = st.to_string();
                drop(s);
                if client.try_publish(format!("{topic}/state"), QoS::AtMostOnce, true, body).is_ok() {
                    last_pub = t;
                    sig = Some(sg);
                    if let Ok(mut s) = sh.lock() {
                        s.dirty = false;
                    }
                }
            }
        }
    }).expect("thread orologio");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tl() -> Value {
        json!({"from": "td-dmx-ops", "length": 100.0, "loop": false, "active": true, "name": "Prova",
               "cues": [{"time": 30.0, "label": "B", "scene": "s2", "fade": 2.0},
                        {"time": 0.0, "label": "A", "scene": "s1", "fade": 1.0},
                        {"time": 60.0, "label": "", "scene": "s3", "fade": 0.5}]})
    }

    #[test]
    fn play_pause_seek() {
        let mut t = Transport::new();
        t.set_timeline(0.0, &tl());
        t.command(0.0, "play", &Value::Null).unwrap();
        assert!((t.pos(10.0) - 10.0).abs() < 1e-9);
        t.command(10.0, "pause", &Value::Null).unwrap();
        assert!((t.pos(20.0) - 10.0).abs() < 1e-9);
        t.command(20.0, "seek", &json!(45)).unwrap();
        assert_eq!(t.pos(25.0), 45.0);
        t.command(25.0, "seek", &json!("500")).unwrap();
        assert_eq!(t.pos(25.0), 100.0);
        t.command(25.0, "play", &json!(0)).unwrap();
        assert!(!t.playing());
        t.command(25.0, "toggle", &Value::Null).unwrap();
        assert!(t.playing());
        t.command(26.0, "stop", &Value::Null).unwrap();
        assert!(!t.playing() && t.pos(30.0) == 0.0);
        assert!(t.command(0.0, "salta", &Value::Null).is_err());
    }

    #[test]
    fn end_and_loop() {
        let mut t = Transport::new();
        t.set_timeline(0.0, &tl());
        t.command(0.0, "seek", &json!(95)).unwrap();
        t.command(0.0, "play", &Value::Null).unwrap();
        assert!(!t.tick(4.0));
        assert!(t.tick(6.0));
        assert!(!t.playing() && t.pos(7.0) == 100.0);
        let mut l = tl();
        l["loop"] = json!(true);
        t.set_timeline(7.0, &l);
        t.command(7.0, "seek", &json!(95)).unwrap();
        t.command(7.0, "play", &Value::Null).unwrap();
        assert!(!t.tick(17.0));
        assert!((t.pos(17.0) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn cues_go_back() {
        let mut t = Transport::new();
        assert!(t.command(0.0, "go", &Value::Null).is_err());
        t.set_timeline(0.0, &tl());
        assert_eq!(t.cue_at(29.9), 0);
        assert_eq!(t.cue_at(30.0), 1);
        t.command(0.0, "seek", &json!(31)).unwrap();
        t.command(0.0, "go", &Value::Null).unwrap();
        assert_eq!(t.pos(0.0), 60.0);
        t.command(0.0, "go", &Value::Null).unwrap();
        assert_eq!(t.pos(0.0), 60.0, "oltre l'ultima resta sull'ultima");
        t.command(0.0, "back", &Value::Null).unwrap();
        assert_eq!(t.pos(0.0), 30.0);
        t.command(0.0, "cue", &json!(1)).unwrap();
        assert_eq!(t.pos(0.0), 0.0);
        assert!(t.command(0.0, "cue", &json!(4)).is_err());
        let st = t.state(0.0);
        assert_eq!(st["cue"]["index"], 1);
        assert_eq!(st["cue"]["count"], 3);
        assert_eq!(st["cue"]["scene"], "s1");
        assert_eq!(st["cmd"]["action"], "cue");
        assert_eq!(st["cmd"]["cue"]["fade"], 1.0);
        assert_eq!(st["active"], true);
        assert_eq!(st["timeline_from"], "td-dmx-ops");
    }

    #[test]
    fn timeline_shorter_clamps_and_no_jump_on_disc() {
        let mut t = Transport::new();
        t.set_timeline(0.0, &tl());
        t.command(0.0, "play", &Value::Null).unwrap();
        t.set_disc(50.0, 1.0001);
        assert!((t.pos(50.0) - 50.0).abs() < 1e-9);
        assert!((t.pos(60.0) - 60.001).abs() < 1e-9);
        let mut l = tl();
        l["length"] = json!(40.0);
        assert!(t.set_timeline(60.0, &l));
        assert!(!t.set_timeline(60.0, &l), "stesso documento: nessun cambio");
        assert_eq!(t.pos(60.0), 40.0);
    }

    #[test]
    fn discipline_measures_audio_clock() {
        let mut d = Discipline { samples: Vec::new(), warm: None };
        let fs = 48000f64.to_bits();
        let mut r = None;
        for i in 0..=40u64 {
            // scheda 100 ppm piu' veloce, blocchi da 480 campioni: l'istante e' quello del blocco
            let frames = ((i as f64 * 48000.0 + (i * 7 % 10) as f64 * 48.0) / 480.0).floor() as u64 * 480;
            let at = frames as f64 / (48000.0 * 1.0001);
            r = d.sample(at, frames, fs);
        }
        assert!((r.unwrap() - 1.0001).abs() < 1e-6, "{r:?}");
        // nessun blocco nuovo: niente stima, finestra intatta
        let n = d.samples.len();
        let (at, f, _) = *d.samples.last().unwrap();
        assert!(d.sample(at, f, fs).is_none() && d.samples.len() == n);
        // scheda ferma a lungo (uscita persa) e poi riparte: la finestra riparte
        assert!(d.sample(at + 5.0, f + 480, fs).is_none() && d.samples.is_empty());
        // i primi secondi dopo la ripartenza si scartano
        assert!(d.sample(at + 7.0, f + 480 + 96000, fs).is_none() && d.samples.is_empty());
        assert!(d.sample(at + 11.0, f + 480 + 288000, fs).is_none() && d.samples.len() == 1);
        // cambio di frequenza: riparte
        assert!(d.sample(at + 12.0, f + 44100, 44100f64.to_bits()).is_none() && d.samples.is_empty());
    }

    #[test]
    fn broker_address() {
        assert_eq!(parse_broker("mqtt://127.0.0.1:11883").unwrap(), ("127.0.0.1".into(), 11883));
        assert_eq!(parse_broker("10.0.0.2").unwrap(), ("10.0.0.2".into(), 1883));
        assert!(parse_broker("h:x").is_err());
    }
}
