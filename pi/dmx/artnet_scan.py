#!/usr/bin/env python3
"""
Scan Art-Net (ArtPoll / ArtPollReply) — utility standalone, non usata dal
servizio gaia-dmx stesso (quello manda solo ArtDMX verso un host già
configurato, vedi artnet.py). Serve per scoprire i nodi reali presenti
sulla rete prima di impostare ARTNET_HOST a mano in /etc/gaia/dmx.conf --
stesso bisogno già risolto lato TD da dmx_patch (scan nodi Art-Net), qui
una versione minima per uso da riga di comando sul Pi.

Uso:
    python3 artnet_scan.py [--timeout 2.0] [--broadcast 2.255.255.255]
"""
import argparse
import socket
import struct
import time

_ART_NET_ID = b"Art-Net\x00"
_OPCODE_POLL = 0x2000
_OPCODE_POLL_REPLY = 0x2100
_PORT = 6454


def _decode_cstr(b):
    return b.split(b"\x00", 1)[0].decode("ascii", errors="replace")


def scan(timeout=2.0, broadcast="2.255.255.255", port=_PORT):
    """Manda un ArtPoll in broadcast e raccoglie le ArtPollReply arrivate
    entro `timeout` secondi. Ritorna una lista di dict, uno per nodo
    (deduplicati per IP sorgente — un nodo può rispondere più volte)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", port))
    sock.settimeout(0.2)

    # ArtPoll: ID(8) + OpCode(2,LE) + ProtVerHi/Lo(2) + TalkToMe(1) + Priority(1)
    poll = _ART_NET_ID + struct.pack("<HBBBB", _OPCODE_POLL, 0, 14, 0x00, 0x00)
    sock.sendto(poll, (broadcast, port))

    nodes = {}
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        if len(data) < 10 or data[:8] != _ART_NET_ID:
            continue
        opcode = struct.unpack("<H", data[8:10])[0]
        if opcode != _OPCODE_POLL_REPLY:
            continue
        ip_src = addr[0]
        if ip_src in nodes:
            continue
        # ArtPollReply (parziale, solo i campi utili per identificare il nodo):
        # ID(8) OpCode(2) IP(4) Port(2,LE) VersInfoH/L(2) NetSwitch(1)
        # SubSwitch(1) Oem(2) Ubea(1) Status1(1) EstaMan(2)
        # ShortName(18) LongName(64) NodeReport(64) ...
        try:
            short_name = _decode_cstr(data[26:44])
            long_name = _decode_cstr(data[44:108])
        except Exception:
            short_name = long_name = "?"
        nodes[ip_src] = {
            "ip": ip_src,
            "short_name": short_name,
            "long_name": long_name,
        }
    sock.close()
    return list(nodes.values())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=float, default=2.0)
    ap.add_argument("--broadcast", default="2.255.255.255")
    ap.add_argument("--port", type=int, default=_PORT)
    args = ap.parse_args()

    print(f"ArtPoll su {args.broadcast}:{args.port}, raccolgo per {args.timeout}s...")
    found = scan(args.timeout, args.broadcast, args.port)
    if not found:
        print("Nessun nodo ha risposto.")
    for n in found:
        print(f"  {n['ip']}  short={n['short_name']!r}  long={n['long_name']!r}")
