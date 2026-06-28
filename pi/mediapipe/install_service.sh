#!/bin/bash
# Installa gaia-mediapipe come servizio systemd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME=$(whoami)
SERVICE_FILE="/etc/systemd/system/gaia-mediapipe.service"

echo "Installazione servizio systemd..."

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=GAIA MediaPipe Node
After=network.target
Wants=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/venv/bin/python3 $SCRIPT_DIR/mediapipe_node.py
Restart=always
RestartSec=10
Environment=SERVICE_NAME=gaia-mediapipe
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gaia-mediapipe
sudo systemctl start gaia-mediapipe

echo "✓ Servizio installato e avviato"
echo "  journalctl -u gaia-mediapipe -f"
