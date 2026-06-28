#!/usr/bin/env python3
"""Mostra RMS e VAD in tempo reale per calibrare ENERGY_FLOOR."""
import numpy as np
import pyaudio
import webrtcvad
from scipy.signal import resample_poly
from math import gcd

TARGET_RATE = 16000
FRAME_MS = 30
VAD_MODE = 2

pa = pyaudio.PyAudio()

# Trova Polycom
dev = None
for i in range(pa.get_device_count()):
    d = pa.get_device_info_by_index(i)
    if d["maxInputChannels"] > 0 and "polycom" in d["name"].lower():
        dev = i
        break

info = pa.get_device_info_by_index(dev) if dev is not None else pa.get_default_input_device_info()
src_rate = int(info["defaultSampleRate"])
src_ch = min(int(info["maxInputChannels"]), 2)
native_chunk = int(src_rate * FRAME_MS / 1000)

g = gcd(TARGET_RATE, src_rate)
up, down = TARGET_RATE // g, src_rate // g

print(f"Device: {info['name']} @ {src_rate}Hz {src_ch}ch → 16kHz mono")
print("Parla normalmente — vedi i livelli RMS. Ctrl+C per uscire.\n")

stream = pa.open(format=pyaudio.paInt16, channels=src_ch, rate=src_rate,
                 input=True, frames_per_buffer=native_chunk,
                 input_device_index=dev)

vad = webrtcvad.Vad(VAD_MODE)
FRAME_SAMPLES = int(TARGET_RATE * FRAME_MS / 1000)

recent = []
try:
    while True:
        raw = stream.read(native_chunk, exception_on_overflow=False)
        data = np.frombuffer(raw, dtype=np.int16)
        if src_ch == 2:
            data = data[::2]
        if src_rate != TARGET_RATE:
            data = resample_poly(data, up, down).astype(np.int16)
        data = data[:FRAME_SAMPLES]
        if len(data) < FRAME_SAMPLES:
            data = np.pad(data, (0, FRAME_SAMPLES - len(data)))

        vol = float(np.sqrt(np.mean(data.astype(np.float32)**2)))
        recent.append(vol)
        if len(recent) > 30:
            recent.pop(0)
        floor = min(recent)

        try:
            is_sp = vad.is_speech(data.tobytes(), TARGET_RATE)
        except:
            is_sp = False

        bar = "█" * min(40, int(vol / 50))
        tag = "SPEECH" if is_sp else "silent"
        print(f"\rRMS={vol:6.0f}  floor={floor:5.0f}  VAD={tag:6s}  {bar:<40s}", end="", flush=True)
except KeyboardInterrupt:
    print("\nFine.")
finally:
    stream.stop_stream()
    stream.close()
    pa.terminate()
