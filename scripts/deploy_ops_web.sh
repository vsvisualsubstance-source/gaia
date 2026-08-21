#!/bin/bash
# Deploy dei file web/ (admin.html, dashboard.html, ecc.) su OPS -- stesso
# principio di deploy_ops_nodered.sh: il Node-RED su OPS gira in un
# container Docker che monta come sua cartella statica una copia SEPARATA
# su Windows (C:\gaia-docker-cfg\core-node-0\web), non il repo -- ogni
# modifica ai file web/ va ricopiata li' a mano, altrimenti resta invisibile
# a chi apre le pagine da OPS (192.168.1.240:1880), anche se il repo e la
# copia locale di Core sono gia' aggiornati (scoperto dal vivo 2026-08-11,
# admin.html coi nuovi preset Herbarium non comparivano su OPS).
#
# Usa scp, non rsync: OPS e' Windows/OpenSSH, rsync non e' detto sia
# installato li'. scp -r su web/* esclude gia' da solo i file nascosti
# (.bak_*), quindi non serve un filtro esplicito.
set -euo pipefail

REPO="/home/core/core-node-0"
OPS_LAN="192.168.1.240"
# Fallback Tailscale (2026-08-21): a differenza di altri usi di
# net_resolve.py, qui non si può interrogare /gaia/devices/profiles per
# scoprire l'IP Tailscale di OPS -- quel registro è servito DA OPS stesso
# (Node-RED, porta 1880): se la LAN verso OPS è giù non si raggiunge
# nemmeno il registro. Costante di ultima istanza (va aggiornata se OPS
# viene mai ri-autenticato su Tailscale), stesso principio del
# "cold-bootstrap" già documentato in docs/discovery-protocol.md per
# Pi→Core.
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
OPS_WEB_DEST="C:/gaia-docker-cfg/core-node-0/web"

echo "Deploy web/ su OPS (${OPS_HOST})..."
scp -r "$REPO"/web/* "vsvis@${OPS_HOST}:${OPS_WEB_DEST}/"

echo "--- verifica (dentro il container) ---"
ssh "vsvis@${OPS_HOST}" "docker exec gaia-nodered-test sh -c \"ls /media/core/D/gaia-web | wc -l\""
