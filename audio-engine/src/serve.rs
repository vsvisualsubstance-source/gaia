//! `gaia-audio serve`: il motore in esercizio. Uscita audio (WASAPI con
//! cpal), WebSocket di controllo su 127.0.0.1 (il bridge della Plancia e'
//! l'unico client previsto), caricamento delle tracce e salvataggio di cue e
//! hot cue accanto all'analisi (`<cache>/<id>.cues.json`, stesso formato di
//! plancia/audio-lib.js).
//!
//! Se la scheda non c'e' o sparisce, il motore continua con un clock interno
//! (niente suono, stato e comandi funzionano) e riprova ad aprirla ogni 5 s.

use crate::decode;
use crate::engine::{Cmd, Engine, HOT, HotOp, Msg, MixVals, Out, TrackData};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{Value, json};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tungstenite::Message;

pub struct ServeOpts {
    pub root: PathBuf,
    pub cache: PathBuf,
    pub port: u16,
    /// parte del nome della scheda; None = uscita predefinita di Windows
    pub device: Option<String>,
    pub no_audio: bool,
}

type Clients = Arc<Mutex<Vec<Sender<String>>>>;

fn broadcast(clients: &Clients, s: &str) {
    if let Ok(mut c) = clients.lock() {
        c.retain(|tx| tx.send(s.to_string()).is_ok());
    }
}

fn error_msg(clients: &Clients, m: &str) {
    eprintln!("errore: {m}");
    broadcast(clients, &json!({"type": "audio_error", "message": m}).to_string());
}

// ---------- comandi dal WebSocket ----------

fn deck(v: &Value) -> Option<usize> {
    match v.get("deck")?.as_str()? {
        "A" => Some(0),
        "B" => Some(1),
        _ => None,
    }
}

fn mix_vals(v: &Value) -> MixVals {
    let n = |k: &str| v.get(k).and_then(Value::as_f64);
    MixVals {
        gain: n("gain"),
        hi: n("hi"),
        mid: n("mid"),
        lo: n("lo"),
        filter: n("filter"),
        fader: n("fader"),
        cue: v.get("cue").and_then(Value::as_bool),
        xfader: n("xfader"),
        master: n("master"),
        cue_mix: n("cue_mix"),
    }
}

/// comando JSON -> Cmd; `deck.load` e' a parte (decodifica fuori dalla callback)
pub fn parse_cmd(v: &Value) -> Result<Option<Cmd>, String> {
    let cmd = v.get("cmd").and_then(Value::as_str).ok_or("comando senza cmd")?;
    let num = |k: &str| v.get(k).and_then(Value::as_f64).ok_or_else(|| format!("{cmd}: manca {k}"));
    let d = || deck(v).ok_or_else(|| format!("{cmd}: deck A o B"));
    Ok(Some(match cmd {
        "deck.play" => Cmd::Play(d()?),
        "deck.cue_down" => Cmd::CueDown(d()?),
        "deck.cue_up" => Cmd::CueUp(d()?),
        "deck.scrub" => Cmd::Scrub(d()?, v.get("active").and_then(Value::as_bool).unwrap_or(false), num("pos")?),
        "deck.jump" => Cmd::Jump(d()?, if num("dir")? < 0.0 { -1 } else { 1 }),
        "deck.snap" => Cmd::Snap(d()?),
        "deck.seek" => Cmd::Seek(d()?, num("pos")?),
        "deck.hotcue" => {
            let n = num("n")?;
            if !(0.0..HOT as f64).contains(&n) {
                return Err("deck.hotcue: n 0-7".into());
            }
            let op = if v.get("op").and_then(Value::as_str) == Some("clear") { HotOp::Clear } else { HotOp::Go };
            Cmd::HotCue(d()?, n as usize, op)
        }
        "deck.tempo" => Cmd::Tempo(d()?, num("value")?),
        "deck.range" => Cmd::Range(d()?, num("value")?),
        "deck.nudge" => Cmd::Nudge(d()?, num("value")?),
        "deck.sync" => Cmd::Sync(d()?),
        "deck.master" => Cmd::Master(d()?),
        "deck.keylock" => Cmd::Keylock(d()?),
        "deck.eject" => Cmd::Eject(d()?),
        "mix.set" => {
            let vals = mix_vals(v.get("values").unwrap_or(&Value::Null));
            match v.get("ch").and_then(Value::as_str) {
                Some("A") => Cmd::MixCh(0, vals),
                Some("B") => Cmd::MixCh(1, vals),
                Some(_) => return Err("mix.set: ch A o B".into()),
                None => Cmd::Mix(vals),
            }
        }
        // solo della pagina (zoom della forma d'onda) o richieste senza effetto
        "deck.zoom" | "hello" => return Ok(None),
        _ => return Err(format!("comando sconosciuto: {cmd}")),
    }))
}

