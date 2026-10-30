//! Libreria: scansione della cartella musica, analisi in parallelo con cache,
//! correzioni a mano della griglia.
//!
//! Cache: un file JSON per traccia in `<cache>/<id>.json` (id = FNV-1a del
//! percorso relativo). Si rianalizza solo se cambiano dimensione o data del
//! file o la versione dell'analisi. Una griglia corretta a mano ha
//! `locked: true` e un'analisi nuova non la tocca (come Traktor).

use crate::analysis::{self, BpmRange, Grid, Wave};
use crate::decode;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

/// da alzare quando cambia l'analisi: le tracce vengono rianalizzate
pub const ANALYSIS_VERSION: u32 = 1;
const EXTS: [&str; 3] = ["mp3", "flac", "wav"];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackInfo {
    /// percorso relativo alla cartella musica, con '/'
    pub path: String,
    pub size: u64,
    pub mtime: u64,
    pub version: u32,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub seconds: f64,
    pub rate: u32,
    pub channels: usize,
    pub grid: Grid,
    /// griglia corretta a mano: l'analisi non la sovrascrive
    #[serde(default)]
    pub locked: bool,
    /// BPM dei tag del file, per confronto
    pub tag_bpm: Option<f64>,
    pub rms_db: f64,
    pub peak_db: f64,
    pub wave: Wave,
}

pub fn track_id(rel: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in rel.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn rel_path(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// file audio sotto `dir` (ricorsivo), esclusi i "._" di macOS
pub fn scan(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| EXTS.contains(&x.to_lowercase().as_str())) {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

fn file_stamp(p: &Path) -> (u64, u64) {
    let m = std::fs::metadata(p).ok();
    let size = m.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = m
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (size, mtime)
}

pub fn load(cache: &Path, rel: &str) -> Option<TrackInfo> {
    let s = std::fs::read_to_string(cache.join(format!("{}.json", track_id(rel)))).ok()?;
    serde_json::from_str(&s).ok()
}

pub fn save(cache: &Path, t: &TrackInfo) -> Result<(), String> {
    std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let p = cache.join(format!("{}.json", track_id(&t.path)));
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(t).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

pub fn analyze_file(root: &Path, cache: &Path, file: &Path, range: BpmRange, force: bool) -> Result<(TrackInfo, bool), String> {
    let rel = rel_path(root, file);
    let (size, mtime) = file_stamp(file);
    let old = load(cache, &rel);
    if let Some(o) = &old {
        if !force && o.size == size && o.mtime == mtime && o.version == ANALYSIS_VERSION {
            return Ok((o.clone(), false));
        }
    }
    let d = decode::decode(file)?;
    let a = analysis::analyze(&d.mono(), d.rate, range);
    let mut t = TrackInfo {
        path: rel,
        size,
        mtime,
        version: ANALYSIS_VERSION,
        title: d.title.clone(),
        artist: d.artist.clone(),
        seconds: (d.seconds() * 1000.0).round() / 1000.0,
        rate: d.rate,
        channels: d.channels,
        grid: a.grid,
        locked: false,
        tag_bpm: d.tag_bpm,
        rms_db: a.rms_db,
        peak_db: a.peak_db,
        wave: a.wave,
    };
    // griglia corretta a mano: resta quella
    if let Some(o) = old.filter(|o| o.locked) {
        t.grid = o.grid;
        t.locked = true;
    }
    save(cache, &t)?;
    Ok((t, true))
}

pub struct Summary {
    pub total: usize,
    pub analyzed: usize,
    pub cached: usize,
    pub failed: Vec<(String, String)>,
}

/// analizza `targets` (file o cartelle sotto `root`) in parallelo;
/// `progress(n, totale, risultato)` per ogni traccia
pub fn analyze_many<F>(root: &Path, cache: &Path, targets: &[PathBuf], range: BpmRange, force: bool, progress: F) -> Summary
where
    F: Fn(usize, usize, &Result<(TrackInfo, bool), (String, String)>) + Sync,
{
    let mut files: Vec<PathBuf> = Vec::new();
    for t in targets {
        if t.is_dir() {
            files.extend(scan(t));
        } else {
            files.push(t.clone());
        }
    }
    files.sort();
    files.dedup();
    let total = files.len();
    let done = AtomicUsize::new(0);
    let results: Vec<Result<(TrackInfo, bool), (String, String)>> = files
        .par_iter()
        .map(|f| {
            let r = analyze_file(root, cache, f, range, force).map_err(|e| (rel_path(root, f), e));
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress(n, total, &r);
            r
        })
        .collect();
    let mut s = Summary { total, analyzed: 0, cached: 0, failed: Vec::new() };
    for r in results {
        match r {
            Ok((_, true)) => s.analyzed += 1,
            Ok((_, false)) => s.cached += 1,
            Err(e) => s.failed.push(e),
        }
    }
    s
}

/// correzione a mano della griglia (come i comandi griglia di Traktor);
/// ogni correzione blocca la griglia
pub enum GridEdit {
    SetBpm(f64),
    /// sposta l'ancora di questi secondi (+ = piu' tardi)
    Move(f64),
    Double,
    Half,
    /// il battito e' qui (secondi): l'ancora si allinea, il BPM resta
    Anchor(f64),
    Lock(bool),
}

pub fn edit_grid(cache: &Path, rel: &str, edit: GridEdit) -> Result<TrackInfo, String> {
    let mut t = load(cache, rel).ok_or("traccia non analizzata")?;
    let g = &mut t.grid;
    let period = |b: f64| 60.0 / b;
    match edit {
        GridEdit::SetBpm(b) if b > 20.0 && b < 400.0 => g.bpm = b,
        GridEdit::SetBpm(_) => return Err("BPM fuori scala".into()),
        GridEdit::Move(s) => g.first_beat += s,
        GridEdit::Double => g.bpm *= 2.0,
        GridEdit::Half => g.bpm /= 2.0,
        GridEdit::Anchor(s) => g.first_beat = s,
        GridEdit::Lock(l) => {
            t.locked = l;
            save(cache, &t)?;
            return Ok(t);
        }
    }
    if g.bpm > 0.0 {
        g.first_beat = g.first_beat.rem_euclid(period(g.bpm));
    }
    t.locked = true;
    save(cache, &t)?;
    Ok(t)
}

/// tutte le tracce analizzate (senza forma d'onda di dettaglio)
pub fn index(root: &Path, cache: &Path) -> Vec<serde_json::Value> {
    scan(root)
        .iter()
        .filter_map(|f| load(cache, &rel_path(root, f)))
        .map(|t| {
            serde_json::json!({
                "id": track_id(&t.path), "path": t.path, "title": t.title, "artist": t.artist,
                "seconds": t.seconds, "bpm": t.grid.bpm, "first_beat": t.grid.first_beat,
                "confidence": t.grid.confidence, "locked": t.locked, "tag_bpm": t.tag_bpm, "rms_db": t.rms_db,
            })
        })
        .collect()
}
