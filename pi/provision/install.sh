#!/bin/bash
# GAIA Provisioning WiFi — installazione su Pi (Bookworm + NetworkManager)
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== GAIA Provision — Install ==="

# Unit systemd (path placeholder /opt/gaia → path reale)
sed "s|/opt/gaia|$(dirname "$SCRIPT_DIR")|g" "$SCRIPT_DIR/gaia-provision.service" \
    | sudo tee /etc/systemd/system/gaia-provision.service > /dev/null
echo "  ✓ gaia-provision.service"

# DNS captive per l'hotspot (solo connessioni shared)
sudo install -D -m 644 "$SCRIPT_DIR/gaia-captive-dnsmasq.conf" \
    /etc/NetworkManager/dnsmasq-shared.d/gaia-captive.conf
echo "  ✓ dnsmasq captive (NM shared)"

# Config opzionale
if [ ! -f /etc/gaia/provision.conf ]; then
    sudo mkdir -p /etc/gaia
    echo "# AP_PASSWORD=gaiasetup" | sudo tee /etc/gaia/provision.conf > /dev/null
    echo "  ✓ /etc/gaia/provision.conf (default)"
fi

sudo systemctl daemon-reload
sudo systemctl enable --now gaia-provision
echo "  ✓ gaia-provision abilitato e avviato"
echo ""
echo "Test rapido:  journalctl -u gaia-provision -f"
