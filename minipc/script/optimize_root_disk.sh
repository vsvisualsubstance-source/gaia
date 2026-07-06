#!/bin/bash
# GAIA — libera spazio sulla partizione root (richiede sudo).
# Uso:  sudo bash optimize_root_disk.sh
#
# Cosa fa (in ordine, con verifiche):
#  1. Sposta il data-root di Docker (~12GB di immagini) su /media/core/D/docker
#     — il vecchio /var/lib/docker viene RINOMINATO in .old, non cancellato:
#     si elimina a mano solo dopo qualche giorno di verifica.
#  2. Riduce il journal di systemd a 200MB (e lo limita per il futuro).
#  3. Svuota la cache apt.
#  4. Rimuove le revisioni snap disabilitate e limita a 2 quelle conservate.
set -euo pipefail

D_ROOT="/media/core/D/docker"

echo "── Spazio prima ──"
df -h / /media/core/D | tail -2

# ── 1. Docker data-root → D ──────────────────────────────────────────────
if [ -d "$D_ROOT" ] && [ -n "$(ls -A "$D_ROOT" 2>/dev/null)" ]; then
    echo "!! $D_ROOT esiste già e non è vuoto — salto la migrazione docker."
else
    echo "── Fermo lo stack e docker ──"
    (cd /home/core/core-node-0 && docker compose stop) || true
    systemctl stop docker docker.socket

    echo "── Copio /var/lib/docker → $D_ROOT (qualche minuto) ──"
    mkdir -p "$D_ROOT"
    if command -v rsync >/dev/null; then
        rsync -aHX /var/lib/docker/ "$D_ROOT/"
    else
        cp -a /var/lib/docker/. "$D_ROOT/"
    fi

    echo "── Configuro daemon.json ──"
    mkdir -p /etc/docker
    if [ -f /etc/docker/daemon.json ]; then
        python3 - <<PYEOF
import json
p = '/etc/docker/daemon.json'
d = json.load(open(p))
d['data-root'] = '$D_ROOT'
json.dump(d, open(p, 'w'), indent=2)
PYEOF
    else
        printf '{\n  "data-root": "%s"\n}\n' "$D_ROOT" > /etc/docker/daemon.json
    fi

    echo "── Riavvio docker e lo stack ──"
    systemctl start docker
    sleep 3
    (cd /home/core/core-node-0 && docker compose up -d)
    sleep 8
    RUNNING=$(docker ps --format '{{.Names}}' | sort | tr '\n' ' ')
    echo "Container attivi: $RUNNING"
    case "$RUNNING" in
        *mosquitto*ollama*openhab*qdrant*|*mosquitto*openhab*ollama*qdrant*)
            echo "── Verifica OK: parcheggio il vecchio data-root come .old ──"
            mv /var/lib/docker /var/lib/docker.old
            echo "   (tra qualche giorno: sudo rm -rf /var/lib/docker.old)"
            ;;
        *)
            echo "!! ATTENZIONE: non vedo tutti e 4 i container. Lascio /var/lib/docker"
            echo "   al suo posto. Controlla 'docker ps' e i log prima di rimuoverlo."
            ;;
    esac
fi

# ── 2. Journal ───────────────────────────────────────────────────────────
echo "── Journal → max 200MB ──"
journalctl --vacuum-size=200M
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/gaia-size.conf
systemctl restart systemd-journald

# ── 3. Cache apt ─────────────────────────────────────────────────────────
echo "── apt clean ──"
apt-get clean

# ── 4. Snap: revisioni vecchie ───────────────────────────────────────────
echo "── Snap: rimuovo revisioni disabilitate ──"
snap set system refresh.retain=2 || true
snap list --all | awk '/disabled/{print $1, $3}' | while read -r name rev; do
    snap remove "$name" --revision="$rev" || true
done

echo "── Spazio dopo ──"
df -h / /media/core/D | tail -2
echo "Fatto."
