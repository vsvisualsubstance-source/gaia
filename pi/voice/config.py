import os

# ── Stanza (identificatore unico per questo Pi) ──────────────────────
CAMERA_NAME = os.getenv("CAMERA_NAME", "ingresso")

# ── MQTT ─────────────────────────────────────────────────────────────
MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

TOPIC_COMMAND = f"gaia/voice/command/{CAMERA_NAME}"
TOPIC_TTS     = f"gaia/voice/tts/{CAMERA_NAME}"
TOPIC_STATUS  = f"gaia/voice/status/{CAMERA_NAME}"

# ── Audio ─────────────────────────────────────────────────────────────
SAMPLE_RATE        = 16000
CHUNK_SIZE         = 1280      # 80ms @ 16kHz — dimensione richiesta da openWakeWord
SILENCE_THRESHOLD  = 400       # media assoluta int16 sotto cui = silenzio
RECORD_SECONDS_MAX = 12

# ── Wakeword (openWakeWord) ───────────────────────────────────────────
# Modelli disponibili: "alexa", "hey_jarvis", "hey_mycroft", "hey_rhasspy"
# oppure percorso assoluto a un .onnx custom
WAKEWORD_MODEL_NAME = os.getenv("WAKEWORD_MODEL", "alexa")
WAKEWORD_THRESHOLD  = 0.5

# ── STT (faster-whisper) ─────────────────────────────────────────────
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")   # tiny | base | small
WHISPER_LANG  = "it"

# ── TTS (Piper — percorsi relativi alla cartella dello script) ────────
_BASE        = os.path.dirname(os.path.abspath(__file__))
PIPER_BIN    = os.path.join(_BASE, "bin", "piper")
PIPER_MODEL  = os.path.join(_BASE, "models", "it_IT-paola-medium.onnx")
PIPER_CONFIG = os.path.join(_BASE, "models", "it_IT-paola-medium.onnx.json")
PIPER_SAMPLE_RATE = 22050
