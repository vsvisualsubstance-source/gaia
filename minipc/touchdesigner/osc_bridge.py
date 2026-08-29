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
import urllib.request

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


_TD_METRICS_USED = ("activeLights", "activePeople", "averageLight")


def _scope_for_td(payload):
    """Filtra il payload WS grezzo (canale 1, ~1900+ indirizzi appiattiti,
    9474 canali live lato TD secondo la verifica di TD/Mac 2026-08-08,
    GAIA_INTERFACE.md 'Core, 8'/'TD/Mac, 2') a ciò che TD legge davvero:
    people/* (legenda persone), rooms/*/objects/* (legenda oggetti YOLO per
    stanza), 3 valori in metrics/* (glow ambientale della sfera). Verificato
    da TD cercando OGNI riferimento a oscin1 nel progetto, non a occhio —
    tutto il resto del flatten grezzo non ha nessun consumer. Riduce il
    lavoro di serializzazione qui E l'ingest lato TD (Time Sliced su
    migliaia di canali dinamici per una manciata usati). Se in futuro TD
    inizia a leggere altri campi del flatten grezzo, aggiungerli qui --
    il canale 2 curato (/gaia/canvas/...) resta la via preferita per dati
    nuovi, questo canale 1 è ormai solo compatibilità per i 3 gruppi sopra."""
    metrics = payload.get("metrics") or {}
    rooms = payload.get("rooms") or []
    lights = payload.get("lights") or []
    stats = payload.get("stats") or {}
    return {
        "people": payload.get("people", []),
        "rooms": [
            {
                "id": r.get("id"),
                "objects": r.get("objects", {}),
                "persons_count": r.get("persons_count", 0),
            }
            for r in rooms
            if r.get("id")
        ],
        "metrics": {k: metrics[k] for k in _TD_METRICS_USED if k in metrics},
        # gaia/soul/*, gaia/lights/*/{brightness,power,motion}, gaia/stats/
        # totalPeopleCount, rooms/*/persons_count -- trovati da TD/Mac dopo
        # "Core, 9" con errori di cook ATTIVI in produzione (non solo un
        # effetto invisibile): select CHOP referenziano oscin1 via il
        # parametro `chops` (riferimento a operatore, non testo/espressione),
        # invisibili alla ricerca testuale usata per l'audit originale
        # "TD/Mac, 2". Vedi GAIA_INTERFACE.md "TD/Mac, 5" per la lista
        # completa verificata. Lights: mandiamo tutte (non solo le 22 usate
        # da TD oggi) per non dipendere da un elenco nomi che può cambiare
        # lato OpenHAB -- filtriamo solo i 3 campi usati, non l'intero
        # oggetto luce (colore/colorTemp/alert/lastUpdate scartati).
        "soul": payload.get("soul"),
        "stats": {"totalPeopleCount": stats.get("totalPeopleCount", 0)},
        "lights": [
            {
                "id": l.get("id"),
                "brightness": l.get("brightness"),
                "power": l.get("power"),
                "motion": l.get("motion"),
            }
            for l in lights
            if l.get("id")
        ],
        # gaia/vision/rooms/*/mediapipe(Active) -- letto da script_mediapipe_agg
        # in TD per la sfera reattiva al sorriso (uSmile in soul_geo). Mancava
        # in questa lista, verificato da TD/Mac dal vivo dopo il primo filtro
        # (GAIA_INTERFACE.md "TD/Mac, 4") -- non era nell'audit originale
        # "TD/Mac, 2", che aveva verificato solo rooms/*/objects/*. payload.vision
        # è un mirror di payload.rooms (stessi dati, namespace diverso usato da
        # questo script specifico), quindi si ricostruisce da `rooms` qui invece
        # di aggiungere l'intero payload.vision (che ha anche people/emotions/
        # events/lastUpdate ridondanti con altri campi già mandati altrove).
        "vision": {
            "rooms": [
                {
                    "id": r.get("id"),
                    "mediapipeActive": r.get("mediapipeActive", False),
                    "mediapipe": r.get("mediapipe"),
                }
                for r in rooms
                if r.get("id")
            ],
        },
    }


def _cleared_value(value):
    """Valore "svuotato" dello stesso tipo di `value` — per azzerare un
    canale invece di lasciarlo bloccato sull'ultimo valore per sempre."""
    if isinstance(value, str):
        return ""
    return 0


