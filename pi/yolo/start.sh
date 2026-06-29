#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Carica yolo.conf (necessario per avvio manuale; systemd lo carica via EnvironmentFile)
[ -f /etc/gaia/yolo.conf ] && set -a && source /etc/gaia/yolo.conf && set +a

VENV="${YOLO_VENV:-$SCRIPT_DIR/venv}"

if [ ! -d "$VENV" ]; then
    echo "❌ Venv non trovato: $VENV"
    echo "   Imposta YOLO_VENV=/path/al/venv in /etc/gaia/yolo.conf"
    exit 1
fi

cd "$SCRIPT_DIR"
source "$VENV/bin/activate"
exec python3 "$SCRIPT_DIR/main.py"
