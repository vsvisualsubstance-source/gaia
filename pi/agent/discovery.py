"""
Discovery di Gaia Core — cascata: IP in cache → broadcast UDP → mDNS.

Controparte client di minipc/beacon/gaia_beacon.py (protocollo v1):
datagramma b"GAIA_DISCOVER" su UDP 8899 → risposta JSON con mqtt_host,
mqtt_port, admin_port, version. Stesso contratto previsto per i futuri
client ESP32/Arduino.

Uso (da agent.py, prima della connect MQTT):

    info = discovery.discover(cached_host=config.MQTT_HOST)
    if info:
        config.MQTT_HOST = info["mqtt_host"]
"""
import json
import os
import socket

BEACON_PORT = int(os.getenv("GAIA_BEACON_PORT", "8899"))
MAGIC       = b"GAIA_DISCOVER"

_BASE      = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(_BASE, "gaia_core.json")

# Nomi mDNS da provare se broadcast e cache falliscono (avahi/nss sul Pi
# risolve i .local senza dipendenze extra). Configurabile via env.
MDNS_NAMES = [
    n.strip() for n in
    os.getenv("GAIA_MDNS_NAMES", "gaia.local,core-node-0.local").split(",")
    if n.strip()
]


def _probe(host: str, timeout: float = 1.5) -> dict | None:
    """Interroga il beacon in unicast. Ritorna il JSON o None."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            s.sendto(MAGIC, (host, BEACON_PORT))
            data, addr = s.recvfrom(512)
            info = json.loads(data)
            if info.get("service") == "gaia-core":
                return info
    except (OSError, ValueError):
        pass
    return None


def _probe_tcp(host: str, port: int = 1883, timeout: float = 1.5) -> bool:
    """Fallback compatibilità: broker raggiungibile anche senza beacon."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _broadcast(timeout: float = 2.0, attempts: int = 3) -> dict | None:
    """Broadcast GAIA_DISCOVER sulla LAN. Ritorna il primo gaia-core."""
    for _ in range(attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                s.settimeout(timeout)
                s.sendto(MAGIC, ("255.255.255.255", BEACON_PORT))
                data, addr = s.recvfrom(512)
                info = json.loads(data)
                if info.get("service") == "gaia-core":
                    return info
        except (OSError, ValueError):
            continue
    return None


def _mdns() -> dict | None:
    """Risolve i nomi mDNS noti e conferma col beacon (o TCP 1883)."""
    for name in MDNS_NAMES:
        try:
            ip = socket.getaddrinfo(name, None, socket.AF_INET)[0][4][0]
        except OSError:
            continue
        info = _probe(ip)
        if info:
            return info
        if _probe_tcp(ip):
            return {"service": "gaia-core", "mqtt_host": ip, "mqtt_port": 1883}
    return None


def _load_cache() -> str | None:
    try:
        with open(CACHE_FILE) as f:
            return json.load(f).get("mqtt_host")
    except (OSError, ValueError):
        return None


def _save_cache(info: dict):
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(info, f, indent=2)
    except OSError:
        pass


def discover(cached_host: str | None = None) -> dict | None:
    """
    Un giro completo di discovery. Ordine:
      1. ultimo host trovato (gaia_core.json), poi cached_host (config/env)
      2. broadcast UDP
      3. mDNS
    Per gli host noti: prima beacon UDP, poi fallback TCP 1883 (compat
    con un Gaia Core senza beacon installato).
    Ritorna il dict del beacon (almeno mqtt_host/mqtt_port) o None.
    """
    candidates = []
    file_cached = _load_cache()
    if file_cached:
        candidates.append(file_cached)
    if cached_host and cached_host not in candidates:
        candidates.append(cached_host)

    for host in candidates:
        info = _probe(host)
        if info:
            _save_cache(info)
            return info
        if _probe_tcp(host):
            return {"service": "gaia-core", "mqtt_host": host, "mqtt_port": 1883}

    info = _broadcast()
    if info is None:
        info = _mdns()
    if info:
        _save_cache(info)
    return info


if __name__ == "__main__":
    print(json.dumps(discover(), indent=2))
