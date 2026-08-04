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


def _cleared_value(value):
    """Valore "svuotato" dello stesso tipo di `value` — per azzerare un
    canale invece di lasciarlo bloccato sull'ultimo valore per sempre."""
    if isinstance(value, str):
        return ""
    return 0


class OscAddressTracker:
    """Ricorda gli indirizzi mandati nel giro precedente e azzera quelli
    che spariscono nel giro corrente (persona/oggetto non più presente).

    Gotcha OSC/TD: non esiste un messaggio "elimina questo canale" — un
    OSC In CHOP tiene l'ultimo valore ricevuto per sempre. Se Gaia smette
    di mandare /gaia/people/Mauro/confidence perché Mauro è uscito, senza
    questo tracker quel canale resta bloccato al suo ultimo valore (es.
    0.77) anche ore dopo — visto dal vivo: "Ospiti" fittizi e persone
    uscite da tempo ancora "presenti" secondo TD, con la WS di Gaia già
    correttamente vuota. Ogni feed continuo (non gli eventi one-shot, che
    sono bang per natura) deve avere il proprio tracker indipendente."""

    def __init__(self, osc_client):
        self._osc = osc_client
        self._prev = {}

    def send(self, pairs):
        current = dict(pairs)
        for address, value in current.items():
            try:
                self._osc.send_message(address, value)
            except OSError:
                pass  # TouchDesigner non in ascolto — non bloccare il resto
        for address in (self._prev.keys() - current.keys()):
            try:
                self._osc.send_message(address, _cleared_value(self._prev[address]))
            except OSError:
                pass
        self._prev = current


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
        self._tracker = OscAddressTracker(self._osc)

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
            self._tracker.send(pairs)

    def run(self):
        threading.Thread(target=self._sender_loop, daemon=True).start()
        backoff = 1
        while not self._stop:
            connected_at = None

            def on_open(_ws):
                nonlocal connected_at
                connected_at = time.time()
                print(f"[TD-Bridge] Connesso a {config.GAIA_WS_URL} → OSC "
                      f"{config.TD_OSC_HOST}:{config.TD_OSC_PORT} "
                      f"(ogni {config.SEND_INTERVAL_S * 1000:.0f}ms)")

            try:
                ws = websocket.WebSocketApp(
                    config.GAIA_WS_URL,
                    on_message=self._on_message,
                    on_open=on_open,
                )
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                print(f"[TD-Bridge] Errore WS: {e}")
            if self._stop:
                break
            # run_forever() puo' ritornare pulito (senza eccezioni) anche se
            # la connessione non si e' mai stabilita o e' caduta subito dopo
            # (visto dopo un riavvio di Node-RED: loop di riconnessione ogni
            # ~1s all'infinito). Resetta il backoff solo se la sessione e'
            # durata abbastanza da essere considerata riuscita davvero.
            if connected_at and (time.time() - connected_at) > 3:
                backoff = 1
            else:
                backoff = min(backoff * 2, 30)
            print(f"[TD-Bridge] Riconnessione tra {backoff}s...")
            time.sleep(backoff)

    def stop(self):
        self._stop = True


class GaiaCanvasToTouchDesigner:
    """MQTT (gaia/td/canvas, gaia/td/canvas/event/#) → OSC out, sotto
    /gaia/canvas/... — feed curato apposta per TD (mood+palette, oggetti
    YOLO con seed deterministico per il disegno astratto, luci pulite per
    DMX, mattoni, lessico, sogno), costruito in Node-RED ("Build TD
    Canvas", tab Gaia Engine) e ben più piccolo del flatten grezzo
    dell'intero payload dashboard (~1900 indirizzi su /gaia/...).

    A differenza di GaiaToTouchDesigner non serve disaccoppiare rate di
    arrivo e di invio: il canvas continuo ticka ogni 2s (non migliaia di
    volte al secondo come la WS grezza), e gli eventi one-shot
    (level_up, dream_new, face_enrolled, person_recognized...) vanno
    mandati subito, non in un batch a intervalli — quindi si invia
    direttamente da _on_message.

    Gli eventi vanno su una porta SEPARATA (event_osc_client, di norma
    TD_EVENT_OSC_PORT) dal tick continuo (osc_client, TD_OSC_PORT):
    mischiano stringhe e numeri nello stesso messaggio, un OSC In CHOP
    pensato per canali numerici continui non li gestisce bene — su una
    porta a parte TD può puntarci un OSC In DAT dedicato.
    """

    def __init__(self, osc_client, event_osc_client=None):
        self._osc = osc_client
        self._event_osc = event_osc_client or osc_client
        # Solo il tick continuo passa dal tracker (azzera stanze/oggetti/
        # persone spariti) — gli eventi one-shot sono bang per natura, non
        # hanno un "prima" con cui confrontarsi né vanno azzerati.
        self._tracker = OscAddressTracker(osc_client)
        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id="gaia-td-canvas-bridge")
        self._mqtt.on_connect = self._on_connect
        self._mqtt.on_message = self._on_message
        self._mqtt.reconnect_delay_set(min_delay=2, max_delay=30)
        self._mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, keepalive=60)
        self._mqtt.loop_start()

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        client.subscribe("gaia/td/canvas", qos=0)
        client.subscribe("gaia/td/canvas/event/#", qos=0)
        print(f"[TD-Bridge] Canvas: sottoscritto gaia/td/canvas → OSC "
              f"{config.TD_OSC_HOST}:{config.TD_OSC_PORT}/gaia/canvas/... "
              f"(soul/rooms/lights/bricks), eventi + lexicon/dream → OSC "
              f"{config.TD_OSC_HOST}:{config.TD_EVENT_OSC_PORT}/gaia/canvas/...")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload)
        except (json.JSONDecodeError, TypeError):
            return
        if msg.topic.startswith("gaia/td/canvas/event/"):
            event_name = _sanitize(msg.topic.rsplit('/', 1)[-1])
            prefix = f"/gaia/canvas/event/{event_name}"
            pairs = []
            _flatten(prefix, payload, pairs)
            for address, value in pairs:
                try:
                    self._event_osc.send_message(address, value)
                except OSError:
                    pass  # TouchDesigner non in ascolto — non bloccare il resto
            return
        # lexicon e dream sono testo (parole, mood come stringa) — stesso
        # problema di fondo degli eventi sopra, un OSC In CHOP sulla 7000
        # non li digerisce bene. Escono quindi sulla stessa porta eventi
        # (7001) invece che nel tick continuo tracciato.
        payload = dict(payload)
        text_fields = {}
        for key in ("lexicon", "dream"):
            if key in payload:
                text_fields[key] = payload.pop(key)
        if text_fields:
            text_pairs = []
            _flatten("/gaia/canvas", text_fields, text_pairs)
            for address, value in text_pairs:
                try:
                    self._event_osc.send_message(address, value)
                except OSError:
                    pass
        pairs = []
        _flatten("/gaia/canvas", payload, pairs)
        self._tracker.send(pairs)


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
    event_osc = SimpleUDPClient(config.TD_OSC_HOST, config.TD_EVENT_OSC_PORT)
    canvas_to_td = GaiaCanvasToTouchDesigner(gaia_to_td._osc, event_osc)
    try:
        gaia_to_td.run()
    except KeyboardInterrupt:
        gaia_to_td.stop()
        server.shutdown()


if __name__ == "__main__":
    main()
