#!/usr/bin/env python3
"""
GAIA ↔ MadMapper — bridge OSC↔MQTT, "family" nuova (2026-09, richiesta
esplicitamente per far crescere la libreria di integrazioni del progetto,
stesso principio già usato per DMX/PatchDeck su TouchDesigner: un device
che si annuncia su MQTT con `family`, una pagina web dedicata che lo
scopre da sola per quel campo — vedi web/madmapper.html, stesso schema
client-side di web/mixeraudio.html per `family === 'mixeraudio'`).

Processo SEPARATO da MadMapper.exe stesso (lanciato/monitorato come
servizio a parte da agent.py, vedi services.json) — stesso principio già
validato per il watchdog TD in osc_bridge.py: un self-check dentro l'app
controllata condividerebbe il suo stesso destino se si blocca.

COSA E' GENERICO OGGI, COSA E' PLACEHOLDER (letto dal vivo il giorno
del deploy, GAIA_INTERFACE-style — mai un'ipotesi non verificata spacciata
per certa):
  - Il relay OSC è completamente generico: qualunque indirizzo, in
    entrambe le direzioni. Nessun nome di parametro/superficie/scena
    hardcoded — esattamente come brain._tdFxParams non hardcoda mai i
    nomi FX di PatchDeck (stessa lezione, stessa sessione).
  - L'UNICA azione "named" è il blackout (/surfaces/*/opacity -> 0),
    perché è documentata ufficialmente da MadMapper (Help -> OSC Channels
    List / docs.madmapper.com) — sicura da costruire senza aver visto il
    progetto reale.
  - MADMAPPER_OSC_OUT_PORT/MADMAPPER_OSC_IN_PORT sono PLACEHOLDER — vanno
    confermati contro le preferenze OSC reali di MadMapper una volta
    online (Preferences -> OSC, o "Live Performance & Control").
  - Liveness: SOLO passiva (età dell'ultimo messaggio OSC ricevuto da
    MadMapper, esposta nello status) — NON dichiara MadMapper "morto" e
    non chiede mai un restart da sola. Non è confermato se MadMapper mandi
    traffico OSC spontaneo quando la scena è statica/inattiva: un
    trigger automatico su "silenzio OSC" rischierebbe falsi positivi
    (restart di un'istanza perfettamente viva, solo silenziosa) — peggio
    di nessun watchdog. Il riavvio automatico reale resta quello di
    agent.py sul PROCESSO (affidabile: se MadMapper.exe crasha, sparisce
    davvero). Da rafforzare più avanti se si conferma dal vivo che
    MadMapper risponde a una query OSC esplicita (il protocollo la
    supporta in teoria, "Get" — sintassi esatta da vedere coi propri
    occhi, stessa regola di sempre in questa sessione).
"""
import json
import os
import re
import socket
import sys
import threading
import time

import paho.mqtt.client as mqtt
from pythonosc.udp_client import SimpleUDPClient
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import ThreadingOSCUDPServer

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
DEVICE_ID = os.getenv("MADMAPPER_DEVICE_ID", f"madmapper-{socket.gethostname()}")
NAME      = os.getenv("MADMAPPER_NAME", "MadMapper")
STANZA    = os.getenv("MADMAPPER_STANZA", "palazzo-ducale")

# PLACEHOLDER -- confermare dal vivo (Preferences -> OSC in MadMapper).
MADMAPPER_HOST         = os.getenv("MADMAPPER_HOST", "127.0.0.1")
MADMAPPER_OSC_OUT_PORT = int(os.getenv("MADMAPPER_OSC_OUT_PORT", "8010"))
MADMAPPER_OSC_IN_PORT  = int(os.getenv("MADMAPPER_OSC_IN_PORT", "8011"))

HEARTBEAT_INTERVAL = 30
_SANITIZE_RE = re.compile(r'[^a-zA-Z0-9_]+')


def _sanitize(segment) -> str:
    return _SANITIZE_RE.sub('_', str(segment)).strip('_') or '_'


