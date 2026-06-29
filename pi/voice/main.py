#!/usr/bin/env python3
"""
GAIA Voice Node
Pipeline: openWakeWord → faster-whisper STT → MQTT → Piper TTS
"""
import os
import json
import signal
import subprocess
import threading
import time

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from openwakeword.model import Model as WakeWordModel
import paho.mqtt.client as mqtt

import config

# ──────────────────────────────────────────────────────────────────────
# Stato globale
# ──────────────────────────────────────────────────────────────────────
_running  = True
_speaking = False
_speak_lock = threading.Lock()


def _handle_signal(sig, frame):
    global _running
    _running = False
    print("\n[GAIA Voice] Shutdown...")


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)


# ──────────────────────────────────────────────────────────────────────
# MQTT
# ──────────────────────────────────────────────────────────────────────
_mqtt = mqtt.Client()


def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        client.subscribe(config.TOPIC_TTS)
        _publish_status("listening")
        print(f"[MQTT] Connesso — in ascolto su {config.TOPIC_TTS}")
    else:
        print(f"[MQTT] Connessione fallita: rc={rc}")


def _on_disconnect(client, userdata, rc):
    if rc != 0:
        print(f"[MQTT] Disconnesso inaspettatamente (rc={rc}), riconnessione...")


def _on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload)
        text = data.get("text", "").strip()
        if text:
            threading.Thread(target=_speak, args=(text,), daemon=True).start()
    except Exception as e:
        print(f"[MQTT] Errore messaggio: {e}")


_mqtt.on_connect    = _on_connect
_mqtt.on_disconnect = _on_disconnect
_mqtt.on_message    = _on_message


def _publish_status(state: str):
    _mqtt.publish(
        config.TOPIC_STATUS,
        json.dumps({"state": state, "stanza": config.CAMERA_NAME,
                    "ts": int(time.time() * 1000)}),
        retain=True
    )


def _publish_command(text: str):
    _mqtt.publish(
        config.TOPIC_COMMAND,
        json.dumps({"text": text, "stanza": config.CAMERA_NAME,
                    "ts": int(time.time() * 1000)})
    )
    print(f"[MQTT] → '{text}'")


# ──────────────────────────────────────────────────────────────────────
# TTS (Piper binary + aplay)
# ──────────────────────────────────────────────────────────────────────
def _speak(text: str):
    global _speaking
    with _speak_lock:
        _speaking = True
    _publish_status("speaking")
    try:
        piper = subprocess.run(
            [config.PIPER_BIN,
             "--model",  config.PIPER_MODEL,
             "--config", config.PIPER_CONFIG,
             "--output-raw"],
            input=text.encode(),
            capture_output=True,
            timeout=20
        )
        if piper.returncode == 0 and piper.stdout:
            subprocess.run(
                ["aplay", "-r", str(config.PIPER_SAMPLE_RATE),
                 "-f", "S16_LE", "-c", "1", "-q"],
                input=piper.stdout,
                timeout=30
            )
    except FileNotFoundError:
        print(f"[TTS] piper non trovato: {config.PIPER_BIN}")
    except subprocess.TimeoutExpired:
        print("[TTS] Timeout")
    except Exception as e:
        print(f"[TTS] Errore: {e}")
    finally:
        with _speak_lock:
            _speaking = False
        _publish_status("listening")


# ──────────────────────────────────────────────────────────────────────
# STT (faster-whisper)
# ──────────────────────────────────────────────────────────────────────
print("[STT] Caricamento Whisper...")
_whisper = WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type="int8")
print(f"[STT] Modello '{config.WHISPER_MODEL}' pronto")


def _transcribe(audio_f32: np.ndarray) -> str:
    segments, _ = _whisper.transcribe(
        audio_f32,
        language=config.WHISPER_LANG,
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400}
    )
    return " ".join(s.text.strip() for s in segments).strip()


