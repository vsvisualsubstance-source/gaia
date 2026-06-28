"""
GAIA MQTT Client — con Device Registry integrato

Al connect:
  1. Subscribe a gaia/devices/{device_id}/config  (retained → room immediata)
  2. Publish  gaia/devices/{device_id}/announce   → Node-RED risponde con config

I topic di publish (frame, events, snapshot, heartbeat) sono proprietà
dinamiche derivate da self.node_id — cambiano automaticamente quando
il Device Registry assegna una nuova room.
"""

import json
import time
import os
import socket
import logging
import paho.mqtt.client as mqtt
from ota import OtaHandler

log = logging.getLogger('gaia-yolo')


class MqttClient:

    def __init__(self, host, port, device_id, node_id_claim, base_dir=None, service_name=None):
        self.host      = host
        self.port      = port
        self.device_id = device_id
        self.node_id   = node_id_claim
        self.connected = False
        self._ota = OtaHandler(
            mqtt_client  = self,
            device_id    = device_id,
            device_type  = 'yolo',
            base_dir     = base_dir or os.path.dirname(os.path.abspath(__file__)),
            service_name = service_name or os.environ.get('SERVICE_NAME', None),
        )

        self._client = mqtt.Client(
            client_id=f"gaia-yolo-{device_id}",
            clean_session=True
        )
        self._client.reconnect_delay_set(min_delay=2, max_delay=30)
        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message    = self._on_message

        try:
            self._client.connect(host, port, keepalive=60)
            self._client.loop_start()
            log.info(f"MQTT connecting to {host}:{port}")
        except Exception as e:
            log.error(f"MQTT connect failed: {e} — retry in background")
            self._client.loop_start()

    # ── TOPIC DINAMICI ────────────────────────────────────────────────────────
    # Cambiano automaticamente quando node_id viene aggiornato dal registry

    @property
    def topic_frame(self):
        return f"gaia/{self.node_id}/frame"

    @property
    def topic_events(self):
        return f"gaia/{self.node_id}/events"

    @property
    def topic_snapshot(self):
        return f"gaia/{self.node_id}/snapshot"

    @property
    def topic_heartbeat(self):
        return f"gaia/{self.node_id}/heartbeat"

    # ── CALLBACKS ─────────────────────────────────────────────────────────────

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc != 0:
            log.warning(f"MQTT error rc={rc}")
            return
        self.connected = True
        log.info(f"MQTT connesso | node_id={self.node_id}")

        # Config room (retained)
        config_topic = f"gaia/devices/{self.device_id}/config"
        client.subscribe(config_topic, qos=1)
        # OTA updates
        for t in self._ota.topics():
            client.subscribe(t, qos=1)
        log.info(f"Subscribed a config + OTA")

        # Announce → il Device Registry risponde con la config retained
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            ip = 'unknown'

        announce = {
            'device_id':  self.device_id,
            'type':       'yolo',
            'ip':         ip,
            'room_claim': self.node_id,
            'ts':         int(time.time() * 1000),
        }
        client.publish(
            f"gaia/devices/{self.device_id}/announce",
            json.dumps(announce),
            retain=False
        )
        log.info(f"Announce inviato: room_claim={self.node_id}")

    def _on_disconnect(self, client, userdata, rc, properties=None):
        self.connected = False
        log.warning(f"MQTT disconnesso rc={rc}")

    def _on_message(self, client, userdata, msg):
        """Riceve config room o comandi OTA."""
        topic = msg.topic

        # OTA
        if topic in self._ota.topics():
            self._ota.handle(topic, msg.payload)
            return

        # Config room
        expected = f"gaia/devices/{self.device_id}/config"
        if topic != expected:
            return
        try:
            cfg = json.loads(msg.payload.decode())
            new_room = cfg.get('room')
            if new_room and new_room != self.node_id:
                log.info(f"Room aggiornata: {self.node_id} → {new_room} "
                         f"(verified={cfg.get('verified', False)})")
                self.node_id = new_room
            elif new_room:
                log.info(f"Config confermata: room={new_room}")
        except Exception as e:
            log.error(f"Config parse error: {e}")

    # ── PUBLISH ───────────────────────────────────────────────────────────────

    def publish(self, topic, payload, retain=False):
        if not self.connected:
            log.warning(f"MQTT non connesso, skip publish su {topic}")
            return
        try:
            result = self._client.publish(
                topic,
                json.dumps(payload, default=str),
                qos=0,
                retain=retain
            )
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                log.warning(f"Publish failed rc={result.rc} topic={topic}")
        except Exception as e:
            log.error(f"Publish error: {e}")

    def stop(self):
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception as e:
            log.error(f"MQTT stop error: {e}")
