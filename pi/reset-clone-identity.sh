#!/bin/bash
# Da lanciare UNA VOLTA su un Pi appena clonato da un'altra SD (dd/rpi-clone/
# Raspberry Pi Imager "usa immagine esistente"), PRIMA di collegarlo alla rete
# di casa -- altrimenti confligge con il Pi originale (stessa stanza dichiarata,
# stesso hostname, stesse chiavi host SSH). Non tocca DEVICE_ID (agent/config.py
# lo calcola dal MAC address, quindi e' gia' univoco da solo sul clone) ne'
# WiFi/stanza: quello lo fa gaia-provision al primo boot via captive portal
# (docs/provisioning-wifi.md), qui si resetta solo cio' che il captive portal
# non tocca.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== GAIA Pi — Reset identità post-clone ==="
echo ""
read -rp "Nuovo hostname per questo Pi (es. raspberrypi-cucina): " NEW_HOSTNAME
if [ -z "$NEW_HOSTNAME" ]; then
    echo "Hostname vuoto, interrotto." >&2
    exit 1
fi

echo "[1/4] Stop gaia-agent (evita che riscriva device.json durante il reset)..."
sudo systemctl stop gaia-agent 2>/dev/null || true

echo "[2/4] Rimuovo device.json (stanza/servizi del Pi originale)..."
if [ -f "$SCRIPT_DIR/agent/device.json" ]; then
    rm "$SCRIPT_DIR/agent/device.json"
    echo "  ✓ Rimosso — verrà ricreato dal template al prossimo avvio di gaia-agent"
else
    echo "  (già assente)"
fi

echo "[3/4] Rigenero le chiavi host SSH (quelle clonate sono condivise col Pi originale)..."
sudo rm -f /etc/ssh/ssh_host_*
sudo ssh-keygen -A
echo "  ✓ Chiavi host SSH rigenerate"

echo "[4/4] Rigenero /etc/machine-id..."
sudo rm -f /etc/machine-id
sudo systemd-machine-id-setup
echo "  ✓ machine-id rigenerato"

echo ""
echo "Imposto hostname → $NEW_HOSTNAME"
sudo hostnamectl set-hostname "$NEW_HOSTNAME"
sudo sed -i "s/127\.0\.1\.1.*/127.0.1.1\t$NEW_HOSTNAME/" /etc/hosts 2>/dev/null || true

echo ""
echo "✅ Reset completato. Riavvia il Pi per applicare hostname/chiavi SSH:"
echo "   sudo reboot"
echo ""
echo "Dopo il riavvio, se il Pi non trova WiFi noto entra in modalità captive"
echo "portal (hotspot 'Gaia-Setup-XXXX') per configurare rete e stanza — vedi"
echo "docs/provisioning-wifi.md. Da lì assegna la stanza giusta, non a mano in"
echo "device.json."
