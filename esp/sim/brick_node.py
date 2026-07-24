#!/usr/bin/env python3
"""
GAIA ESP32 — simulatore di "cellula" (mattone intelligente, progetto Casa Zero
github.com/vsvisualsubstance-source/casazero).

Parla il PROTOCOLLO REALE di GAIA — stesso schema di pi/agent/agent.py e
pi/yolo/mqtt_client.py: connect → subscribe config (retained) → announce →
profilo semantico retained → comandi. Un mattone simulato appare quindi nel
Device Registry / Pi Manager esattamente come un Pi o un OPS, non con un
protocollo parallelo.

Esteso con i due concetti nuovi del "DNA Costruttivo" (dna.html) che GAIA non
aveva ancora, perché pensati per elementi edilizi passivi e non per PC/SBC:
  - interfaces: power / data / mesh (un canale puramente passivo non ne avrebbe
    nessuna — qui simulate solo le varianti con elettronica reale a bordo)
  - position.neighbors: nord/sud/est/ovest/sopra/sotto — topologia locale,
    nessuna mappa centrale (stesso principio "le cellule conoscono i vicini"
    del DNA Costruttivo)

Non è firmware reale: è un prototipo software per definire/validare la LOGICA
prima di scrivere C++/Arduino per un ESP32 vero — stesso approccio già usato
in pi/herbarium/plant_simulator.py (finge l'hardware al confine del
protocollo, il resto del sistema non vede la differenza). Vedi anche
docs/esp32-roadmap.md per il piano di porting a firmware reale.

Una sola implementazione, specializzata a runtime da --variant — stesso
principio del mattone fisico ("nasce uguale, si specializza in stampa").
Solo le varianti con elettronica reale a bordo sono simulate: B0/B-E/B-W/B-A
sono passaggi passivi senza cartuccia (vedi mattone.html), non generano un
nodo di rete proprio.

Uso:
  python3 brick_node.py --variant B-G --room ingresso \
      --neighbor nord=wall_0213 --neighbor sotto=floor_0100

Il device appare (retained) in GET /gaia/devices/profiles e in admin.html Pi
Manager come un device qualsiasi. Per rimuoverlo a test finito:
  POST /gaia/device/forget {"device_id": "esp32-xxxxxx", "force": true}
"""
import argparse
import json
import random
import sys
import time
import uuid

import paho.mqtt.client as mqtt

# Senza questo, i print() restano bufferizzati a blocchi quando l'output non
# è un terminale (es. redirezione su file di un processo in background) —
# non si vede nulla finché il processo non termina. Stesso bug già trovato
# e corretto in scripts/gaia_mqtt.py.
sys.stdout.reconfigure(line_buffering=True)

DEFAULT_HOST = "192.168.1.142"

# Varianti stampabili CON elettronica reale a bordo (mattone.html / CLAUDE.md
# di casazero, tabella B0–B-C) → capacità + servizi + interfacce DNA.
BRICK_VARIANTS = {
    "B-D": {
        "label": "Dati/sensori",
        "capabilities": {"temperature": True, "humidity": True, "bus_data": True},
        "interfaces": ["power", "data"],
        "services": ["sensor_stream"],
    },
    "B-S": {
        "label": "Sensore",
        "capabilities": {"temperature": True, "humidity": True, "vibration": True, "air_quality": True},
        "interfaces": ["power", "data"],
        "services": ["sensor_stream", "detect_water"],
    },
    "B-G": {
        "label": "Nodo Gaia",
        "capabilities": {"temperature": True, "humidity": True, "vibration": True, "edge_ai": True},
        "interfaces": ["power", "data", "mesh"],
        "services": ["sensor_stream", "detect_crack", "detect_presence", "gaia_relay"],
    },
    "B-I": {
        "label": "Ispezionabile",
        "capabilities": {"hatch_state": True},
        "interfaces": ["power", "data"],
        "services": ["hatch_status"],
    },
    "B-J": {
        "label": "Giunzione/derivazione",
        "capabilities": {"bus_data": True},
        "interfaces": ["data", "mesh"],
        "services": [],
    },
    "B-C": {
        "label": "Angolo/connessione",
        "capabilities": {"bus_data": True},
        "interfaces": ["data", "mesh"],
        "services": [],
    },
}

NEIGHBOR_SLOTS = ["nord", "sud", "est", "ovest", "sopra", "sotto"]


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", choices=sorted(BRICK_VARIANTS), default="B-G")
    ap.add_argument("--room", default="ingresso")
    ap.add_argument("--id", default=None, help="device_id esplicito (default: esp32-<mac finto>)")
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--interval", type=float, default=10.0,
                     help="secondi tra una lettura sensore e l'altra")
    ap.add_argument("--neighbor", action="append", default=[], metavar="LATO=ID",
                     help="es. --neighbor nord=wall_0213 (ripetibile; lati: %s)"
                          % "/".join(NEIGHBOR_SLOTS))
    return ap.parse_args()


