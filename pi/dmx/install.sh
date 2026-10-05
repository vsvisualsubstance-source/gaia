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
USER_UID=$(id -u)
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
# Richiesto dall'audio-reattività (ffmpeg -f alsa): senza questa variabile
# un servizio systemd di sistema non trova la sessione PipeWire
# dell'utente e l'acquisizione fallisce in silenzio (nessun errore
# visibile, solo audio_level fermo a 0) -- stesso identico gotcha già
# documentato/risolto in pi/mediaplayer/pi/livestream.
Environment=XDG_RUNTIME_DIR=/run/user/$USER_UID
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

# Broker MQTT locale (2026-10-05) -- gaia-dmx e le pagine web locali
# (dmx-touch.html/dmx-editor.html servite da questo Pi, porta 8099)
# parlano SEMPRE con un mosquitto su questa stessa macchina, cosi'
# funzionano anche "in giro" senza rete verso Core (pensato per uso
# touring). Quando Core è raggiungibile, un bridge mosquitto->mosquitto
# inoltra l'intero namespace gaia/# in entrambe le direzioni --
# Admin/Telegram continuano a controllare il device come sempre, zero
# cambi lato Core. Se Core non c'è, il bridge resta semplicemente non
# connesso (ritenta in background), nessun impatto sul funzionamento
# locale. Sempre eseguito, non opzionale: nessuno svantaggio reale per
# un Pi che gira sempre collegato a casa. Autorizzato esplicitamente
# dall'utente (apre un listener websocket sulla rete locale, porta 9001).
echo ""
echo "[3/3] Broker MQTT locale (mosquitto, per funzionare anche senza Core)..."
if ! command -v mosquitto >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq mosquitto
fi
sudo systemctl enable mosquitto >/dev/null 2>&1 || true

DMX_CONF=/etc/gaia/dmx.conf
# Target del bridge: riusa un MQTT_HOST esplicito già presente (install
# precedente a questa feature, puntava dritto a Core) prima di
# sovrascriverlo -- altrimenti CORE_MQTT_HOST passato all'invocazione di
# questo script (default 192.168.1.142, mai indovinato oltre il default
# storico già in uso in tutto il progetto).
BRIDGE_HOST="${CORE_MQTT_HOST:-192.168.1.142}"
BRIDGE_PORT="${CORE_MQTT_PORT:-1883}"
if [ -f "$DMX_CONF" ]; then
    OLD_HOST=$(grep -E '^MQTT_HOST=' "$DMX_CONF" | tail -1 | cut -d= -f2)
    if [ -n "$OLD_HOST" ] && [ "$OLD_HOST" != "127.0.0.1" ]; then
        BRIDGE_HOST="$OLD_HOST"
    fi
    sudo sed -i '/^MQTT_HOST=/d' "$DMX_CONF"
fi
echo "MQTT_HOST=127.0.0.1" | sudo tee -a "$DMX_CONF" > /dev/null

sudo tee /etc/mosquitto/conf.d/gaia-dmx-broker.conf > /dev/null << EOF
# Generato da pi/dmx/install.sh -- broker locale per gaia-dmx e le pagine
# web servite da questo Pi (porta 8099). Vedi config.py per il perché.
listener 1883 127.0.0.1
allow_anonymous true

listener 9001 0.0.0.0
protocol websockets
allow_anonymous true

connection gaia-core-bridge
address $BRIDGE_HOST:$BRIDGE_PORT
topic gaia/# both 0
notifications false
cleansession true
start_type automatic
restart_timeout 10 30
try_private false
EOF
sudo systemctl restart mosquitto
echo "  ✓ broker locale attivo (1883 locale + 9001 websocket), bridge verso $BRIDGE_HOST:$BRIDGE_PORT"

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
