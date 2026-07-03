#!/usr/bin/env python3
"""
GAIA ↔ TouchDesigner — bridge OSC bidirezionale.

Gaia → TouchDesigner: si collega alla stessa WebSocket usata da dashboard.html
/ gaia-art (ws://{host}:1880/gaia, payload costruito da ThreeViewEngineGAME in
Node-RED), appiattisce il JSON in coppie indirizzo/valore OSC e le manda via
UDP a TouchDesigner (di norma un OSC In CHOP o OSC In DAT in ascolto in
locale). Un indirizzo per ogni valore scalare — è il pattern più semplice da
consumare per un OSC In CHOP in TD (ogni indirizzo univoco diventa un canale).

TouchDesigner → Gaia: un piccolo server OSC locale riceve messaggi da
TouchDesigner (es. parametri generati dai suoi network generativi — palette,
intensità, preset) e li ripubblica su MQTT sotto `gaia/touchdesigner/{path}`,
così Node-RED (o qualunque altro consumatore) può reagirci come a qualsiasi
altro topic del sistema, senza sapere nulla di OSC.

Non è un servizio critico: se TouchDesigner non è acceso, il bridge continua
a girare e a riprovare la connessione WS; se il bridge stesso è giù, il resto
del sistema Gaia non ne risente (nessun altro componente dipende da questo).
"""
import json
import re
import socket
import threading
import time

import websocket
from pythonosc.udp_client import SimpleUDPClient
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import ThreadingOSCUDPServer
import paho.mqtt.client as mqtt

import config

_SANITIZE_RE = re.compile(r'[^a-zA-Z0-9_]+')


def _sanitize(segment) -> str:
    return _SANITIZE_RE.sub('_', str(segment)).strip('_') or '_'


def _flatten(prefix, value, out):
    """Appiattisce dict/list annidati in coppie (indirizzo_osc, valore_scalare)."""
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}/{_sanitize(k)}", v, out)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            # Se l'elemento ha un name/id leggibile, usalo nell'indirizzo invece
            # dell'indice — più facile da mappare a mano nei network TouchDesigner.
            key = None
            if isinstance(item, dict):
                key = item.get('name') or item.get('id')
            _flatten(f"{prefix}/{_sanitize(key) if key else i}", item, out)
    elif value is None:
        return
    elif isinstance(value, bool):
        out.append((prefix, 1 if value else 0))
    elif isinstance(value, (int, float, str)):
        out.append((prefix, value))
    # altri tipi (non attesi nel payload Gaia) vengono ignorati silenziosamente


class GaiaToTouchDesigner:
    """WS client → OSC out.

    La WS può ricevere aggiornamenti molto più spesso di quanto un network
    generativo debba consumarli (vedi nota in config.py) — `_on_message` si
    limita a tenere in memoria l'ultimo payload ricevuto; un thread separato
    (`_sender_loop`) lo appiattisce e lo manda via OSC a ritmo fisso
    (`config.SEND_INTERVAL_S`), disaccoppiando il rate di arrivo da quello
    di invio. Riconnessione WS automatica con backoff.
    """

    def __init__(self):
        self._osc = SimpleUDPClient(config.TD_OSC_HOST, config.TD_OSC_PORT)
        self._stop = False
        self._lock = threading.Lock()
        self._latest_payload = None

    def _on_message(self, _ws, message):
        try:
            payload = json.loads(message)
        except (json.JSONDecodeError, TypeError):
            return
        with self._lock:
            self._latest_payload = payload

    def _sender_loop(self):
        while not self._stop:
            time.sleep(config.SEND_INTERVAL_S)
            with self._lock:
                payload = self._latest_payload
                self._latest_payload = None
            if payload is None:
                continue
            pairs = []
            _flatten("/gaia", payload, pairs)
            for address, value in pairs:
                try:
                    self._osc.send_message(address, value)
                except OSError:
                    pass  # TouchDesigner non in ascolto — non bloccare il resto

    def run(self):
        threading.Thread(target=self._sender_loop, daemon=True).start()
        backoff = 1
        while not self._stop:
            try:
                ws = websocket.WebSocketApp(
                    config.GAIA_WS_URL,
                    on_message=self._on_message,
                )
                print(f"[TD-Bridge] Connesso a {config.GAIA_WS_URL} → OSC "
                      f"{config.TD_OSC_HOST}:{config.TD_OSC_PORT} "
                      f"(ogni {config.SEND_INTERVAL_S * 1000:.0f}ms)")
                backoff = 1
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                print(f"[TD-Bridge] Errore WS: {e}")
            if self._stop:
                break
            print(f"[TD-Bridge] Riconnessione tra {backoff}s...")
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)

    def stop(self):
        self._stop = True


class TouchDesignerToGaia:
    """Server OSC locale → relay MQTT. Ogni indirizzo /gaia/td/... entrante
    diventa un publish su gaia/touchdesigner/<resto-del-path>."""

    def __init__(self):
        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self._mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, keepalive=60)
        self._mqtt.loop_start()

    def _default_handler(self, address, *args):
        topic_suffix = address.strip('/')
        if topic_suffix.startswith('gaia/td/'):
            topic_suffix = topic_suffix[len('gaia/td/'):]
        elif topic_suffix.startswith('gaia/'):
            topic_suffix = topic_suffix[len('gaia/'):]
        topic = f"{config.MQTT_TD_TOPIC_BASE}/{topic_suffix}"
        payload = args[0] if len(args) == 1 else list(args)
        try:
            self._mqtt.publish(topic, json.dumps(payload))
            print(f"[TD-Bridge] TouchDesigner → MQTT {topic} = {payload}")
        except Exception as e:
            print(f"[TD-Bridge] Errore publish MQTT: {e}")

    def build_server(self):
        dispatcher = Dispatcher()
        dispatcher.set_default_handler(self._default_handler)
        server = ThreadingOSCUDPServer(("0.0.0.0", config.OSC_IN_PORT), dispatcher)
        # TouchDesigner può mandare raffiche di molti messaggi in pochi ms (es. un
        # loop che itera un intero set di parametri) — il buffer di ricezione di
        # default del socket è troppo piccolo per assorbirle, e i pacchetti in
        # eccesso vengono scartati dal kernel prima ancora di arrivare qui
        # (visto: 174 drop su /proc/net/udp con 0 messaggi consegnati all'app).
        server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
        print(f"[TD-Bridge] In ascolto OSC da TouchDesigner su UDP {config.OSC_IN_PORT}")
        return server


def main():
    td_to_gaia = TouchDesignerToGaia()
    server = td_to_gaia.build_server()
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    gaia_to_td = GaiaToTouchDesigner()
    try:
        gaia_to_td.run()
    except KeyboardInterrupt:
        gaia_to_td.stop()
        server.shutdown()


if __name__ == "__main__":
    main()