def make_device_id(explicit):
    if explicit:
        return explicit
    fake_mac = uuid.getnode().to_bytes(6, "big").hex()
    return f"esp32-{fake_mac[-6:]}"


def parse_neighbors(pairs):
    neighbors = {slot: None for slot in NEIGHBOR_SLOTS}
    for pair in pairs:
        if "=" not in pair:
            continue
        slot, val = pair.split("=", 1)
        slot = slot.strip().lower()
        if slot in neighbors:
            neighbors[slot] = val.strip() or None
    return neighbors


class BrickNode:
    def __init__(self, args):
        self.args = args
        self.device_id = make_device_id(args.id)
        self.variant = BRICK_VARIANTS[args.variant]
        self.room = args.room
        self.neighbors = parse_neighbors(args.neighbor)
        self.ip = "0.0.0.0-simulato"

        try:
            self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                       client_id=f"gaia-brick-{self.device_id}")
        except AttributeError:
            self.client = mqtt.Client(client_id=f"gaia-brick-{self.device_id}")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(min_delay=2, max_delay=30)

    # ── ciclo di vita: stesso schema di pi/agent + pi/yolo/mqtt_client ──────
    def _on_connect(self, client, userdata, flags, rc, properties=None):
        print(f"[Brick] MQTT connesso — {self.device_id} "
              f"({self.args.variant}, {self.variant['label']}) in {self.room}")
        client.subscribe(f"gaia/devices/{self.device_id}/config", qos=1)
        client.subscribe(f"gaia/device/{self.device_id}/command", qos=1)
        client.subscribe("gaia/device/all/command", qos=1)

        announce = {
            "device_id": self.device_id,
            "type": "brick",
            "ip": self.ip,
            "room_claim": self.room,
            "ts": int(time.time() * 1000),
        }
        client.publish(f"gaia/devices/{self.device_id}/announce",
                        json.dumps(announce), retain=False)
        print(f"[Brick] Announce inviato: room_claim={self.room}")
        self._publish_profile()

    def _on_message(self, client, userdata, msg):
        if msg.topic == f"gaia/devices/{self.device_id}/config":
            try:
                cfg = json.loads(msg.payload)
            except ValueError:
                return
            new_room = cfg.get("room")
            if new_room and new_room != self.room:
                print(f"[Brick] Stanza aggiornata dal Device Registry: {self.room} -> {new_room}")
                self.room = new_room
                self._publish_profile()
            return
        try:
            cmd = json.loads(msg.payload)
        except ValueError:
            return
        if cmd.get("action") == "status":
            self._publish_profile()
        else:
            print(f"[Brick] Comando ricevuto (ignorato nel simulatore): {cmd}")

    def _publish_profile(self):
        """Profilo semantico retained — stesso schema di pi/agent._publish_profile
        (docs/gaia-semantico.md), esteso con 'interfaces' e 'position.neighbors'
        dal DNA Costruttivo di casazero."""
        services = {
            name: {"state": "active",
                   "endpoints": {"data": f"gaia/brick/{self.device_id}/sensor/{name}"}}
            for name in self.variant["services"]
        }
        profile = {
            "device_id": self.device_id,
            "role": "brick",
            "brick_variant": self.args.variant,
            "room": self.room,
            "ip": self.ip,
            "capabilities": self.variant["capabilities"],
            "interfaces": self.variant["interfaces"],
            "position": {"neighbors": self.neighbors},
            "services": services,
            "sw_version": "sim-0.1",
            "ts": int(time.time() * 1000),
        }
        self.client.publish(f"gaia/devices/{self.device_id}/profile",
                             json.dumps(profile), retain=True)

    def _publish_sensor_reading(self):
        caps = self.variant["capabilities"]
        reading = {"ts": int(time.time() * 1000)}
        if caps.get("temperature"):
            reading["temperature"] = round(19 + random.uniform(-1, 4), 1)
        if caps.get("humidity"):
            reading["humidity"] = round(45 + random.uniform(-10, 15), 1)
        if caps.get("vibration"):
            reading["vibration"] = round(random.uniform(0, 0.3), 3)
        if caps.get("air_quality"):
            reading["air_quality"] = round(random.uniform(0, 100), 1)
        topic = f"gaia/brick/{self.device_id}/sensor"
        self.client.publish(topic, json.dumps(reading))
        print(f"[Brick] {topic} -> {reading}")

    def run(self):
        self.client.connect(self.args.host, self.args.port, keepalive=60)
        self.client.loop_start()
        try:
            while True:
                time.sleep(self.args.interval)
                if self.variant["capabilities"]:
                    self._publish_sensor_reading()
        except KeyboardInterrupt:
            print("\n[Brick] Fermato.")
        finally:
            self.client.loop_stop()


def main():
    args = parse_args()
    BrickNode(args).run()


if __name__ == "__main__":
    main()
