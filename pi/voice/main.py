#!/usr/bin/env python3
"""
GAIA Voice Node
Pipeline: openWakeWord → faster-whisper STT → MQTT → Piper TTS
"""
import base64
import io
import json
import os
import pickle
import queue
import signal
import socket
import subprocess
import threading
import time
import urllib.request
import urllib.error
import wave

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from openwakeword.model import Model as WakeWordModel
import paho.mqtt.client as mqtt

import config
from ota import OtaHandler

# ──────────────────────────────────────────────────────────────────────
# Stato globale
# ──────────────────────────────────────────────────────────────────────
_running      = True
_speaking     = False
_current_room = config.NODE_ID

_tts_lock      = threading.Lock()          # serializza le esecuzioni TTS
_tts_proc: subprocess.Popen | None = None  # processo aplay corrente
_tts_proc_lock = threading.Lock()          # protegge _tts_proc

# Coda richieste di registrazione clip (citofono/campioni) — gestita nel main loop
_clip_requests:      queue.Queue = queue.Queue()
_calibrate_requests: queue.Queue = queue.Queue()


def _handle_signal(sig, frame):
    global _running
    _running = False
    _interrupt_tts()
    print("\n[GAIA Voice] Shutdown...")


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)


# ──────────────────────────────────────────────────────────────────────
# Topic dinamici — si aggiornano automaticamente quando il Device
# Registry cambia la room assegnata a questo Pi
# ──────────────────────────────────────────────────────────────────────
def _topic_tts():        return f"gaia/voice/tts/{_current_room}"
def _topic_status():     return f"gaia/voice/status/{_current_room}"
def _topic_command():    return f"gaia/voice/command/{_current_room}"
def _topic_record_clip():return f"gaia/voice/record_clip/{_current_room}"
def _topic_admin():      return f"gaia/voice/admin/{_current_room}"


# ──────────────────────────────────────────────────────────────────────
# MQTT
# ──────────────────────────────────────────────────────────────────────
_mqtt = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION1,
    client_id=f"gaia-voice-{config.DEVICE_ID}",
    clean_session=True,
)
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)

_ota = OtaHandler(
    mqtt_client  = _mqtt,
    device_id    = config.DEVICE_ID,
    device_type  = 'voice',
    base_dir     = os.path.dirname(os.path.abspath(__file__)),
    service_name = os.environ.get('SERVICE_NAME', 'gaia-voice'),
)


