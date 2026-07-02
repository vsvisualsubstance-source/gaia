#!/usr/bin/env python3
"""
gaia_listener.py — Gaia Voice Pipeline
Wake word "Gaia" → STT → Speaker ID → MQTT
Admin via gaia/admin/# : config | calibrate | voice_enroll | reload_speakers | remove_speaker
"""

import os, sys, json, time, wave, io, threading, logging, signal, queue
from math import gcd
import numpy as np
import pyaudio
import webrtcvad
import paho.mqtt.client as mqtt
from scipy.signal import resample_poly
from faster_whisper import WhisperModel
from resemblyzer import VoiceEncoder, preprocess_wav

# ── Topic MQTT ────────────────────────────────────────────────────────────────
MQTT_BROKER   = "localhost"
MQTT_PORT     = 1883
TOPIC_COMANDO = "gaia/voice/command/minipc"
TOPIC_STATO   = "gaia/voice/status/minipc"
TOPIC_STATS   = "gaia/voice/stats/minipc"
TOPIC_TTS     = "gaia/voice/tts/minipc"
TOPIC_ADMIN   = "gaia/admin/#"

# ── Audio ─────────────────────────────────────────────────────────────────────
TARGET_RATE   = 16000
FRAME_MS      = 30
FRAME_SAMPLES = int(TARGET_RATE * FRAME_MS / 1000)  # 480

# ── Defaults (overridable da listener_config.json) ────────────────────────────
DEFAULT_VOICE_THRESHOLD = 300
DEFAULT_SILENCE_FRAMES  = 25
DEFAULT_SPEAKER_THR     = 0.72
MIN_FRAMES  = 8
MAX_FRAMES  = 120
LISTEN_MAX_S           = 20
LISTEN_SILENCE_FRAMES  = 50

# ── Paths ─────────────────────────────────────────────────────────────────────
DB_PATH     = os.path.expanduser("~/core-node-0/minipc/script/voice_db.json")
CONFIG_PATH = os.path.expanduser("~/core-node-0/minipc/script/listener_config.json")

# ── Logger ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger("gaia")

