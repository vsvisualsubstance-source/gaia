#!/usr/bin/env python3
"""
GAIA Voice Node — OPS (silvermini2, Windows nativo)
Pipeline: openWakeWord -> faster-whisper STT -> MQTT, e MQTT -> Piper TTS (via
libreria Python piper-tts, non binario+aplay: qui gira su Windows).

Basato su pi/voice/main.py (stessa architettura, stesso contratto MQTT — il
topic TTS e' per-stanza, gia' coerente con quanto Node-RED gia' pubblica per
gaia/voice/tts/{stanza}, nessuna modifica lato Core necessaria). Differenze
volute rispetto al Pi:
  - niente OTA (qui si lancia a mano, non c'e' un agent che gestisce systemd)
  - niente rilevamento citofono (non pertinente a questa macchina)
  - TTS: PiperVoice (onnxruntime) + sounddevice invece di piper binario + aplay
"""
import base64
import io
import json
import os
import pickle
import queue
import signal
import socket
import threading
import time
import urllib.request
import wave

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from openwakeword.model import Model as WakeWordModel
from piper import PiperVoice
import paho.mqtt.client as mqtt

import config

# ──────────────────────────────────────────────────────────────────────
# Stato globale
# ──────────────────────────────────────────────────────────────────────
_running      = True
_speaking     = False
_current_room = config.NODE_ID

_tts_lock = threading.Lock()  # serializza le esecuzioni TTS

_calibrate_requests: queue.Queue = queue.Queue()
_record_clip_requests: queue.Queue = queue.Queue()   # campioni wakeword da admin


def _handle_signal(sig, frame):
    global _running
    _running = False
    sd.stop()
    print("\n[GAIA Voice] Shutdown...")


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)


# ──────────────────────────────────────────────────────────────────────
# Topic dinamici — si aggiornano automaticamente quando il Device
# Registry cambia la room assegnata a questa macchina
# ──────────────────────────────────────────────────────────────────────
def _topic_tts():     return f"gaia/voice/tts/{_current_room}"
def _topic_status():  return f"gaia/voice/status/{_current_room}"
def _topic_command(): return f"gaia/voice/command/{_current_room}"
def _topic_admin():   return f"gaia/voice/admin/{_current_room}"
def _topic_record_clip(): return f"gaia/voice/record_clip/{_current_room}"


# ──────────────────────────────────────────────────────────────────────
# MQTT
# ──────────────────────────────────────────────────────────────────────
_mqtt = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2,
    client_id=f"gaia-voice-{config.DEVICE_ID}",
    clean_session=True,
)
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


def _local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unknown"


def _on_connect(client, userdata, flags, rc, properties=None):
    if rc != 0:
        print(f"[MQTT] Connessione fallita: rc={rc}")
        return
    client.subscribe(_topic_tts())
    client.subscribe(_topic_admin())
    client.subscribe(_topic_record_clip())
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    _publish_status("listening")
    client.publish(
        f"gaia/devices/{config.DEVICE_ID}/announce",
        json.dumps({
            "device_id":  config.DEVICE_ID,
            "type":       "voice",
            "ip":         _local_ip(),
            "room_claim": _current_room,
            "ts":         int(time.time() * 1000),
        }),
        retain=False,
    )
    print(f"[MQTT] Connesso — room={_current_room}, TTS={_topic_tts()}")


def _on_disconnect(client, userdata, rc, properties=None):
    if rc != 0:
        print(f"[MQTT] Disconnesso inaspettatamente (rc={rc}), riconnessione...")


