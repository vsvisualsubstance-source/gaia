#!/usr/bin/env python3
"""
GAIA Beacon — risponditore UDP per la discovery di Gaia Core.

Protocollo v1 (contratto condiviso con pi/agent/discovery.py e futuri
client ESP32/Arduino — non cambiare senza aggiornare tutti i client):

  Richiesta : datagramma UDP che inizia con b"GAIA_DISCOVER"
              (broadcast o unicast, porta 8899)
  Risposta  : JSON singolo datagramma verso il mittente:
              {
                "service":    "gaia-core",
                "proto":      1,
                "mqtt_host":  "<ip del miniPC visto dal richiedente>",
                "mqtt_port":  1883,
                "admin_port": 8765,
                "version":    "1.0.2",
                "hostname":   "core-node-0"
              }

mqtt_host viene calcolato per-richiesta con un connect UDP fittizio verso
il mittente: su host multi-interfaccia risponde con l'IP giusto per la
rete da cui arriva la domanda.
"""
import json
import os
import socket

BEACON_PORT = int(os.environ.get("BEACON_PORT", "8899"))
MQTT_PORT   = int(os.environ.get("MQTT_PORT",   "1883"))
ADMIN_PORT  = int(os.environ.get("ADMIN_PORT",  "8765"))
VERSION     = os.environ.get("GAIA_VERSION", "1.0.2")

MAGIC = b"GAIA_DISCOVER"


def _local_ip_towards(peer_ip: str) -> str:
    """IP locale dell'interfaccia che instrada verso peer_ip."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((peer_ip, 1))
            return s.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", BEACON_PORT))
    print(f"[Beacon] In ascolto su UDP {BEACON_PORT}")

    while True:
        try:
            data, addr = sock.recvfrom(512)
        except OSError:
            continue
        if not data.startswith(MAGIC):
            continue
        reply = {
            "service":    "gaia-core",
            "proto":      1,
            "mqtt_host":  _local_ip_towards(addr[0]),
            "mqtt_port":  MQTT_PORT,
            "admin_port": ADMIN_PORT,
            "version":    VERSION,
            "hostname":   socket.gethostname(),
        }
        try:
            sock.sendto(json.dumps(reply).encode(), addr)
            print(f"[Beacon] DISCOVER da {addr[0]}:{addr[1]} → risposto {reply['mqtt_host']}")
        except OSError as e:
            print(f"[Beacon] Errore risposta a {addr}: {e}")


if __name__ == "__main__":
    main()