class TDDeviceRegistry:
    """Scopre le istanze TD vive via lo stesso Device Registry MQTT usato
    dal mocap diretto (pi/mediapipe/mediapipe_node.py, canale 2) — nessun
    IP fisso in config: ogni TD che si annuncia (gaia/device/+/status,
    role=="touchdesigner") entra nella lista dei destinatari; una che
    smette di mandare heartbeat (OFFLINE_AFTER_S) ne esce da sola, stesso
    timeout usato da Pi Manager per marcare un device offline.

    Trovato dal vivo il 2026-08-06: con TD_OSC_HOST fisso in config, aperta
    una seconda istanza TD su un'altra macchina, solo la prima (quella
    scritta in config) riceveva il feed — l'altra restava muta senza nessun
    errore visibile. Stesso identico bug del mocap diretto, sistemato il
    giorno prima con lo stesso pattern.

    Pausa/ripresa per istanza (aggiunto lo stesso giorno, su richiesta):
    Pi Manager (web/admin.html) pubblica su gaia/td-bridge/command per
    sospendere il feed verso UNA istanza specifica senza fermare il bridge
    per le altre — utile per silenziare temporaneamente un'installazione
    mentre resta collegata (annunciarsi ancora, solo senza ricevere dati).
    Lo stato (compresi i target in pausa, altrimenti invisibili una volta
    esclusi da live_ips()) va su gaia/td-bridge/status, retained — quel
    che consuma Pi Manager per disegnare la sezione con i pulsanti."""

    OFFLINE_AFTER_S = 90
    # Pulizia automatica dei retained di un device sparito per davvero
    # (2026-08-27, su richiesta esplicita dopo che le prove DMX di una sera
    # avevano lasciato 6+ device_id orfani sul broker, puliti a mano) --
    # soglia MOLTO più lunga di OFFLINE_AFTER_S apposta: un rig spento per
    # la notte (TD chiuso, laptop in sospensione) non deve perdere la sua
    # dmx_matrix/patchdeck_matrix (configurazione/calibrazione vera, non
    # solo un heartbeat) solo perché è stato silente per un weekend breve.
    REAP_AFTER_S  = 48 * 3600
    STATUS_TOPIC  = "gaia/td-bridge/status"
    COMMAND_TOPIC = "gaia/td-bridge/command"

    def __init__(self):
        self._targets = {}   # device_id -> {"ip","name","stanza","last_seen","paused"}
        self._lock = threading.Lock()
        self._alerted_offline = set()   # device_id già segnalati offline — evita spam ripetuto
        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id="gaia-td-discovery")
        self._mqtt.on_connect = self._on_connect
        self._mqtt.on_message = self._on_message
        self._mqtt.reconnect_delay_set(min_delay=2, max_delay=30)
        self._mqtt.connect(config.MQTT_HOST, config.MQTT_PORT, keepalive=60)
        self._mqtt.loop_start()
        # Watchdog SEPARATO dal cook di TD apposta (2026-08-06, su richiesta
        # dopo che l'agent dentro TD si è bloccato due volte in produzione —
        # heartbeat fermo, nessun errore visibile finché qualcuno non se ne
        # accorge da solo): un self-check dentro TD condividerebbe lo stesso
        # destino di ciò che deve controllare (se il cook si blocca, si
        # blocca anche lui). Questo gira sul Core, guarda solo MQTT dal di
        # fuori — non può bloccarsi insieme a TD.
        threading.Thread(target=self._watchdog_loop, daemon=True).start()

    def _watchdog_loop(self):
        while True:
            time.sleep(30)
            self._check_offline_transitions()
            self._reap_stale()

    # Famiglia di topic retained che un device del canale 4+5 (Pi-Manager +
    # Device Registry) può aver pubblicato -- pulire un topic mai esistito
    # è un no-op innocuo lato mosquitto, quindi si cancellano tutti senza
    # bisogno di sapere a priori se questo device era DMX/PatchDeck/altro.
    _REAP_TOPIC_SUFFIXES = (
        "device/{id}/status", "devices/{id}/announce", "devices/{id}/config",
        "devices/{id}/profile", "devices/{id}/dmx_matrix",
        "devices/{id}/patchdeck_matrix",
    )

    def _forget_from_registry(self, device_id):
        """Pulire i retained MQTT non basta: il Device Registry di Node-RED
        (brain.devices, quello dietro GET /gaia/devices/profiles) è uno
        stato SEPARATO, popolato via announce/profile — un retained vuoto
        fallisce il parsing lato Node-RED e viene ignorato in silenzio,
        quindi il reap qui sopra puliva il broker ma lasciava il device
        per sempre nel registry (dati sporchi permanenti, trovato dal vivo
        2026-08-29 dopo una sessione di pulizia manuale). POST /gaia/device/
        forget (già esistente, usato anche da Admin) chiude il cerchio.
        Best-effort: se Node-RED è giù in questo momento non deve bloccare
        né far fallire il reap MQTT, che resta comunque valido da solo."""
        url = f"http://{config.GAIA_WS_HOST}:{config.GAIA_WS_PORT}/gaia/device/forget"
        body = json.dumps({"device_id": device_id, "force": True}).encode()
        req = urllib.request.Request(url, data=body,
                                      headers={"Content-Type": "application/json"},
                                      method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
        except Exception as e:
            print(f"[TD-Bridge] REAP: forget da Node-RED fallito per {device_id}: {e}")

    def _reap_stale(self):
        now = time.time()
        with self._lock:
            snapshot = {k: dict(v) for k, v in self._targets.items()}
        reaped_any = False
        for device_id, t in snapshot.items():
            age = now - t["last_seen"]
            if age <= self.REAP_AFTER_S:
                continue
            name = t.get("name") or device_id
            for suffix in self._REAP_TOPIC_SUFFIXES:
                self._mqtt.publish(f"gaia/{suffix.format(id=device_id)}",
                                    payload=None, qos=1, retain=True)
            self._forget_from_registry(device_id)
            with self._lock:
                self._targets.pop(device_id, None)
            self._alerted_offline.discard(device_id)
            reaped_any = True
            hours = round(age / 3600)
            self._notify(f"🧹 TouchDesigner \"{name}\" ({device_id}) silente da {hours}h "
                         f"— retained ripuliti dal broker (soglia {self.REAP_AFTER_S // 3600}h).")
            print(f"[TD-Bridge] REAP: {device_id} ripulito dopo {hours}h di silenzio")
        if reaped_any:
            self._publish_status()

    def _check_offline_transitions(self):
        now = time.time()
        with self._lock:
            snapshot = {k: dict(v) for k, v in self._targets.items()}
        for device_id, t in snapshot.items():
            is_offline = (now - t["last_seen"]) > self.OFFLINE_AFTER_S
            was_alerted = device_id in self._alerted_offline
            name = t.get("name") or device_id
            if is_offline and not was_alerted:
                self._alerted_offline.add(device_id)
                self._notify(f"⚠️ TouchDesigner \"{name}\" ({device_id}) non risponde da oltre "
                             f"{self.OFFLINE_AFTER_S}s — probabile blocco interno (l'agent dentro "
                             f"TD si è impallato, non la macchina).")
                print(f"[TD-Bridge] ALERT: {device_id} offline")
            elif not is_offline and was_alerted:
                self._alerted_offline.discard(device_id)
                self._notify(f"✅ TouchDesigner \"{name}\" ({device_id}) di nuovo attiva.")
                print(f"[TD-Bridge] RECOVERY: {device_id} online")

    def _notify(self, text):
        self._mqtt.publish("gaia/notify/telegram", json.dumps({"text": text}))

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        client.subscribe("gaia/device/+/status", qos=0)
        client.subscribe(self.COMMAND_TOPIC, qos=0)

    def _on_message(self, client, userdata, msg):
        if msg.topic == self.COMMAND_TOPIC:
            self._handle_command(msg.payload)
            return
        try:
            d = json.loads(msg.payload)
        except (json.JSONDecodeError, TypeError):
            return
        if d.get("role") != "touchdesigner":
            return
        ip, device_id = d.get("ip"), d.get("device_id")
        if not ip or not device_id:
            return
        # Timestamp del MESSAGGIO (embedded, in ms), non l'orario di
        # ricezione locale: un riavvio di questo servizio fa consegnare
        # subito l'ultimo messaggio RETAINED di ogni device (anche se
        # vecchio di ore) come se fosse appena arrivato — con time.time()
        # qui, un device gia' morto risulterebbe "appena visto" al riavvio
        # del bridge, vanificando il watchdog per i primi OFFLINE_AFTER_S
        # secondi dopo ogni restart.
        raw_ts = d.get("ts")
        last_seen = raw_ts / 1000 if isinstance(raw_ts, (int, float)) and raw_ts > 0 else time.time()
        with self._lock:
            is_new = device_id not in self._targets
            paused = self._targets.get(device_id, {}).get("paused", False)
            self._targets[device_id] = {
                "ip": ip, "name": d.get("name") or device_id,
                "stanza": d.get("stanza"), "last_seen": last_seen,
                "paused": paused,
            }
        if is_new:
            print(f"[TD-Bridge] Nuova istanza TD scoperta: {device_id} → {ip}")
        self._publish_status()

    def _handle_command(self, payload):
        try:
            cmd = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            return
        device_id, action = cmd.get("device_id"), cmd.get("action")
        if not device_id or action not in ("pause", "resume"):
            return
        with self._lock:
            if device_id not in self._targets:
                return
            self._targets[device_id]["paused"] = (action == "pause")
        print(f"[TD-Bridge] {device_id}: {'in pausa' if action == 'pause' else 'ripreso'}")
        self._publish_status()

    def _publish_status(self):
        now = time.time()
        with self._lock:
            targets = {
                device_id: {
                    "ip": t["ip"], "name": t["name"], "stanza": t["stanza"],
                    "paused": t["paused"],
                    "offline": (now - t["last_seen"]) > self.OFFLINE_AFTER_S,
                }
                for device_id, t in self._targets.items()
            }
        self._mqtt.publish(self.STATUS_TOPIC, json.dumps({"targets": targets}), retain=True)

    def live_ips(self):
        now = time.time()
        with self._lock:
            return sorted({t["ip"] for t in self._targets.values()
                            if not t["paused"] and now - t["last_seen"] < self.OFFLINE_AFTER_S})


class TDFanoutClient:
    """Sostituto drop-in di un singolo SimpleUDPClient (stessa interfaccia
    send_message usata da OscAddressTracker): manda ogni messaggio a TUTTE
    le istanze TD vive secondo TDDeviceRegistry, stessa porta per tutte
    (ognuna sulla propria macchina — nessun conflitto)."""

    def __init__(self, registry, port):
        self._registry = registry
        self._port = port
        self._clients = {}   # ip -> SimpleUDPClient

    def send_message(self, address, value):
        for ip in self._registry.live_ips():
            client = self._clients.get(ip)
            if client is None:
                client = SimpleUDPClient(ip, self._port)
                self._clients[ip] = client
            try:
                client.send_message(address, value)
            except OSError:
                pass  # quella specifica istanza non risponde — non bloccare le altre


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

    def __init__(self, registry):
        self._osc = TDFanoutClient(registry, config.TD_OSC_PORT)
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
            _flatten("/gaia", _scope_for_td(payload), pairs)
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
                      f"porta {config.TD_OSC_PORT} verso tutte le istanze TD vive "
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

    TUTTO questo feed (tick continuo + eventi) va sulla porta
    TD_EVENT_OSC_PORT, verso TUTTE le istanze TD vive (TDFanoutClient, non
    più un unico host fisso) — verificato campo per campo il 2026-08-04:
    ogni categoria del canvas (soul.mood, rooms.activity/emotion/pose/
    gesture, lights.color, bricks.variant/room/interfaces) ha almeno un
    valore testuale mischiato ai numeri, quindi non ha senso provare a
    separare "i numeri" dal resto — un OSC In CHOP (pensato per canali
    numerici continui) non digerisce bene nessuna di queste categorie.
    """

    def __init__(self, registry):
        self._event_osc = TDFanoutClient(registry, config.TD_EVENT_OSC_PORT)
        # Tutto il feed passa dal tracker (azzera stanze/oggetti/persone/
        # lexicon spariti) tranne gli eventi one-shot, bang per natura —
        # non hanno un "prima" con cui confrontarsi né vanno azzerati.
        self._tracker = OscAddressTracker(self._event_osc)
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
        print(f"[TD-Bridge] Canvas (tick + eventi, tutto testo+numeri) → OSC "
              f"porta {config.TD_EVENT_OSC_PORT} verso tutte le istanze TD vive, "
              f"/gaia/canvas/...")

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

    # Un solo registro condiviso (una sola subscribe a gaia/device/+/status)
    # — sia il flatten grezzo che il canvas mandano lo stesso feed a tutte
    # le istanze TD vive, ognuna sulla propria porta (7000/7001).
    td_registry = TDDeviceRegistry()
    gaia_to_td = GaiaToTouchDesigner(td_registry)
    canvas_to_td = GaiaCanvasToTouchDesigner(td_registry)
    try:
        gaia_to_td.run()
    except KeyboardInterrupt:
        gaia_to_td.stop()
        server.shutdown()


if __name__ == "__main__":
    main()
