#!/bin/bash
# Sincronizza pi/{yolo,mediapipe,voice,camera,agent} verso OPS -- stesso
# principio di deploy_ops_web.sh: Node-RED su OPS gira in un container
# Docker che monta C:\gaia-docker-cfg\core-node-0 come /home/core/core-node-0
# (verificato dal vivo 2026-09-13 via `docker inspect gaia-nodered-test`),
# lo stesso path letto dal flow "GET /gaia/ota/:filename" (PI_BASE) per
# servire gli aggiornamenti OTA ai Pi. A differenza di web/, questa cartella
# non aveva MAI avuto uno script di sync dedicato: e' rimasta ferma a
# qualunque copia iniziale del mount, quindi l'OTA serviva codice vecchio
# di settimane senza nessun errore visibile (trovato dal vivo mentre si
# cercava di aggiornare un Pi via OTA: agent.py/discovery.py serviti da
# OPS non contenevano nessuno dei fix appena fatti).
#
# Solo le 5 directory che l'endpoint OTA sa davvero servire
# (ALLOWED_SERVICES nel flow Node-RED) -- non l'intero pi/, che include
# anche kiosk/screen/mediaplayer/herbarium/provision (non OTA-abili) e i
# venv Python di yolo/mediapipe/voice (grossi, inutili su OPS: l'OTA serve
# solo i sorgenti .py, non esegue nulla li').
#
# rsync locale (Core→staging, esclude venv/__pycache__/.git) poi scp verso
# OPS (Windows/OpenSSH, rsync non e' detto sia installato li' -- stesso
# motivo di deploy_ops_web.sh).
set -euo pipefail

REPO="/home/core/core-node-0"
OPS_LAN="192.168.1.240"
OPS_TAILSCALE="100.91.251.83"
OPS_HOST=$(python3 -c "
import sys
sys.path.insert(0, '$REPO/minipc/script')
import net_resolve
host = net_resolve.resolve_best('deploy-ops', [
    {'kind': 'lan', 'host': '$OPS_LAN', 'port': 22},
    {'kind': 'tailscale', 'host': '$OPS_TAILSCALE', 'port': 22},
], ttl=0)
print(host or '$OPS_LAN')
")
OPS_PI_DEST="C:/gaia-docker-cfg/core-node-0/pi"

STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

for svc in yolo mediapipe voice camera agent; do
    mkdir -p "$STAGING/$svc"
    rsync -a --exclude 'venv' --exclude '__pycache__' --exclude '*.pyc' \
        "$REPO/pi/$svc/" "$STAGING/$svc/"
done

echo "Deploy pi/{yolo,mediapipe,voice,camera,agent} su OPS (${OPS_HOST})..."
# Le sottocartelle esistono gia' (l'OTA le serve gia' oggi, solo stantie) --
# nessun mkdir preventivo necessario.
for svc in yolo mediapipe voice camera agent; do
    scp -r "$STAGING/$svc"/* "vsvis@${OPS_HOST}:${OPS_PI_DEST}/${svc}/"
done

echo "--- verifica (endpoint OTA reale) ---"
for f in agent/agent.py agent/discovery.py yolo/main.py mediapipe/mediapipe_node.py voice/main.py; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://${OPS_HOST}:1880/gaia/ota/$f")
    echo "  $f -> HTTP $code"
done
