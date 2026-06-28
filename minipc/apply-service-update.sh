#!/bin/bash
# Esegui questo script con: sudo bash minipc/apply-service-update.sh
set -e
REPO="/home/core/core-node-0"

echo "=== Aggiornamento service files GAIA ==="

cp "$REPO/minipc/script/gaia-listener.service" /etc/systemd/system/
cp "$REPO/minipc/script/gaia-admin.service"    /etc/systemd/system/

systemctl daemon-reload

echo "  ✓ gaia-listener.service aggiornato"
systemctl restart gaia-listener
sleep 2
systemctl is-active gaia-listener && echo "  ✓ gaia-listener: RUNNING" || echo "  ✗ gaia-listener: FAILED"

echo "  ✓ gaia-admin.service aggiornato"
systemctl restart gaia-admin 2>/dev/null && echo "  ✓ gaia-admin: RUNNING" || echo "  ℹ  gaia-admin non attivo"

echo ""
echo "=== Riavvio Node-RED ==="
systemctl restart nodered
sleep 3
systemctl is-active nodered && echo "  ✓ Node-RED: RUNNING" || echo "  ✗ Node-RED: FAILED"

echo ""
echo "✅ Fatto. Verifica: journalctl -u gaia-listener -n 20"
