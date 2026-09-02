"""Config gaia-dante-monitor — layering: env > /etc/gaia/dante.conf > default."""
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


_conf = _load_conf("/etc/gaia/dante.conf")


def _get(key, default):
    return os.getenv(key, _conf.get(key, default))


MQTT_HOST = _get("MQTT_HOST", "192.168.1.142")
MQTT_PORT = int(_get("MQTT_PORT", "1883"))

# Porte UDP su cui il driver esterno del Solaro manda telemetria (H/V Angle,
# Mic Level, Far End Audio, Camera Preset, Heartbeat...) — qualunque
# pacchetto su una di queste conta come "rete Dante viva". Elenco
# volutamente ampio e configurabile: il driver dell'utente è ancora in
# sviluppo, le porte possono cambiare senza dover toccare questo codice.
DANTE_PORTS = [int(p) for p in _get("DANTE_PORTS", "4554,4555,4556,4557,4558,4559").split(",") if p.strip()]

# Se non arriva nessun pacchetto entro questa finestra, si considera Dante
# spenta/scollegata — i canali osservati durante i test pubblicavano a
# ~10Hz, quindi qualche secondo di margine assorbe i normali silenzi (es.
# nessuno parla, H/V Angle non aggiornato) senza sembrare "spento" a torto.
DANTE_TIMEOUT_S  = float(_get("DANTE_TIMEOUT_S", "8"))
STATUS_INTERVAL_S = float(_get("STATUS_INTERVAL_S", "3"))

# ── Device Solaro QR1-UC nel registro standard (gaia/device/{id}/status,
# family="solaro") — separato dal blob generico gaia/dante/status sopra
# (che resta per compatibilita' con mediaplayer/musica.html, non toccato).
# Porte -> nome canale, stesso formato per tutte (ASCII decimale puro,
# nessun framing -- deciso 2026-07-30, vedi memoria project-solaro-dsp).
SOLARO_DEVICE_ID = _get("SOLARO_DEVICE_ID", "solaro-qr1")
SOLARO_STANZA    = _get("SOLARO_STANZA", "")   # vuoto = non assegnata, non indovinare
SOLARO_HEARTBEAT_PORT = int(_get("SOLARO_HEARTBEAT_PORT", "4559"))
SOLARO_CHANNELS = {
    4554: "h_angle",
    4555: "v_angle",
    4556: "mic_level_db",
    4557: "far_end_level_db",
    4558: "camera_preset",
}
