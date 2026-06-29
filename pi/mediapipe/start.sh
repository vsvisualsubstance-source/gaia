#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Carica mediapipe.conf (necessario per avvio manuale)
[ -f /etc/gaia/mediapipe.conf ] && set -a && source /etc/gaia/mediapipe.conf && set +a

VENV="${MEDIAPIPE_VENV:-$SCRIPT_DIR/venv}"

if [ ! -d "$VENV" ]; then
    echo "❌ Venv non trovato: $VENV"
    echo "   Imposta MEDIAPIPE_VENV=/path/al/venv in /etc/gaia/mediapipe.conf"
    exit 1
fi

source "$VENV/bin/activate"
exec python3 "$SCRIPT_DIR/mediapipe_node.py"
