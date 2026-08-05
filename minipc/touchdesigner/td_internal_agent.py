"""
GAIA Device Agent — vive DENTRO il progetto TouchDesigner (Text DAT +
Execute DAT), non e' un processo di sistema esterno. Nessun manifest sul
filesystem, nessun path a TouchDesigner.exe: gira ovunque il .toe gira,
configurato con i parametri del componente che lo ospita e salvato nel
progetto stesso — portabile da una macchina all'altra senza toccare nulla
fuori dal .toe (ogni macchina puo' avere TD installato diversamente).

SETUP IN TD
1. Crea un COMP contenitore (es. "gaia_agent"). Customize Component ->
   aggiungi una Custom Page con questi parametri (tutti opzionali, se
   mancanti l'agent usa dei default sensati, vedi _read_config):
     Deviceid  (Str)  es. "td-herbarium"
     Stanza    (Str)  es. "salotto"
     Name      (Str)  es. "AV Herbarium"
     Mqtthost  (Str)  default 192.168.1.142
     Mqttport  (Int)  default 1883
2. Dentro quel COMP: un Text DAT chiamato "gaia_device_agent" — parametro
   File = path di QUESTO .py, "Sync to OS" ON cosi' TD ricarica da solo
   quando lo modifichi fuori da TD (repo git, editor esterno).
3. Un Execute DAT nello stesso COMP, sorgente attiva quel Text DAT:
       def onStart():
           op('gaia_device_agent').module.start()
           return
       def onExit():
           op('gaia_device_agent').module.stop()
           return

ESPORRE UN SERVIZIO REALE (facoltativo)
Senza fare nient'altro l'agent compare gia' in Admin (presenza + heartbeat,
"services" vuoto, i comandi restano no-op loggati). Per collegare un
controllo vero (es. "riavvia l'OSC In se si blocca"), da un TUO script di
progetto — questo file resta identico in ogni progetto, non editarlo qui:
    agent = op('gaia_agent/gaia_device_agent').module
    agent.register_service('osc_in',
        start=lambda: setattr(op('oscin1').par, 'active', 1),
        stop=lambda: setattr(op('oscin1').par, 'active', 0),
        status=lambda: bool(op('oscin1').par.active.eval()))

Stesso protocollo MQTT degli agent Pi/OPS (pi/agent/agent.py,
ops/agent/agent.py): gaia/device/{id}/status (retained, ogni 30s) +
comandi enable/disable/restart su gaia/device/{id}/command e
gaia/device/all/command.

NOTA: firma esatta di run()/comportamento di me nei thread verificati sulla
documentazione TD ma non testati dentro una vera istanza (nessuna qui
disponibile) — primo avvio da collaudare in TD, vedi README.
"""
import json
import threading
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None
    print("[GAIA Agent] paho-mqtt non installato nel Python di TD — "
          "pip install paho-mqtt nell'interprete usato da TouchDesigner.")

_client   = None
_running  = False
_start_ts = None
_my_path  = None          # path di questo Text DAT, catturato in start() (thread principale)
_services = {}             # name -> {"start": fn, "stop": fn, "status": fn}


def register_service(name, start=None, stop=None, status=None):
    """Chiamalo dal tuo script di progetto per esporre un controllo reale.
    status() deve restituire True/False (o None se sconosciuto)."""
    _services[name] = {"start": start, "stop": stop, "status": status}


def _read_config():
    host = me.parent()

    def par(name, default):
        try:
            v = host.par[name].eval()
            return v if v not in (None, "") else default
        except Exception:
            return default

    return {
        "device_id": par("Deviceid", f"td-{project.name}"),
        "stanza":    par("Stanza", "unknown"),
        "name":      par("Name", project.name),
        "mqtt_host": par("Mqtthost", "192.168.1.142"),
        "mqtt_port": int(par("Mqttport", 1883) or 1883),
    }


def _service_status(name):
    fn = _services.get(name, {}).get("status")
    if not fn:
        return "unknown"
    try:
        return "active" if fn() else "inactive"
    except Exception as e:
        print(f"[GAIA Agent] status({name}) errore: {e}")
        return "unknown"


def _publish_status():
    if _client is None:
        return
    cfg = _read_config()
    payload = {
        "device_id": cfg["device_id"],
        "name":      cfg["name"],
        "stanza":    cfg["stanza"],
        "role":      "touchdesigner",
        "services":  {n: _service_status(n) for n in _services},
        "uptime":    int(time.time() - _start_ts) if _start_ts else 0,
        "ts":        int(time.time() * 1000),
    }
    _client.publish(f"gaia/device/{cfg['device_id']}/status", json.dumps(payload), retain=True)


def _apply_command(cmd):
    # Chiamata SOLO via run() dal thread principale di TD (vedi
    # _on_message) — qui e' sicuro toccare op()/par, mai direttamente dal
    # thread di rete di paho-mqtt.
    action  = cmd.get("action", "")
    service = cmd.get("service", "")
    svc = _services.get(service)
    print(f"[GAIA Agent] Comando: {cmd}")

    if action in ("enable", "disable", "restart") and not svc:
        print(f"[GAIA Agent] Servizio '{service}' non registrato (register_service mai chiamato)")
    elif action == "enable" and svc.get("start"):
        svc["start"]()
    elif action == "disable" and svc.get("stop"):
        svc["stop"]()
    elif action == "restart" and svc:
        if svc.get("stop"):
            svc["stop"]()
        if svc.get("start"):
            svc["start"]()
    elif action == "status":
        pass
    else:
        print(f"[GAIA Agent] Azione ignorata: {action}")

    _publish_status()


def _on_message(client, userdata, msg):
    try:
        cmd = json.loads(msg.payload)
    except Exception as e:
        print(f"[GAIA Agent] Comando non valido: {e}")
        return
    if _my_path is None:
        return
    # Marshalling sul thread principale: mai mutare operatori dal thread
    # di rete di paho-mqtt (on_message gira li').
    run(f"op({_my_path!r}).module._apply_command(args[0])", cmd, delayFrames=1)


def _on_connect(client, userdata, flags, reason_code, properties=None):
    cfg = _read_config()
    if reason_code == 0:
        client.subscribe(f"gaia/device/{cfg['device_id']}/command")
        client.subscribe("gaia/device/all/command")
        print(f"[GAIA Agent] Connesso — device_id: {cfg['device_id']}")
        _publish_status()
    else:
        print(f"[GAIA Agent] Connessione MQTT fallita rc={reason_code}")


def _on_disconnect(client, userdata, rc, properties=None):
    if rc != 0:
        print(f"[GAIA Agent] Disconnesso (rc={rc})")


def _heartbeat_loop():
    while _running:
        try:
            _publish_status()
        except Exception as e:
            print(f"[GAIA Agent] Errore heartbeat: {e}")
        time.sleep(30)


def start():
    global _client, _running, _start_ts, _my_path
    if mqtt is None:
        return
    if _running:
        return
    _my_path = me.path
    cfg = _read_config()
    _running  = True
    _start_ts = time.time()
    _client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gaia-td-{cfg['device_id']}")
    _client.on_connect    = _on_connect
    _client.on_disconnect = _on_disconnect
    _client.on_message    = _on_message
    _client.connect_async(cfg["mqtt_host"], cfg["mqtt_port"], 60)
    _client.loop_start()
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    print(f"[GAIA Agent] Avviato ({cfg['device_id']} @ {cfg['mqtt_host']}:{cfg['mqtt_port']})")


def stop():
    global _client, _running
    _running = False
    if _client:
        _client.loop_stop()
        _client.disconnect()
        _client = None
    print("[GAIA Agent] Fermato.")
