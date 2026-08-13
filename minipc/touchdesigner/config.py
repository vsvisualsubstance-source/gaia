import os


def _load_conf(path):
    cfg = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    cfg[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return cfg


_defaults = {
    # Sorgente dati: WebSocket già usata da dashboard/arte visiva (ThreeViewEngineGAME).
    # Default 'localhost' presume Node-RED sullo stesso host di questo bridge (Core).
    # Dal cutover 2026-08-08 Node-RED gira su OPS: in produzione va sovrascritto a
    # 192.168.1.240 via /etc/gaia/touchdesigner.conf (non versionato). Vedi
    # docs/core-distribuito.md ("Runtime attuale") e GAIA_TD_INTEGRATION.md canale 1.
    'GAIA_WS_HOST':      'localhost',
    'GAIA_WS_PORT':      '1880',
    'GAIA_WS_PATH':      '/gaia',

    # Uscita verso TouchDesigner (OSC In CHOP/DAT). NIENTE PIU' TD_OSC_HOST
    # (rimosso 2026-08-06): un IP fisso qui è andato stantio due volte in
    # produzione (mocap direttto e poi questo stesso bridge, entrambi
    # puntati a una macchina sbagliata/vecchia) — le destinazioni si
    # scoprono ora dal vivo via MQTT (TDDeviceRegistry in osc_bridge.py,
    # gaia/device/+/status, role=="touchdesigner"), una o più istanze
    # contemporaneamente, senza nessun valore da tenere aggiornato a mano.
    'TD_OSC_PORT':        '7000',
    # Porta SEPARATA per gli eventi one-shot (level_up, dream_new,
    # face_enrolled, person_recognized...): mischiano stringhe (nome,
    # stanza) e numeri (confidenza, timestamp) nello stesso messaggio, un
    # OSC In CHOP sulla 7000 (pensato per canali numerici continui) non li
    # digerisce bene. Su questa porta TD punta un OSC In DAT dedicato.
    'TD_EVENT_OSC_PORT':  '7001',
    # La WS di Gaia può aggiornarsi molto più spesso di quanto serva a un
    # network generativo (misurato: migliaia di broadcast/sec in certe
    # condizioni, non 1/sec come da documentazione originale) — il bridge
    # invia solo lo snapshot più recente ogni SEND_INTERVAL_MS, non ogni
    # messaggio WS in arrivo.
    'SEND_INTERVAL_MS':   '100',

    # Ingresso da TouchDesigner (OSC Out CHOP/DAT punta qui)
    'OSC_IN_PORT':        '9008',

    # Dati generati da TouchDesigner rientrano in Gaia via MQTT (Node-RED può sottoscriverli)
    'MQTT_HOST':          '192.168.1.142',
    'MQTT_PORT':          '1883',
    'MQTT_TD_TOPIC_BASE': 'gaia/touchdesigner',
}

_file_cfg = _load_conf('/etc/gaia/touchdesigner.conf')
_cfg = {**_defaults, **_file_cfg, **{k: os.environ[k] for k in _defaults if k in os.environ}}

GAIA_WS_HOST = _cfg['GAIA_WS_HOST']
GAIA_WS_PORT = int(_cfg['GAIA_WS_PORT'])
GAIA_WS_PATH = _cfg['GAIA_WS_PATH']
GAIA_WS_URL  = f"ws://{GAIA_WS_HOST}:{GAIA_WS_PORT}{GAIA_WS_PATH}"

TD_OSC_PORT = int(_cfg['TD_OSC_PORT'])
TD_EVENT_OSC_PORT = int(_cfg['TD_EVENT_OSC_PORT'])
SEND_INTERVAL_S = int(_cfg['SEND_INTERVAL_MS']) / 1000.0

OSC_IN_PORT = int(_cfg['OSC_IN_PORT'])

MQTT_HOST = _cfg['MQTT_HOST']
MQTT_PORT = int(_cfg['MQTT_PORT'])
MQTT_TD_TOPIC_BASE = _cfg['MQTT_TD_TOPIC_BASE']
