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

# 20/11/2026: un client sulla STESSA macchina (es. TD DMX su OPS/touring) manda il broadcast
# dall'interfaccia della via predefinita, cioe' spesso il Wi-Fi: senza questo riceverebbe l'IP del
# Wi-Fi (che cambia con la rete del posto). A lui si risponde con l'IP della rete dello show
# (LOCAL_HOST, default 192.168.1.240 se e' di questa macchina, altrimenti 127.0.0.1).
LOCAL_HOST = os.environ.get("BEACON_LOCAL_HOST", "192.168.1.240")


def _is_mine(ip: str) -> bool:
    """ip e' un indirizzo di questa macchina? (bind riuscito = si')"""
    if ip.startswith("127."):
        return True
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.bind((ip, 0))
        return True
    except OSError:
        return False


def _answer_host(peer_ip: str) -> str:
    if _is_mine(peer_ip):
        return LOCAL_HOST if _is_mine(LOCAL_HOST) else "127.0.0.1"
    return _local_ip_towards(peer_ip)


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
    # Windows (OPS/touring, 20/11): niente SO_REUSEADDR, che li' lascerebbe partire un secondo beacon
    # sulla stessa porta; ConnectionResetError (ICMP "porta chiusa" di un client gia' andato) non lo ferma
    if os.name != "nt":
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", BEACON_PORT))
    print(f"[Beacon] In ascolto su UDP {BEACON_PORT}, broker annunciato sulla porta {MQTT_PORT}", flush=True)

    while True:
        try:
            data, addr = sock.recvfrom(512)
        except OSError:      # anche ConnectionResetError su Windows
            continue
        if not data.startswith(MAGIC):
            continue
        reply = {
            "service":    "gaia-core",
            "proto":      1,
            "mqtt_host":  _answer_host(addr[0]),
            "mqtt_port":  MQTT_PORT,
            "admin_port": ADMIN_PORT,
            "version":    VERSION,
            "hostname":   socket.gethostname(),
        }
        try:
            sock.sendto(json.dumps(reply).encode(), addr)
            print(f"[Beacon] DISCOVER da {addr[0]}:{addr[1]} -> risposto {reply['mqtt_host']}:{MQTT_PORT}", flush=True)
        except OSError as e:
            print(f"[Beacon] Errore risposta a {addr}: {e}", flush=True)


if __name__ == "__main__":
    main()
