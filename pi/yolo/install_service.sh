#!/bin/bash
# Installa gaia-yolo come servizio systemd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME=$(whoami)
SERVICE_FILE="/etc/systemd/system/gaia-yolo.service"

echo "Installazione servizio systemd..."

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=GAIA YOLO Node
After=network.target
Wants=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/venv/bin/python3 $SCRIPT_DIR/main.py
Restart=always
RestartSec=10
Environment=SERVICE_NAME=gaia-yolo
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gaia-yolo
sudo systemctl start gaia-yolo

echo "✓ Servizio installato e avviato"
echo "  journalctl -u gaia-yolo -f"
