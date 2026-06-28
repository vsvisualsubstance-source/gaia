#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== GAIA Voice Node — Install ==="
echo ""

# ── Architettura ─────────────────────────────────────────────────────
ARCH=$(uname -m)
echo "  Architettura: $ARCH"

# ── Dipendenze sistema ───────────────────────────────────────────────
echo "[1/5] Dipendenze sistema..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-venv python3-pip \
    portaudio19-dev \
    libsndfile1 \
    ffmpeg \
    alsa-utils \
    wget

# ── Venv ─────────────────────────────────────────────────────────────
echo "[2/5] Creazione venv..."
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip -q

# numpy prima (dipendenza di tutti gli altri)
pip install "numpy>=1.24,<2.0" -q

# ── Pacchetti Python ─────────────────────────────────────────────────
echo "[3/5] Installazione pacchetti Python..."
pip install -r requirements.txt -q

# Pre-download wakeword models
python3 -c "
import openwakeword
openwakeword.utils.download_models()
" 2>/dev/null && echo "  ✓ openWakeWord modelli scaricati" || echo "  ⚠ openWakeWord: verifica connessione"

# Pre-download Whisper
MODEL="${WHISPER_MODEL:-base}"
echo "  → Whisper '$MODEL' (prima esecuzione scarica il modello)..."
python3 -c "
from faster_whisper import WhisperModel
WhisperModel('$MODEL', device='cpu', compute_type='int8')
print('  ✓ Whisper pronto')
"

# ── Piper binary ─────────────────────────────────────────────────────
echo "[4/5] Piper TTS binary..."
mkdir -p bin models

if [ "$ARCH" = "aarch64" ]; then
    PIPER_FILE="piper_linux_aarch64.tar.gz"
elif [ "$ARCH" = "armv7l" ]; then
    PIPER_FILE="piper_linux_armv7l.tar.gz"
else
    PIPER_FILE="piper_linux_x86_64.tar.gz"
fi

if [ ! -f "bin/piper" ]; then
    PIPER_VER="2023.11.14-2"
    PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/${PIPER_FILE}"
    echo "  → Download $PIPER_FILE..."
    wget -q "$PIPER_URL" -O /tmp/piper.tar.gz
    tar -xzf /tmp/piper.tar.gz -C bin/ --strip-components=1
    rm -f /tmp/piper.tar.gz
    echo "  ✓ piper installato"
else
    echo "  ✓ piper già presente"
fi

# ── Modello voce Piper ────────────────────────────────────────────────
echo "[5/5] Modello voce italiana (Piper)..."
PIPER_VOICE="it_IT-paola-medium"
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/paola/medium"

if [ ! -f "models/${PIPER_VOICE}.onnx" ]; then
    echo "  → Download voce ${PIPER_VOICE}..."
    wget -q "${HF_BASE}/${PIPER_VOICE}.onnx" -O "models/${PIPER_VOICE}.onnx"
    wget -q "${HF_BASE}/${PIPER_VOICE}.onnx.json" -O "models/${PIPER_VOICE}.onnx.json"
    echo "  ✓ Voce scaricata"
else
    echo "  ✓ Voce già presente"
fi

echo ""
echo "✅ Installazione completata!"
echo ""
echo "Configura la stanza in config.py:"
echo "  CAMERA_NAME = 'soggiorno'   # nome della stanza"
echo "  MQTT_HOST   = '192.168.1.142'"
echo ""
echo "Oppure usa variabili d'ambiente:"
echo "  CAMERA_NAME=soggiorno bash start.sh"
echo ""
echo "Installa come servizio systemd:"
echo "  sudo cp voice-node.service /etc/systemd/system/"
echo "  sudo sed -i \"s|/opt/gaia/voice-node|$SCRIPT_DIR|g\" /etc/systemd/system/voice-node.service"
echo "  sudo systemctl daemon-reload && sudo systemctl enable --now voice-node"
