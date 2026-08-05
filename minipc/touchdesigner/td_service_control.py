"""
GAIA Service Control — play/stop/restart dei servizi base dei device
(Pi, OPS, Core) nativamente dentro TouchDesigner. Stesso ruolo di Pi
Manager in web/admin.html, stesso protocollo MQTT, ma qui TD e' il
CONTROLLORE: ascolta gli status di TUTTI i device (gaia/device/+/status)
e puo' inviare comandi enable/disable/restart a ciascuno.

Complementare a td_internal_agent.py (che invece fa comparire QUESTA
istanza TD come UN device controllabile) — i due possono coesistere nello
stesso progetto senza conflitti, sono moduli indipendenti.

SETUP IN TD
1. COMP contenitore (es. "gaia_control"), Custom Page opzionale con
   Mqtthost (Str, default 192.168.1.142) / Mqttport (Int, default 1883).
2. Un Table DAT vuoto chiamato "devices_table" nello stesso COMP — questo
   script lo riscrive ogni volta che arriva uno status (una riga per
   coppia device+servizio: device_id, name, stanza, role, service, state,
   offline). Bind diretto per un List COMP: e' il modo piu' naturale in TD
   per fare una UI a righe con bottoni play/stop.
3. Text DAT "td_service_control" con QUESTO file come sorgente esterna
   (Sync to OS ON).
4. Execute DAT nello stesso COMP:
       def onStart():
           op('td_service_control').module.start()
           return
       def onExit():
           op('td_service_control').module.stop()
           return
5. Per i bottoni play/stop/restart (Button COMP, List COMP onClick, ecc.),
   chiama semplicemente:
       op('gaia_control/td_service_control').module.send_command(
           device_id, service_name, 'enable')   # o 'disable' / 'restart'
   send_command() e' sicura da chiamare direttamente da un callback UI
   (gira gia' sul thread principale di TD) — nessun marshalling necessario
   li', a differenza della ricezione degli status (che arrivano dal thread
   di rete MQTT e vengono scritti nella tabella via run(), mai in diretta).

STATI: "active" / "inactive" / "failed" — stessi valori pubblicati dagli
agent Pi/OPS/local_agent, nessuna traduzione. offline=True se il device
non manda status da piu' di OFFLINE_AFTER_S secondi (stesso timeout di
Pi Manager, 90s).

NOTA: run()/Table DAT verificati sulla docstring/API TD ma non testati
dentro una vera istanza (nessuna disponibile qui) — collaudare al primo
avvio, vedi README.
"""
import json
import threading
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None
    print("[GAIA Service Control] paho-mqtt non installato nel Python di TD.")

OFFLINE_AFTER_S = 90
HEARTBEAT_CHECK_S = 10

_client   = None
_running  = False
_my_path  = None
_devices  = {}   # device_id -> {status..., "_last_seen": float}
_lock     = threading.Lock()


def _read_config():
    host = me.parent()

    def par(name, default):
        try:
            v = host.par[name].eval()
            return v if v not in (None, "") else default
        except Exception:
            return default

    return {
        "mqtt_host": par("Mqtthost", "192.168.1.142"),
        "mqtt_port": int(par("Mqttport", 1883) or 1883),
    }


def get_devices():
    """Snapshot corrente device_id -> ultimo payload status ricevuto."""
    with _lock:
        return {k: dict(v) for k, v in _devices.items()}


def send_command(device_id, service, action):
    """Chiamala da un Button/List COMP: play='enable', stop='disable',
    restart='restart'. Sicura da un callback UI (thread principale)."""
    if _client is None:
        print("[GAIA Service Control] non connesso, comando ignorato")
        return
    _client.publish(
        f"gaia/device/{device_id}/command",
        json.dumps({"action": action, "service": service}),
    )


def _svc_keys(d):
    keys = list((d.get("services") or {}).keys())
    for k in (d.get("config") or {}):
        if k not in keys:
            keys.append(k)
    return keys


def _rebuild_table():
    # Chiamata SOLO via run() sul thread principale — mai direttamente dal
    # thread di rete MQTT (scrivere in un Table DAT e' una mutazione TD).
    table = me.parent().op("devices_table")
    if table is None:
        print("[GAIA Service Control] Table DAT 'devices_table' non trovata (vedi setup nel README)")
        return
    table.clear()
    table.appendRow(["device_id", "name", "stanza", "role", "service", "state", "offline"])
    now = time.time()
    with _lock:
        devices = dict(_devices)
    for device_id, d in sorted(devices.items()):
        offline = (now - d.get("_last_seen", 0)) > OFFLINE_AFTER_S
        keys = _svc_keys(d) or [""]
        for svc in keys:
            state = (d.get("services") or {}).get(svc, "unknown")
            table.appendRow([
                device_id, d.get("name") or d.get("stanza") or device_id,
                d.get("stanza", ""), d.get("role", ""), svc, state, str(offline),
            ])


def _on_message(client, userdata, msg):
    try:
        d = json.loads(msg.payload)
    except Exception as e:
        print(f"[GAIA Service Control] Status non valido: {e}")
        return
    device_id = d.get("device_id")
    if not device_id:
        return
    d["_last_seen"] = time.time()
    with _lock:
        _devices[device_id] = d
    if _my_path:
        run(f"op({_my_path!r}).module._rebuild_table()", delayFrames=1)


def _on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        client.subscribe("gaia/device/+/status")
        print("[GAIA Service Control] Connesso, in ascolto su gaia/device/+/status")
    else:
        print(f"[GAIA Service Control] Connessione MQTT fallita rc={reason_code}")


def _on_disconnect(client, userdata, rc, properties=None):
    if rc != 0:
        print(f"[GAIA Service Control] Disconnesso (rc={rc})")


def _staleness_loop():
    while _running:
        time.sleep(HEARTBEAT_CHECK_S)
        if _my_path:
            run(f"op({_my_path!r}).module._rebuild_table()", delayFrames=1)


def start():
    global _client, _running, _my_path
    if mqtt is None:
        return
    if _running:
        return
    _my_path = me.path
    cfg = _read_config()
    _running = True
    _client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-td-control-{int(time.time())}")
    _client.on_connect    = _on_connect
    _client.on_disconnect = _on_disconnect
    _client.on_message    = _on_message
    _client.connect_async(cfg["mqtt_host"], cfg["mqtt_port"], 60)
    _client.loop_start()
    threading.Thread(target=_staleness_loop, daemon=True).start()
    print(f"[GAIA Service Control] Avviato ({cfg['mqtt_host']}:{cfg['mqtt_port']})")


def stop():
    global _client, _running
    _running = False
    if _client:
        _client.loop_stop()
        _client.disconnect()
        _client = None
    print("[GAIA Service Control] Fermato.")
