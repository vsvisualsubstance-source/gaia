//! Decodifica di un file audio intero in memoria (f32 interleaved).
//! Un mp3 di 5 minuti si decodifica in ~0,2 s: i deck tengono tutta la
//! traccia in RAM (seek, loop e forma d'onda immediati).

use std::path::Path;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, StandardTag};

pub struct Decoded {
    pub rate: u32,
    pub channels: usize,
    /// campioni interleaved, `frames * channels`
    pub samples: Vec<f32>,
    /// BPM scritto nei tag del file (ID3 TBPM), se c'e'
    pub tag_bpm: Option<f64>,
    pub title: Option<String>,
    pub artist: Option<String>,
}

impl Decoded {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1)
    }
    pub fn seconds(&self) -> f64 {
        self.frames() as f64 / self.rate.max(1) as f64
    }
    /// somma dei canali, per l'analisi
    pub fn mono(&self) -> Vec<f32> {
        let ch = self.channels.max(1);
        let k = 1.0 / ch as f32;
        self.samples.chunks_exact(ch).map(|f| f.iter().sum::<f32>() * k).collect()
    }
}

pub fn decode(path: &Path) -> Result<Decoded, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| e.to_string())?;

    let (mut tag_bpm, mut title, mut artist) = (None, None, None);
    let mut meta = format.metadata();
    while let Some(rev) = meta.pop() {
        for tag in &rev.media.tags {
            match &tag.std {
                Some(StandardTag::Bpm(b)) if *b > 0 => tag_bpm = Some(*b as f64),
                Some(StandardTag::TrackTitle(t)) => title = Some(t.to_string()),
                Some(StandardTag::Artist(a)) => artist = Some(a.to_string()),
                _ => {}
            }
        }
    }

    let track = format.default_track(TrackType::Audio).ok_or("nessuna traccia audio")?;
    let id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or("parametri audio mancanti")?
        .clone();
    let mut dec = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| e.to_string())?;

    let (mut rate, mut channels) = (0u32, 0usize);
    let mut samples: Vec<f32> = Vec::new();
    let mut chunk: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id != id {
            continue;
        }
        // un pacchetto rovinato non deve buttare via tutta la traccia
        let buf = match dec.decode(&packet) {
            Ok(b) => b,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let spec = buf.spec();
        if rate == 0 {
            rate = spec.rate();
            channels = spec.channels().count();
            samples.reserve(rate as usize * channels * 400);
        }
        buf.copy_to_vec_interleaved(&mut chunk);
        samples.extend_from_slice(&chunk);
    }
    if rate == 0 || channels == 0 {
        return Err("nessun campione decodificato".into());
    }
    Ok(Decoded { rate, channels, samples, tag_bpm, title, artist })
}
