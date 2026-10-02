#!/bin/bash
# GAIA DMX (base) — script di installazione self-contained
# Uso: cd ~/gaia/dmx && bash install.sh
#
# Modulo "leggero" (system python3 + system paho-mqtt, nessun venv dedicato
# -- stesso principio di pi/mediaplayer/pi/livestream, vedi pi/CLAUDE.md):
# nessuna libreria pesante, l'invio Art-Net è UDP fatto a mano (artnet.py).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   GAIA DMX (base) — Install      ║"
echo "╚══════════════════════════════════╝"
echo "  Dir: $SCRIPT_DIR"
echo ""

echo "[1/2] Dipendenze Python (paho-mqtt)..."
pip3 install --break-system-packages --quiet paho-mqtt
echo "  ✓ paho-mqtt OK"

# Unit generata con l'utente/percorso REALI di questa macchina (MAI un file
# statico con un utente hardcoded -- trovato dal vivo un Pi il cui utente
# reale non era quello presunto, causa di "status=217/USER" in systemd,
# stesso gotcha già documentato in pi/mediaplayer/install.sh).
echo ""
echo "[2/2] Servizio systemd..."
USER_NAME=$(whoami)
sudo tee /etc/systemd/system/gaia-dmx.service > /dev/null << EOF
[Unit]
Description=GAIA DMX (base) — palette + timeline via Art-Net
After=network-online.target
# Gestito da gaia-agent — NON abilitare con systemctl enable

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$SCRIPT_DIR
EnvironmentFile=/etc/gaia/device.conf
EnvironmentFile=-/etc/gaia/dmx.conf
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
echo "╔══════════════════════════════════╗"
echo "║   Installazione completata ✅    ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "  IMPORTANTE: imposta ARTNET_HOST in /etc/gaia/dmx.conf (vedi"
echo "  dmx.conf.example) prima di aspettarti output reale -- senza, il"
echo "  servizio gira (palette/timeline/status funzionano) ma non manda"
echo "  nessun pacchetto Art-Net, solo un avviso nei log."
echo ""
echo "  gaia-dmx è gestito da gaia-agent (start/stop via MQTT o Pi Manager)"
echo "  -- non va abilitato/avviato a mano in produzione."
echo ""
echo "  Avvio manuale per test:"
echo "     sudo systemctl start gaia-dmx"
echo "     journalctl -u gaia-dmx -f"
echo ""
