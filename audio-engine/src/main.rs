//! gaia-audio: motore della Console Audio (docs/console-audio.md).
//! Per ora solo verifiche della toolchain: elenco delle uscite e lettura di un mp3.
//!   gaia-audio --list            uscite audio viste (host, dispositivi, formato predefinito)
//!   gaia-audio --probe file.mp3  decodifica tutto il file: durata, frequenza, canali

use cpal::traits::{DeviceTrait, HostTrait};
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

fn probe(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let file = std::fs::File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("mp3");
    let mut format = symphonia::default::get_probe().probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())?;
    let track = format.default_track(TrackType::Audio).ok_or("nessuna traccia audio")?;
    let id = track.id;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).ok_or("parametri audio mancanti")?.clone();
    let mut dec = symphonia::default::get_codecs().make_audio_decoder(&params, &AudioDecoderOptions::default())?;
    let (mut frames, mut rate, mut ch) = (0u64, 0u32, 0usize);
    let t0 = std::time::Instant::now();
    while let Some(packet) = format.next_packet()? {
        if packet.track_id != id {
            continue;
        }
        let buf = dec.decode(&packet)?;
        let spec = buf.spec();
        rate = spec.rate();
        ch = spec.channels().count();
        frames += buf.frames() as u64;
    }
    println!(
        "{path}\n  {:.1} s, {rate} Hz, {ch} canali, decodificato in {:.2} s",
        frames as f64 / rate.max(1) as f64,
        t0.elapsed().as_secs_f64()
    );
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("--list") => list(),
        Some("--probe") if args.len() > 2 => {
            if let Err(e) = probe(&args[2]) {
                eprintln!("errore: {e}");
                return ExitCode::FAILURE;
            }
        }
        _ => {
            eprintln!("uso: gaia-audio --list | --probe file.mp3");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
