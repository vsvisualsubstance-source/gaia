#!/bin/bash
# GAIA backup notturno — dati preziosi NON versionabili in git (biometrici,
# stato del brain, dataset di training). Tre destinazioni (ridisegnato
# 2026-08-19, dopo che la seconda destinazione fissa -- un Pi identificato
# per IP -- si è ritrovata fisicamente fuori casa per giorni, lasciando UNA
# sola copia reale):
#   1. /media/core/D/backups/gaia         (disco locale, stessa macchina)
#   2. OPS: C:/gaia-docker-cfg/backups/gaia (altra macchina fisica, via scp
#      -- niente rsync, non è detto sia installato su Windows/OpenSSH)
#   3. Un Pi PRESENTE in casa ORA, scelto dinamicamente via GET
#      /gaia/devices/profiles (role='pi', heartbeat fresco <2min) invece di
#      un IP fisso -- i Pi vengono spostati/sostituiti (visto dal vivo: "Pi
#      cucina" diventato "Pi ingresso") e possono cambiare rete più volte
#      nella stessa giornata (visto dal vivo il 2026-08-21, vsrasp01: tre
#      IP LAN diversi in un paio d'ore). Per ogni candidato si prova prima
#      il suo IP LAN, poi il suo IP Tailscale (net_resolve.py, stesso
#      modulo usato dagli agent -- vedi docs/discovery-protocol.md).
#      Best-effort: se nessun Pi risulta online, o se la copia fallisce,
#      NON conta come fallimento del backup -- 1+2 bastano per l'alert
#      dead-man-switch (dead-man switch = nessun backup fresco da >26h →
#      alert Telegram via l'health check del brain).
# Schedulato via crontab utente core (03:30) — il sudoers non permette di
# installare unit systemd e il crontab utente gira anche senza sessione.
# Niente --delete: un errore locale non deve propagarsi ai backup.
set -u
LOG=/media/core/D/backups/gaia_backup.log
DST_LOCAL=/media/core/D/backups/gaia
OPS_HOST=vsvis@192.168.1.240
OPS_CONTAINER=gaia-nodered-test
OPS_DST_WIN='C:\gaia-docker-cfg\backups\gaia'
OPS_DST_SCP='C:/gaia-docker-cfg/backups/gaia'
DEVICES_API=http://192.168.1.240:1880/gaia/devices/profiles
NET_RESOLVE_DIR=/home/core/core-node-0/minipc/script

# SSH user per Pi noti, per device_id -- non per IP, che oggi può essere LAN
# o Tailscale a seconda di dove si trova il Pi (vedi sopra). Non uniforme
# tra i device (vsrasp01/pi-b2c8db usa 'admin', il vecchio Pi cucina/
# ingresso usava 'asemico'). Se un Pi nuovo non è in questa mappa si prova
# comunque con PI_USER_DEFAULT.
declare -A PI_USER=(
  [pi-b2c8db]=admin
  [pi-fd75d8]=asemico
)
PI_USER_DEFAULT=admin

SRC=(
  /home/core/gaia
  /home/core/core-node-0/minipc/script/gaia_wakeword_samples
  /home/core/core-node-0/minipc/script/gaia_wakeword_samples_minipc
  /home/core/core-node-0/minipc/script/gaia_wakeword_samples_ops
  /home/core/core-node-0/minipc/script/doorbell_samples
  /home/core/core-node-0/minipc/script/voice_db.json
  /home/core/core-node-0/minipc/script/listener_config.json
  /home/core/core-node-0/node-red/flows.json
  /media/core/D/face-env/faces
)

mkdir -p "$DST_LOCAL"
echo "── $(date -Is) avvio backup" >> "$LOG"

ok=1

# Node-RED gira su OPS dall'8 agosto, non più su Core: /home/core/gaia/
# (mood, lessico, presenze, sogni, riassunti) restava congelato a quella
# data -- la vera memoria di Gaia (dentro il container Docker su OPS) non
# aveva alcun backup. Trovato dal vivo 2026-08-19. Tiriamo giù lo stato
# vivo da OPS PRIMA del backup, così rientra nei giri di sotto come tutto
# il resto.
mkdir -p /home/core/gaia
for f in brain.json dreams.json memories.json thoughts.json; do
  tmp="/home/core/gaia/.${f}.tmp"
  if timeout 30 ssh "$OPS_HOST" "docker exec $OPS_CONTAINER cat /home/core/gaia/$f" > "$tmp" 2>>"$LOG" && [ -s "$tmp" ]; then
    mv "$tmp" "/home/core/gaia/$f"
  else
    echo "── $(date -Is) ATTENZIONE: pull $f da OPS fallito, mantengo copia precedente" >> "$LOG"
    rm -f "$tmp"
    ok=0
  fi