def _on_message(client, userdata, msg):
    topic = msg.topic
    if topic == f"gaia/devices/{config.DEVICE_ID}/config":
        _handle_device_config(client, msg.payload)
        return
    if topic == _topic_record_clip():
        # Registrazione campione (wakeword Gaia / citofono) richiesta da admin.
        # Accodata: il MAIN LOOP possiede il mic — un secondo InputStream
        # simultaneo su Windows fallirebbe (stesso pattern della calibrazione).
        try:
            data = json.loads(msg.payload)
            _record_clip_requests.put({
                "label": data.get("label", "gaia_positive"),
                "duration_s": int(data.get("duration_s", 3)),
            })
            print(f"[Clip] Richiesta registrazione: {data}")
        except Exception as e:
            print(f"[Clip] Errore richiesta: {e}")
        return
    if topic == _topic_admin():
        try:
            data = json.loads(msg.payload)
            cmd = data.get("cmd", "")
            if cmd == "calibrate":
                duration_s = int(data.get("duration_s", 5))
                _calibrate_requests.put({"duration_s": duration_s})
                print(f"[Admin] Calibrazione richiesta: {duration_s}s")
            elif cmd == "config":
                _apply_config(data)
        except Exception as e:
            print(f"[Admin] Errore: {e}")
        return
    try:
        data = json.loads(msg.payload)
        text = data.get("text", "").strip()
        if text:
            threading.Thread(target=_speak, args=(text,), daemon=True).start()
    except Exception as e:
        print(f"[MQTT] Errore messaggio: {e}")


def _handle_device_config(client, payload):
    global _current_room
    try:
        cfg = json.loads(payload.decode())
        new_room = cfg.get("room")
        if new_room and new_room != _current_room:
            print(f"[Registry] Room: {_current_room} -> {new_room}")
            client.unsubscribe(_topic_tts())
            client.unsubscribe(_topic_admin())
            client.unsubscribe(_topic_record_clip())
            _current_room = new_room
            client.subscribe(_topic_tts())
            client.subscribe(_topic_admin())
            client.subscribe(_topic_record_clip())
            _publish_status("listening")
        elif new_room:
            print(f"[Registry] Room confermata: {new_room}")
    except Exception as e:
        print(f"[Registry] Errore config: {e}")


_mqtt.on_connect    = _on_connect
_mqtt.on_disconnect = _on_disconnect
_mqtt.on_message    = _on_message


def _publish_status(state: str):
    _mqtt.publish(
        _topic_status(),
        json.dumps({"state": state, "stanza": _current_room,
                    "ts": int(time.time() * 1000)}),
        retain=True,
    )


def _publish_command(text: str):
    _mqtt.publish(
        _topic_command(),
        json.dumps({"text": text, "stanza": _current_room,
                    "ts": int(time.time() * 1000)}),
    )
    print(f"[MQTT] -> '{text}'")


# ──────────────────────────────────────────────────────────────────────
# TTS (PiperVoice + sounddevice — interrompibile con sd.stop())
# ──────────────────────────────────────────────────────────────────────
print("[TTS] Caricamento Piper...")
_piper_voice = PiperVoice.load(config.PIPER_MODEL, config_path=config.PIPER_CONFIG)
print(f"[TTS] Voce pronta (sample_rate={_piper_voice.config.sample_rate})")


def _speak(text: str):
    """Sintetizza e riproduce text. Interrompe qualsiasi TTS gia' in corso."""
    global _speaking
    sd.stop()
    with _tts_lock:
        _speaking = True
        _publish_status("speaking")
        try:
            chunks = list(_piper_voice.synthesize(text))
            if chunks:
                audio = np.concatenate([c.audio_int16_array for c in chunks])
                sd.play(audio, samplerate=_piper_voice.config.sample_rate,
                        device=config.OUTPUT_DEVICE)
                sd.wait()
        except Exception as e:
            print(f"[TTS] Errore: {e}")
        finally:
            _speaking = False
            _publish_status("listening")


# ──────────────────────────────────────────────────────────────────────
# STT (faster-whisper)
# ──────────────────────────────────────────────────────────────────────
print("[STT] Caricamento Whisper...")
_whisper = WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type="int8")
print(f"[STT] Modello '{config.WHISPER_MODEL}' pronto")


