#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== GAIA TD-Studio Agent — Install (macOS) ==="
echo ""

if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ python3 non trovato. Installa Python 3 (es. da python.org o Homebrew) e rilancia."
    exit 1
fi

echo "[1/2] Venv Python..."
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "  ✓ paho-mqtt installato"

echo "[2/2] LaunchAgent..."
PLIST_SRC="$SCRIPT_DIR/com.gaia.tdstudio.agent.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.gaia.tdstudio.agent.plist"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__SCRIPT_DIR__|$SCRIPT_DIR|g" "$PLIST_SRC" > "$PLIST_DST"
echo "  ✓ Copiato in $PLIST_DST (placeholder __SCRIPT_DIR__ sostituito)"

echo ""
echo "✅ Installazione completata!"
echo ""
echo "PRIMA di avviare: apri services.json e sostituisci i path CONFIGURA"
echo "(TouchDesigner.app reale + .toe reali di herbarium/project2/project3),"
echo "verificati dal vivo su questa macchina."
echo ""
echo "Poi carica il LaunchAgent (parte subito e ad ogni login):"
echo "  launchctl load -w \"$PLIST_DST\""
echo ""
echo "Per fermarlo:"
echo "  launchctl unload \"$PLIST_DST\""
echo ""
echo "Log:"
echo "  tail -f \"$SCRIPT_DIR/agent.log\""
echo ""
echo "Oppure avvia manualmente in foreground (per test, senza LaunchAgent):"
echo "  bash start.sh"