def _on_connect(client, userdata, flags, rc, properties=None):
    if rc != 0:
        print(f"[MQTT] Connessione fallita: rc={rc}")
        return
    client.subscribe(_topic_tts())
    client.subscribe(_topic_record_clip())
    client.subscribe(_topic_admin())
    client.subscribe(f"gaia/devices/{config.DEVICE_ID}/config", qos=1)
    for t in _ota.topics():
        client.subscribe(t, qos=1)
    _publish_status("listening")
    # gethostbyname(gethostname()) risolve spesso a 127.0.1.1 (voce /etc/hosts su
    # Debian/Raspbian) invece dell'IP di rete reale — stesso approccio di
    # agent.py._get_ip() per restare coerenti con quello che mostra Pi Manager.
    try:
        ip = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3).stdout.strip().split()[0]
    except Exception:
        ip = "unknown"
    client.publish(
        f"gaia/devices/{config.DEVICE_ID}/announce",
        json.dumps({
            "device_id":  config.DEVICE_ID,
            "type":       "voice",
            "ip":         ip,
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
    if topic in _ota.topics():
        _ota.handle(topic, msg.payload)
        return
    if topic == f"gaia/devices/{config.DEVICE_ID}/config":
        _handle_device_config(client, msg.payload)
        return
    if topic == _topic_record_clip():
        try:
            data = json.loads(msg.payload)
            label      = data.get("label", "positive")
            duration_s = int(data.get("duration_s", 5))
            _clip_requests.put({"label": label, "duration_s": duration_s})
            print(f"[Clip] Richiesta registrazione: label={label} durata={duration_s}s")
        except Exception as e:
            print(f"[Clip] Errore parsing: {e}")
        return
    if topic == _topic_admin():
        try:
            data = json.loads(msg.payload)
            cmd  = data.get("cmd", "")
            if cmd == "calibrate":
                duration_s = int(data.get("duration_s", 5))
                _calibrate_requests.put({"duration_s": duration_s})
                print(f"[Admin] Calibrazione richiesta: {duration_s}s")
            elif cmd == "config":
                _apply_pi_config(data)
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
            print(f"[Registry] Room: {_current_room} → {new_room}")
            client.unsubscribe(_topic_tts())
            client.unsubscribe(_topic_record_clip())
            client.unsubscribe(_topic_admin())
            _current_room = new_room
            client.subscribe(_topic_tts())
            client.subscribe(_topic_record_clip())
            client.subscribe(_topic_admin())
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
    print(f"[MQTT] → '{text}'")


# ──────────────────────────────────────────────────────────────────────
# TTS (Piper binary + aplay — interrompibile)
# ──────────────────────────────────────────────────────────────────────
def _interrupt_tts():
    """Termina immediatamente il processo aplay in corso, se presente."""
    with _tts_proc_lock:
        proc = _tts_proc
    if proc and proc.poll() is None:
        proc.terminate()


def _speak(text: str):
    """Sintetizza e riproduce text. Interrompe qualsiasi TTS già in corso."""
    global _speaking, _tts_proc
    _interrupt_tts()
    with _tts_lock:
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
                timeout=20,
            )
            if piper.returncode == 0 and piper.stdout:
                proc = subprocess.Popen(
                    ["aplay", "-r", str(config.PIPER_SAMPLE_RATE),
                     "-f", "S16_LE", "-c", "1", "-q"],
                    stdin=subprocess.PIPE,
                )
                with _tts_proc_lock:
                    _tts_proc = proc
                try:
                    proc.stdin.write(piper.stdout)
                    proc.stdin.close()
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    proc.kill()
                except BrokenPipeError:
                    pass  # processo terminato da _interrupt_tts
        except FileNotFoundError:
            print(f"[TTS] piper non trovato: {config.PIPER_BIN}")
        except subprocess.TimeoutExpired:
            print("[TTS] Timeout piper")
        except Exception as e:
            print(f"[TTS] Errore: {e}")
        finally:
            with _tts_proc_lock:
                _tts_proc = None
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
               "Gaia, musica. Gaia, volume su. Gaia, volume giù. "
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

# ── Doorbell model (opzionale, caricato se presente) ──────────────────────────
_DOORBELL_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "doorbell_verifier.pkl")
_doorbell_clf        = None
_doorbell_af         = None
_doorbell_buffer     = []      # buffer chunk int16 per sliding window
_DOORBELL_BUFFER_SEC = 2       # finestra di valutazione
_DOORBELL_THRESHOLD  = 0.75
_doorbell_last_alert = 0.0
_DOORBELL_COOLDOWN   = 10.0    # secondi tra alert consecutivi

_GAIA_MODEL_PATH  = os.path.join(os.path.dirname(__file__), "models", "gaia_verifier.pkl")
_gaia_clf         = None
_gaia_af          = None
_gaia_buffer      = []
_GAIA_BUFFER_SEC  = 1.5    # finestra più corta per wakeword (risposta veloce)
_GAIA_THRESHOLD   = config.GAIA_THRESHOLD

# AudioFeatures condiviso da Gaia + Citofono (caricato una volta sola)
_shared_af = None

def _load_af():
    global _shared_af
    if _shared_af is None:
        try:
            from openwakeword.utils import AudioFeatures
            try:
                _shared_af = AudioFeatures(inference_framework='onnx', device='cpu')
            except TypeError:
                _shared_af = AudioFeatures()
        except Exception as e:
            print(f"[AudioFeatures] Impossibile caricare: {e}")
    return _shared_af

if os.path.exists(_GAIA_MODEL_PATH):
    try:
        _gaia_af = _load_af()
        _gaia_clf = pickle.load(open(_GAIA_MODEL_PATH, 'rb'))
        print(f"[Gaia WW] Modello custom caricato: {_GAIA_MODEL_PATH}")
    except Exception as e:
        print(f"[Gaia WW] Impossibile caricare il modello: {e}")

if os.path.exists(_DOORBELL_MODEL_PATH):
    try:
        _doorbell_af = _load_af()
        _doorbell_clf = pickle.load(open(_DOORBELL_MODEL_PATH, 'rb'))
        print(f"[Citofono] Modello caricato: {_DOORBELL_MODEL_PATH}")
    except Exception as e:
        print(f"[Citofono] Impossibile caricare il modello: {e}")

SR    = config.SAMPLE_RATE
CHUNK = config.CHUNK_SIZE

# ── Stats loop wakeword ────────────────────────────────────────────────────────
_stats_ts         = 0.0
_vol_samples: list[float] = []
_ww_conf_peak     = 0.0
_gaia_conf_peak   = 0.0
_STATS_INTERVAL   = 5.0   # secondi tra publish di stats


def _publish_pi_stats(vol: float, state: str, ww_conf: float, gaia_conf: float = 0.0):
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


def _apply_pi_config(data: dict):
    """Aggiorna i threshold live via MQTT senza riavvio."""
    global _GAIA_THRESHOLD, _DOORBELL_THRESHOLD
    if "wakeword_threshold" in data:
        config.WAKEWORD_THRESHOLD = float(data["wakeword_threshold"])
        print(f"[Config] WAKEWORD_THRESHOLD → {config.WAKEWORD_THRESHOLD:.2f}")
    if "gaia_threshold" in data:
        _GAIA_THRESHOLD = float(data["gaia_threshold"])
        print(f"[Config] GAIA_THRESHOLD → {_GAIA_THRESHOLD:.2f}")
    if "silence_threshold" in data:
        config.SILENCE_THRESHOLD = int(data["silence_threshold"])
        print(f"[Config] SILENCE_THRESHOLD → {config.SILENCE_THRESHOLD}")


def _do_calibrate(duration_s: int = 5):
    """Misura il rumore di fondo e pubblica il risultato."""
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
        p95       = float(np.percentile(samples, 95))
        suggested = int(p95 * 2.5)
        print(f"[Calibrazione] Noise floor p95={p95:.1f} → soglia suggerita={suggested}")
        _mqtt.publish(
            f"gaia/voice/calibrate_result/{_current_room}",
            json.dumps({
                "noise_floor":         round(p95, 1),
                "suggested_threshold": suggested,
                "room":                _current_room,
                "ts":                  int(time.time() * 1000),
            })
        )
    _publish_status("listening")


# ──────────────────────────────────────────────────────────────────────
# Registrazione clip campione (citofono/doorbell) su richiesta admin
# ──────────────────────────────────────────────────────────────────────
def _do_record_clip(label: str, duration_s: int):
    """Registra duration_s secondi dal microfono e invia al miniPC."""
    print(f"[Clip] Inizio registrazione {label} ({duration_s}s)...")
    _publish_status("recording")
    chunks = []
    n_chunks = int(SR / CHUNK * duration_s)
    with sd.InputStream(samplerate=SR, channels=1, dtype="int16",
                        blocksize=CHUNK, device=config.MIC_DEVICE) as s:
        for _ in range(n_chunks):
            if not _running:
                break
            data, _ = s.read(CHUNK)
            chunks.append(data.flatten())

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
    # "stanza" permette all'admin di smistare i campioni gaia_* nel dataset
    # della macchina giusta (es. cucina → OPS) — i mic non si mescolano
    payload   = json.dumps({"label": label, "audio_base64": audio_b64,
                            "stanza": _current_room,
                            "device_id": config.DEVICE_ID}).encode()
    try:
        req = urllib.request.Request(admin_url, data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read())
            print(f"[Clip] Inviato → {result}")
    except Exception as e:
        print(f"[Clip] Errore invio al miniPC: {e}")


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
        # ── Calibrazione Pi se richiesta ───────────────────────────
        while not _calibrate_requests.empty():
            req = _calibrate_requests.get_nowait()
            _do_calibrate(req.get("duration_s", 5))

        # ── Clip registrazione campione (citofono) se richiesta ────
        while not _clip_requests.empty():
            req = _clip_requests.get_nowait()
            _do_record_clip(req["label"], req["duration_s"])

        # ── Fase 1: ascolto wakeword ───────────────────────────────
        _publish_status("listening")
        wakeword_stream = sd.InputStream(
            samplerate=SR, channels=1, dtype="int16", blocksize=CHUNK,
            device=config.MIC_DEVICE,
        )
        wakeword_stream.start()

        wakeword_detected = False
        while _running and not wakeword_detected:
            if not _clip_requests.empty() or not _calibrate_requests.empty():
                break  # esce per gestire clip/calibrate nel loop esterno
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

            # ── Volume RMS per stats ──────────────────────────────────────────
            vol_rms = float(np.sqrt(np.mean(chunk_flat.astype(np.float32) ** 2)))
            _vol_samples.append(vol_rms)

            prediction = _oww.predict(chunk_flat)
            max_conf = max((v for v in prediction.values()), default=0.0)

            global _ww_conf_peak
            if max_conf > _ww_conf_peak:
                _ww_conf_peak = max_conf

            # ── Publish stats ogni _STATS_INTERVAL secondi ───────────────────
            _now_s = time.time()
            if _now_s - _stats_ts >= _STATS_INTERVAL:
                avg_vol = sum(_vol_samples) / len(_vol_samples) if _vol_samples else 0.0
                print(f"[Stats] vol={avg_vol:.0f}  "
                      f"oww={_ww_conf_peak:.3f}(thr={config.WAKEWORD_THRESHOLD})  "
                      f"gaia={_gaia_conf_peak:.3f}(thr={_GAIA_THRESHOLD})")
                _publish_pi_stats(avg_vol, "listening", _ww_conf_peak, _gaia_conf_peak)
                _stats_ts       = _now_s
                _vol_samples.clear()
                _ww_conf_peak   = 0.0
                _gaia_conf_peak = 0.0

            if any(v > config.WAKEWORD_THRESHOLD for v in prediction.values()):
                wakeword_detected = True

            # ── Gaia custom wakeword classifier ──────────────────────────────
            if _gaia_clf and _gaia_af and not wakeword_detected:
                _gaia_buffer.append(chunk_flat.copy())
                if len(_gaia_buffer) * CHUNK / SR >= _GAIA_BUFFER_SEC:
                    import numpy as _np
                    arr = _np.concatenate(_gaia_buffer).astype(_np.int16).reshape(1, -1)
                    try:
                        emb  = _gaia_af.embed_clips(arr).mean(axis=1)
                        prob = float(_gaia_clf.predict_proba(emb)[:, 1][0])
                        if prob > _gaia_conf_peak:
                            _gaia_conf_peak = prob
                        if prob >= _GAIA_THRESHOLD:
                            print(f"[Gaia WW] Rilevato! prob={prob:.2f}")
                            wakeword_detected = True
                    except Exception as _e:
                        print(f"[Gaia WW] Errore: {_e}")
                    _gaia_buffer.clear()

            # ── Doorbell detection (classificatore citofono) ──────────────────
            if _doorbell_clf and _doorbell_af:
                _doorbell_buffer.append(data.flatten().copy())
                _buf_sec = len(_doorbell_buffer) * CHUNK / SR
                if _buf_sec >= _DOORBELL_BUFFER_SEC:
                    import numpy as _np
                    chunk_arr = _np.concatenate(_doorbell_buffer[-int(SR/_DOORBELL_BUFFER_SEC*_DOORBELL_BUFFER_SEC/CHUNK):]).astype(_np.int16)
                    clips = chunk_arr.reshape(1, -1)
                    try:
                        emb = _doorbell_af.embed_clips(clips).mean(axis=1)
                        prob = float(_doorbell_clf.predict_proba(emb)[:, 1][0])
                        _now = time.time()
                        if prob >= _DOORBELL_THRESHOLD and (_now - _doorbell_last_alert) > _DOORBELL_COOLDOWN:
                            _doorbell_last_alert = _now
                            print(f"[Citofono] Rilevato! prob={prob:.2f}")
                            _mqtt.publish(
                                f"gaia/{_current_room}/alarm",
                                json.dumps({"type": "doorbell",
                                            "confidence": round(prob, 3),
                                            "ts": int(_now * 1000)})
                            )
                    except Exception as _e:
                        print(f"[Citofono] Errore inferenza: {_e}")
                    _doorbell_buffer.clear()

        wakeword_stream.stop()
        wakeword_stream.close()

        if not _running:
            break

        if not wakeword_detected:
            continue  # torna all'inizio dell'outer loop per gestire clip requests

        print("[GAIA Voice] Wakeword rilevato — parla ora...")

        # ── Fase 2: registrazione ──────────────────────────────────
        audio = _record_speech()

        if audio is None or len(audio) < SR * 0.3:
            print("[GAIA Voice] Audio troppo breve, ignorato.")
            continue

        # Clip vicino al massimo (12s) = probabile rumore ambientale (TV, musica)
        # che ha saturato RECORD_SECONDS_MAX senza mai scendere sotto SILENCE_THRESHOLD
        if len(audio) >= SR * (config.RECORD_SECONDS_MAX - 2):
            print(f"[GAIA Voice] Audio {len(audio)/SR:.1f}s ≈ max — probabilmente falso positivo, scartato.")
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