_STT_PROMPT = ("Gaia, accendi le luci del soggiorno. Gaia, spegni il corridoio. "
               "Gaia, attiva l'ingresso. Gaia, accendi la camera da letto. "
               "Gaia, spegni tutto. Gaia, che ore sono? Gaia, temperatura. "
               "Gaia, musica. Gaia, volume su. Gaia, volume giu'. "
               "soggiorno, salotto, ingresso, corridoio, cucina, camera, notte, sala.")


def _transcribe(audio_f32: np.ndarray) -> str:
    segments, _ = _whisper.transcribe(
        audio_f32,
        language=config.WHISPER_LANG,
        beam_size=3,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        initial_prompt=_STT_PROMPT,
    )
    return " ".join(s.text.strip() for s in segments).strip()


# ──────────────────────────────────────────────────────────────────────
# Wakeword (openWakeWord)
# ──────────────────────────────────────────────────────────────────────
print("[WW] Caricamento openWakeWord...")
_oww = WakeWordModel(
    wakeword_models=[config.WAKEWORD_MODEL_NAME],
    inference_framework="onnx",
)
print(f"[WW] Wakeword '{config.WAKEWORD_MODEL_NAME}' pronto")

# ── Gaia custom wakeword classifier (opzionale, allenato sui campioni del
# mic di questa macchina — non esiste ancora, feed() ritorna sempre 0.0 finche'
# non viene allenato da admin.html, stesso pattern del Pi/miniPC) ────────────
_GAIA_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "gaia_verifier.pkl")
_gaia_clf        = None
_gaia_af         = None
_gaia_buffer      = []
_GAIA_BUFFER_SEC  = 1.5
_GAIA_THRESHOLD   = config.GAIA_THRESHOLD

if os.path.exists(_GAIA_MODEL_PATH):
    try:
        from openwakeword.utils import AudioFeatures
        try:
            _gaia_af = AudioFeatures(inference_framework='onnx', device='cpu')
        except TypeError:
            _gaia_af = AudioFeatures()
        _gaia_clf = pickle.load(open(_GAIA_MODEL_PATH, 'rb'))
        print(f"[Gaia WW] Modello custom caricato: {_GAIA_MODEL_PATH}")
    except Exception as e:
        print(f"[Gaia WW] Impossibile caricare il modello: {e}")
else:
    print("[Gaia WW] Nessun modello per questa macchina ancora allenato — verifica disattiva")

SR    = config.SAMPLE_RATE
CHUNK = config.CHUNK_SIZE

# ── Stats loop wakeword ────────────────────────────────────────────────────────
_stats_ts       = 0.0
_vol_samples: list[float] = []
_ww_conf_peak   = 0.0
_gaia_conf_peak = 0.0
_STATS_INTERVAL = 5.0


def _publish_stats(vol: float, state: str, ww_conf: float, gaia_conf: float = 0.0):
    _mqtt.publish(
        f"gaia/voice/stats/{_current_room}",
        json.dumps({
            "vol":               round(float(vol), 1),
            "state":             state,
            "ww_confidence":     round(float(ww_conf), 3),
            "gaia_confidence":   round(float(gaia_conf), 3),
            "ww_threshold":      round(float(config.WAKEWORD_THRESHOLD), 2),
            "gaia_threshold":    round(float(_GAIA_THRESHOLD), 2),
            "silence_threshold": int(config.SILENCE_THRESHOLD),
            "device_id":         config.DEVICE_ID,
            "room":              _current_room,
            "ts":                int(time.time() * 1000),
        }),
        retain=False,
    )