fn valid_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// traccia analizzata -> decodificata, stereo, con griglia e punti salvati
fn load_track(root: &Path, cache: &Path, id: &str) -> Result<(TrackData, f64, [Option<f64>; HOT]), String> {
    if !valid_id(id) {
        return Err("id traccia non valido".into());
    }
    let info: Value = serde_json::from_str(&std::fs::read_to_string(cache.join(format!("{id}.json"))).map_err(|_| "traccia non analizzata")?).map_err(|e| e.to_string())?;
    let rel = info.get("path").and_then(Value::as_str).ok_or("analisi senza percorso")?;
    let g = |k: &str| info.get("grid").and_then(|x| x.get(k)).and_then(Value::as_f64).unwrap_or(0.0);
    let d = decode::decode(&root.join(rel)).map_err(|e| format!("{rel}: {e}"))?;
    let samples: Vec<f32> = match d.channels {
        1 => d.samples.iter().flat_map(|s| [*s, *s]).collect(),
        2 => d.samples,
        n => d.samples.chunks_exact(n).flat_map(|f| [f[0], f[1]]).collect(),
    };
    let seconds = samples.len() as f64 / 2.0 / d.rate as f64;
    let track = TrackData {
        id: id.to_string(),
        samples,
        rate: d.rate as f64,
        seconds,
        bpm: g("bpm"),
        first_beat: g("first_beat"),
        confidence: g("confidence"),
        locked: info.get("locked").and_then(Value::as_bool).unwrap_or(false),
    };
    let mut cue = track.first_beat;
    let mut hot = [None; HOT];
    if let Ok(s) = std::fs::read_to_string(cache.join(format!("{id}.cues.json"))) {
        if let Ok(c) = serde_json::from_str::<Value>(&s) {
            if let Some(x) = c.get("cue").and_then(Value::as_f64) {
                cue = x;
            }
            if let Some(a) = c.get("hot").and_then(Value::as_array) {
                for (i, x) in a.iter().take(HOT).enumerate() {
                    hot[i] = x.as_f64();
                }
            }
        }
    }
    Ok((track, cue, hot))
}

