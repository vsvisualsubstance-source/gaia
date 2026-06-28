#!/bin/bash
# GAIA YOLO — script di installazione self-contained
# Uso: cd ~/yolo && bash install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/venv"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   GAIA YOLO — Install            ║"
echo "╚══════════════════════════════════╝"
echo "  Dir: $SCRIPT_DIR"
echo ""

# ── Pacchetti di sistema ──────────────────────────────────────────────────────
echo "[1/5] Pacchetti di sistema (solo essenziali)..."
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
echo "[2/5] Creazione venv..."
rm -rf "$VENV"
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip --quiet
echo "  ✓ venv in $VENV"

# ── Dipendenze Python (ordine importante) ─────────────────────────────────────
echo ""
echo "[3/5] Installazione pacchetti Python..."
# numpy prima — ultralytics deve trovare la versione giusta
pip install "numpy>=1.24,<2.0"
pip install -r "$SCRIPT_DIR/requirements.txt"
echo "  ✓ pacchetti Python OK"

# ── Modello YOLO ──────────────────────────────────────────────────────────────
echo ""
echo "[4/5] Modello YOLO..."
mkdir -p "$SCRIPT_DIR/models"
if [ ! -f "$SCRIPT_DIR/models/yolo11n.pt" ]; then
    echo "  Download yolo11n.pt..."
    python3 -c "
from ultralytics import YOLO
import shutil, os
m = YOLO('yolo11n.pt')   # scarica nella dir corrente
src = 'yolo11n.pt'
dst = '$SCRIPT_DIR/models/yolo11n.pt'
if os.path.exists(src):
    shutil.move(src, dst)
    print('  ✓ modello salvato in', dst)
else:
    # ultralytics lo mette in ~/.cache
    import glob
    found = glob.glob(os.path.expanduser('~/.config/Ultralytics/*/yolo11n.pt'))
    if not found:
        found = glob.glob(os.path.expanduser('~/.cache/**/yolo11n.pt'), recursive=True)
    if found:
        shutil.copy(found[0], dst)
        print('  ✓ modello copiato da cache:', found[0])
    else:
        print('  ⚠️  modello non trovato nella cache, verrà scaricato al primo avvio')
"
else
    echo "  ✓ modello già presente"
fi

# ── Configurazione ────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Configurazione..."
sudo mkdir -p /etc/gaia
if [ ! -f /etc/gaia/yolo.conf ]; then
    sudo cp "$SCRIPT_DIR/yolo.conf.example" /etc/gaia/yolo.conf
    echo "  ✓ /etc/gaia/yolo.conf creato"
    echo "  ⚠️  Modifica NODE_ID prima di avviare!"
else
    echo "  → /etc/gaia/yolo.conf già presente, non sovrascritto"
fi

# ── Verifica ──────────────────────────────────────────────────────────────────
echo ""
echo "══ Verifica import ══"
python3 -c "import cv2;              print('  ✓ cv2         ', cv2.__version__)"
python3 -c "import numpy;            print('  ✓ numpy       ', numpy.__version__)"
python3 -c "import ultralytics;      print('  ✓ ultralytics OK')"
python3 -c "import paho.mqtt.client; print('  ✓ paho-mqtt   OK')"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   Installazione completata ✅    ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "  1. Modifica la stanza:"
echo "     sudo nano /etc/gaia/yolo.conf"
echo "     → imposta NODE_ID=<nome_stanza>"
echo ""
echo "  2. Avvio manuale:"
echo "     bash start.sh"
echo ""
echo "  3. Installa come servizio (opzionale):"
echo "     bash install_service.sh"
echo ""
