#!/usr/bin/env python3
"""
GAIA TCC M Agent — bridge verso il Sennheiser TeamConnect Ceiling Medium
(microfono a soffitto con beamforming), parla l'API nativa SSCv2 del
device (HTTPS + subscription SSE, Basic Auth) invece del canale UDP
grezzo usato per il Solaro (vedi minipc/dante/) — qui il DSP/microfono
espone i dati direttamente (beam azimuth/elevation, room activity, mute),
non serve dedurli da un driver esterno.

Adattato da un template scaricato dall'utente (2026-09-02) dopo aver
verificato i path delle risorse e il formato dei messaggi SSE contro la
spec ufficiale Sennheiser SSCv2
(docs.cloud.sennheiser.com/en-us/api-docs/api-docs/sscv2-specification-2.3.html)
e contro un binding Go generato da OpenAPI per il TCC M
(github.com/chetan-prime/sennheiser-tcc-m-api) -- tutti i path in
RESOURCES sono confermati reali contro quest'ultimo. **Bug reale trovato
e corretto nel template**: il parsing degli eventi "message" assumeva un
payload {"path":..., "value":...}, ma la spec dice che il payload e'
{"<path della risorsa>": <valore>} (il path e' la CHIAVE, non un campo
separato) -- un evento puo' anche contenere piu' risorse in un solo
messaggio, vedi process_sse_event().

Pubblica DUE cose:
  1. Topic custom gaia/tccm/{beam,audio,room,room/activity,mute,status}
     (schema del template originale, utile per consumatori diretti).
  2. gaia/device/{TCCM_DEVICE_ID}/status (role:"device", family:"tccm")
     -- stesso schema di madmapper/solaro, compare in Pi Manager.

Nessun comando inviato al device oltre a leggere risorse via
subscription -- niente PUT verso l'API in questo modulo (i controlli
reali restano da derivare quando servono, stessa regola gia' seguita
per Solaro/MadMapper).
"""
import json
import logging
import signal
import sys
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import requests
from requests.auth import HTTPBasicAuth

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TCCM] %(levelname)s: %(message)s",
)
log = logging.getLogger("gaia-tccm")

# Path confermati contro github.com/chetan-prime/sennheiser-tcc-m-api
# (binding Go generato da OpenAPI per il TCC M) prima di usarli qui.
RESOURCES = [
    "/api/audio/inputs/microphone/beam/direction",
    "/api/audio/inputs/microphone/level",
    "/api/audio/roomInUse",
    "/api/audio/roomInUse/activityLevel",
    "/api/audio/outputs/global/mute",
]