# ── Config file ───────────────────────────────────────────────────────────────
def load_config() -> dict:
    defaults = {
        "device_id":          "gaia-main",
        "device_hint":        "Polycom",
        "voice_threshold":    DEFAULT_VOICE_THRESHOLD,
        "silence_frames":     DEFAULT_SILENCE_FRAMES,
        "speaker_threshold":  DEFAULT_SPEAKER_THR,
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                defaults.update(json.load(f))
        except Exception as e:
            log.warning(f"Config load error: {e}")
    return defaults

def save_config(cfg: dict):
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        log.warning(f"Config save error: {e}")

# ── Audio device ──────────────────────────────────────────────────────────────
def find_device(pa, hint=""):
    if not hint:
        return None  # usa default di sistema
    for i in range(pa.get_device_count()):
        d = pa.get_device_info_by_index(i)
        if d["maxInputChannels"] > 0 and hint.lower() in d["name"].lower():
            return i
    log.warning(f"Microfono '{hint}' non trovato — uso default di sistema")
    return None

def get_device_info(pa, idx):
    return pa.get_device_info_by_index(idx) if idx is not None else pa.get_default_input_device_info()

# ── Resampling ────────────────────────────────────────────────────────────────
def make_resampler(src_rate: int):
    if src_rate == TARGET_RATE:
        return lambda d: d
    g = gcd(TARGET_RATE, src_rate)
    up, down = TARGET_RATE // g, src_rate // g
    return lambda d: resample_poly(d, up, down).astype(np.int16)

# ── Audio helpers ─────────────────────────────────────────────────────────────
def frames_to_wav(frames: list[bytes]) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(TARGET_RATE)
        wf.writeframes(b"".join(frames))
    return buf.getvalue()

def rms(frame: bytes) -> float:
    d = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
    return float(np.sqrt(np.mean(d**2))) if len(d) else 0.0

# ── Speaker DB ────────────────────────────────────────────────────────────────
class SpeakerDB:
    def __init__(self, threshold=DEFAULT_SPEAKER_THR):
        self.encoder   = VoiceEncoder()
        self.threshold = threshold
        self.db: dict[str, np.ndarray] = {}
        self._load()

    def _load(self):
        if os.path.exists(DB_PATH):
            try:
                with open(DB_PATH) as f:
                    raw = json.load(f)
                self.db = {n: np.array(d["embedding"]) for n, d in raw.items()}
                log.info(f"Speaker DB: {list(self.db.keys())}")
            except Exception as e:
                log.warning(f"Speaker DB load error: {e}")
        else:
            log.warning(f"Speaker DB non trovato: {DB_PATH}")

    def reload(self):
        self._load()

    def speakers(self) -> list[str]:
        return list(self.db.keys())

    def remove(self, name: str):
        self.db.pop(name, None)
        if not os.path.exists(DB_PATH):
            return
        try:
            with open(DB_PATH) as f:
                raw = json.load(f)
            raw.pop(name, None)
            with open(DB_PATH, "w") as f:
                json.dump(raw, f, indent=2)
            log.info(f"Speaker rimosso: {name}")
        except Exception as e:
            log.warning(f"remove_speaker error: {e}")

    def enroll(self, name: str, embeddings: list) -> bool:
        if not embeddings:
            return False
        final = np.mean(embeddings, axis=0)
        final = final / (np.linalg.norm(final) + 1e-8)
        self.db[name] = final
        db = {}
        if os.path.exists(DB_PATH):
            with open(DB_PATH) as f:
                db = json.load(f)
        db[name] = {"embedding": final.tolist()}
        with open(DB_PATH, "w") as f:
            json.dump(db, f, indent=2)
        return True

    def identify(self, wav_bytes: bytes) -> tuple[str, float]:
        if not self.db:
            return "sconosciuto", 0.0
        try:
            tmp = "/tmp/gaia_speaker.wav"
            with open(tmp, "wb") as f:
                f.write(wav_bytes)
            wav = preprocess_wav(tmp)
            emb = self.encoder.embed_utterance(wav)
        except Exception as e:
            log.warning(f"Speaker embed error: {e}")
            return "sconosciuto", 0.0
        best, best_score = "sconosciuto", 0.0
        for n, known in self.db.items():
            score = float(np.dot(emb, known))
            if score > best_score:
                best_score, best = score, n
        return (best, best_score) if best_score >= self.threshold else ("sconosciuto", best_score)

# Varianti di "Gaia" che Whisper può trascrivere in italiano
_GAIA_VARIANTS = {"gaia", "gaya", "gaïa", "gaìa", "gaja", "gaia,", "gaya,"}
# Prompt per aiutare Whisper a riconoscere il nome proprio e l'italiano parlato
_WAKE_PROMPT  = "Gaia,"
_CMD_PROMPT   = ("Gaia, accendi le luci del soggiorno. Gaia, spegni il corridoio. "
                 "Gaia, attiva l'ingresso. Gaia, accendi la camera. "
                 "Gaia, spegni tutto. Gaia, che ore sono? Gaia, temperatura della casa. "
                 "Gaia, musica. Gaia, volume su. "
                 "soggiorno, salotto, ingresso, corridoio, cucina, camera, notte, sala.")

# ── Transcriber ───────────────────────────────────────────────────────────────
class Transcriber:
    def __init__(self):
        log.info("Caricamento whisper-tiny…")
        self.tiny  = WhisperModel("tiny",  device="cpu", compute_type="int8")
        log.info("Caricamento whisper-small…")
        self.small = WhisperModel("small", device="cpu", compute_type="int8")
        log.info("Whisper pronto.")

    def detect_wake(self, wav_bytes: bytes) -> tuple[bool, str]:
        segs, _ = self.tiny.transcribe(
            io.BytesIO(wav_bytes), language="it",
            beam_size=1, best_of=1, temperature=0.0, vad_filter=False,
            initial_prompt=_WAKE_PROMPT,
        )
        text = " ".join(s.text for s in segs).strip().lower()
        log.info(f"[TINY] '{text}'")
        found = any(v in text for v in _GAIA_VARIANTS)
        return found, text

    def transcribe_command(self, wav_bytes: bytes) -> str:
        segs, _ = self.small.transcribe(
            io.BytesIO(wav_bytes), language="it",
            beam_size=5, best_of=1, temperature=0.0, vad_filter=True,
            initial_prompt=_CMD_PROMPT,
        )
        return " ".join(s.text for s in segs).strip()

# ── State machine ─────────────────────────────────────────────────────────────
class GaiaListener:
    STATE_IDLE        = "idle"
    STATE_LISTENING   = "listening"
    STATE_PROCESSING  = "processing"
    STATE_ENROLLING   = "enrolling"
    STATE_CALIBRATING = "calibrating"

    def __init__(self):
        self._cfg = load_config()
        self.voice_threshold = self._cfg.get("voice_threshold", DEFAULT_VOICE_THRESHOLD)
        self.silence_frames  = self._cfg.get("silence_frames",  DEFAULT_SILENCE_FRAMES)

        self.state       = self.STATE_IDLE
        self.speaker_db  = SpeakerDB(threshold=self._cfg.get("speaker_threshold", DEFAULT_SPEAKER_THR))
        self.transcriber = Transcriber()

        self._cmd_queue = queue.Queue()
        self._busy      = False  # True durante enrollment/calibrazione: blocca il loop audio

        # MQTT
        self.mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.mqtt.on_connect = self._on_connect
        self.mqtt.on_message = self._on_admin_msg
        self.mqtt.connect(MQTT_BROKER, MQTT_PORT, 60)
        self.mqtt.loop_start()

        # PyAudio
        self.pa = pyaudio.PyAudio()
        hint = self._cfg.get("device_hint", "")
        dev  = find_device(self.pa, hint)
        if dev is not None:
            log.info(f"Microfono: '{hint}' (idx={dev})")
        else:
            info_def = self.pa.get_default_input_device_info()
            log.info(f"Microfono: default di sistema — {info_def['name']}")
        self.device_index = dev

        info = get_device_info(self.pa, dev)
        self.src_rate     = int(info["defaultSampleRate"])
        self.src_channels = min(int(info["maxInputChannels"]), 2)
        self.native_chunk = int(self.src_rate * FRAME_MS / 1000)
        self.resample     = make_resampler(self.src_rate)
        log.info(f"Audio: {self.src_rate} Hz {self.src_channels}ch → 16000 Hz mono")

        self.vad      = webrtcvad.Vad(2)
        self._running = True

    # ── MQTT callbacks ────────────────────────────────────────────────────────
    def _on_connect(self, c, u, f, rc, p):
        log.info(f"MQTT connesso (rc={rc})")
        c.subscribe(TOPIC_ADMIN)

    def _on_admin_msg(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            leaf    = msg.topic.split("/")[-1]
            self._cmd_queue.put({"cmd": leaf, "data": payload})
        except Exception as e:
            log.warning(f"Admin msg error: {e}")

    # ── Publish helpers ───────────────────────────────────────────────────────
    def _publish_stato(self, stato: str):
        self.state = stato
        self.mqtt.publish(TOPIC_STATO, stato, qos=0)

    def _publish_stats(self, vol: float, frames_acc: int, extra: dict | None = None):
        payload = {
            "vol":              round(float(vol), 0),
            "state":            self.state,
            "threshold":        self.voice_threshold,
            "silence_frames":   self.silence_frames,
            "speaker_threshold": round(self.speaker_db.threshold, 2),
            "frames_acc":       frames_acc,
            "device_id":        self._cfg.get("device_id", "gaia-main"),
        }
        if extra:
            payload.update(extra)
        self.mqtt.publish(TOPIC_STATS, json.dumps(payload), qos=0)

    def _publish_comando(self, text: str, speaker: str, confidence: float):
        if not text:
            return
        payload = json.dumps({
            "text": text, "speaker": speaker,
            "confidence": round(confidence, 3),
            "ts": int(time.time() * 1000)
        }, ensure_ascii=False)
        self.mqtt.publish(TOPIC_COMANDO, payload, qos=1)
        log.info(f"→ MQTT: [{speaker}] {text!r} ({confidence:.2f})")

    # ── Audio helpers ─────────────────────────────────────────────────────────
    def _open_stream(self):
        return self.pa.open(
            format=pyaudio.paInt16, channels=self.src_channels,
            rate=self.src_rate, input=True,
            frames_per_buffer=self.native_chunk,
            input_device_index=self.device_index
        )

    def _read_frame(self, stream) -> bytes:
        raw  = stream.read(self.native_chunk, exception_on_overflow=False)
        data = np.frombuffer(raw, dtype=np.int16)
        if self.src_channels == 2:
            data = data[::2]
        if self.src_rate != TARGET_RATE:
            data = self.resample(data)
        if len(data) != FRAME_SAMPLES:
            data = data[:FRAME_SAMPLES] if len(data) > FRAME_SAMPLES else np.pad(data, (0, FRAME_SAMPLES - len(data)))
        return data.astype(np.int16).tobytes()

    def _is_speech(self, frame: bytes) -> bool:
        try:
            return self.vad.is_speech(frame, TARGET_RATE)
        except Exception:
            return False

    def _record_until_silence(self, stream) -> list[bytes]:
        frames, silence = [], 0
        deadline = time.time() + LISTEN_MAX_S
        while time.time() < deadline and self._running and not self._busy:
            try:
                data = self._read_frame(stream)
            except OSError:
                break
            frames.append(data)
            if rms(data) > self.voice_threshold:
                silence = 0
            else:
                silence += 1
                if silence >= LISTEN_SILENCE_FRAMES:
                    break
        return frames

    # ── Admin command dispatcher ──────────────────────────────────────────────
    def _exec_cmd(self, item, stream):
        cmd, data = item["cmd"], item["data"]

        if cmd == "config":
            if "voice_threshold" in data:
                self.voice_threshold = int(data["voice_threshold"])
            if "silence_frames" in data:
                self.silence_frames = int(data["silence_frames"])
            if "speaker_threshold" in data:
                self.speaker_db.threshold = float(data["speaker_threshold"])
            self._cfg.update({
                "voice_threshold":   self.voice_threshold,
                "silence_frames":    self.silence_frames,
                "speaker_threshold": self.speaker_db.threshold,
            })
            save_config(self._cfg)
            log.info(f"Config aggiornata: voice_threshold={self.voice_threshold} silence_frames={self.silence_frames}")
            self._publish_stats(0, 0)

        elif cmd == "calibrate":
            if not self._busy:
                threading.Thread(target=self._do_calibrate, args=(stream,), daemon=True).start()

        elif cmd == "voice_enroll":
            name = data.get("name", "").strip()
            if name and not self._busy:
                threading.Thread(
                    target=self._do_enroll,
                    args=(name, stream, data.get("samples", 3), data.get("duration_s", 5)),
                    daemon=True
                ).start()

        elif cmd == "record_raw_clip":
            # Registra N secondi dal microfono e salva il WAV nel path specificato
            dest_path  = data.get("path", "").strip()
            duration_s = int(data.get("duration_s", 3))
            if dest_path and not self._busy:
                threading.Thread(
                    target=self._do_record_raw,
                    args=(dest_path, stream, duration_s),
                    daemon=True
                ).start()

        elif cmd == "voice_enroll_file":
            name      = data.get("name", "").strip()
            file_path = data.get("file_path", "").strip()
            if name and file_path and not self._busy:
                threading.Thread(
                    target=self._do_enroll_file,
                    args=(name, file_path),
                    daemon=True
                ).start()

        elif cmd == "reload_speakers":
            self.speaker_db.reload()
            log.info("Speaker DB ricaricato")

        elif cmd == "remove_speaker":
            name = data.get("name", "").strip()
            if name:
                self.speaker_db.remove(name)

    # ── Calibration (background thread) ──────────────────────────────────────
    def _do_calibrate(self, stream, duration_s: int = 5):
        self._busy = True
        time.sleep(0.05)  # lascia uscire il loop principale
        prev = self.state
        self._publish_stato(self.STATE_CALIBRATING)
        log.info(f"Calibrazione: silenzio per {duration_s}s…")

        volumes = []
        for _ in range(int(duration_s * 1000 / FRAME_MS)):
            try:
                volumes.append(rms(self._read_frame(stream)))
            except:
                break

        if volumes:
            p95       = float(np.percentile(volumes, 95))
            suggested = int(p95 * 2.5)
            log.info(f"Noise floor p95={p95:.1f} → soglia suggerita={suggested}")
            self.mqtt.publish("gaia/admin/calibrate_result", json.dumps({
                "noise_floor":         round(p95, 1),
                "suggested_threshold": suggested,
            }))

        self._busy = False
        self._publish_stato(prev)

    # ── Voice enrollment (background thread) ──────────────────────────────────
    def _do_enroll(self, name: str, stream, n_samples: int = 3, duration_s: int = 5):
        self._busy = True
        time.sleep(0.05)
        self._publish_stato(self.STATE_ENROLLING)
        log.info(f"Enrollment: {name} ({n_samples}×{duration_s}s)")

        encoder    = VoiceEncoder()
        embeddings = []

        for i in range(n_samples):
            self._publish_stats(0, 0, extra={
                "enroll_name": name, "enroll_sample": i + 1, "enroll_total": n_samples
            })
            log.info(f"Campione {i+1}/{n_samples} — parla ora…")
            time.sleep(0.5)

            frames = []
            for _ in range(int(duration_s * 1000 / FRAME_MS)):
                try:
                    frames.append(self._read_frame(stream))
                except:
                    break

            if len(frames) < 10:
                log.warning(f"Campione {i+1}: troppo corto, salto")
                continue

            try:
                tmp = f"/tmp/enroll_{name}_{i}.wav"
                with open(tmp, "wb") as f:
                    f.write(frames_to_wav(frames))
                emb = encoder.embed_utterance(preprocess_wav(tmp))
                embeddings.append(emb)
                log.info(f"Campione {i+1} acquisito ✓")
            except Exception as e:
                log.warning(f"Campione {i+1} errore: {e}")

        success = self.speaker_db.enroll(name, embeddings) if embeddings else False
        log.info(f"Enrollment {name}: {'OK' if success else 'FALLITO'} ({len(embeddings)} validi)")

        self._publish_stats(0, 0, extra={
            "enrolled": name, "success": success, "samples": len(embeddings)
        })
        self._busy = False
        self._publish_stato(self.STATE_IDLE)

    # ── Registrazione clip grezzo (WAV) — usato per training campioni ──────────
    def _do_record_raw(self, dest_path: str, stream, duration_s: int = 3):
        self._busy = True
        self._publish_stato(self.STATE_ENROLLING)
        log.info(f"Record raw clip: {duration_s}s → {dest_path}")
        frames = []
        for _ in range(int(duration_s * 1000 / FRAME_MS)):
            try:
                frames.append(self._read_frame(stream))
            except Exception:
                break
        ok = False
        if frames:
            try:
                import os
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                with open(dest_path, "wb") as f:
                    f.write(frames_to_wav(frames))
                ok = True
                log.info(f"Clip salvata: {dest_path}")
            except Exception as e:
                log.warning(f"Salvataggio clip fallito: {e}")
        self._publish_stats(0, 0, extra={"clip_saved": dest_path if ok else None, "clip_ok": ok})
        self._busy = False
        self._publish_stato(self.STATE_IDLE)

    # ── Voice enrollment da file caricato (no microfono) ───────────────────────
    def _do_enroll_file(self, name: str, file_path: str):
        self._busy = True
        self._publish_stato(self.STATE_ENROLLING)
        log.info(f"Enrollment da file: {name} ({file_path})")

        success, n_valid = False, 0
        try:
            emb = self.speaker_db.encoder.embed_utterance(preprocess_wav(file_path))
            success = self.speaker_db.enroll(name, [emb])
            n_valid = 1 if success else 0
        except Exception as e:
            log.warning(f"Enrollment da file fallito: {e}")
        finally:
            try:
                os.remove(file_path)
            except OSError:
                pass

        log.info(f"Enrollment {name} (file): {'OK' if success else 'FALLITO'}")
        self._publish_stats(0, 0, extra={
            "enrolled": name, "success": success, "samples": n_valid
        })
        self._busy = False
        self._publish_stato(self.STATE_IDLE)

    # ── Command processing ────────────────────────────────────────────────────
    def _process_command(self, wav_bytes: bytes):
        self._publish_stato(self.STATE_PROCESSING)
        result_text    = [""]
        result_speaker = [("sconosciuto", 0.0)]

        t1 = threading.Thread(target=lambda: result_text.__setitem__(0, self.transcriber.transcribe_command(wav_bytes)), daemon=True)
        t2 = threading.Thread(target=lambda: result_speaker.__setitem__(0, self.speaker_db.identify(wav_bytes)),          daemon=True)
        t1.start(); t2.start(); t1.join(); t2.join()

        text = result_text[0]
        _STRIP_PREFIXES = ["gaia,", "gaya,", "gaia ", "gaya ", "gaia", "gaya"]
        for prefix in _STRIP_PREFIXES:
            if text.lower().startswith(prefix):
                text = text[len(prefix):].strip()
                break

        self._publish_comando(text, *result_speaker[0])
        self._publish_stato(self.STATE_IDLE)

    # ── Main loop ─────────────────────────────────────────────────────────────
    def run(self):
        log.info("Gaia Listener avviato. In ascolto per 'Gaia'…")
        self._publish_stato(self.STATE_IDLE)
        stream = self._open_stream()

        speech_frames = []
        silence_count = 0
        last_hb       = time.time()

        try:
            while self._running:
                # Comandi admin
                while not self._cmd_queue.empty():
                    self._exec_cmd(self._cmd_queue.get_nowait(), stream)

                # Yield durante operazioni in background
                if self._busy:
                    time.sleep(0.03)
                    continue

                # Leggi frame audio
                try:
                    data = self._read_frame(stream)
                except OSError as e:
                    log.warning(f"Audio error: {e}, riapro…")
                    time.sleep(0.5)
                    try: stream.stop_stream(); stream.close()
                    except: pass
                    stream = self._open_stream()
                    speech_frames = []; silence_count = 0
                    continue

                vol = rms(data)

                # Heartbeat + stats
                if time.time() - last_hb > 3.0:
                    log.info(f"[ALIVE] vol={vol:.0f} acc={len(speech_frames)} state={self.state}")
                    self._publish_stats(vol, len(speech_frames))
                    last_hb = time.time()

                # IDLE: accumula e cerca wake word
                if self.state == self.STATE_IDLE:
                    if vol > self.voice_threshold:
                        speech_frames.append(data)
                        silence_count = 0
                    elif speech_frames:
                        silence_count += 1
                        speech_frames.append(data)

                        if silence_count >= self.silence_frames or len(speech_frames) >= MAX_FRAMES:
                            if len(speech_frames) >= MIN_FRAMES:
                                wav = frames_to_wav(speech_frames)
                                found, full_text = self.transcriber.detect_wake(wav)
                                log.info(f"[STT] '{full_text}' | wake={found}")

                                if found:
                                    after = ""
                                    for tok in ["gaia,", "gaya,", "gaia ", "gaya ", "gaia", "gaya"]:
                                        idx = full_text.find(tok)
                                        if idx >= 0:
                                            after = full_text[idx + len(tok):].strip()
                                            break
                                    if len(after.split()) >= 2:
                                        log.info(f"Comando diretto: '{after}'")
                                        self._publish_stato(self.STATE_PROCESSING)
                                        spk, conf = self.speaker_db.identify(wav)
                                        self._publish_comando(after, spk, conf)
                                        self._publish_stato(self.STATE_IDLE)
                                    else:
                                        self._publish_stato(self.STATE_LISTENING)
                                        self.mqtt.publish(TOPIC_TTS, "Dimmi", qos=0)

                            speech_frames = []; silence_count = 0

                # LISTENING: registra il comando
                elif self.state == self.STATE_LISTENING:
                    frames = self._record_until_silence(stream)
                    if len(frames) > 5:
                        self._process_command(frames_to_wav(frames))
                    else:
                        self._publish_stato(self.STATE_IDLE)

        except KeyboardInterrupt:
            log.info("Interruzione.")
        finally:
            try: stream.stop_stream(); stream.close()
            except: pass
            self.pa.terminate()
            self.mqtt.loop_stop()
            self.mqtt.disconnect()

    def stop(self):
        self._running = False


if __name__ == "__main__":
    listener = GaiaListener()
    signal.signal(signal.SIGTERM, lambda s, f: listener.stop())
    listener.run()
