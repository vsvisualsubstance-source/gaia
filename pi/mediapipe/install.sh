#!/bin/bash
# GAIA MediaPipe — script di installazione self-contained
# Uso: cd ~/mediapipe && bash install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/venv"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   GAIA MediaPipe — Install       ║"
echo "╚══════════════════════════════════╝"
echo "  Dir: $SCRIPT_DIR"
echo ""

# ── Architettura ──────────────────────────────────────────────────────────────
ARCH=$(uname -m)
echo "[arch] $ARCH"
if [[ "$ARCH" == "armv7l" ]]; then
    echo "⚠️  ATTENZIONE: ARM 32-bit rilevato."
    echo "   mediapipe richiede ARM 64-bit (aarch64) o x86_64."
    echo "   Se il Pi è un Pi 4/5, reinstalla con Raspberry Pi OS 64-bit."
    echo "   Vuoi continuare comunque? (Ctrl+C per annullare, Enter per continuare)"
    read -r
fi

# ── Pacchetti di sistema ──────────────────────────────────────────────────────
echo ""
echo "[1/4] Pacchetti di sistema (solo essenziali)..."
sudo apt-get update --allow-releaseinfo-change -qq || true
sudo apt-get install -y --allow-unauthenticated \
    python3-pip \
    python3-venv \
    libgl1 \
    libglib2.0-0 \
    2>&1 | grep -E "^(Inst|Err|E:)" || true
echo "  ✓ pacchetti sistema OK"

# ── Venv ──────────────────────────────────────────────────────────────────────
echo ""
echo "[2/4] Creazione venv..."
rm -rf "$VENV"
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip --quiet
echo "  ✓ venv in $VENV"

# ── Dipendenze Python (ordine importante) ─────────────────────────────────────
echo ""
echo "[3/4] Installazione pacchetti Python..."
# numpy prima — mediapipe e opencv devono trovare la versione giusta al resolve
pip install "numpy>=2.0"
pip install -r "$SCRIPT_DIR/requirements.txt"
echo "  ✓ pacchetti Python OK"

# ── Configurazione ────────────────────────────────────────────────────────────
echo ""
echo "[4/4] Configurazione..."
sudo mkdir -p /etc/gaia
if [ ! -f /etc/gaia/mediapipe.conf ]; then
    sudo cp "$SCRIPT_DIR/mediapipe.conf.example" /etc/gaia/mediapipe.conf
    echo "  ✓ /etc/gaia/mediapipe.conf creato"
    echo "  ⚠️  Modifica CAMERA_NAME prima di avviare!"
else
    echo "  → /etc/gaia/mediapipe.conf già presente, non sovrascritto"
fi

# ── Verifica ──────────────────────────────────────────────────────────────────
echo ""
echo "══ Verifica import ══"
python3 -c "import cv2;              print('  ✓ cv2         ', cv2.__version__)"
python3 -c "import numpy;            print('  ✓ numpy       ', numpy.__version__)"
python3 -c "import mediapipe;        print('  ✓ mediapipe   OK')"
python3 -c "import paho.mqtt.client; print('  ✓ paho-mqtt   OK')"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   Installazione completata ✅    ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "  1. Modifica la stanza:"
echo "     sudo nano /etc/gaia/mediapipe.conf"
echo "     → imposta CAMERA_NAME=<nome_stanza>"
echo ""
echo "  2. Avvio manuale:"
echo "     bash start.sh"
echo ""
echo "  3. Installa come servizio (opzionale):"
echo "     bash install_service.sh"
echo ""
