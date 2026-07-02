#!/usr/bin/env python3
"""
train_doorbell_model.py — Addestra un classificatore suono citofono
usando l'estrattore di feature condiviso di openWakeWord (AudioFeatures)
e una regressione logistica (train_verifier_model).

Uso CLI:
  python3 train_doorbell_model.py [--samples-dir DIR] [--output PATH]

Uso programmatico (da gaia_admin.py):
  from train_doorbell_model import train_and_save
  ok, msg = train_and_save(samples_dir, output_path)
"""

import argparse
import glob
import os
import pickle
import wave

import numpy as np
from openwakeword.utils import AudioFeatures
from openwakeword.custom_verifier_model import train_verifier_model

DEFAULT_SAMPLES_DIR = os.path.join(os.path.dirname(__file__), "doorbell_samples")
DEFAULT_OUTPUT      = os.path.join(DEFAULT_SAMPLES_DIR, "doorbell_verifier.pkl")

MIN_CLIPS = 3  # campioni minimi per label (positivo/negativo)


def load_wav_int16(path: str) -> np.ndarray:
    """Carica un WAV come array int16 (16kHz mono) — il formato richiesto da AudioFeatures."""
    with wave.open(path) as wf:
        return np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)


def embed_clips(af: AudioFeatures, paths: list[str]) -> np.ndarray:
    """Embedding medio-temporale per ogni clip: ritorna (N, 96)."""
    if not paths:
        return np.empty((0, 96), dtype=np.float32)

    clips = [load_wav_int16(p) for p in paths]
    max_len = max(len(c) for c in clips)
    arr = np.zeros((len(clips), max_len), dtype=np.int16)
    for i, c in enumerate(clips):
        arr[i, :len(c)] = c

    emb = af.embed_clips(arr)   # (N, T, 96)
    return emb.mean(axis=1)     # (N, 96) — mean-pool sul tempo


def train_and_save(samples_dir: str = DEFAULT_SAMPLES_DIR,
                   output_path: str = DEFAULT_OUTPUT) -> tuple[bool, str]:
    """
    Addestra il modello dai campioni in samples_dir/{positive,negative}/*.wav
    e salva il pickle a output_path.

    Returns:
        (True, messaggio) in caso di successo
        (False, messaggio) in caso di errore
    """
    pos_paths = sorted(glob.glob(os.path.join(samples_dir, "positive", "*.wav")))
    neg_paths = sorted(glob.glob(os.path.join(samples_dir, "negative", "*.wav")))

    if len(pos_paths) < MIN_CLIPS:
        return False, f"Campioni positivi insufficienti ({len(pos_paths)} < {MIN_CLIPS})"
    if len(neg_paths) < MIN_CLIPS:
        return False, f"Campioni negativi insufficienti ({len(neg_paths)} < {MIN_CLIPS})"

    print(f"[Training] {len(pos_paths)} positivi, {len(neg_paths)} negativi")

    af = AudioFeatures()
    pos = embed_clips(af, pos_paths)
    neg = embed_clips(af, neg_paths)

    X = np.vstack([pos, neg])
    y = np.array([1] * len(pos) + [0] * len(neg))

    print(f"[Training] Feature: {X.shape}, Labels: {y}")
    model = train_verifier_model(X, y)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    pickle.dump(model, open(output_path, "wb"))

    train_acc = float((model.predict(X) == y).mean())
    return True, f"Modello salvato: {output_path} (acc training {train_acc:.0%}, {len(pos_paths)}pos/{len(neg_paths)}neg)"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Addestra modello citofono")
    parser.add_argument("--samples-dir", default=DEFAULT_SAMPLES_DIR)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    ok, msg = train_and_save(args.samples_dir, args.output)
    print("[OK]" if ok else "[ERRORE]", msg)
    exit(0 if ok else 1)
