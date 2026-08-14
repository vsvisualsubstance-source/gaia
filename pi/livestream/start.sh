#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Carica livestream.conf (necessario per avvio manuale; systemd lo carica
# via EnvironmentFile). Nessun venv dedicato — solo system python3 +
# paho-mqtt di sistema, stesso principio di herbarium/mediaplayer.
[ -f /etc/gaia/livestream.conf ] && set -a && source /etc/gaia/livestream.conf && set +a

cd "$SCRIPT_DIR"
exec python3 "$SCRIPT_DIR/main.py"
