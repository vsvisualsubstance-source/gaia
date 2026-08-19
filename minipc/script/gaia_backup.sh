#!/bin/bash
# GAIA backup notturno — dati preziosi NON versionabili in git (biometrici,
# stato del brain, dataset di training). Tre destinazioni (ridisegnato
# 2026-08-19, dopo che la seconda destinazione fissa -- un Pi identificato
# per IP -- si è ritrovata fisicamente fuori casa per giorni, lasciando UNA
# sola copia reale):
#   1. /media/core/D/backups/gaia         (disco locale, stessa macchina)
#   2. OPS: C:/gaia-docker-cfg/backups/gaia (altra macchina fisica, via scp
#      -- niente rsync, non è detto sia installato su Windows/OpenSSH)
#   3. Un Pi PRESENTE in casa ORA, scelto dinamicamente via GET /gaia/devices
#      (online=true, profile.role='pi') invece di un IP fisso -- i Pi
#      vengono spostati/sostituiti (visto dal vivo: "Pi cucina" diventato
#      "Pi ingresso"). Best-effort: se nessun Pi risulta online, o se la
#      copia fallisce, NON conta come fallimento del backup -- 1+2 bastano
#      per l'alert dead-man-switch (dead-man switch = nessun backup fresco
#      da >26h → alert Telegram via l'health check del brain).
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
DEVICES_API=http://192.168.1.240:1880/gaia/devices

# SSH user per Pi noti -- non uniforme tra i device (vsrasp01/pi-b2c8db usa
# 'admin', il vecchio Pi cucina/ingresso usava 'asemico'). Se un Pi nuovo
# non è in questa mappa si prova comunque con PI_USER_DEFAULT.
declare -A PI_USER=(
  [192.168.1.52]=admin
  [192.168.1.190]=asemico
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

# 3. Un Pi presente ora (best-effort, non tocca $ok)
pi_ip=$(timeout 8 curl -s "$DEVICES_API" 2>>"$LOG" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    cands = [x for x in d["devices"]
             if x.get("online") and x.get("profile", {}).get("role") == "pi"
             and x.get("ip") not in (None, "unknown")]
    print(cands[0]["ip"] if cands else "")
except Exception:
    print("")
' 2>>"$LOG")

if [ -n "$pi_ip" ]; then
    pi_user="${PI_USER[$pi_ip]:-$PI_USER_DEFAULT}"
    echo "── $(date -Is) Pi presente trovato: ${pi_user}@${pi_ip}" >> "$LOG"
    if rsync -a --timeout=60 -e "ssh -o ConnectTimeout=10" "${SRC[@]}" "${pi_user}@${pi_ip}:gaia-backup/" >> "$LOG" 2>&1; then
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
