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
PATCHED="/tmp/claude-1000/-home-core-core-node-0/139b6cd4-d727-4fcd-83d5-910eceaf6073/scratchpad/ops-nodered-data/flows.json"
OPS_HOST="192.168.1.240"

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
CODE=$(ssh "vsvis@${OPS_HOST}" "curl -s -o NUL -w '%{http_code}' -X POST http://localhost:1880/flows -H 'Node-RED-Deployment-Type: full' -H 'Content-Type: application/json' --data-binary @-" < "$PATCHED")
echo "HTTP $CODE"
if [ "$CODE" != "204" ]; then
    echo "ERRORE: deploy non riuscito (atteso 204)" >&2
    exit 1
fi

sleep 3
echo "--- verifica broker connesso ---"
ssh "vsvis@${OPS_HOST}" "docker logs gaia-nodered-test --tail 5" 2>&1 | grep -i "mqtt-broker" || true
