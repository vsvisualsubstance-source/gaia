#!/usr/bin/env python3
"""
GAIA LAN DHCP server — mini server DHCP per la rete di trasferta su OPS.

Windows (client, non Server) non ha un vero DHCP server con reservation per
MAC: ne' il ruolo DHCP Server (solo Windows Server), ne' ICS (assegna IP a
caso nella sua subnet 192.168.137.0/24, senza reservation), ne' tftpd64
(verificato dal sorgente il 2026-10-14: la sua struct S_DHCP_Param ha solo
pool dinamico, nessun campo MAC->IP). Quindi questo file.

Riusa DIRETTAMENTE minipc/network/gaia-demo-dnsmasq.conf (le righe
dhcp-host=mac[,mac2],ip) come unica fonte delle reservation -- stessa lista
usata da Core via NetworkManager/dnsmasq, nessuna configurazione duplicata
da tenere sincronizzata a mano tra Linux e Windows.

Non avviare direttamente senza prima aver reso STATICO l'IP dell'adattatore
Ethernet di OPS (vedi gaia_lan_activate.ps1) -- due DHCP server sulla stessa
LAN (es. il router di casa + questo) darebbero IP in conflitto a QUALSIASI
device della rete, non solo quelli Gaia.
"""
import ipaddress
import json
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_DIR, "..", ".."))
RESERVATIONS_CONF = os.path.join(_REPO_ROOT, "minipc", "network", "gaia-demo-dnsmasq.conf")
LEASES_FILE = os.path.join(_DIR, "dhcp_leases.json")
LOG_FILE = os.path.join(_DIR, "dhcp_server.log")

BIND_IP       = os.getenv("GAIA_DHCP_BIND_IP", "192.168.1.240")
SUBNET_MASK   = os.getenv("GAIA_DHCP_MASK", "255.255.255.0")
GATEWAY       = os.getenv("GAIA_DHCP_GATEWAY", BIND_IP)
DNS_SERVER    = os.getenv("GAIA_DHCP_DNS", "")           # vuoto = nessuna opzione 6 (niente internet da offrire)
LEASE_SECONDS = int(os.getenv("GAIA_DHCP_LEASE", "86400"))
POOL_START    = os.getenv("GAIA_DHCP_POOL_START", "192.168.1.50")
POOL_END      = os.getenv("GAIA_DHCP_POOL_END", "192.168.1.99")

DHCP_SERVER_PORT = 67
DHCP_CLIENT_PORT = 68
MAGIC_COOKIE = b"\x63\x82\x53\x63"

MSG_DISCOVER, MSG_OFFER, MSG_REQUEST, MSG_DECLINE, MSG_ACK, MSG_NAK, MSG_RELEASE, MSG_INFORM = range(1, 9)

_MAC_RE = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")


class _RotatingConsole:
    """Stesso meccanismo di pi/agent/agent.py e ops/agent/agent.py: sostituisce
    stdout/stderr per i casi in cui questo gira senza console (pythonw.exe),
    con rotazione a dimensione massima."""

    def __init__(self, path, max_bytes=10 * 1024 * 1024, backups=3):
        self._path = path
        self._max_bytes = max_bytes
        self._backups = backups
        self._fh = open(path, "a", encoding="utf-8", errors="replace")

    def write(self, s):
        try:
            self._fh.write(s)
            self._fh.flush()
            if self._fh.tell() >= self._max_bytes:
                self._rotate()
        except Exception:
            pass
        return len(s)

    def flush(self):
        try:
            self._fh.flush()
        except Exception:
            pass

    def isatty(self):
        return False

    def _rotate(self):
        try:
            self._fh.close()
            for i in range(self._backups - 1, 0, -1):
                src, dst = f"{self._path}.{i}", f"{self._path}.{i + 1}"
                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)
            if os.path.exists(self._path):
                dst1 = f"{self._path}.1"
                if os.path.exists(dst1):
                    os.remove(dst1)
                os.rename(self._path, dst1)
        finally:
            self._fh = open(self._path, "a", encoding="utf-8", errors="replace")


def _log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