def _apply_config(data: dict):
    global _GAIA_THRESHOLD
    if "wakeword_threshold" in data:
        config.WAKEWORD_THRESHOLD = float(data["wakeword_threshold"])
        print(f"[Config] WAKEWORD_THRESHOLD -> {config.WAKEWORD_THRESHOLD:.2f}")
    if "gaia_threshold" in data:
        _GAIA_THRESHOLD = float(data["gaia_threshold"])
        print(f"[Config] GAIA_THRESHOLD -> {_GAIA_THRESHOLD:.2f}")
    if "silence_threshold" in data:
        config.SILENCE_THRESHOLD = int(data["silence_threshold"])
        print(f"[Config] SILENCE_THRESHOLD -> {config.SILENCE_THRESHOLD}")


def _do_record_clip(label: str, duration_s: int):
    """Registra duration_s secondi dal mic e invia il WAV all'admin sul Core.
    Il payload include la stanza: l'admin smista i campioni gaia_* nel dataset
    della macchina giusta (cucina -> OPS)."""
    _publish_status("recording")
    print(f"[Clip] Registrazione {label} ({duration_s}s)...")
    chunks = []
    n_chunks = int(SR / CHUNK * duration_s)
    try:
        with sd.InputStream(samplerate=SR, channels=1, dtype="int16",
                            blocksize=CHUNK, device=config.MIC_DEVICE) as st:
            for _ in range(n_chunks):
                if not _running:
                    break
                data, _ = st.read(CHUNK)
                chunks.append(data.flatten())
    except Exception as e:
        print(f"[Clip] Errore stream: {e}")
    _publish_status("listening")
    if not chunks:
        print("[Clip] Registrazione vuota, scarto")
        return
    pcm = np.concatenate(chunks).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    audio_b64 = base64.b64encode(buf.getvalue()).decode()
    admin_url = f"http://{config.MQTT_HOST}:8765/api/doorbell/sample"
    payload = json.dumps({"label": label, "audio_base64": audio_b64,
                          "stanza": _current_room}).encode()
    try:
        req = urllib.request.Request(admin_url, data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            print(f"[Clip] Inviato -> {json.loads(resp.read())}")
    except Exception as e:
        print(f"[Clip] Errore invio al Core: {e}")


def _do_calibrate(duration_s: int = 5):
    _publish_status("calibrating")
    print(f"[Calibrazione] Silenzio per {duration_s}s...")
    samples: list[float] = []
    n_chunks = int(SR / CHUNK * duration_s)
    try:
        with sd.InputStream(samplerate=SR, channels=1, dtype="int16",
                            blocksize=CHUNK, device=config.MIC_DEVICE) as s:
            for _ in range(n_chunks):
                if not _running:
                    break
                data, _ = s.read(CHUNK)
                chunk = data.flatten()
                samples.append(float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))))
    except Exception as e:
        print(f"[Calibrazione] Errore stream: {e}")
    if samples:
        p95 = float(np.percentile(samples, 95))
        suggested = int(p95 * 2.5)
        print(f"[Calibrazione] Noise floor p95={p95:.1f} -> soglia suggerita={suggested}")
        _mqtt.publish(
            f"gaia/voice/calibrate_result/{_current_room}",
            json.dumps({
                "noise_floor": round(p95, 1),
                "suggested_threshold": suggested,
                "room": _current_room,
                "ts": int(time.time() * 1000),
            })
        )
    _publish_status("listening")


