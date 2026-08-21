"""
Resolver LAN→Tailscale — trova il miglior host raggiungibile per uno scopo
dato, provando prima la LAN (veloce, funziona anche offline) e Tailscale
come fallback solo quando la LAN non basta.

Non sostituisce discovery.py (protocollo beacon GAIA_DISCOVER, specifico
per Pi→Core): questo modulo serve a chiunque debba raggiungere un host via
TCP semplice (Node-RED su OPS, l'API di gaia_admin, ecc.), da qualunque
piattaforma. Stdlib-only apposta — nessuna dipendenza da installare.

Copiato identico in tre punti (repo senza meccanismo di import
cross-directory, ogni agent è un'unità di deploy indipendente):
  pi/agent/net_resolve.py       (copia canonica)
  ops/agent/net_resolve.py
  minipc/script/net_resolve.py
Sync manuale — se tocchi uno di questi file, aggiorna anche gli altri due.

Uso:
    import net_resolve
    host = net_resolve.resolve_best("ops-nodered", [
        {"kind": "lan",       "host": "192.168.1.240", "port": 1880},
        {"kind": "tailscale", "host": "100.91.251.83",  "port": 1880},
    ])
"""
import platform
import shutil
import socket
import subprocess
import time

_cache: dict[str, tuple[str, float]] = {}   # purpose -> (host, scaduto_a)
_ts_ip_cache: tuple[str | None, float] = (None, 0.0)   # (ip, scaduto_a)
_TS_IP_TTL = 90.0   # l'IP tailscale locale non cambia spesso, non serve rileggerlo ad ogni chiamata
_internet_cache: tuple[bool, float] = (False, 0.0)
_INTERNET_TTL = 90.0


def probe_tcp(host: str, port: int, timeout: float = 1.5) -> bool:
    """Stesso identico pattern di discovery.py._probe_tcp."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _tailscale_binary() -> str | None:
    """Trova il binario tailscale sul PATH. Su Windows prova anche il path
    di installazione standard se non è sul PATH (l'agent OPS spesso gira
    senza il PATH utente completo, vedi il gotcha pythonw.exe già noto)."""
    exe = "tailscale.exe" if platform.system() == "Windows" else "tailscale"
    found = shutil.which(exe)
    if found:
        return found
    if platform.system() == "Windows":
        default = r"C:\Program Files\Tailscale\tailscale.exe"
        import os
        if os.path.exists(default):
            return default
    return None


def local_tailscale_ip(timeout: float = 1.5) -> str | None:
    """IP tailscale (100.x.x.x) di questa macchina, o None se tailscale
    non è installato/non è su. Nessun I/O di rete se il binario manca —
    fallisce in pochi millisecondi, non blocca l'avvio in scenari offline
    (Gaia-Demo) dove tailscale è magari installato ma mai autenticato."""
    global _ts_ip_cache
    ip, expires = _ts_ip_cache
    now = time.monotonic()
    if now < expires:
        return ip

    result_ip = None
    exe = _tailscale_binary()
    if exe:
        try:
            out = subprocess.run(
                [exe, "ip", "-4"], capture_output=True, text=True, timeout=timeout,
            )
            if out.returncode == 0:
                candidate = out.stdout.strip().splitlines()[0].strip() if out.stdout.strip() else ""
                if candidate:
                    result_ip = candidate
        except (OSError, subprocess.TimeoutExpired, IndexError):
            pass

    _ts_ip_cache = (result_ip, now + _TS_IP_TTL)
    return result_ip


def has_internet(timeout: float = 1.5) -> bool:
    """Connessione TCP di prova verso due resolver DNS pubblici noti (porta
    53, nessun dato scambiato) — non richiede risoluzione DNS, solo
    raggiungibilità IP. Cache con TTL, stesso motivo di local_tailscale_ip:
    non rifare il probe ad ogni heartbeat."""
    global _internet_cache
    ok, expires = _internet_cache
    now = time.monotonic()
    if now < expires:
        return ok
    result = probe_tcp("1.1.1.1", 53, timeout) or probe_tcp("8.8.8.8", 53, timeout)
    _internet_cache = (result, now + _INTERNET_TTL)
    return result


def resolve_best(purpose: str, candidates: list[dict], ttl: float = 60.0) -> str | None:
    """Prova tutti i candidati 'lan' prima, poi tutti i 'tailscale', via
    probe_tcp — il primo che risponde vince. Risultato in cache per
    `purpose` per `ttl` secondi (stesso idioma già in produzione in
    Node-RED: Ollama Health Check fa poll periodico + cache + accessor
    pickUrl(), qui per-processo). Ritorna l'host vincitore o None se
    nessun candidato risponde."""
    now = time.monotonic()
    cached = _cache.get(purpose)
    if cached and now < cached[1]:
        return cached[0]

    ordered = sorted(candidates, key=lambda c: 0 if c.get("kind") == "lan" else 1)
    for c in ordered:
        host, port = c.get("host"), c.get("port")
        if not host or not port:
            continue
        if probe_tcp(host, port):
            _cache[purpose] = (host, now + ttl)
            return host
    return None


if __name__ == "__main__":
    import json
    print("tailscale locale:", local_tailscale_ip())
    print("internet:", has_internet())
    print(json.dumps({"self_test": "ok"}, indent=2))
