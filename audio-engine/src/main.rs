//! gaia-audio: motore della Console Audio (docs/console-audio.md).
//! Per ora strumenti da riga di comando; il motore vero (deck, mixer, uscite,
//! WebSocket) arriva nella fase 1.
//!
//!   gaia-audio list                         uscite audio viste
//!   gaia-audio analyze [cartella|file ...]  BPM, griglia, forma d'onda (tutta la musica se vuoto)
//!       --force          rianalizza anche quelle in cache
//!       --range 88-175   intervallo dei BPM (come Traktor)
//!   gaia-audio grid FILE (--bpm X | --move MS | --double | --half | --anchor S | --lock | --unlock)
//!   gaia-audio index                        tracce analizzate, in JSON
//!
//! Opzioni comuni: --root CARTELLA (musica; default GAIA_MUSIC o
//! C:\gaia-docker-cfg\core-node-0\musica), --cache CARTELLA (default
//! GAIA_AUDIO_CACHE o ./cache).

mod analysis;
mod decode;
mod library;

use analysis::BpmRange;
use cpal::traits::{DeviceTrait, HostTrait};
use library::GridEdit;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn list() {
    for id in cpal::available_hosts() {
        let host = match cpal::host_from_id(id) {
            Ok(h) => h,
            Err(e) => {
                println!("{id:?}: non disponibile ({e})");
                continue;
            }
        };
        println!("== {id:?}");
        let Ok(devices) = host.output_devices() else { continue };
        for d in devices {
            let name = d.description().map(|n| n.to_string()).unwrap_or_else(|_| "?".into());
            match d.default_output_config() {
                Ok(c) => println!("  {name}  [{} ch, {} Hz, {:?}]", c.channels(), c.sample_rate(), c.sample_format()),
                Err(e) => println!("  {name}  (formato: {e})"),
            }
        }
    }
}

struct Opts {
    root: PathBuf,
    cache: PathBuf,
    range: BpmRange,
    force: bool,
    rest: Vec<String>,
}

fn parse(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts {
        root: std::env::var_os("GAIA_MUSIC").map(PathBuf::from).unwrap_or_else(|| r"C:\gaia-docker-cfg\core-node-0\musica".into()),
        cache: std::env::var_os("GAIA_AUDIO_CACHE").map(PathBuf::from).unwrap_or_else(|| "cache".into()),
        range: BpmRange::default(),
        force: false,
        rest: Vec::new(),
    };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => o.root = it.next().ok_or("--root senza cartella")?.into(),
            "--cache" => o.cache = it.next().ok_or("--cache senza cartella")?.into(),
            "--force" => o.force = true,
            "--range" => {
                let v = it.next().ok_or("--range senza valori")?;
                let (a, b) = v.split_once('-').ok_or("--range MIN-MAX")?;
                o.range = BpmRange { min: a.parse().map_err(|_| "--range")?, max: b.parse().map_err(|_| "--range")? };
            }
            _ => o.rest.push(a.clone()),
        }
    }
    Ok(o)
}

/// percorso dato -> assoluto sotto root (accetta anche relativo alla root)
fn under_root(root: &Path, p: &str) -> PathBuf {
    let q = PathBuf::from(p);
    if q.is_absolute() || q.exists() { q } else { root.join(p) }
}

fn analyze(o: &Opts) -> ExitCode {
    let targets: Vec<PathBuf> = if o.rest.is_empty() { vec![o.root.clone()] } else { o.rest.iter().map(|p| under_root(&o.root, p)).collect() };
    let t0 = std::time::Instant::now();
    let agree = std::sync::atomic::AtomicUsize::new(0);
    let tagged = std::sync::atomic::AtomicUsize::new(0);
    let s = library::analyze_many(&o.root, &o.cache, &targets, o.range, o.force, |n, tot, r| match r {
        Ok((t, fresh)) => {
            let mut note = String::new();
            if let Some(tb) = t.tag_bpm {
                tagged.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let b = t.grid.bpm;
                // d'accordo anche a meta'/doppio: e' solo una convenzione
                let ok = [1.0, 2.0, 0.5].iter().any(|k| (b - tb * k).abs() <= 0.6);
                if ok {
                    agree.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
                note = format!("  tag {tb}{}", if ok { "" } else { "  <-- diverso" });
            }
            println!(
                "[{n}/{tot}] {:7.2} BPM  conf {:.2}{}  {}{}{}",
                t.grid.bpm,
                t.grid.confidence,
                if t.locked { " bloccata" } else { "" },
                t.path,
                if *fresh { "" } else { "  (cache)" },
                note
            );
        }
        Err((p, e)) => println!("[{n}/{tot}] ERRORE {p}: {e}"),
    });
    let tg = tagged.into_inner();
    println!(
        "\n{} tracce: {} analizzate, {} gia' in cache, {} errori, {:.1} s{}",
        s.total,
        s.analyzed,
        s.cached,
        s.failed.len(),
        t0.elapsed().as_secs_f64(),
        if tg > 0 { format!("; BPM uguale al tag in {}/{tg}", agree.into_inner()) } else { String::new() }
    );
    if s.failed.is_empty() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

fn grid(o: &Opts) -> Result<(), String> {
    let file = o.rest.first().ok_or("manca il file")?;
    let abs = under_root(&o.root, file);
    let rel = abs.strip_prefix(&o.root).map_err(|_| "il file non e' nella cartella musica")?.to_string_lossy().replace('\\', "/");
    let num = |i: usize| -> Result<f64, String> { o.rest.get(i).and_then(|v| v.parse().ok()).ok_or_else(|| "valore mancante".to_string()) };
    let edit = match o.rest.get(1).map(String::as_str) {
        Some("--bpm") => GridEdit::SetBpm(num(2)?),
        Some("--move") => GridEdit::Move(num(2)? / 1000.0),
        Some("--double") => GridEdit::Double,
        Some("--half") => GridEdit::Half,
        Some("--anchor") => GridEdit::Anchor(num(2)?),
        Some("--lock") => GridEdit::Lock(true),
        Some("--unlock") => GridEdit::Lock(false),
        _ => return Err("serve --bpm X | --move MS | --double | --half | --anchor S | --lock | --unlock".into()),
    };
    let t = library::edit_grid(&o.cache, &rel, edit)?;
    println!("{}: {} BPM, primo battito {:.4} s, {}", t.path, t.grid.bpm, t.grid.first_beat, if t.locked { "bloccata" } else { "libera" });
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().cloned() else {
        eprintln!("uso: gaia-audio list | analyze [cartella|file ...] | grid FILE ... | index");
        return ExitCode::FAILURE;
    };
    let o = match parse(&args[1..]) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("errore: {e}");
            return ExitCode::FAILURE;
        }
    };
    let res = match cmd.as_str() {
        "list" => {
            list();
            Ok(())
        }
        "analyze" => return analyze(&o),
        "grid" => grid(&o),
        "index" => {
            println!("{}", serde_json::to_string_pretty(&library::index(&o.root, &o.cache)).unwrap_or_default());
            Ok(())
        }
        _ => Err(format!("comando sconosciuto: {cmd}")),
    };
    match res {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("errore: {e}");
            ExitCode::FAILURE
        }
    }
}
