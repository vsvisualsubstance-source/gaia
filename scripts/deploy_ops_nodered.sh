#!/bin/bash
# Deploy di node-red/flows.json su OPS -- SEMPRE passare da qui, mai un
# deploy manuale via ssh+curl: tre volte (2026-08-07/08) ho pushato per
# errore la copia con "localhost" (Core) invece di quella patchata per
# OPS, disconnettendo il broker MQTT in produzione per decine di secondi
# ogni volta. Questo script rigenera la patch (broker/openhab/memory ->
# 192.168.1.142) SEMPRE, ad ogni esecuzione, azzerando la possibilita' di
# dimenticarselo.
set -euo pipefail

REPO="/home/core/core-node-0"
PATCHED="$(mktemp -t gaia-ops-nodered-flows-XXXXXX.json)"
trap 'rm -f "$PATCHED"' EXIT
OPS_LAN="192.168.1.240"
# Fallback Tailscale (2026-08-21): non si può interrogare
# /gaia/devices/profiles per scoprire l'IP Tailscale di OPS -- quel
# registro è servito DA OPS stesso (Node-RED, porta 1880): se la LAN verso
# OPS è giù non si raggiunge nemmeno il registro. Costante di ultima
# istanza (va aggiornata se OPS viene mai ri-autenticato su Tailscale),
# stesso principio del "cold-bootstrap" in docs/discovery-protocol.md.
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

python3 - "$REPO/node-red/flows.json" "$PATCHED" << 'PYEOF'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8') as f:
    flows = json.load(f)
for n in flows:
    if n.get('type') == 'mqtt-broker':
        n['broker'] = '192.168.1.142'
content = json.dumps(flows, indent=4, ensure_ascii=False)
content = content.replace('http://localhost:8080', 'http://192.168.1.142:8080')
content = content.replace('http://localhost:8000', 'http://192.168.1.142:8000')
with open(dst, 'w', encoding='utf-8') as f:
    f.write(content)
print(f"Patchato: broker/openhab/memory -> 192.168.1.142 ({dst})")
PYEOF

echo "Deploy su OPS..."
# Niente apici singoli: la sessione SSH su Windows passa per cmd.exe, che
# non li interpreta come quoting shell (visto dal vivo: '%{http_code}'
# arrivava letterale a curl, output tripli con apici). Solo apici doppi
# con escape, stesso stile gia' usato con successo in questa sessione.
CODE=$(ssh "vsvis@${OPS_HOST}" "curl -s -o NUL -w \"%{http_code}\" -X POST http://localhost:1880/flows -H \"Node-RED-Deployment-Type: full\" -H \"Content-Type: application/json\" --data-binary @-" < "$PATCHED")
echo "HTTP $CODE"
if [ "$CODE" != "204" ]; then
    echo "ERRORE: deploy non riuscito (atteso 204)" >&2
    exit 1
fi

sleep 3
echo "--- verifica broker connesso ---"
ssh "vsvis@${OPS_HOST}" "docker logs gaia-nodered-test --tail 5" 2>&1 | grep -i "mqtt-broker" || true
