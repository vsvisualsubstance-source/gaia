#!/bin/bash
# GAIA LiveStream — script di installazione self-contained
# Uso: cd ~/gaia/livestream && bash install.sh
#
# icecast2 gira LOCALE su questo Pi (non centralizzato su Core/OPS) — un
# demone di sistema leggero, sempre attivo appena installato (come mosquitto
# su Core), non gestito dall'agent: solo il source client ffmpeg (main.py,
# servizio gaia-livestream) è on/off a comando.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   GAIA LiveStream — Install      ║"
echo "╚══════════════════════════════════╝"
echo "  Dir: $SCRIPT_DIR"
echo ""

# ── Pacchetti di sistema ──────────────────────────────────────────────────────
echo "[1/4] Pacchetti di sistema..."
sudo apt-get update --allow-releaseinfo-change -qq || true
# pipewire-alsa: se il mic è un'interfaccia USB (es. webcam) su un Pi con
# PipeWire attivo, PipeWire la reclama come sorgente di sistema e l'accesso
# ALSA diretto di ffmpeg ("-f alsa -i hw:X,Y") smette di vederla del tutto —
# stesso bug incontrato in pi/voice (vedi install.sh di quel modulo). Con
# "default" (MIC_DEVICE di default qui) passa dal plugin ALSA di PipeWire,
# che la vede sempre e fa la conversione di samplerate se serve.
sudo apt-get install -y --allow-unauthenticated \
    ffmpeg \
    pipewire-alsa \
    2>&1 | grep -E "^(Inst|Err|E:)" || true
echo "  ✓ ffmpeg/pipewire-alsa OK"

# icecast2 va installato SENZA prompt: il pacchetto Debian chiede
# hostname/porta/password via debconf, e per sicurezza NON abilita il
# servizio finché non lo si conferma esplicitamente in /etc/default/icecast2
# (ENABLE=true) — qui lo confermiamo noi, la config vera la scriviamo dopo
# a mano (icecast.xml.template) sovrascrivendo quella del pacchetto.
echo ""
echo "[2/4] icecast2..."
if ! dpkg -l icecast2 2>/dev/null | grep -q "^ii"; then
    echo "icecast2 icecast2/hostname string localhost" | sudo debconf-set-selections
    echo "icecast2 icecast2/ports string 8000" | sudo debconf-set-selections
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y icecast2 \
        2>&1 | grep -E "^(Inst|Err|E:)" || true
    echo "  ✓ icecast2 installato"
else
    echo "  ✓ icecast2 già presente"
fi
sudo sed -i 's/^ENABLE=.*/ENABLE=true/' /etc/default/icecast2 2>/dev/null || \
    echo "ENABLE=true" | sudo tee -a /etc/default/icecast2 > /dev/null

# ── Configurazione ────────────────────────────────────────────────────────────
echo ""
echo "[3/4] Configurazione..."
sudo mkdir -p /etc/gaia
mkdir -p "$SCRIPT_DIR/musica"

if [ ! -f /etc/gaia/livestream.conf ]; then
    # Password sorgente unica per device — se fosse fissa/condivisa,
    # chiunque in LAN potrebbe spingere audio arbitrario nel mount di
    # QUALSIASI Pi (icecast non fa altra autenticazione sulla connessione
    # source). Generata una volta, riusata sia da ffmpeg (qui) che da
    # icecast.xml (sotto).
    SOURCE_PASS="$(openssl rand -hex 12)"
    ADMIN_PASS="$(openssl rand -hex 12)"
    cat > /tmp/gaia-livestream.conf.new <<EOF
LIVESTREAM_SOURCE=mic
LIVESTREAM_MIC_DEVICE=default
LIVESTREAM_LIBRARY_DIR=$SCRIPT_DIR/musica
ICECAST_PORT=8000
ICECAST_SOURCE_PASSWORD=$SOURCE_PASS
LIVESTREAM_MOUNT=stream.ogg
LIVESTREAM_BITRATE=96k
EOF
    sudo mv /tmp/gaia-livestream.conf.new /etc/gaia/livestream.conf
    echo "  ✓ /etc/gaia/livestream.conf creato (password sorgente generata)"
else
    SOURCE_PASS="$(grep '^ICECAST_SOURCE_PASSWORD=' /etc/gaia/livestream.conf | cut -d= -f2)"
    ADMIN_PASS="$(openssl rand -hex 12)"
    echo "  → /etc/gaia/livestream.conf già presente, non sovrascritto"
fi

sudo sed -e "s|__SOURCE_PASS__|$SOURCE_PASS|g" -e "s|__ADMIN_PASS__|$ADMIN_PASS|g" \
    "$SCRIPT_DIR/icecast.xml.template" | sudo tee /etc/icecast2/icecast.xml > /dev/null
sudo chown icecast2:icecast /etc/icecast2/icecast.xml 2>/dev/null || true
echo "  ✓ /etc/icecast2/icecast.xml scritto"

sudo systemctl restart icecast2
sudo systemctl enable icecast2 2>&1 | grep -v "^$" || true
echo "  ✓ icecast2 avviato e abilitato al boot"

# ── Verifica ──────────────────────────────────────────────────────────────────
echo ""
echo "[4/4] Verifica..."
sleep 2
if curl -sf "http://localhost:8000/status-json.xsl" > /dev/null; then
    echo "  ✓ icecast2 risponde su :8000"
else
    echo "  ⚠️  icecast2 non risponde — controlla: sudo journalctl -u icecast2 -n 30"
fi

echo ""
echo "╔══════════════════════════════════╗"
echo "║   Installazione completata ✅    ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "  Libreria locale (modalità 'library'): copia i file audio in"
echo "     $SCRIPT_DIR/musica/"
echo ""
echo "  gaia-livestream è gestito da gaia-agent (enable/disable via"
echo "  captive portal o dashboard) — non va avviato a mano."
echo ""