class TCCMAgent:
    def __init__(self):
        self.running = True

        self.session = requests.Session()
        self.session.auth = HTTPBasicAuth(config.TCCM_USER, config.TCCM_PASSWORD)
        self.session.verify = config.TCCM_VERIFY_TLS

        try:
            self.mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=config.MQTT_CLIENT_ID)
        except AttributeError:                        # paho 1.x di sistema
            self.mqtt = mqtt.Client(client_id=config.MQTT_CLIENT_ID)
        self.mqtt.on_connect = self._on_mqtt_connect
        self.mqtt.on_disconnect = self._on_mqtt_disconnect
        self.mqtt.reconnect_delay_set(min_delay=2, max_delay=30)

        self.mqtt_connected = False
        self.sse_connected = False
        self.subscription_uuid = None

        self.last_seen = None
        self.last_beam = None
        self.last_room_active = None
        self.last_mute = None

        self.status_thread = threading.Thread(target=self.status_loop, daemon=True)

    # ── MQTT ─────────────────────────────────────────────────────────
    def _on_mqtt_connect(self, client, userdata, flags, reason_code, properties=None):
        self.mqtt_connected = (reason_code == 0)
        if self.mqtt_connected:
            log.info("MQTT connesso")
        else:
            log.warning("MQTT connessione fallita rc=%s", reason_code)

    def _on_mqtt_disconnect(self, client, userdata, *args):
        self.mqtt_connected = False

    def mqtt_connect(self):
        backoff = 2
        while self.running:
            try:
                log.info("Connessione MQTT %s:%s", config.MQTT_HOST, config.MQTT_PORT)
                self.mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, keepalive=60)
                self.mqtt.loop_start()
                return
            except Exception as exc:
                log.warning("Connessione MQTT fallita (%s), riprovo tra %ss", exc, backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def publish(self, topic, payload):
        try:
            self.mqtt.publish(topic, json.dumps(payload, separators=(",", ":")), qos=0, retain=False)
        except Exception as exc:
            log.warning("Publish MQTT fallito (%s): %s", topic, exc)

    # ── TCC M HTTP ───────────────────────────────────────────────────
    def base_url(self):
        return f"https://{config.TCCM_HOST}:{config.TCCM_PORT}"

    def api_get(self, path):
        response = self.session.get(self.base_url() + path, timeout=10)
        response.raise_for_status()
        return response.json()

    # ── Subscription ─────────────────────────────────────────────────
    def create_subscription(self):
        url = self.base_url() + "/api/ssc/state/subscriptions"
        log.info("Apertura subscription SSE TCC M")
        response = self.session.get(
            url,
            headers={"Accept": "text/event-stream", "Cache-Control": "no-cache"},
            stream=True,
            timeout=(config.SSE_CONNECT_TIMEOUT, config.SSE_IDLE_TIMEOUT),
        )
        response.raise_for_status()
        # Il sessionUUID arriva anche via header Content-Location (spec
        # SSCv2), ma l'evento "open" (vedi process_sse_event) e' la fonte
        # autorevole -- l'header e' solo un fallback anticipato, se il
        # server non lo manda l'evento "open" arriva comunque subito dopo.
        content_location = response.headers.get("Content-Location")
        if content_location:
            self.subscription_uuid = content_location.rstrip("/").split("/")[-1]
        return response

    def add_resources(self):
        if not self.subscription_uuid:
            raise RuntimeError("subscription_uuid non disponibile")
        url = self.base_url() + f"/api/ssc/state/subscriptions/{self.subscription_uuid}/add"
        response = self.session.put(url, json=RESOURCES, timeout=10)
        response.raise_for_status()
        log.info("Sottoscritte %d risorse TCC M", len(RESOURCES))

    def delete_subscription(self):
        if not self.subscription_uuid:
            return
        try:
            url = self.base_url() + f"/api/ssc/state/subscriptions/{self.subscription_uuid}"
            self.session.delete(url, timeout=5)
        except Exception:
            pass
        self.subscription_uuid = None

    # ── SSE ──────────────────────────────────────────────────────────
    def process_sse_event(self, event_type, data):
        if not data:
            return
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            log.warning("SSE JSON non valido: %s", data)
            return

        if event_type == "open":
            uuid = payload.get("sessionUUID")
            if uuid:
                self.subscription_uuid = uuid
                log.info("Sessione SSE TCC M: %s", uuid)
                try:
                    self.add_resources()
                except Exception as exc:
                    log.error("Impossibile sottoscrivere le risorse: %s", exc)
                    raise
            return

        if event_type == "close":
            log.info("Sessione SSE chiusa dal server")
            return

        # Evento "message": {"<path risorsa>": <valore>, ...} -- il path
        # e' la CHIAVE del JSON, non un campo "path" separato (verificato
        # contro la spec ufficiale SSCv2 2.3 -- bug reale nel template di
        # partenza, vedi docstring modulo). Un solo evento puo' contenere
        # piu' risorse aggiornate insieme, quindi si itera su tutte.
        if isinstance(payload, dict):
            for path, value in payload.items():
                self.handle_resource(path, value)

    def sse_loop(self):
        backoff = config.RECONNECT_MIN
        while self.running:
            response = None
            try:
                response = self.create_subscription()
                self.sse_connected = True
                self.publish_status()

                event_type = "message"
                data_lines = []
                for raw_line in response.iter_lines(decode_unicode=True):
                    if not self.running:
                        break
                    if raw_line is None:
                        continue
                    line = raw_line.strip()
                    if line == "":
                        if data_lines:
                            self.process_sse_event(event_type, "\n".join(data_lines))
                        event_type = "message"
                        data_lines = []
                        continue
                    if line.startswith(":"):
                        continue
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                        continue
                    if line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())

                if data_lines:
                    self.process_sse_event(event_type, "\n".join(data_lines))

                raise ConnectionError("Connessione SSE TCC M chiusa")

            except Exception as exc:
                self.sse_connected = False
                log.warning("SSE TCC M disconnessa (%s)", exc)
                self.publish_status()
                if self.running:
                    time.sleep(backoff)
                    backoff = min(backoff * 2, config.RECONNECT_MAX)
            finally:
                if response is not None:
                    try:
                        response.close()
                    except Exception:
                        pass
                self.delete_subscription()

            if self.sse_connected:
                backoff = config.RECONNECT_MIN

    # ── Gestione risorse ─────────────────────────────────────────────
    def timestamp(self):
        return datetime.now(timezone.utc).isoformat()

    def with_metadata(self, value):
        result = dict(value) if isinstance(value, dict) else {"value": value}
        result["ts"] = self.timestamp()
        return result

    def handle_resource(self, path, value):
        self.last_seen = time.time()
        payload = self.with_metadata(value)

        if path.endswith("/microphone/beam/direction"):
            self.last_beam = payload
            self.publish(f"{config.MQTT_BASE_TOPIC}/beam", payload)
        elif path.endswith("/microphone/level"):
            self.publish(f"{config.MQTT_BASE_TOPIC}/audio", payload)
        elif path.endswith("/roomInUse/activityLevel"):
            self.publish(f"{config.MQTT_BASE_TOPIC}/room/activity", payload)
        elif path.endswith("/roomInUse"):
            self.last_room_active = value.get("active") if isinstance(value, dict) else None
            self.publish(f"{config.MQTT_BASE_TOPIC}/room", payload)
        elif path.endswith("/outputs/global/mute"):
            self.last_mute = value.get("enabled") if isinstance(value, dict) else None
            self.publish(f"{config.MQTT_BASE_TOPIC}/mute", payload)

        self.publish_solaro_style_device()

    # ── Status (topic custom, invariato dal template) ────────────────
    def check_api(self):
        try:
            self.api_get("/api/ssc/version")
            return True
        except Exception:
            return False

    def build_status(self):
        return {
            "online": self.sse_connected,
            "api_reachable": self.check_api(),
            "sse_connected": self.sse_connected,
            "last_seen": self.last_seen,
            "last_beam": self.last_beam,
            "ts": self.timestamp(),
        }

    def publish_status(self):
        self.publish(f"{config.MQTT_BASE_TOPIC}/status", self.build_status())

    # ── Device nel registro standard (gaia/device/{id}/status) ───────
    def publish_solaro_style_device(self):
        now = time.time()
        age = round(now - self.last_seen, 1) if self.last_seen else None
        payload = {
            "device_id": config.TCCM_DEVICE_ID,
            "name": "TCC M (Sennheiser)",
            "role": "device",
            "family": "tccm",
            "stanza": config.TCCM_STANZA,
            "online": self.sse_connected,
            "last_seen_age_s": age,
            "beam": self.last_beam,
            "room_active": self.last_room_active,
            "muted": self.last_mute,
            "capabilities": {"beam_direction": True, "room_activity": True},
            "ts": int(now * 1000),
        }
        self.publish(f"gaia/device/{config.TCCM_DEVICE_ID}/status", payload)

    def status_loop(self):
        stale_warned = False
        while self.running:
            try:
                self.publish_status()
                self.publish_solaro_style_device()
                # 2026-09-03: rileva uno stream "zombie" (sse_connected=True
                # ma nessun evento reale da tempo) -- il bug reale che ha
                # motivato SSE_IDLE_TIMEOUT sopra e' passato inosservato 17
                # ore proprio perche' nessun log segnalava la discrepanza.
                # Soglia doppia rispetto a SSE_IDLE_TIMEOUT: col fix quello
                # dovrebbe gia' auto-riconnettere prima che scatti questo.
                if self.sse_connected and self.last_seen:
                    age = time.time() - self.last_seen
                    if age > config.SSE_IDLE_TIMEOUT * 2:
                        if not stale_warned:
                            log.warning(
                                "Nessun evento SSE da %.0fs pur risultando connesso "
                                "(possibile stream bloccato)", age
                            )
                            stale_warned = True
                    else:
                        stale_warned = False
            except Exception as exc:
                log.warning("Aggiornamento status fallito: %s", exc)
            time.sleep(config.STATUS_INTERVAL)

    # ── Shutdown ─────────────────────────────────────────────────────
    def stop(self):
        if not self.running:
            return
        log.info("Arresto TCC M agent")
        self.running = False
        self.sse_connected = False
        self.delete_subscription()
        try:
            self.mqtt.loop_stop()
            self.mqtt.disconnect()
        except Exception:
            pass

    # ── Avvio ────────────────────────────────────────────────────────
    def run(self):
        if not config.TCCM_PASSWORD:
            log.error("TCCM_PASSWORD non configurata (env o /etc/gaia/tccm.conf)")
            return 1

        self.mqtt_connect()

        try:
            version = self.api_get("/api/ssc/version")
            log.info("TCC M SSC version: %s", version)
        except Exception as exc:
            log.warning("Controllo API TCC M fallito: %s", exc)

        self.status_thread.start()
        self.sse_loop()
        self.stop()
        return 0


agent = TCCMAgent()


def handle_signal(signum, frame):
    agent.stop()


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


if __name__ == "__main__":
    sys.exit(agent.run())
