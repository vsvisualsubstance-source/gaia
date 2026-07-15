#!/bin/bash
# GAIA backup notturno — dati preziosi NON versionabili in git (biometrici,
# stato del brain, dataset di training). Due destinazioni:
#   1. /media/core/D/backups/gaia   (altro disco della stessa macchina)
#   2. Pi cucina ~/gaia-backup      (altra macchina, 148G liberi)
# Esito su MQTT retained gaia/backup/status — l'health check del brain fa da
# dead-man switch: nessun backup fresco da >26h → alert Telegram.
# Schedulato via crontab utente core (03:30) — il sudoers non permette di
# installare unit systemd e il crontab utente gira anche senza sessione.
# Niente --delete: un errore locale non deve propagarsi ai backup.
set -u
LOG=/media/core/D/backups/gaia_backup.log
DST_LOCAL=/media/core/D/backups/gaia
DST_PI=asemico@192.168.1.190:gaia-backup
SRC=(
  /home/core/gaia
  /home/core/core-node-0/minipc/script/gaia_wakeword_samples
  /home/core/core-node-0/minipc/script/gaia_wakeword_samples_minipc
  /home/core/core-node-0/minipc/script/gaia_wakeword_samples_ops
  /home/core/core-node-0/minipc/script/doorbell_samples
  /home/core/core-node-0/minipc/script/voice_db.json
  /home/core/core-node-0/minipc/script/listener_config.json
  /home/core/.node-red/flows.json
  /media/core/D/face-env/faces
)

mkdir -p "$DST_LOCAL"
echo "── $(date -Is) avvio backup" >> "$LOG"

ok=1
rsync -a --timeout=60 "${SRC[@]}" "$DST_LOCAL/" >> "$LOG" 2>&1 || ok=0
rsync -a --timeout=120 "${SRC[@]}" "$DST_PI/" >> "$LOG" 2>&1 || ok=0

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