def parse_reservations(path):
    """dhcp-host=mac1[,mac2,...],ip per riga (formato dnsmasq, righe non
    dhcp-host o malformate vengono ignorate in silenzio)."""
    reservations = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line.startswith("dhcp-host="):
                    continue
                parts = line[len("dhcp-host="):].split(",")
                if len(parts) < 2:
                    continue
                ip = parts[-1].strip()
                macs = [m.strip().lower() for m in parts[:-1]]
                try:
                    ipaddress.ip_address(ip)
                except ValueError:
                    continue
                for mac in macs:
                    if _MAC_RE.match(mac):
                        reservations[mac] = ip
    except FileNotFoundError:
        _log(f"ATTENZIONE: {path} non trovato, nessuna reservation caricata")
    return reservations


def _write_file_safe(path, content):
    if os.path.exists(path):
        os.remove(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _load_leases():
    try:
        with open(LEASES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_leases(leases):
    _write_file_safe(LEASES_FILE, json.dumps(leases, indent=2))


def _fmt_mac(chaddr, hlen):
    return ":".join(f"{b:02x}" for b in chaddr[:hlen])


def parse_packet(data):
    if len(data) < 240 or data[236:240] != MAGIC_COOKIE:
        return None
    hlen = data[2]
    options = {}
    i = 240
    while i < len(data):
        opt = data[i]
        if opt == 255:
            break
        if opt == 0:
            i += 1
            continue
        if i + 1 >= len(data):
            break
        length = data[i + 1]
        options[opt] = data[i + 2:i + 2 + length]
        i += 2 + length
    return {
        "xid": data[4:8],
        "flags": data[10:12],
        "chaddr": data[28:28 + hlen],
        "hlen": hlen,
        "giaddr": data[24:28],
        "options": options,
    }


def build_reply(req, msg_type, yiaddr, extra_options):
    chaddr = req["chaddr"] + b"\x00" * (16 - len(req["chaddr"]))
    header = struct.pack(
        "!BBBB4sHH4s4s4s4s16s64s128s",
        2, 1, req["hlen"], 0,
        req["xid"], 0,
        struct.unpack("!H", req["flags"])[0],
        b"\x00\x00\x00\x00",
        socket.inet_aton(yiaddr),
        socket.inet_aton(BIND_IP),
        req["giaddr"],
        chaddr, b"\x00" * 64, b"\x00" * 128,
    )
    opts = MAGIC_COOKIE
    opts += bytes([53, 1, msg_type])
    opts += bytes([54, 4]) + socket.inet_aton(BIND_IP)
    for code, val in extra_options:
        opts += bytes([code, len(val)]) + val
    opts += bytes([255])
    return header + opts


def _standard_options():
    opts = [
        (1, socket.inet_aton(SUBNET_MASK)),
        (51, struct.pack("!I", LEASE_SECONDS)),
    ]
    if GATEWAY:
        opts.append((3, socket.inet_aton(GATEWAY)))
    if DNS_SERVER:
        opts.append((6, socket.inet_aton(DNS_SERVER)))
    return opts


def _pick_dynamic_ip(mac, reservations, leases):
    """Prima la lease esistente (sticky), poi il primo IP libero nel pool --
    mai un IP gia' riservato per un altro MAC (reservations) o gia' in lease
    ad un altro MAC vivo."""
    now = time.time()
    existing = leases.get(mac)
    if existing and existing.get("ip"):
        return existing["ip"]
    taken = set(reservations.values())
    for mac2, lease in leases.items():
        if mac2 != mac and lease.get("expiry", 0) > now:
            taken.add(lease["ip"])
    start = int(ipaddress.ip_address(POOL_START))
    end = int(ipaddress.ip_address(POOL_END))
    for n in range(start, end + 1):
        ip = str(ipaddress.ip_address(n))
        if ip not in taken:
            return ip
    return None


class ForeignServerDetected(Exception):
    pass


NET_IFACE = os.getenv("GAIA_DHCP_IFACE", "Ethernet")


def _network_category_watchdog():
    """Windows rivaluta la categoria di rete (Public/Private) ad ogni evento
    di rete significativo (es. un device che prende/rinnova un IP) e la
    riporta a Public di default -- trovato dal vivo 2026-10-14: senza
    Private, Docker/HNS smette di esporre le porte dei container sulla Gaia
    LAN (vedi commento in gaia_lan_activate.ps1), quindi una sola
    applicazione all'attivazione non basta per tutta la durata di un evento
    in trasferta. Girare in background, non bloccare mai il server DHCP."""
    while True:
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"(Get-NetConnectionProfile -InterfaceAlias '{NET_IFACE}').NetworkCategory"],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            if out and out != "Private":
                _log(f"categoria rete '{NET_IFACE}' = {out}, la rimetto a Private")
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     f"Set-NetConnectionProfile -InterfaceAlias '{NET_IFACE}' -NetworkCategory Private"],
                    capture_output=True, text=True, timeout=10,
                )
        except Exception as e:
            _log(f"network category watchdog: errore ({e})")
        time.sleep(30)


