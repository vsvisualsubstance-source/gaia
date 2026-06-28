"""
GAIA OTA Client — aggiornamento Over-The-Air via MQTT + HTTP

Flusso:
  1. Pi si avvia e si annuncia (announce già gestito dal main script)
  2. Node-RED pubblica su gaia/ota/broadcast o gaia/devices/{id}/update:
     {"script":"mediapipe_node.py","url":"http://host/gaia/ota/mediapipe_node.py",
      "md5":"abc123","version":"1.2.3","service":"gaia-mediapipe","restart":true}
  3. OtaHandler scarica, verifica MD5, sostituisce file, riavvia
  4. Pubblica ack su gaia/devices/{id}/ota/ack
"""

import os
import sys
import time
import hashlib
import logging
import threading
import subprocess
import urllib.request

log = logging.getLogger('gaia-ota')


class OtaHandler:

    def __init__(self, mqtt_client, device_id, device_type, base_dir, service_name=None):
        """
        mqtt_client  : istanza MqttClient (con metodo .publish)
        device_id    : hostname del Pi
        device_type  : 'mediapipe' | 'yolo'
        base_dir     : cartella dove salvare i file aggiornati
        service_name : nome servizio systemd (es. 'gaia-mediapipe'), None se manuale
        """
        self.device_id   = device_id
        self.device_type = device_type
        self.base_dir    = base_dir
        self.service     = service_name
        self._mqtt       = mqtt_client
        self._lock       = threading.Lock()

    def topics(self):
        """Topic MQTT a cui iscriversi."""
        return [
            'gaia/ota/broadcast',
            f'gaia/devices/{self.device_id}/update',
        ]

    def handle(self, topic, payload_bytes):
        """Chiamato quando arriva un messaggio OTA. Thread-safe."""
        import json
        try:
            cmd = json.loads(payload_bytes)
        except Exception:
            log.error("OTA: payload non valido")
            return

        # Filtra per tipo device (broadcast può specificare il tipo)
        target_type = cmd.get('type')
        if target_type and target_type not in ('all', self.device_type):
            return

        script  = cmd.get('script')
        url     = cmd.get('url')
        md5_exp = cmd.get('md5')
        version = cmd.get('version', '?')
        restart = cmd.get('restart', True)
        service = cmd.get('service', self.service)

        if not script or not url:
            log.error("OTA: mancano script o url")
            return

        log.info(f"OTA ricevuto: {script} v{version} da {url}")
        threading.Thread(
            target=self._apply,
            args=(script, url, md5_exp, version, restart, service),
            daemon=True
        ).start()

    def _apply(self, script, url, md5_exp, version, restart, service):
        with self._lock:
            try:
                # ── DOWNLOAD ──────────────────────────────────────────────────
                log.info(f"Download {url} ...")
                req = urllib.request.Request(url, headers={'User-Agent': f'gaia-ota/{self.device_id}'})
                with urllib.request.urlopen(req, timeout=30) as r:
                    content = r.read()
                log.info(f"Download OK: {len(content)} bytes")

                # ── VERIFICA MD5 ──────────────────────────────────────────────
                if md5_exp:
                    actual = hashlib.md5(content).hexdigest()
                    if actual != md5_exp:
                        log.error(f"MD5 mismatch: got {actual}, expected {md5_exp}")
                        self._ack('failed', version, 'md5_mismatch')
                        return
                    log.info(f"MD5 OK: {actual}")

                # ── SCRITTURA ATOMICA ──────────────────────────────────────────
                target = os.path.join(self.base_dir, script)
                tmp    = target + '.ota_tmp'
                with open(tmp, 'wb') as f:
                    f.write(content)
                os.replace(tmp, target)   # atomico su POSIX
                log.info(f"✓ {script} scritto in {target}")

                self._ack('updated', version)

                # ── RESTART ───────────────────────────────────────────────────
                if not restart:
                    return

                time.sleep(0.5)  # lascia tempo all'ack MQTT di partire

                if service:
                    log.info(f"Restart systemd: {service}")
                    subprocess.run(['sudo', 'systemctl', 'restart', service], check=True)
                else:
                    # Auto-restart: rimpiazza il processo corrente con la versione aggiornata
                    log.info("Self-restart via os.execv...")
                    os.execv(sys.executable, [sys.executable] + sys.argv)

            except Exception as e:
                log.error(f"OTA failed: {e}")
                self._ack('failed', version, str(e))

    def _ack(self, status, version, error=None):
        import json
        payload = {
            'device_id': self.device_id,
            'type':      self.device_type,
            'status':    status,
            'version':   version,
            'ts':        int(time.time() * 1000),
        }
        if error:
            payload['error'] = error
        topic = f'gaia/devices/{self.device_id}/ota/ack'
        try:
            self._mqtt.publish(topic, json.dumps(payload), retain=False)
        except Exception as e:
            log.error(f"OTA ack failed: {e}")
        log.info(f"OTA ack: {status} v{version}" + (f" [{error}]" if error else ""))
