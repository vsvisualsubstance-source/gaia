#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== GAIA Agent — Install ==="
echo ""

# ── Dipendenze sistema ───────────────────────────────────────────────
echo "[1/3] Dipendenze sistema..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-venv python3-pip

# ── Venv ─────────────────────────────────────────────────────────────
echo "[2/3] Venv Python..."
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "  ✓ paho-mqtt installato"

# Crea device.json dal template se non esiste ancora
if [ ! -f "$SCRIPT_DIR/device.json" ]; then
    cp "$SCRIPT_DIR/device.json.template" "$SCRIPT_DIR/device.json"
    echo "  ✓ Creato device.json da template"
    echo "  ⚙️  Modifica 'stanza' in $SCRIPT_DIR/device.json prima di avviare"
fi

# ── Servizi systemd ──────────────────────────────────────────────────
echo "[3/3] Installazione servizi systemd..."

# Sostituisce il path placeholder con quello reale
GAIA_ROOT="$(dirname "$SCRIPT_DIR")"
SERVICES="gaia-agent.service gaia-yolo.service gaia-mediapipe.service gaia-voice.service"

for SVC in $SERVICES; do
    if [ -f "$SCRIPT_DIR/$SVC" ]; then
        sed -e "s|/opt/gaia|$GAIA_ROOT|g" -e "s|User=pi|User=$(whoami)|g" "$SCRIPT_DIR/$SVC" \
            | sudo tee "/etc/systemd/system/$SVC" > /dev/null
        echo "  ✓ Installato: $SVC"
    fi
done

sudo systemctl daemon-reload

# Abilita solo l'agent — gli altri sono gestiti dall'agent stesso
sudo systemctl enable gaia-agent.service
echo "  ✓ gaia-agent.service abilitato all'avvio"

# Cartella /etc/gaia con permessi utente corrente
sudo mkdir -p /etc/gaia
sudo touch /etc/gaia/device.conf
sudo chown -R "$(whoami):$(whoami)" /etc/gaia
sudo chmod 755 /etc/gaia
sudo chmod 644 /etc/gaia/device.conf
echo "  ✓ /etc/gaia configurato"

# Permessi sudo per systemctl (necessari per start/stop servizi)
SUDOERS_FILE="/etc/sudoers.d/gaia-agent"
echo "$(whoami) ALL=(ALL) NOPASSWD: /bin/systemctl start gaia-*, /bin/systemctl stop gaia-*, /bin/systemctl restart gaia-*, /sbin/reboot" \
    | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"
echo "  ✓ Permessi sudo configurati per $(whoami)"

echo ""
echo "✅ Installazione completata!"
echo ""
echo "Configura la stanza in device.json, poi:"
echo "  sudo systemctl start gaia-agent"
echo "  journalctl -u gaia-agent -f"
echo ""
echo "Oppure avvia manualmente:"
echo "  bash start.sh"
