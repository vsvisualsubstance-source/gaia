#!/usr/bin/env python3
"""
GAIA Dante Monitor — rileva se la rete audio Dante (Solaro QR1-UC + TCCM
Sennheiser) e' attiva osservando il traffico UDP del driver esterno
dell'utente (H/V Angle, Mic Level, Far End Audio, Camera Preset — vedi
config.DANTE_PORTS). Non decodifica il contenuto: e' solo un rilevatore di
presenza/vita della rete, usato da altri servizi (es. mediaplayer) per
decidere se ha senso instradare l'audio su Dante.

MQTT: gaia/dante/status (retained) -> {active, last_seen_ts, ports_seen, ts}
Pubblica SEMPRE ogni STATUS_INTERVAL_S, anche quando inattivo (stesso
pattern di mediapipe/mediaplayer: chi consuma non deve gestire un proprio
timeout).
"""
import json
import selectors
import socket
import time

import paho.mqtt.client as mqtt

import config

_running = True
_last_seen_ts = 0.0
_ports_seen: dict[int, float] = {}   # porta -> ultimo timestamp visto


def _open_sockets():
    sel = selectors.DefaultSelector()
    opened = []
    for port in config.DANTE_PORTS:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setblocking(False)
        try:
            s.bind(("0.0.0.0", port))
        except OSError as e:
            print(f"[Dante] Porta {port} non disponibile ({e}) — salto")
            s.close()
            continue
        sel.register(s, selectors.EVENT_READ, port)
        opened.append(port)
    print(f"[Dante] In ascolto su {opened}")
    return sel


try:
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="gaia-dante-monitor")
except AttributeError:                        # paho 1.x di sistema
    _mqtt = mqtt.Client(client_id="gaia-dante-monitor")
_mqtt.reconnect_delay_set(min_delay=2, max_delay=30)


def _publish_status():
    now = time.time()
    active = bool(_last_seen_ts) and (now - _last_seen_ts) < config.DANTE_TIMEOUT_S
    ports_active = sorted(p for p, t in _ports_seen.items() if now - t < config.DANTE_TIMEOUT_S)
    payload = {
        "active":        active,
        "last_seen_ts":  int(_last_seen_ts * 1000) if _last_seen_ts else None,
        "ports_seen":    ports_active,
        "ts":            int(now * 1000),
    }
    _mqtt.publish("gaia/dante/status", json.dumps(payload), retain=True)


def main():
    global _last_seen_ts
    sel = _open_sockets()
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    _mqtt.loop_start()

    last_status = 0.0
    while _running:
        for key, _ in sel.select(timeout=0.5):
            sock = key.fileobj
            port = key.data
            try:
                sock.recvfrom(4096)
            except OSError:
                continue
            now = time.time()
            _last_seen_ts = now
            _ports_seen[port] = now

        now = time.time()
        if now - last_status >= config.STATUS_INTERVAL_S:
            last_status = now
            _publish_status()


if __name__ == "__main__":
    main()
