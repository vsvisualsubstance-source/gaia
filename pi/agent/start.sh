#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$SCRIPT_DIR/venv" ]; then
    echo "❌ Venv non trovato. Esegui prima: bash install.sh"
    exit 1
fi

cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/venv/bin/activate"
exec python3 "$SCRIPT_DIR/agent.py"