def main():
    sys.stdout = sys.stderr = _RotatingConsole(LOG_FILE)
    _log("GAIA LAN DHCP server in avvio")
    _log(f"bind={BIND_IP} mask={SUBNET_MASK} gateway={GATEWAY or '(nessuno)'} pool={POOL_START}-{POOL_END}")

    threading.Thread(target=_network_category_watchdog, daemon=True).start()

    reservations = parse_reservations(RESERVATIONS_CONF)
    _log(f"{len(reservations)} reservation caricate da {RESERVATIONS_CONF}")
    for mac, ip in sorted(reservations.items(), key=lambda kv: kv[1]):
        _log(f"  {mac} -> {ip}")

    leases = _load_leases()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    # Retry sul bind: appena dopo gaia_lan_activate.ps1 assegna l'IP statico
    # e avvia la Scheduled Task, Windows a volte non ha ancora finito di
    # applicarlo a livello di stack di rete -- bind fallisce con WinError
    # 10049 "indirizzo non valido nel proprio contesto" anche se l'IP e'
    # gia' visibile un attimo dopo via Get-NetIPConfiguration (trovato dal
    # vivo 2026-10-14, primo test reale in trasferta).
    for attempt in range(10):
        try:
            sock.bind((BIND_IP, DHCP_SERVER_PORT))
            break
        except OSError as e:
            _log(f"bind su {BIND_IP} fallito ({e}), riprovo tra 2s ({attempt + 1}/10)")
            time.sleep(2)
    else:
        _log(f"bind su {BIND_IP} fallito dopo 10 tentativi, esco")
        return
    _log(f"in ascolto su {BIND_IP}:{DHCP_SERVER_PORT}")

    my_server_id = socket.inet_aton(BIND_IP)

    while True:
        try:
            data, addr = sock.recvfrom(2048)
        except Exception as e:
            _log(f"recvfrom errore: {e}, riprovo")
            time.sleep(1)
            continue

        req = parse_packet(data)
        if not req:
            continue
        msg_type_raw = req["options"].get(53)
        if not msg_type_raw:
            continue
        msg_type = msg_type_raw[0]
        mac = _fmt_mac(req["chaddr"], req["hlen"])

        if msg_type == MSG_REQUEST:
            server_id = req["options"].get(54)
            if server_id and server_id != my_server_id:
                # Un client ha accettato l'offerta di un ALTRO server DHCP
                # sulla stessa LAN -- segnale serio di rete sbagliata (es.
                # Ethernet riattaccato per sbaglio alla rete di casa). Mai
                # silenzioso: l'attivazione va rifatta a mano dopo aver
                # verificato la rete (vedi gaia_lan_activate.ps1).
                _log(f"ATTENZIONE: {mac} ha scelto un altro server DHCP "
                     f"({socket.inet_ntoa(server_id)}) -- esco per sicurezza")
                sock.close()
                raise ForeignServerDetected(socket.inet_ntoa(server_id))

        if mac in reservations:
            ip = reservations[mac]
        elif msg_type in (MSG_DISCOVER, MSG_REQUEST):
            ip = _pick_dynamic_ip(mac, reservations, leases)
            if not ip:
                _log(f"pool DHCP esaurito, nessun IP per {mac}")
                continue
        else:
            continue

        if msg_type == MSG_DISCOVER:
            reply = build_reply(req, MSG_OFFER, ip, _standard_options())
            sock.sendto(reply, ("255.255.255.255", DHCP_CLIENT_PORT))
            _log(f"OFFER {ip} -> {mac}")
        elif msg_type == MSG_REQUEST:
            reply = build_reply(req, MSG_ACK, ip, _standard_options())
            sock.sendto(reply, ("255.255.255.255", DHCP_CLIENT_PORT))
            _log(f"ACK {ip} -> {mac}")
            if mac not in reservations:
                leases[mac] = {"ip": ip, "expiry": time.time() + LEASE_SECONDS}
                _save_leases(leases)


if __name__ == "__main__":
    try:
        main()
    except ForeignServerDetected as e:
        _log(f"server fermato: rilevato un DHCP server estraneo ({e})")
        sys.exit(2)