/// data UTC ISO 8601 senza dipendenze (algoritmo dei giorni civili di H. Hinnant)
fn iso_now() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let (secs, ms) = (d.as_secs() as i64, d.subsec_millis());
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{ms:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn save_cues(cache: &Path, id: &str, cue: f64, hot: &[Option<f64>; HOT]) -> Result<(), String> {
    if !valid_id(id) || !cache.join(format!("{id}.json")).exists() {
        return Err("solo tracce analizzate".into());
    }
    let r = |x: f64| (x.max(0.0) * 10000.0).round() / 10000.0;
    let body = json!({"cue": r(cue), "hot": hot.iter().map(|h| h.map(r)).collect::<Vec<_>>(), "updated": iso_now()});
    let p = cache.join(format!("{id}.cues.json"));
    let tmp = cache.join(format!("{id}.cues.json.tmp"));
    std::fs::write(&tmp, body.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

struct Ctx {
    root: PathBuf,
    cache: PathBuf,
    tx: Sender<Msg>,
    clients: Clients,
}

fn handle_text(ctx: &Arc<Ctx>, text: &str) {
    let v: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };
    if v.get("cmd").and_then(Value::as_str) == Some("deck.load") {
        let (Some(k), Some(id)) = (deck(&v), v.get("track").or(v.get("id")).and_then(Value::as_str)) else {
            error_msg(&ctx.clients, "deck.load: servono deck e track");
            return;
        };
        let (ctx, id) = (ctx.clone(), id.to_string());
        thread::spawn(move || match load_track(&ctx.root, &ctx.cache, &id) {
            Ok((track, cue, hot)) => {
                let _ = ctx.tx.send(Msg::Loaded { deck: k, track: Arc::new(track), cue, hot });
            }
            Err(e) => error_msg(&ctx.clients, &format!("Deck {}: traccia non caricata ({e}).", if k == 0 { "A" } else { "B" })),
        });
        return;
    }
    match parse_cmd(&v) {
        Ok(Some(c)) => {
            let _ = ctx.tx.send(Msg::Cmd(c));
        }
        Ok(None) => {}
        Err(e) => error_msg(&ctx.clients, &e),
    }
}

fn client(ctx: Arc<Ctx>, stream: TcpStream) {
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    let mut ws = match tungstenite::accept(stream) {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("WebSocket {peer}: {e}");
            return;
        }
    };
    let _ = ws.get_ref().set_read_timeout(Some(Duration::from_millis(10)));
    let (otx, orx) = mpsc::channel::<String>();
    if let Ok(mut c) = ctx.clients.lock() {
        c.push(otx);
    }
    println!("collegato: {peer}");
    loop {
        match ws.read() {
            Ok(Message::Text(t)) => handle_text(&ctx, t.as_str()),
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        while let Ok(s) = orx.try_recv() {
            if ws.send(Message::text(s)).is_err() {
                println!("scollegato: {peer}");
                return;
            }
        }
    }
    println!("scollegato: {peer}");
}

// ---------- uscita audio ----------

#[derive(Clone)]
struct OutputInfo {
    device: String,
    rate: f64,
    ok: bool,
    error: Option<String>,
}

fn find_device(want: &Option<String>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    match want {
        None => host.default_output_device().ok_or_else(|| "nessuna uscita audio predefinita".to_string()),
        Some(w) => {
            let w = w.to_lowercase();
            host.output_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.description().map(|n| n.to_string().to_lowercase().contains(&w)).unwrap_or(false))
                .ok_or_else(|| format!("uscita \"{w}\" non trovata"))
        }
    }
}

fn open_output(want: &Option<String>, engine: &Arc<Mutex<Engine>>, err_tx: Sender<String>) -> Result<(cpal::Stream, OutputInfo), String> {
    let dev = find_device(want)?;
    let name = dev.description().map(|n| n.to_string()).unwrap_or_else(|_| "?".into());
    let sup = dev.default_output_config().map_err(|e| e.to_string())?;
    if sup.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("{name}: formato {:?}, serve F32", sup.sample_format()));
    }
    let cfg = sup.config();
    let (ch, fs) = (cfg.channels as usize, cfg.sample_rate as f64);
    if let Ok(mut e) = engine.lock() {
        e.set_rate(fs);
    }
    let eng = engine.clone();
    let stream = dev
        .build_output_stream(
            cfg,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| match eng.try_lock() {
                Ok(mut e) => e.render(data, ch),
                Err(_) => data.fill(0.0),
            },
            move |e| {
                let _ = err_tx.send(e.to_string());
            },
            None,
        )
        .map_err(|e| format!("{name}: {e}"))?;
    stream.play().map_err(|e| format!("{name}: {e}"))?;
    Ok((stream, OutputInfo { device: name, rate: fs, ok: true, error: None }))
}

/// clock interno senza scheda: blocchi da 10 ms in tempo reale
fn null_clock(engine: Arc<Mutex<Engine>>, run: Arc<AtomicBool>) {
    let fs = 48000.0;
    if let Ok(mut e) = engine.lock() {
        e.set_rate(fs);
    }
    thread::spawn(move || {
        let mut buf = vec![0f32; 480 * 2];
        let t0 = Instant::now();
        let mut done: u64 = 0;
        while run.load(Ordering::Relaxed) {
            let due = (t0.elapsed().as_secs_f64() * fs) as u64;
            while done + 480 <= due {
                if let Ok(mut e) = engine.lock() {
                    e.render(&mut buf, 2);
                }
                done += 480;
            }
            thread::sleep(Duration::from_millis(5));
        }
    });
}

fn state_json(s: crate::engine::Snapshot, out: &OutputInfo) -> String {
    let [da, db] = s.decks;
    let [ma, mb] = s.mix;
    json!({
        "type": "audio_state", "t": s.t, "master": s.master,
        "decks": {"A": da, "B": db},
        "mix": {"A": ma, "B": mb, "xfader": s.xfader, "master": s.master_level, "cue_mix": s.cue_mix},
        "meters": {"master": s.master_meter, "limiter_db": s.limiter_db},
        "outputs": [{"kind": if out.ok { "wasapi" } else { "none" }, "device": out.device, "rate": out.rate, "ok": out.ok, "error": out.error}],
    })
    .to_string()
}

