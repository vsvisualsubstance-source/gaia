#!/usr/bin/env python3
"""
Risolve l'host di Node-RED (su OPS, non su Core -- vedi sotto) prima di
avviare il chiosco: prova prima la LAN, poi Tailscale, via net_resolve.py.

Scritto perche' il default storico in gaia-kiosk.service costruiva l'URL
da MQTT_HOST (l'host del broker, su Core) invece che dall'host di
Node-RED (su OPS dal cutover dell'8/8) -- funzionava per coincidenza
quando tutto girava sulla stessa macchina, sbagliato da allora. Inoltre
non aveva NESSUN fallback: un Pi non piu' sulla LAN di OPS (isolamento
WiFi/AP, o semplicemente altrove) restava bloccato su una pagina che non
carica mai, anche con Tailscale perfettamente funzionante (trovato dal
vivo 2026-09-13, Pi ingresso).

Scrive SOLO /etc/gaia/nodered_host.conf (auto-gestito, mai a mano) --
NON tocca /etc/gaia/kiosk.conf, che resta lo spazio dell'utente per un
override esplicito (es. puntare a una pagina diversa), sempre a priorita'
massima nel default shell di gaia-kiosk.service.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net_resolve  # noqa: E402

OPS_LAN = "192.168.1.240"
OPS_TAILSCALE = "100.91.251.83"
NODERED_PORT = 1880

OUT_FILE = "/etc/gaia/nodered_host.conf"


def main():
    host = net_resolve.resolve_best("kiosk-nodered", [
        {"kind": "lan", "host": OPS_LAN, "port": NODERED_PORT},
        {"kind": "tailscale", "host": OPS_TAILSCALE, "port": NODERED_PORT},
    ])
    # Nessun candidato raggiungibile: meglio un default LAN esplicito che
    # nessun valore -- il chiosco mostrera' un errore di connessione
    # invece di un URL vuoto/malformato, e ritentera' al prossimo restart.
    if not host:
        host = OPS_LAN
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w") as f:
        f.write(f"NODERED_HOST={host}\n")
    print(f"[resolve_url] Node-RED risolto: {host}")


if __name__ == "__main__":
    main()
