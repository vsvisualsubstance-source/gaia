#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Carica camera.conf (necessario per avvio manuale; systemd lo carica via EnvironmentFile)
[ -f /etc/gaia/camera.conf ] && set -a && source /etc/gaia/camera.conf && set +a

VENV="${CAMERA_VENV:-$SCRIPT_DIR/venv}"

if [ ! -d "$VENV" ]; then
    echo "❌ Venv non trovato: $VENV"
    echo "   Imposta CAMERA_VENV=/path/al/venv in /etc/gaia/camera.conf"
    exit 1
fi

cd "$SCRIPT_DIR"
source "$VENV/bin/activate"
exec python3 "$SCRIPT_DIR/camera_server.py"