done

# 1. Locale
rsync -a --timeout=60 "${SRC[@]}" "$DST_LOCAL/" >> "$LOG" 2>&1 || ok=0

# 2. OPS -- niente apici singoli nel comando remoto: la sessione SSH su
# Windows passa per cmd.exe, che non li interpreta come quoting shell
# (stesso gotcha già affrontato in scripts/deploy_ops_nodered.sh).
timeout 15 ssh "$OPS_HOST" "if not exist \"$OPS_DST_WIN\" mkdir \"$OPS_DST_WIN\"" >> "$LOG" 2>&1
timeout 90 scp -r -o ConnectTimeout=10 "${SRC[@]}" "$OPS_HOST:$OPS_DST_SCP/" >> "$LOG" 2>&1 || ok=0

# 3. Un Pi presente ora (best-effort, non tocca $ok). Candidati dal
# registro (heartbeat fresco <2min, role=pi), LAN provato prima di
# Tailscale via net_resolve.resolve_best() -- stesso modulo/idioma usato
# dagli agent, primo consumer reale fuori da pi/agent/ops/agent/local_agent.
pi_target=$(timeout 8 curl -s "$DEVICES_API" 2>>"$LOG" | python3 -c "
import json, sys, time
sys.path.insert(0, '$NET_RESOLVE_DIR')
import net_resolve

try:
    profiles = json.loads(sys.stdin.read())
    now = time.time() * 1000
    for dev_id, p in profiles.items():
        if p.get('role') != 'pi':
            continue
        if now - (p.get('ts') or 0) > 120000:
            continue
        candidates = []
        if p.get('ip') and p['ip'] != 'unknown':
            candidates.append({'kind': 'lan', 'host': p['ip'], 'port': 22})
        if p.get('tailscale_ip'):
            candidates.append({'kind': 'tailscale', 'host': p['tailscale_ip'], 'port': 22})
        host = net_resolve.resolve_best(f'backup-{dev_id}', candidates, ttl=0)
        if host:
            print(f'{dev_id}\t{host}')
            break
except Exception:
    pass
" 2>>"$LOG")

if [ -n "$pi_target" ]; then
    pi_device_id="${pi_target%%$'\t'*}"
    pi_host="${pi_target##*$'\t'}"
    pi_user="${PI_USER[$pi_device_id]:-$PI_USER_DEFAULT}"
    echo "── $(date -Is) Pi presente trovato: ${pi_device_id} (${pi_user}@${pi_host})" >> "$LOG"
    if rsync -a --timeout=60 -e "ssh -o ConnectTimeout=10" "${SRC[@]}" "${pi_user}@${pi_host}:gaia-backup/" >> "$LOG" 2>&1; then
        echo "── $(date -Is) copia sul Pi riuscita" >> "$LOG"
    else
        echo "── $(date -Is) ATTENZIONE: copia sul Pi fallita (best-effort, non conta per l'alert)" >> "$LOG"
    fi
else
    echo "── $(date -Is) nessun Pi online al momento, salto la terza copia (best-effort)" >> "$LOG"
fi

bytes=$(du -sb "$DST_LOCAL" 2>/dev/null | cut -f1)
echo "── $(date -Is) fine backup ok=$ok" >> "$LOG"

/media/core/D/venv/bin/python3 - "$ok" "$bytes" <<'PY'
import json, sys, time
import paho.mqtt.client as mqtt
ok, size = sys.argv[1] == "1", int(sys.argv[2] or 0)
c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="gaia-backup")
c.connect("localhost", 1883, 30)
c.loop_start()
c.publish("gaia/backup/status",
          json.dumps({"ok": ok, "size_bytes": size, "ts": int(time.time() * 1000)}),
          retain=True).wait_for_publish(10)
c.loop_stop()
PY
exit $(( 1 - ok ))
