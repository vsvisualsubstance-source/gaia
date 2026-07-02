#!/bin/bash
# GAIA Camera Broker — script di installazione self-contained
# Uso: cd ~/gaia/camera && bash install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/venv"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   GAIA Camera Broker — Install   ║"
echo "╚══════════════════════════════════╝"
echo "  Dir: $SCRIPT_DIR"
echo ""

# ── Pacchetti di sistema ──────────────────────────────────────────────────────
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
pip install -r "$SCRIPT_DIR/requirements.txt"
echo "  ✓ venv in $VENV"

# ── Configurazione ────────────────────────────────────────────────────────────
echo ""
echo "[3/4] Configurazione..."
sudo mkdir -p /etc/gaia
if [ ! -f /etc/gaia/camera.conf ]; then
    sudo cp "$SCRIPT_DIR/camera.conf.example" /etc/gaia/camera.conf
    echo "  ✓ /etc/gaia/camera.conf creato"
else
    echo "  → /etc/gaia/camera.conf già presente, non sovrascritto"
fi

# ── Verifica ──────────────────────────────────────────────────────────────────
echo ""
echo "[4/4] Verifica import..."
python3 -c "import cv2;   print('  ✓ cv2  ', cv2.__version__)"
python3 -c "import numpy; print('  ✓ numpy', numpy.__version__)"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   Installazione completata ✅    ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "  gaia-camera è gestito automaticamente da gaia-agent quando yolo"
echo "  o mediapipe vengono abilitati — non va avviato/abilitato a mano."
echo ""
echo "  Avvio manuale per test:"
echo "     bash start.sh"
echo ""
