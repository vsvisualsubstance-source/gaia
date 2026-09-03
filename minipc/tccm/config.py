"""Config gaia-tccm — layering: env > /etc/gaia/tccm.conf > default.
Stesso schema di minipc/dante/config.py (deciso 2026-09-02 nell'adattare
il template scaricato dall'utente, che leggeva SOLO env var nonostante il
suo stesso README dicesse di creare /etc/gaia/tccm.conf -- file mai
caricato davvero, corretto qui)."""
import os


def _load_conf(path):
    cfg = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip()
    return cfg


_conf = _load_conf("/etc/gaia/tccm.conf")


def _get(key, default):
    return os.getenv(key, _conf.get(key, default))


# TCC M — Sennheiser TeamConnect Ceiling Medium, API SSCv2 (HTTPS+SSE,
# auth Basic, verificato contro la spec ufficiale e contro
# github.com/chetan-prime/sennheiser-tcc-m-api prima di scrivere questo
# modulo -- vedi memoria project-solaro-dsp per il contesto TCCM/Solaro).
TCCM_HOST = _get("TCCM_HOST", "192.168.1.235")
TCCM_PORT = int(_get("TCCM_PORT", "443"))
TCCM_USER = _get("TCCM_USER", "api")
TCCM_PASSWORD = _get("TCCM_PASSWORD", None)   # MAI in git, solo env o /etc/gaia/tccm.conf (non versionato)
TCCM_VERIFY_TLS = _get("TCCM_VERIFY_TLS", "false").lower() in ("1", "true", "yes", "on")

MQTT_HOST = _get("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(_get("MQTT_PORT", "1883"))
MQTT_CLIENT_ID = _get("MQTT_CLIENT_ID", "gaia-tccm")
MQTT_BASE_TOPIC = _get("MQTT_BASE_TOPIC", "gaia/tccm")

# Device nel registro standard (gaia/device/{id}/status, family="tccm") --
# stesso principio di minipc/dante SOLARO_DEVICE_ID, cosi' compare in Pi
# Manager/admin.html come qualunque altro device.
TCCM_DEVICE_ID = _get("TCCM_DEVICE_ID", "tccm-ceiling")
TCCM_STANZA    = _get("TCCM_STANZA", "")   # vuoto = non assegnata, non indovinare

SSE_CONNECT_TIMEOUT = int(_get("TCCM_SSE_CONNECT_TIMEOUT", "15"))
# 2026-09-03: la spec SSCv2 non garantisce ne' un close-event ne' un
# heartbeat quando la subscription muore lato server/rete (verificato
# contro la spec ufficiale prima di aggiungere questo timeout) -- trovato
# dal vivo un caso reale: sse_connected restava true per 17+ ore con
# ZERO eventi ricevuti (nemmeno su roomInUse, che in 17 ore dovrebbe
# cambiare) mentre una GET diretta sulla stessa risorsa mostrava valori
# live che cambiavano ogni secondo. requests.iter_lines() con timeout
# read=None resta bloccato per sempre su una connessione morta senza
# FIN/RST esplicito. Un timeout di lettura finito forza requests a
# sollevare ReadTimeout se non arriva NESSUNA riga (nemmeno un commento
# ":" di keep-alive, se il device li manda) entro questa soglia --
# il loop di reconnect esistente (gia' con backoff) se ne occupa da solo.
SSE_IDLE_TIMEOUT = int(_get("TCCM_SSE_IDLE_TIMEOUT", "90"))
RECONNECT_MIN = int(_get("TCCM_RECONNECT_MIN", "2"))
RECONNECT_MAX = int(_get("TCCM_RECONNECT_MAX", "60"))
STATUS_INTERVAL = int(_get("TCCM_STATUS_INTERVAL", "5"))