# ──────────────────────────────────────────────────────────────────────
# Registrazione dopo wakeword (VAD energia)
# ──────────────────────────────────────────────────────────────────────
def _record_speech() -> np.ndarray | None:
    _publish_status("recording")
    chunks = []
    silence_count = 0
    SILENCE_LIMIT = int(SR / CHUNK * 1.5)
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
    global _stats_ts, _ww_conf_peak, _gaia_conf_peak

    _mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, 60)
    _mqtt.loop_start()

    print(f"\n[GAIA Voice] Stanza  : {_current_room}")
    print(f"[GAIA Voice] Device  : {config.DEVICE_ID}")
    print(f"[GAIA Voice] MQTT    : {config.MQTT_HOST}:{config.MQTT_PORT}")
    print(f"[GAIA Voice] Wakeword: '{config.WAKEWORD_MODEL_NAME}'")
    print("[GAIA Voice] Pronto.\n")

    while _running:
        while not _calibrate_requests.empty():
            req = _calibrate_requests.get_nowait()
            _do_calibrate(req.get("duration_s", 5))

        while not _record_clip_requests.empty():
            req = _record_clip_requests.get_nowait()
            _do_record_clip(req.get("label", "gaia_positive"), req.get("duration_s", 3))

        _publish_status("listening")
        wakeword_stream = sd.InputStream(
            samplerate=SR, channels=1, dtype="int16", blocksize=CHUNK,
            device=config.MIC_DEVICE,
        )
        wakeword_stream.start()

        wakeword_detected = False
        while _running and not wakeword_detected:
            if not _calibrate_requests.empty() or not _record_clip_requests.empty():
                break
            if _speaking:
                try:
                    wakeword_stream.read(CHUNK)
                except Exception:
                    pass
                continue

            try:
                data, _ = wakeword_stream.read(CHUNK)
            except Exception as e:
                print(f"[MIC] Errore: {e}")
                time.sleep(0.1)
                continue

            chunk_flat = data.flatten()

            vol_rms = float(np.sqrt(np.mean(chunk_flat.astype(np.float32) ** 2)))
            _vol_samples.append(vol_rms)

            prediction = _oww.predict(chunk_flat)
            max_conf = max((v for v in prediction.values()), default=0.0)
            if max_conf > _ww_conf_peak:
                _ww_conf_peak = max_conf

            _now_s = time.time()
            if _now_s - _stats_ts >= _STATS_INTERVAL:
                avg_vol = sum(_vol_samples) / len(_vol_samples) if _vol_samples else 0.0
                print(f"[Stats] vol={avg_vol:.0f}  "
                      f"oww={_ww_conf_peak:.3f}(thr={config.WAKEWORD_THRESHOLD})  "
                      f"gaia={_gaia_conf_peak:.3f}(thr={_GAIA_THRESHOLD})")
                _publish_stats(avg_vol, "listening", _ww_conf_peak, _gaia_conf_peak)
                _stats_ts = _now_s
                _vol_samples.clear()
                _ww_conf_peak = 0.0
                _gaia_conf_peak = 0.0

            if any(v > config.WAKEWORD_THRESHOLD for v in prediction.values()):
                wakeword_detected = True

            if _gaia_clf and _gaia_af and not wakeword_detected:
                _gaia_buffer.append(chunk_flat.copy())
                if len(_gaia_buffer) * CHUNK / SR >= _GAIA_BUFFER_SEC:
                    arr = np.concatenate(_gaia_buffer).astype(np.int16).reshape(1, -1)
                    _gaia_buffer.clear()
                    try:
                        emb = _gaia_af.embed_clips(arr).mean(axis=1)
                        prob = float(_gaia_clf.predict_proba(emb)[:, 1][0])
                        if prob > _gaia_conf_peak:
                            _gaia_conf_peak = prob
                        if prob >= _GAIA_THRESHOLD:
                            print(f"[Gaia WW] Rilevato! prob={prob:.2f}")
                            wakeword_detected = True
                    except Exception as e:
                        print(f"[Gaia WW] Errore: {e}")

        wakeword_stream.stop()
        wakeword_stream.close()

        if not _running:
            break
        if not wakeword_detected:
            continue

        print("[GAIA Voice] Wakeword rilevato — parla ora...")

        audio = _record_speech()

        if audio is None or len(audio) < SR * 0.3:
            print("[GAIA Voice] Audio troppo breve, ignorato.")
            continue

        if len(audio) >= SR * (config.RECORD_SECONDS_MAX - 2):
            print(f"[GAIA Voice] Audio {len(audio)/SR:.1f}s ~= max — probabile falso positivo, scartato.")
            continue

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
