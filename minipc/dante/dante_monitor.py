#!/usr/bin/env python3
"""
GAIA Dante Monitor — rileva se la rete audio Dante (Solaro QR1-UC + TCCM
Sennheiser) e' attiva osservando il traffico UDP del driver esterno
dell'utente (H/V Angle, Mic Level, Far End Audio, Camera Preset, Heartbeat
— vedi config.DANTE_PORTS). Pubblica DUE cose distinte:

  1. gaia/dante/status — blob generico invariato (solo presenza/vita della
     rete, nessuna decodifica), usato da mediaplayer/musica.html per
     decidere se l'uscita Dante ha senso. NON toccare lo schema, ha
     consumatori esistenti.
  2. gaia/device/{SOLARO_DEVICE_ID}/status — device vero nel registro
     standard (role:"device", family:"solaro", stesso schema di
     madmapper/dmx/patchdeck), COSI' compare in Pi Manager/admin.html
     come qualunque altro device invece di restare invisibile nel blob
     generico. Qui SI decodifica: ogni canale e' un numero ASCII puro
     senza framing (deciso 2026-07-30, vedi memoria project-solaro-dsp),
     un pacchetto = un valore intero, banale da leggere con int().
     Heartbeat (porta 4559) e' liveness pura del DSP stesso, separata
     dai canali di telemetria dell'array mic (4554-4558) -- un DSP
     "vivo" (heartbeat regolare) puo' comunque non avere nessuno che
     parla (H/V Angle fermi da secondi), sono due segnali diversi.

Nessun comando inviato AL Solaro in questo modulo -- solo ascolto. I
controlli reali (quali comandi accetta, es. via VISCA-over-IP 52381 gia'
confermato funzionante per i preset camera) vanno derivati dalla UI di
controllo del Solaro stesso quando si arriva a costruirli, non indovinati
qui (stessa regola gia' seguita per MadMapper/PatchDeck questa sessione).
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
_channel_raw: dict[int, tuple[int | None, float]] = {}  # porta -> (valore int o None se non decodificabile, ts)
_heartbeat_last_ts = 0.0


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


def _decode_ascii_int(raw: bytes) -> int | None:
    """Un pacchetto = un numero decimale ASCII puro, nessun framing (vedi
    docstring modulo). None se non e' quello che ci si aspetta -- il driver
    esterno e' ancora in sviluppo, un payload inatteso non deve far
    crashare il monitor, solo restare non decodificato per quel pacchetto."""
    try:
        return int(raw.decode("ascii").strip())
    except (UnicodeDecodeError, ValueError):
        return None


def _publish_solaro_device():
    now = time.time()
    heartbeat_age = round(now - _heartbeat_last_ts, 1) if _heartbeat_last_ts else None
    channels = {}
    for port, name in config.SOLARO_CHANNELS.items():
        val, ts = _channel_raw.get(port, (None, 0.0))
        if val is not None and (now - ts) < config.DANTE_TIMEOUT_S:
            channels[name] = val
    payload = {
        "device_id": config.SOLARO_DEVICE_ID,
        "name": "Solaro QR1-UC",
        "role": "device",
        "family": "solaro",
        "stanza": config.SOLARO_STANZA,
        # Liveness del DSP stesso (heartbeat, porta 4559) -- distinta dalla
        # telemetria dell'array mic sotto: il DSP puo' essere vivo e
        # silenzioso (nessuno parla) allo stesso tempo, sono due segnali
        # diversi (vedi docstring modulo).
        "last_heartbeat_age_s": heartbeat_age,
        "alive": heartbeat_age is not None and heartbeat_age < config.DANTE_TIMEOUT_S,
        # Telemetria array mic TCCM, solo i canali freschi (vedi filtro
        # sopra) -- assenti dal payload se scaduti, mai un valore stantio
        # spacciato per attuale.
        "channels": channels,
        # Confermato funzionante (memoria project-solaro-dsp, 2026-07-30):
        # comandi VISCA "Camera Memory Recall" verso la telecamera FollowMe.
        # Nessun comando inviato da qui -- solo dichiarato come capacita'
        # nota del sistema, i comandi reali restano da costruire quando
        # servono (vedi docstring modulo).
        "capabilities": {"ptz_visca_recall": True},
        # Blocco esplicito (2026-09-04, richiesto da TD/Mac via
        # GAIA_INTERFACE.md -- gaia_control_window mostrava questo device
        # con service=""/state="unknown" perche' il blocco mancava del
        # tutto, indistinguibile da un dato non arrivato): questo device
        # e' SOLO presenza/telemetria, nessun servizio avviabile/fermabile,
        # il vuoto qui e' intenzionale non un bug.
        "services": {},
        "config": {},
        "ts": int(now * 1000),
    }
    _mqtt.publish(f"gaia/device/{config.SOLARO_DEVICE_ID}/status", json.dumps(payload), retain=True)


def main():
    global _last_seen_ts, _heartbeat_last_ts
    sel = _open_sockets()
    _mqtt.connect_async(config.MQTT_HOST, config.MQTT_PORT, 60)
    _mqtt.loop_start()

    last_status = 0.0
    while _running:
        for key, _ in sel.select(timeout=0.5):
            sock = key.fileobj
            port = key.data
            try:
                raw, _addr = sock.recvfrom(4096)
            except OSError:
                continue
            now = time.time()
            _last_seen_ts = now
            _ports_seen[port] = now
            _channel_raw[port] = (_decode_ascii_int(raw), now)
            if port == config.SOLARO_HEARTBEAT_PORT:
                _heartbeat_last_ts = now

        now = time.time()
        if now - last_status >= config.STATUS_INTERVAL_S:
            last_status = now
            _publish_status()
            _publish_solaro_device()


if __name__ == "__main__":
    main()