# ──────────────────────────────────────────────────────────────────────
# Wakeword (openWakeWord)
# ──────────────────────────────────────────────────────────────────────
print("[WW] Caricamento openWakeWord...")
_oww = WakeWordModel(
    wakeword_models=[config.WAKEWORD_MODEL_NAME],
    inference_framework="onnx"
)
print(f"[WW] Wakeword '{config.WAKEWORD_MODEL_NAME}' pronto")

SR    = config.SAMPLE_RATE
CHUNK = config.CHUNK_SIZE


# ──────────────────────────────────────────────────────────────────────
# Registrazione dopo wakeword (VAD energia)
# ──────────────────────────────────────────────────────────────────────
def _record_speech() -> np.ndarray | None:
    _publish_status("recording")
    chunks = []
    silence_count = 0
    SILENCE_LIMIT = int(SR / CHUNK * 1.5)           # 1.5s silenzio → stop
    MAX_CHUNKS    = int(SR / CHUNK * config.RECORD_SECONDS_MAX)

    with sd.InputStream(samplerate=SR, channels=1, dtype="int16", blocksize=CHUNK,
                        device=config.MIC_DEVICE) as s:
        for _ in range(MAX_CHUNKS):
            if not _running:
                break
            data, _ = s.read(CHUNK)
            chunk = data.flatten()
            chunks.append(chunk)
            energy = float(np.abs(chunk).mean())
            if energy < config.SILENCE_THRESHOLD:
                silence_count += 1
                if silence_count >= SILENCE_LIMIT:
                    break
            else:
                silence_count = 0

    if len(chunks) < 3:
        return None
    return np.concatenate(chunks).astype(np.float32) / 32768.0


# ──────────────────────────────────────────────────────────────────────
# Main loop
# ──────────────────────────────────────────────────────────────────────
def main():
    _mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, 60)
    _mqtt.loop_start()

    print(f"\n[GAIA Voice] Stanza : {config.CAMERA_NAME}")
    print(f"[GAIA Voice] MQTT   : {config.MQTT_HOST}:{config.MQTT_PORT}")
    print(f"[GAIA Voice] Wakeword: '{config.WAKEWORD_MODEL_NAME}'")
    print("[GAIA Voice] Pronto.\n")

    while _running:
        # ── Fase 1: ascolto wakeword ───────────────────────────────
        _publish_status("listening")
        wakeword_stream = sd.InputStream(
            samplerate=SR, channels=1, dtype="int16", blocksize=CHUNK,
            device=config.MIC_DEVICE
        )
        wakeword_stream.start()

        wakeword_detected = False
        while _running and not wakeword_detected:
            with _speak_lock:
                is_speaking = _speaking
            if is_speaking:
                try:
                    wakeword_stream.read(CHUNK)   # scarica buffer durante TTS
                except Exception:
                    pass
                continue

            try:
                data, _ = wakeword_stream.read(CHUNK)
            except Exception as e:
                print(f"[MIC] Errore: {e}")
                time.sleep(0.1)
                continue

            prediction = _oww.predict(data.flatten())
            if any(v > config.WAKEWORD_THRESHOLD for v in prediction.values()):
                wakeword_detected = True

        wakeword_stream.stop()
        wakeword_stream.close()

        if not _running:
            break

        print("[GAIA Voice] Wakeword rilevato — parla ora...")

        # ── Fase 2: registrazione ──────────────────────────────────
        audio = _record_speech()

        if audio is None or len(audio) < SR * 0.3:
            print("[GAIA Voice] Audio troppo breve, ignorato.")
            continue

        # ── Fase 3: STT ───────────────────────────────────────────
        _publish_status("processing")
        text = _transcribe(audio)
        print(f"[STT] '{text}'")

        if text:
            _publish_command(text)
        else:
            print("[STT] Nessun testo riconosciuto.")
            _publish_status("listening")

    _mqtt.loop_stop()
    _mqtt.disconnect()
    print("[GAIA Voice] Terminato.")


if __name__ == "__main__":
    main()
