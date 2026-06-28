#!/usr/bin/env python3
"""
enroll_voice.py — Registra la voce di un parlante nel database Gaia.
Uso: python3 enroll_voice.py <nome> [device_index]

Registra 3 campioni da 5 secondi ciascuno e fa la media degli embedding.
Più campioni = riconoscimento più robusto.
"""

import sys, json, os, io, wave
import numpy as np
import pyaudio
from scipy.signal import resample_poly
from resemblyzer import VoiceEncoder, preprocess_wav

DB_PATH = os.path.expanduser("~/core-node-0/script/voice_db.json")
TARGET_RATE = 16000
RECORD_S = 5
N_SAMPLES = 3

def find_polycom(pa):
    for i in range(pa.get_device_count()):
        d = pa.get_device_info_by_index(i)
        if d["maxInputChannels"] > 0 and "polycom" in d["name"].lower():
            return i
    return None

def get_device_rate(pa, device_index):
    """Ritorna la sample rate nativa del dispositivo."""
    if device_index is None:
        info = pa.get_default_input_device_info()
    else:
        info = pa.get_device_info_by_index(device_index)
    return int(info["defaultSampleRate"])

def resample_to_16k(data: np.ndarray, src_rate: int) -> np.ndarray:
    """Downsample mono int16 array → 16000 Hz."""
    if src_rate == TARGET_RATE:
        return data
    from math import gcd
    g = gcd(TARGET_RATE, src_rate)
    up, down = TARGET_RATE // g, src_rate // g
    return resample_poly(data, up, down).astype(np.int16)

def record_wav(pa, seconds, device_index=None) -> bytes:
    """Registra alla frequenza nativa, downsample a 16000 Hz, mono."""
    src_rate = get_device_rate(pa, device_index)
    channels = 1  # proviamo mono
    chunk = 1024

    try:
        stream = pa.open(
            format=pyaudio.paInt16, channels=channels, rate=src_rate,
            input=True, frames_per_buffer=chunk,
            input_device_index=device_index
        )
    except OSError:
        # Fallback stereo (Polycom)
        channels = 2
        stream = pa.open(
            format=pyaudio.paInt16, channels=channels, rate=src_rate,
            input=True, frames_per_buffer=chunk,
            input_device_index=device_index
        )

    frames = []
    n_chunks = int(src_rate / chunk * seconds)
    for _ in range(n_chunks):
        frames.append(stream.read(chunk, exception_on_overflow=False))
    stream.stop_stream()
    stream.close()

    raw = np.frombuffer(b"".join(frames), dtype=np.int16)
    if channels == 2:
        raw = raw[::2]  # prendi solo canale sinistro

    if src_rate != TARGET_RATE:
        raw = resample_to_16k(raw, src_rate)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(TARGET_RATE)
        wf.writeframes(raw.tobytes())
    return buf.getvalue()

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 enroll_voice.py <nome> [device_index]")
        sys.exit(1)

    name = sys.argv[1]
    device_index = int(sys.argv[2]) if len(sys.argv) > 2 else None

    pa = pyaudio.PyAudio()
    if device_index is None:
        device_index = find_polycom(pa)
        if device_index is not None:
            print(f"Microfono: Polycom (idx={device_index})")
        else:
            print("Microfono: default di sistema")

    encoder = VoiceEncoder()
    embeddings = []

    print(f"\n=== Enrollment vocale per: {name} ===")
    print(f"Registrerò {N_SAMPLES} campioni da {RECORD_S}s.")
    print("Leggi qualsiasi testo ad alta voce (es. descrivere la tua giornata).\n")

    for i in range(N_SAMPLES):
        input(f"[{i+1}/{N_SAMPLES}] Premi INVIO e parla per {RECORD_S} secondi…")
        print("⏺  Registro…")
        wav_bytes = record_wav(pa, RECORD_S, device_index)
        print("✓  Campione acquisito.")

        try:
            tmp = f"/tmp/enroll_{i}.wav"
            with open(tmp, "wb") as f:
                f.write(wav_bytes)
            wav = preprocess_wav(tmp)
            emb = encoder.embed_utterance(wav)
            embeddings.append(emb)
        except Exception as e:
            print(f"  Errore nel campione {i+1}: {e} — ripeto.")
            continue

    pa.terminate()

    if not embeddings:
        print("Nessun campione valido. Uscita.")
        sys.exit(1)

    final_emb = np.mean(embeddings, axis=0)
    # Normalizza
    final_emb = final_emb / (np.linalg.norm(final_emb) + 1e-8)

    # Carica DB esistente
    db = {}
    if os.path.exists(DB_PATH):
        with open(DB_PATH) as f:
            db = json.load(f)

    db[name] = {"embedding": final_emb.tolist()}

    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)

    print(f"\n✅ Voce di '{name}' salvata ({len(embeddings)} campioni). DB: {list(db.keys())}")

if __name__ == "__main__":
    main()