pub fn serve(o: ServeOpts) -> Result<(), String> {
    let (tx, rx): (Sender<Msg>, Receiver<Msg>) = mpsc::channel();
    let (otx, orx) = mpsc::sync_channel::<Out>(256);
    let engine = Arc::new(Mutex::new(Engine::new(48000.0, rx, otx)));
    let clients: Clients = Arc::new(Mutex::new(Vec::new()));

    let listener = TcpListener::bind(("127.0.0.1", o.port)).map_err(|e| format!("porta {}: {e}", o.port))?;
    let ctx = Arc::new(Ctx { root: o.root.clone(), cache: o.cache.clone(), tx, clients: clients.clone() });
    {
        let ctx = ctx.clone();
        thread::spawn(move || {
            for s in listener.incoming().flatten() {
                let ctx = ctx.clone();
                thread::spawn(move || client(ctx, s));
            }
        });
    }

    // uscita: la scheda, altrimenti clock interno e nuovo tentativo ogni 5 s
    let (err_tx, err_rx) = mpsc::channel::<String>();
    let mut stream: Option<cpal::Stream> = None;
    let mut info = OutputInfo { device: String::new(), rate: 48000.0, ok: false, error: None };
    let null_run = Arc::new(AtomicBool::new(false));
    let mut retry_at = Instant::now();
    let try_open = |stream: &mut Option<cpal::Stream>, info: &mut OutputInfo| {
        if o.no_audio {
            info.error = Some("senza audio (--no-audio)".into());
            return;
        }
        match open_output(&o.device, &engine, err_tx.clone()) {
            Ok((s, i)) => {
                null_run.store(false, Ordering::Relaxed);
                println!("uscita: {} ({} Hz)", i.device, i.rate);
                *stream = Some(s);
                *info = i;
            }
            Err(e) => {
                if info.error.as_deref() != Some(e.as_str()) {
                    eprintln!("uscita audio: {e} (continuo senza suono, riprovo ogni 5 s)");
                }
                info.ok = false;
                info.error = Some(e);
            }
        }
    };
    try_open(&mut stream, &mut info);
    if stream.is_none() {
        null_run.store(true, Ordering::Relaxed);
        null_clock(engine.clone(), null_run.clone());
    }
    println!("gaia-audio in ascolto su ws://127.0.0.1:{} (musica {}, cache {})", o.port, o.root.display(), o.cache.display());

    loop {
        match orx.recv_timeout(Duration::from_millis(200)) {
            Ok(Out::State(s)) => broadcast(&clients, &state_json(s, &info)),
            Ok(Out::SaveCues { id, cue, hot }) => {
                if let Err(e) = save_cues(&o.cache, &id, cue, &hot) {
                    error_msg(&clients, &format!("punti della traccia non salvati: {e}"));
                }
            }
            Ok(Out::Drop(t)) => drop(t),
            Ok(Out::Error(e)) => error_msg(&clients, &e),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("motore fermo".into()),
        }
        if let Ok(e) = err_rx.try_recv() {
            eprintln!("uscita audio: {e}");
            stream = None;
            info.ok = false;
            info.error = Some(e);
            retry_at = Instant::now() + Duration::from_secs(5);
            if !null_run.swap(true, Ordering::Relaxed) {
                null_clock(engine.clone(), null_run.clone());
            }
        }
        if stream.is_none() && !o.no_audio && Instant::now() >= retry_at {
            retry_at = Instant::now() + Duration::from_secs(5);
            try_open(&mut stream, &mut info);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comandi_della_pagina() {
        let p = |s: &str| parse_cmd(&serde_json::from_str(s).unwrap());
        assert!(matches!(p(r#"{"cmd":"deck.play","deck":"B"}"#), Ok(Some(Cmd::Play(1)))));
        assert!(matches!(p(r#"{"cmd":"deck.hotcue","deck":"A","n":3,"op":"clear"}"#), Ok(Some(Cmd::HotCue(0, 3, HotOp::Clear)))));
        assert!(matches!(p(r#"{"cmd":"mix.set","ch":"A","values":{"lo":-1,"cue":true}}"#), Ok(Some(Cmd::MixCh(0, MixVals { lo: Some(-1.0), cue: Some(true), .. })))));
        assert!(matches!(p(r#"{"cmd":"mix.set","values":{"xfader":0.5}}"#), Ok(Some(Cmd::Mix(MixVals { xfader: Some(0.5), .. })))));
        assert!(matches!(p(r#"{"cmd":"deck.zoom","deck":"A","value":4}"#), Ok(None)));
        assert!(p(r#"{"cmd":"deck.play","deck":"C"}"#).is_err());
        assert!(p(r#"{"cmd":"rm -rf"}"#).is_err());
    }

    #[test]
    fn data_iso() {
        let s = iso_now();
        assert_eq!(s.len(), 24);
        assert!(s.starts_with("20") && s.ends_with('Z'));
    }

    #[test]
    fn id_traccia() {
        assert!(valid_id("0123456789abcdef"));
        assert!(!valid_id("../../etc/passwd"));
        assert!(!valid_id("0123456789ABCDEF"));
    }
}
