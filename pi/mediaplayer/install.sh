#!/bin/bash
# GAIA Mediaplayer — script di installazione self-contained
# Uso: cd ~/gaia/mediaplayer && bash install.sh
#
# La unit systemd viene generata qui (non copiata da un file statico) --
# vedi commento nella sezione [3/3] per il motivo.

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
# Generata con l'utente/percorso REALI di questa macchina (come yolo/
# install_service.sh) -- MAI un file statico con "asemico" hardcoded: trovato
# dal vivo un Pi (vsrasp01) il cui utente reale e' "admin", causa esatta di
# "status=217/USER, Failed to determine user credentials" in systemd.
echo ""
echo "[3/3] Servizio systemd..."
USER_NAME=$(whoami)
sudo tee /etc/systemd/system/gaia-mediaplayer.service > /dev/null << EOF
[Unit]
Description=GAIA Mediaplayer — musica/radio per stanza (mpv + MQTT)
After=network-online.target
# Gestito da gaia-agent — NON abilitare con systemctl enable

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$SCRIPT_DIR
EnvironmentFile=/etc/gaia/device.conf
EnvironmentFile=-/etc/gaia/mediaplayer.conf
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 $SCRIPT_DIR/main.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
echo "  ✓ unit installata per l'utente '$USER_NAME' (NON abilitata/avviata: gestita da gaia-agent)"

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
