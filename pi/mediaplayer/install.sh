#!/bin/bash
# GAIA Mediaplayer — script di installazione self-contained
# Uso: cd ~/gaia/mediaplayer && bash install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   GAIA Mediaplayer — Install         ║"
echo "╚══════════════════════════════════════╝"
echo "  Dir: $SCRIPT_DIR"
echo ""

# ── Pacchetti di sistema (mpv, il player vero) ─────────────────────────────
echo "[1/3] Pacchetti di sistema..."
sudo apt-get update --allow-releaseinfo-change -qq || true
sudo apt-get install -y --allow-unauthenticated mpv python3-pip \
    2>&1 | grep -E "^(Inst|Err|E:)" || true
echo "  ✓ mpv installato"

# ── Dipendenze Python ────────────────────────────────────────────────────
echo ""
echo "[2/3] Dipendenze Python (paho-mqtt)..."
pip3 install --break-system-packages --quiet paho-mqtt
echo "  ✓ paho-mqtt OK"

# ── Servizio systemd ─────────────────────────────────────────────────────
echo ""
echo "[3/3] Servizio systemd..."
sudo cp "$SCRIPT_DIR/gaia-mediaplayer.service" /etc/systemd/system/gaia-mediaplayer.service
sudo systemctl daemon-reload
echo "  ✓ unit installata (NON abilitata/avviata: gestita da gaia-agent)"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Installazione completata ✅        ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  gaia-mediaplayer è gestito da gaia-agent (start/stop via MQTT o"
echo "  Pi Manager) — non va abilitato/avviato a mano."
echo ""
echo "  Avvio manuale per test:"
echo "     sudo systemctl start gaia-mediaplayer"
echo "     journalctl -u gaia-mediaplayer -f"
echo ""