class MadMapperBridge:
    def __init__(self):
        self._osc_out = SimpleUDPClient(MADMAPPER_HOST, MADMAPPER_OSC_OUT_PORT)
        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=f"gaia-madmapper-bridge-{DEVICE_ID}")
        self._mqtt.on_connect = self._on_connect
        self._mqtt.on_message = self._on_message
        self._start_ts = time.monotonic()
        self._last_osc_in_ts = None
        self._last_osc_in_address = None

    # ── OSC → MQTT (MadMapper manda qualcosa) ──────────────────────────
    def _osc_default_handler(self, address, *args):
        self._last_osc_in_ts = time.monotonic()
        self._last_osc_in_address = address
        topic_suffix = _sanitize(address)
        topic = f"gaia/device/{DEVICE_ID}/osc_in/{topic_suffix}"
        payload = args[0] if len(args) == 1 else list(args)
        try:
            self._mqtt.publish(topic, json.dumps(payload))
        except Exception as e:
            print(f"[MadMapper-Bridge] Errore publish MQTT: {e}")

    def build_osc_server(self):
        dispatcher = Dispatcher()
        dispatcher.set_default_handler(self._osc_default_handler)
        server = ThreadingOSCUDPServer(("0.0.0.0", MADMAPPER_OSC_IN_PORT), dispatcher)
        # Stesso motivo del buffer allargato in osc_bridge.py TD: raffiche
        # di molti messaggi in pochi ms altrimenti perse silenziosamente.
        server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
        print(f"[MadMapper-Bridge] In ascolto OSC da MadMapper su UDP {MADMAPPER_OSC_IN_PORT}")
        return server

    # ── MQTT → OSC (comandi verso MadMapper) ───────────────────────────
    def _handle_command(self, cmd: dict):
        action = cmd.get("action", "")
        print(f"[MadMapper-Bridge] Comando: {cmd}")

        if action == "osc_set":
            address = cmd.get("address")
            value = cmd.get("value")
            if not address:
                return
            try:
                if isinstance(value, list):
                    self._osc_out.send_message(address, value)
                else:
                    self._osc_out.send_message(address, value)
            except OSError as e:
                print(f"[MadMapper-Bridge] Errore invio OSC: {e}")

        elif action == "blackout":
            # Unico indirizzo "named" -- documentato ufficialmente
            # (wildcard * su tutte le superfici), sicuro senza aver visto
            # il progetto reale.
            try:
                self._osc_out.send_message("/surfaces/*/opacity", 0)
                print("[MadMapper-Bridge] Blackout inviato (/surfaces/*/opacity = 0)")
            except OSError as e:
                print(f"[MadMapper-Bridge] Errore blackout: {e}")

        elif action == "status":
            pass  # solo forza un republish sotto

        else:
            print(f"[MadMapper-Bridge] Azione sconosciuta: {action}")

        self._publish_status()

    def _on_message(self, client, userdata, msg):
        try:
            cmd = json.loads(msg.payload)
        except (json.JSONDecodeError, TypeError):
            return
        threading.Thread(target=self._safe_handle_command, args=(cmd,), daemon=True).start()

    def _safe_handle_command(self, cmd):
        try:
            self._handle_command(cmd)
        except Exception as e:
            print(f"[MadMapper-Bridge] Errore gestendo comando {cmd}: {e}")

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            client.subscribe(f"gaia/device/{DEVICE_ID}/command")
            print(f"[MadMapper-Bridge] MQTT connesso — device_id: {DEVICE_ID}")
            self._publish_status()
        else:
            print(f"[MadMapper-Bridge] Connessione MQTT fallita rc={reason_code}")

    def _publish_status(self):
        last_age = None
        if self._last_osc_in_ts is not None:
            last_age = round(time.monotonic() - self._last_osc_in_ts, 1)
        payload = {
            "device_id": DEVICE_ID,
            "name": NAME,
            "stanza": STANZA,
            "role": "device",
            "family": "madmapper",
            "osc_out_target": f"{MADMAPPER_HOST}:{MADMAPPER_OSC_OUT_PORT}",
            "osc_in_port": MADMAPPER_OSC_IN_PORT,
            # Informativo, MAI usato per auto-restart (vedi docstring modulo
            # -- non e' confermato che MadMapper mandi traffico spontaneo a
            # riposo, un trigger automatico rischierebbe falsi positivi).
            "last_osc_in_age_s": last_age,
            "last_osc_in_address": self._last_osc_in_address,
            "uptime": int(time.monotonic() - self._start_ts),
            "ts": int(time.time() * 1000),
        }
        self._mqtt.publish(f"gaia/device/{DEVICE_ID}/status", json.dumps(payload), retain=True)

    def run(self):
        server = self.build_osc_server()
        threading.Thread(target=server.serve_forever, daemon=True).start()

        backoff = 5
        while True:
            try:
                self._mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
                break
            except OSError as e:
                print(f"[MadMapper-Bridge] Connessione MQTT fallita ({e}), riprovo tra {backoff}s")
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)
        self._mqtt.loop_start()

        while True:
            time.sleep(HEARTBEAT_INTERVAL)
            self._publish_status()


if __name__ == "__main__":
    MadMapperBridge().run()
