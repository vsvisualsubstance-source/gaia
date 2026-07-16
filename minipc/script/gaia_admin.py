#!/usr/bin/env python3
"""
gaia_admin.py — HTTP API per il pannello di tuning GAIA
Porta: 8765
Endpoints:
  GET  /api/status          → stats live + config + speakers + faces
  POST /api/config          → aggiorna soglie
  POST /api/calibrate       → avvia auto-calibrazione microfono
  POST /api/enroll/voice    → avvia enrollment voce
  POST /api/enroll/face     → prepara cattura volto
  POST /api/speaker/<n>/delete → rimuovi speaker
"""

import hashlib
import io
import json, os, threading, logging, base64, time, subprocess
import shutil
import wave

# Dispositivo ALSA per recording locale (es. "plughw:CARD=Communicator,DEV=0" per Polycom)
_admin_mic_device = "plughw:CARD=Communicator,DEV=0"   # default: Polycom


def _list_alsa_inputs() -> list[dict]:
    """Lista dispositivi ALSA di input tramite arecord -L."""
    try:
        out = subprocess.run(["arecord", "-L"], capture_output=True, text=True, timeout=5)
        devices = []
        for line in out.stdout.splitlines():
            if line.startswith("plughw:CARD="):
                card = line.split("CARD=")[1].split(",")[0]
                dev  = line.split("DEV=")[1] if "DEV=" in line else "0"
                label = f"plughw:CARD={card},DEV={dev}"
                friendly = card.replace("_"," ")
                devices.append({"name": label, "label": friendly})
        return devices
    except Exception as e:
        log.warning(f"arecord -L error: {e}")
        return []


def _record_arecord(alsa_device: str, duration_s: int, wav_path: str) -> bool:
    """Registra audio con arecord (ALSA diretto, no PulseAudio)."""
    try:
        cmd = ["arecord", "-D", alsa_device,
               "-f", "S16_LE", "-r", "16000", "-c", "1",
               "-d", str(duration_s), wav_path]
        result = subprocess.run(cmd, capture_output=True, timeout=duration_s + 5)
        return result.returncode == 0
    except Exception as e:
        log.error(f"arecord error: {e}")
        return False
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, quote as _quote
import paho.mqtt.client as mqtt

MQTT_BROKER = "localhost"
MQTT_PORT   = 1883
HTTP_PORT   = 8765

# Pi che devono ricevere voice_db.json aggiornato dopo ogni enrollment/rimozione.
# IP Tailscale (100.x): il Pi di produzione è dietro NAT Google, la LAN non lo
# raggiunge più — il tailnet sì (tutti i device Gaia sono in tailnet).
PI_VOICE_SYNC_TARGETS = [
    {"user": "asemico", "ip": "100.76.11.49", "path": "~/gaia/voice/voice_db.json"},
]

PI_BASE_REPO   = os.path.expanduser("~/core-node-0/pi")  # root pi/ nel repo (serveFile legge da qui)
MINIPC_IP      = "192.168.1.142"
# Libreria musicale locale (punto 3 media): file su D serviti in streaming
# da questa API — i player (mpv) leggono http://core:8765/music/<file>
MUSIC_DIR      = "/media/core/D/musica"
MUSIC_EXT      = ('.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus')
NODERED_PORT   = 1880


def _distribute_model_via_ota(src_path: str, service_subpath: str, service_type: str,
                               service_unit: str, restart: bool = True,
                               target_devices: list | None = None,
                               script_name: str | None = None):
    """Copia il modello nella directory repo pi/ (per ServeFile) e triggera OTA via MQTT.

    service_subpath: percorso relativo al service dir sul Pi, es. 'models/gaia_verifier.pkl'
    service_type: es. 'voice', 'yolo' (corrisponde alla directory in pi/)
    """
    def _run():
        if not os.path.exists(src_path):
            log.error(f"OTA: file sorgente non trovato: {src_path}")
            return
        # 1. Copia nella directory repo staging (pi/{service_type}/{service_subpath})
        staging = os.path.join(PI_BASE_REPO, service_type, service_subpath)
        os.makedirs(os.path.dirname(staging), exist_ok=True)
        shutil.copy2(src_path, staging)
        log.info(f"OTA staging: {staging}")
        # 2. Calcola MD5
        with open(staging, 'rb') as f:
            md5 = hashlib.md5(f.read()).hexdigest()
        # 3. Pubblica OTA via MQTT
        version = time.strftime('%Y%m%d-%H%M')
        url = f"http://{MINIPC_IP}:{NODERED_PORT}/gaia/ota/{service_type}/{service_subpath}"
        cmd = {
            "script":  service_subpath,
            "url":     url,
            "md5":     md5,
            "version": version,
            "service": service_unit,
            "restart": restart,
            "type":    service_type,
        }
        if script_name:
            cmd["script"] = script_name   # nome file sul device ≠ nome in staging
        if _mqtt:
            if target_devices:
                # Mirato: solo i device indicati (i modelli sono per-microfono,
                # il broadcast li farebbe piovere su tutti i servizi voice)
                for dev in target_devices:
                    _mqtt.publish(f"gaia/devices/{dev}/update", json.dumps(cmd), retain=False)
                log.info(f"OTA mirato: {service_subpath} v{version} → {target_devices}")
            else:
                _mqtt.publish("gaia/ota/broadcast", json.dumps(cmd), retain=False)
                log.info(f"OTA pubblicato: {service_subpath} v{version} → {url}")
        else:
            log.warning("OTA: _mqtt non connesso, impossibile pubblicare")
    threading.Thread(target=_run, daemon=True).start()


def _sync_voice_db():
    """Copia voice_db.json verso i Pi configurati (async, non bloccante)."""
    def _run():
        for t in PI_VOICE_SYNC_TARGETS:
            dst = f"{t['user']}@{t['ip']}:{t['path']}"
            try:
                result = subprocess.run(
                    ["rsync", "-avz", DB_PATH, dst],
                    capture_output=True, timeout=15
                )
                if result.returncode == 0:
                    log.info(f"voice_db.json sincronizzato → {t['ip']}")
                else:
                    log.warning(f"sync fallito per {t['ip']}: {result.stderr.decode()[:200]}")
            except Exception as e:
                log.warning(f"sync errore {t['ip']}: {e}")
    threading.Thread(target=_run, daemon=True).start()

DB_PATH         = os.path.expanduser("~/core-node-0/minipc/script/voice_db.json")
CONFIG_PATH     = os.path.expanduser("~/core-node-0/minipc/script/listener_config.json")
FACES_DIR       = "/media/core/D/face-env/faces"
DOORBELL_DIR      = os.path.expanduser("~/core-node-0/minipc/script/doorbell_samples")
GAIA_WAKEWORD_DIR = os.path.expanduser("~/core-node-0/minipc/script/gaia_wakeword_samples")
GAIA_MODEL_PATH   = os.path.join(GAIA_WAKEWORD_DIR, "gaia_verifier.pkl")
# Dataset/modello dedicato al mic del miniPC — non mescolato con i campioni del
# Pi (acustiche diverse), mai distribuito via OTA: gaia_listener.py lo carica
# in locale (vedi GaiaWakeVerifier). Vedi docs/automazioni.md.
GAIA_WAKEWORD_DIR_MINIPC = os.path.expanduser("~/core-node-0/minipc/script/gaia_wakeword_samples_minipc")
GAIA_MODEL_PATH_MINIPC   = os.path.join(GAIA_WAKEWORD_DIR_MINIPC, "gaia_verifier_minipc.pkl")
# Dataset/modello dedicato al mic della macchina OPS (silvermini2, cucina).
# I campioni arrivano dal servizio voice di OPS via record_clip (come il Pi)
# ma vanno smistati per device — vedi GAIA_WW_DIR_BY_DEVICE.
GAIA_WAKEWORD_DIR_OPS = os.path.expanduser("~/core-node-0/minipc/script/gaia_wakeword_samples_ops")
GAIA_MODEL_PATH_OPS   = os.path.join(GAIA_WAKEWORD_DIR_OPS, "gaia_verifier_ops.pkl")
# stanza → dataset per i campioni "gaia_*" registrati da remoto (default: Pi)
# PER DEVICE, non per stanza: i device CAMBIANO stanza (2026-07-12 il Pi è
# passato in cucina — per stanza i suoi campioni sarebbero finiti nel dataset
# del mic OPS). Default: dataset Pi per i voice vecchi senza device_id.
GAIA_WW_DIR_BY_DEVICE = {
    "pi-fd75d8":       GAIA_WAKEWORD_DIR,
    "ops-silvermini2": GAIA_WAKEWORD_DIR_OPS,
}
# Target OTA mirati per i modelli voice: il broadcast colpirebbe TUTTI i
# device voice (dal 2026-07-06 anche OPS) sovrascrivendo i modelli a vicenda.
VOICE_MODEL_TARGETS = {"pi": ["pi-fd75d8"], "ops": ["ops-silvermini2"]}

# ── Provision registry — device registrati al boot (discovery livello 3) ──
# Contratto client: docs/discovery-protocol.md + pi/agent/agent.py::_provision_register
PROVISION_REGISTRY  = os.path.expanduser("~/core-node-0/minipc/script/provision_registry.json")
GAIA_SERVER_VERSION = "1.0.2"
_provision_lock = threading.Lock()


def _load_provision_registry() -> dict:
    try:
        with open(PROVISION_REGISTRY) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_provision_registry(reg: dict):
    with open(PROVISION_REGISTRY, "w") as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("gaia_admin")

# ── Stato condiviso ───────────────────────────────────────────────────────────
_state: dict = {"stats": {}, "calibrate_result": {}, "pi_stats": {}, "pi_calibrate": {}}
_mqtt: mqtt.Client | None = None

def _media_search_worker(payload: dict):
    """Ricerca stazioni radio (directory TuneIn/opml) → play + notifica Telegram.
    Arriva da Telegram via gaia/media/search {query, room, chatId}."""
    import urllib.request as _rq
    q    = (payload.get("query") or "").strip()
    room = payload.get("room") or "cucina"
    chat = payload.get("chatId")

    def _notify(text):
        if _mqtt:
            _mqtt.publish("gaia/notify/telegram",
                          json.dumps({"chatId": chat, "text": text}))
    if not q:
        return
    try:
        url = ("http://opml.radiotime.com/Search.ashx?render=json&formats=mp3,aac"
               "&query=" + _quote(q))
        with _rq.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
        stations = [it for it in data.get("body", [])
                    if it.get("type") == "audio" and it.get("item") == "station"]
        if not stations:
            _notify(f'Nessuna stazione trovata per "{q}".')
            return
        best = stations[0]
        # l'URL della stazione è una playlist: la prima riga è lo stream vero
        with _rq.urlopen(best["URL"], timeout=10) as r:
            stream = r.read().decode("utf8", "ignore").splitlines()[0].strip()
        if _mqtt:
            _mqtt.publish(f"gaia/media/{room}/command",
                          json.dumps({"action": "play", "url": stream}))
        alt = " · ".join(s2.get("text", "?") for s2 in stations[1:4])
        _notify(f"▶️ {best.get('text', '?')} in {room}"
                + (f"\nAlternative: {alt}" if alt else ""))
    except Exception as e:
        log.warning(f"media search: {e}")
        _notify(f"Ricerca stazioni fallita ({e}).")


# ── MQTT ──────────────────────────────────────────────────────────────────────
def _on_connect(c, u, f, rc, p):
    log.info(f"MQTT connesso (rc={rc})")
    c.subscribe("gaia/media/search")             # ricerca stazioni da Telegram
    c.subscribe("gaia/voice/stats/+")            # minipc + stanze Pi
    c.subscribe("gaia/voice/calibrate_result/+") # calibrazione Pi
    c.subscribe("gaia/admin/calibrate_result")   # calibrazione miniPC

def _on_message(c, u, msg):
    try:
        payload = json.loads(msg.payload.decode())
        source  = msg.topic.split("/")[-1]   # "minipc", "ingresso", ecc.
        if msg.topic == "gaia/media/search":
            threading.Thread(target=_media_search_worker, args=(payload,), daemon=True).start()
        elif msg.topic.startswith("gaia/voice/stats/"):
            if source == "minipc":
                _state["stats"] = payload
                if payload.get("success") and payload.get("enrolled"):
                    _sync_voice_db()
            else:
                _state["pi_stats"][source] = payload
        elif msg.topic.startswith("gaia/voice/calibrate_result/"):
            _state["pi_calibrate"][source] = payload
        elif msg.topic == "gaia/admin/calibrate_result":
            _state["calibrate_result"] = payload
    except:
        pass

def _start_mqtt():
    global _mqtt
    _mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    _mqtt.on_connect = _on_connect
    _mqtt.on_message = _on_message
    # connect_async + reconnect_delay: al boot mosquitto (docker) parte DOPO
    # questo servizio — il connect() sincrono moriva con ConnectionRefused e il
    # thread MQTT spariva per sempre lasciando l'HTTP vivo ma stats/pi_stats
    # vuoti (successo il 2026-07-09, stessa race dell'agent OPS al login).
    # connect_async lascia che sia il loop a stabilire (e ristabilire) la
    # connessione con retry automatico.
    _mqtt.reconnect_delay_set(min_delay=2, max_delay=30)
    _mqtt.connect_async(MQTT_BROKER, MQTT_PORT, 60)
    _mqtt.loop_forever(retry_first_connection=True)

# ── Dati ─────────────────────────────────────────────────────────────────────
def get_speakers() -> list[str]:
    if not os.path.exists(DB_PATH):
        return []
    try:
        with open(DB_PATH) as f:
            return list(json.load(f).keys())
    except:
        return []

def get_faces() -> list[dict]:
    if not os.path.exists(FACES_DIR):
        return []
    result = []
    for name in sorted(os.listdir(FACES_DIR)):
        d = os.path.join(FACES_DIR, name)
        if os.path.isdir(d):
            imgs = len([f for f in os.listdir(d) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
            result.append({"name": name, "images": imgs})
    return result

def get_config() -> dict:
    defaults = {
        "device_id": "gaia-main", "device_hint": "Polycom",
        "voice_threshold": 300, "silence_frames": 25, "speaker_threshold": 0.72,
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                defaults.update(json.load(f))
        except:
            pass
    return defaults

def remove_speaker(name: str):
    if not os.path.exists(DB_PATH):
        return
    try:
        with open(DB_PATH) as f:
            db = json.load(f)
        db.pop(name, None)
        with open(DB_PATH, "w") as f:
            json.dump(db, f, indent=2)
        if _mqtt:
            _mqtt.publish("gaia/admin/reload_speakers", "{}")
        log.info(f"Speaker rimosso: {name}")
        _sync_voice_db()
    except Exception as e:
        log.warning(f"remove_speaker error: {e}")

# ── HTTP handler ──────────────────────────────────────────────────────────────
class AdminHandler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors(); self.end_headers()

    def do_DELETE(self):
        p = urlparse(self.path).path
        if p.startswith("/api/gaia-wakeword/clip/"):
            parts = p.split("/")
            if len(parts) >= 6:
                self._delete_clip(GAIA_WAKEWORD_DIR, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return
        if p.startswith("/api/gaia-wakeword-ops/clip/"):
            parts = p.split("/")
            if len(parts) >= 6:
                self._delete_clip(GAIA_WAKEWORD_DIR_OPS, parts[4], int(parts[5]))
                return

        if p.startswith("/api/gaia-wakeword-minipc/clip/"):
            parts = p.split("/")
            if len(parts) >= 6:
                self._delete_clip(GAIA_WAKEWORD_DIR_MINIPC, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return
        if p.startswith("/api/doorbell/clip/"):
            parts = p.split("/")
            if len(parts) >= 6:
                self._delete_clip(DOORBELL_DIR, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return
        self.send_response(404); self._cors(); self.end_headers()

    def _delete_clip(self, base_dir, label, idx):
        """Cancella il clip idx e rinumera i rimanenti per mantenere indici puliti."""
        d = os.path.join(base_dir, label)
        files = sorted(f for f in os.listdir(d) if f.endswith(".wav")) if os.path.exists(d) else []
        if idx >= len(files):
            self.send_response(404); self._cors(); self.end_headers(); return
        target = os.path.join(d, files[idx])
        os.remove(target)
        # Rinumera i file successivi
        for i, fname in enumerate(files[idx+1:], start=idx):
            os.rename(os.path.join(d, fname), os.path.join(d, f"clip_{i:04d}.wav"))
        self._json({"ok": True, "deleted": files[idx], "remaining": len(files) - 1})

    def _serve_clip(self, base_dir, label, idx):
        """Serve un singolo clip WAV per il playback nel browser."""
        path = os.path.join(base_dir, label, f"clip_{idx:04d}.wav")
        if not os.path.exists(path):
            self.send_response(404); self._cors(); self.end_headers(); return
        data = open(path, 'rb').read()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", len(data))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = urlparse(self.path).path

        # Libreria musicale: lista file su D
        if p == "/api/music/list":
            files = []
            for root, _dirs, names in os.walk(MUSIC_DIR):
                for n in sorted(names):
                    if n.lower().endswith(MUSIC_EXT):
                        rel = os.path.relpath(os.path.join(root, n), MUSIC_DIR)
                        files.append({"name": rel,
                                      "url": f"http://{MINIPC_IP}:{HTTP_PORT}/music/{_quote(rel)}"})
            self._json({"files": files, "dir": MUSIC_DIR})
            return

        # Streaming di un file della libreria (per mpv nelle stanze)
        if p.startswith("/music/"):
            rel  = unquote(p[len("/music/"):])
            base = os.path.realpath(MUSIC_DIR)
            full = os.path.realpath(os.path.join(MUSIC_DIR, rel))
            if not full.startswith(base + os.sep) or not os.path.isfile(full):
                self.send_response(404); self._cors(); self.end_headers()
                return
            ext = full.rsplit(".", 1)[-1].lower()
            ctype = {"mp3": "audio/mpeg", "flac": "audio/flac", "ogg": "audio/ogg",
                     "wav": "audio/wav", "m4a": "audio/mp4", "aac": "audio/aac",
                     "opus": "audio/opus"}.get(ext, "application/octet-stream")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(os.path.getsize(full)))
            self.end_headers()
            try:
                with open(full, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
            except (BrokenPipeError, ConnectionResetError):
                pass          # player ha chiuso (stop/cambio brano): normale
            return

        # Playback clip: /api/gaia-wakeword/clip/{label}/{index}
        if p.startswith("/api/gaia-wakeword/clip/"):
            parts = p.split("/")  # ['','api','gaia-wakeword','clip',label,idx]
            if len(parts) >= 6:
                self._serve_clip(GAIA_WAKEWORD_DIR, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return

        # Playback clip: /api/gaia-wakeword-ops/clip/{label}/{index}
        if p.startswith("/api/gaia-wakeword-ops/clip/"):
            parts = p.split("/")
            if len(parts) >= 6:
                self._serve_clip(GAIA_WAKEWORD_DIR_OPS, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return

        # Playback clip: /api/gaia-wakeword-minipc/clip/{label}/{index}
        if p.startswith("/api/gaia-wakeword-minipc/clip/"):
            parts = p.split("/")
            if len(parts) >= 6:
                self._serve_clip(GAIA_WAKEWORD_DIR_MINIPC, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return

        # Playback clip: /api/doorbell/clip/{label}/{index}
        if p.startswith("/api/doorbell/clip/"):
            parts = p.split("/")  # ['','api','doorbell','clip',label,idx]
            if len(parts) >= 6:
                self._serve_clip(DOORBELL_DIR, parts[4], int(parts[5]))
            else:
                self.send_response(400); self._cors(); self.end_headers()
            return

        # Thumbnail volto: /api/faces/{name}/thumb → prima immagine della persona
        if p.startswith("/api/faces/") and p.endswith("/thumb"):
            name = os.path.basename(unquote(p.split("/")[3]))
            d = os.path.join(FACES_DIR, name)
            imgs = sorted(f for f in (os.listdir(d) if os.path.isdir(d) else [])
                          if f.lower().endswith((".jpg", ".jpeg", ".png")))
            if not imgs:
                self.send_response(404); self._cors(); self.end_headers(); return
            fp = os.path.join(d, imgs[0])
            data = open(fp, 'rb').read()
            ctype = "image/png" if fp.lower().endswith(".png") else "image/jpeg"
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", len(data))
            self.send_header("Cache-Control", "max-age=60")
            self.end_headers()
            self.wfile.write(data)
            return

        if p == "/api/provision/devices":
            with _provision_lock:
                reg = _load_provision_registry()
            self._json({"devices": reg}); return

        if p == "/api/microphones":
            devs = _list_alsa_inputs()
            self._json({"devices": devs, "current": _admin_mic_device}); return

        if p == "/api/gaia-wakeword/status":
            def _clips(label):
                d = os.path.join(GAIA_WAKEWORD_DIR, label)
                if not os.path.exists(d): return 0, []
                fs = sorted(f for f in os.listdir(d) if f.endswith(".wav"))
                return len(fs), [i for i in range(len(fs))]
            pos_n, pos_idx = _clips("positive")
            neg_n, neg_idx = _clips("negative")
            self._json({
                "positive": pos_n, "positive_clips": pos_idx,
                "negative": neg_n, "negative_clips": neg_idx,
                "model_exists": os.path.exists(GAIA_MODEL_PATH),
            }); return

        if p == "/api/gaia-wakeword-ops/status":
            def _oclips(lbl):
                d = os.path.join(GAIA_WAKEWORD_DIR_OPS, lbl)
                if not os.path.isdir(d):
                    return 0, []
                fs = sorted(f for f in os.listdir(d) if f.endswith(".wav"))
                return len(fs), [i for i in range(len(fs))]
            pos_n, pos_idx = _oclips("positive")
            neg_n, neg_idx = _oclips("negative")
            self._json({
                "positive": pos_n, "positive_clips": pos_idx,
                "negative": neg_n, "negative_clips": neg_idx,
                "model_exists": os.path.exists(GAIA_MODEL_PATH_OPS),
            }); return

        if p == "/api/gaia-wakeword-minipc/status":
            def _clips_mp(label):
                d = os.path.join(GAIA_WAKEWORD_DIR_MINIPC, label)
                if not os.path.exists(d): return 0, []
                fs = sorted(f for f in os.listdir(d) if f.endswith(".wav"))
                return len(fs), [i for i in range(len(fs))]
            pos_n, pos_idx = _clips_mp("positive")
            neg_n, neg_idx = _clips_mp("negative")
            self._json({
                "positive": pos_n, "positive_clips": pos_idx,
                "negative": neg_n, "negative_clips": neg_idx,
                "model_exists": os.path.exists(GAIA_MODEL_PATH_MINIPC),
            }); return
        if p == "/api/doorbell/status":
            def _dclips(label):
                d = os.path.join(DOORBELL_DIR, label)
                if not os.path.exists(d): return 0, []
                fs = sorted(f for f in os.listdir(d) if f.endswith(".wav"))
                return len(fs), [i for i in range(len(fs))]
            pos_n, pos_idx = _dclips("positive")
            neg_n, neg_idx = _dclips("negative")
            self._json({
                "positive": pos_n, "positive_clips": pos_idx,
                "negative": neg_n, "negative_clips": neg_idx,
                "model_exists": os.path.exists(os.path.join(DOORBELL_DIR, "doorbell_verifier.pkl")),
            }); return
        if p == "/api/status":
            def svc_active(name):
                try:
                    r = subprocess.run(["systemctl", "is-active", name],
                                       capture_output=True, timeout=3)
                    return r.stdout.decode().strip()
                except Exception:
                    return "unknown"
            listener_st = svc_active("gaia-listener")
            self._json({
                "stats":            _state["stats"],
                "pi_stats":         _state["pi_stats"],
                "pi_calibrate":     _state["pi_calibrate"],
                "calibrate_result": _state["calibrate_result"],
                "config":           get_config(),
                "speakers":         get_speakers(),
                "faces":            get_faces(),
                "listener_active":  listener_st == "active",
                "services": {
                    "gaia-listener": listener_st,
                    "gaia-face":     svc_active("gaia-face"),
                    "gaia-camera":   svc_active("gaia-camera"),
                },
            })
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        path   = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if path.startswith("/api/service/listener/"):
            action = path.split("/")[-1]
            if action not in ("start", "stop", "restart"):
                self._json({"ok": False, "error": "azione non valida"}, 400); return
            try:
                result = subprocess.run(
                    ["sudo", "/usr/bin/systemctl", action, "gaia-listener"],
                    capture_output=True, timeout=10
                )
                ok  = result.returncode == 0
                out = (result.stderr or result.stdout).decode(errors="replace")[:200].strip()
                self._json({"ok": ok, "output": out})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})

        elif path.startswith("/api/core-service/"):
            # /api/core-service/{service}/{action}
            # Servizi consentiti (whitelist esplicita)
            ALLOWED = {"gaia-listener", "gaia-face", "gaia-camera"}
            parts = path.split("/")  # ['','api','core-service',svc,action]
            if len(parts) < 5:
                self._json({"ok": False, "error": "formato non valido"}, 400); return
            svc    = parts[3]
            action = parts[4]
            if svc not in ALLOWED:
                self._json({"ok": False, "error": f"servizio non consentito: {svc}"}, 400); return
            if action not in ("start", "stop", "restart"):
                self._json({"ok": False, "error": "azione non valida"}, 400); return
            try:
                result = subprocess.run(
                    ["sudo", "/usr/bin/systemctl", action, svc],
                    capture_output=True, timeout=15
                )
                ok  = result.returncode == 0
                out = (result.stderr or result.stdout).decode(errors="replace")[:200].strip()
                self._json({"ok": ok, "output": out})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})

        elif path.startswith("/api/pi-service/"):
            parts = path.split("/")   # ['','api','pi-service',room,action]
            if len(parts) < 5:
                self._json({"ok": False, "error": "formato non valido"}, 400); return
            room   = parts[3]
            action = parts[4]
            if action not in ("start", "stop", "restart"):
                self._json({"ok": False, "error": "azione non valida"}, 400); return
            mqtt_action = {"start": "enable", "stop": "disable", "restart": "restart"}[action]
            pi_info     = _state["pi_stats"].get(room, {})
            device_id   = pi_info.get("device_id")
            topic = f"gaia/device/{device_id}/command" if device_id else "gaia/device/all/command"
            if _mqtt:
                _mqtt.publish(topic, json.dumps({"action": mqtt_action, "service": "voice"}))
            self._json({"ok": True, "action": mqtt_action, "room": room, "topic": topic})

        elif path == "/api/config":
            if _mqtt:
                _mqtt.publish("gaia/admin/config", json.dumps(body))
            self._json({"ok": True})

        elif path == "/api/calibrate":
            if _mqtt:
                _mqtt.publish("gaia/admin/calibrate", "{}")
            self._json({"ok": True, "message": "Calibrazione avviata — silenzio per 5s"})

        elif path == "/api/pi-voice/calibrate":
            room       = body.get("room", "ingresso")
            duration_s = int(body.get("duration_s", 5))
            if _mqtt:
                _mqtt.publish(f"gaia/voice/admin/{room}",
                              json.dumps({"cmd": "calibrate", "duration_s": duration_s}))
            self._json({"ok": True, "message": f"Calibrazione Pi ({room}) avviata — silenzio per {duration_s}s"})

        elif path == "/api/pi-voice/config":
            room = body.get("room", "ingresso")
            cfg  = {k: v for k, v in body.items() if k != "room"}
            if _mqtt and cfg:
                _mqtt.publish(f"gaia/voice/admin/{room}",
                              json.dumps({"cmd": "config", **cfg}))
            self._json({"ok": True})

        elif path == "/api/enroll/voice":
            name = body.get("name", "").strip().lower()  # nomi sempre minuscoli: "Mauro" e "mauro" creavano due identità
            if not name:
                self._json({"ok": False, "error": "nome obbligatorio"}, 400); return
            payload = {"name": name, "samples": body.get("samples", 3), "duration_s": body.get("duration_s", 5)}
            if _mqtt:
                _mqtt.publish("gaia/admin/voice_enroll", json.dumps(payload))
            self._json({"ok": True, "name": name})

        elif path == "/api/enroll/voice-upload":
            name = body.get("name", "").strip().lower()  # nomi sempre minuscoli: "Mauro" e "mauro" creavano due identità
            audio_b64 = body.get("audio_base64", "")
            if not name or not audio_b64:
                self._json({"ok": False, "error": "nome e audio_base64 obbligatori"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])  # tollera prefisso data URL
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            tmp_path = f"/tmp/voice_upload_{name}_{int(time.time())}.wav"
            with open(tmp_path, "wb") as f:
                f.write(audio_bytes)
            if _mqtt:
                _mqtt.publish("gaia/admin/voice_enroll_file", json.dumps({"name": name, "file_path": tmp_path}))
            self._json({"ok": True, "name": name})

        elif path == "/api/enroll/face":
            name = body.get("name", "").strip().lower()  # nomi sempre minuscoli: "Mauro" e "mauro" creavano due identità
            if not name:
                self._json({"ok": False, "error": "nome obbligatorio"}, 400); return
            if _mqtt:
                _mqtt.publish("gaia/vision/control", json.dumps({"cmd": "save_face", "name": name}))
            self._json({"ok": True, "name": name, "message": "Punta la telecamera verso la persona"})

        elif path == "/api/enroll/face-upload":
            name = body.get("name", "").strip().lower()  # nomi sempre minuscoli: "Mauro" e "mauro" creavano due identità
            image_b64 = body.get("image_base64", "")
            if not name or not image_b64:
                self._json({"ok": False, "error": "nome e image_base64 obbligatori"}, 400); return
            try:
                image_bytes = base64.b64decode(image_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "image_base64 non valido"}, 400); return
            person_dir = os.path.join(FACES_DIR, name)
            os.makedirs(person_dir, exist_ok=True)
            existing = [f for f in os.listdir(person_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
            img_path = os.path.join(person_dir, f"snap_{len(existing):04d}.jpg")
            with open(img_path, "wb") as f:
                f.write(image_bytes)
            log.info(f"Volto caricato: {img_path}")
            if _mqtt:
                _mqtt.publish("gaia/vision/control", json.dumps({"cmd": "reload"}))
            self._json({"ok": True, "name": name})

        elif path == "/api/admin/set-mic":
            global _admin_mic_device
            alsa = body.get("alsa_device")
            if not alsa:
                self._json({"ok": False, "error": "alsa_device obbligatorio"}, 400); return
            _admin_mic_device = alsa
            log.info(f"Mic admin impostato: {_admin_mic_device}")
            self._json({"ok": True, "device": _admin_mic_device})

        elif path == "/api/gaia-wakeword/record-local":
            # Registra dal mic del miniPC → dataset dedicato al modello miniPC
            # (GAIA_WAKEWORD_DIR_MINIPC), separato da quello del Pi: mic diversi,
            # non ha senso mescolarli nello stesso modello. Vedi docs/automazioni.md.
            label      = body.get("label", "positive")
            duration_s = int(body.get("duration_s", 3))
            dst = os.path.join(GAIA_WAKEWORD_DIR_MINIPC, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            # gaia_listener.py ha già il microfono aperto → delega la registrazione via MQTT
            if _mqtt:
                _mqtt.publish("gaia/admin/record_raw_clip",
                              json.dumps({"path": wav_path, "duration_s": duration_s}))
                log.info(f"record_raw_clip inviato a gaia_listener → {wav_path}")
            self._json({"ok": True, "label": label, "duration_s": duration_s, "clip": idx})

        elif path == "/api/gaia-wakeword-minipc/upload":
            label     = body.get("label", "positive")
            audio_b64 = body.get("audio_base64", "")
            if not audio_b64:
                self._json({"ok": False, "error": "audio_base64 mancante"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            dst = os.path.join(GAIA_WAKEWORD_DIR_MINIPC, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            with open(wav_path, "wb") as f:
                f.write(audio_bytes)
            log.info(f"Campione Gaia wakeword (miniPC) caricato: {wav_path}")
            self._json({"ok": True, "label": label, "path": wav_path})

        elif path == "/api/gaia-wakeword-ops/upload":
            label     = body.get("label", "positive")
            audio_b64 = body.get("audio_base64", "")
            if not audio_b64:
                self._json({"ok": False, "error": "audio_base64 mancante"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            dst = os.path.join(GAIA_WAKEWORD_DIR_OPS, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            with open(wav_path, "wb") as f:
                f.write(audio_bytes)
            log.info(f"Gaia wakeword OPS: salvato {wav_path}")
            self._json({"ok": True, "label": label, "clip": idx})

        elif path == "/api/gaia-wakeword-ops/train":
            def _do_train_gaia_ops():
                try:
                    import sys
                    sys.path.insert(0, os.path.dirname(DB_PATH))
                    from train_doorbell_model import train_and_save
                    ok, msg = train_and_save(samples_dir=GAIA_WAKEWORD_DIR_OPS,
                                             output_path=GAIA_MODEL_PATH_OPS)
                    log.info(f"Training Gaia wakeword (OPS): {msg}")
                    if ok:
                        # Staging col nome _ops (l'URL Node-RED lo serve così),
                        # sul device viene scritto come models/gaia_verifier.pkl
                        # che è il nome che pi/voice carica.
                        _distribute_model_via_ota(
                            src_path        = GAIA_MODEL_PATH_OPS,
                            service_subpath = "models/gaia_verifier_ops.pkl",
                            service_type    = "voice",
                            service_unit    = "gaia-voice",
                            target_devices  = VOICE_MODEL_TARGETS["ops"],
                            script_name     = "models/gaia_verifier.pkl",
                        )
                except Exception as e:
                    log.error(f"Errore training Gaia OPS: {e}")
            threading.Thread(target=_do_train_gaia_ops, daemon=True).start()
            self._json({"ok": True, "message": "Training Gaia wakeword (OPS) avviato in background"})

        elif path == "/api/gaia-wakeword-minipc/train":
            def _do_train_gaia_minipc():
                try:
                    import sys
                    sys.path.insert(0, os.path.dirname(DB_PATH))
                    from train_doorbell_model import train_and_save
                    ok, msg = train_and_save(samples_dir=GAIA_WAKEWORD_DIR_MINIPC,
                                             output_path=GAIA_MODEL_PATH_MINIPC)
                    log.info(f"Training Gaia wakeword (miniPC): {msg}")
                    if ok and _mqtt:
                        # Nessuna OTA: il modello e' gia' locale, gaia_listener.py
                        # lo ricarica direttamente dal disco.
                        _mqtt.publish("gaia/admin/reload_gaia_verifier", "{}")
                except Exception as e:
                    log.error(f"Errore training Gaia miniPC: {e}")
            threading.Thread(target=_do_train_gaia_minipc, daemon=True).start()
            self._json({"ok": True, "message": "Training Gaia wakeword (miniPC) avviato in background"})

        elif path == "/api/doorbell/record-local":
            label      = body.get("label", "positive")
            duration_s = int(body.get("duration_s", 3))
            dst = os.path.join(DOORBELL_DIR, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            if _mqtt:
                _mqtt.publish("gaia/admin/record_raw_clip",
                              json.dumps({"path": wav_path, "duration_s": duration_s}))
                log.info(f"record_raw_clip doorbell → {wav_path}")
            self._json({"ok": True, "label": label, "duration_s": duration_s, "clip": idx})

        elif path == "/api/gaia-wakeword/record":
            label      = body.get("label", "positive")
            duration_s = int(body.get("duration_s", 3))
            target     = body.get("stanza", "ingresso")
            if _mqtt:
                _mqtt.publish(f"gaia/voice/record_clip/{target}",
                              json.dumps({"label": f"gaia_{label}", "duration_s": duration_s}))
            self._json({"ok": True, "label": label, "duration_s": duration_s, "target": target})

        elif path == "/api/gaia-wakeword/sample":
            label     = body.get("label", "positive").replace("gaia_", "")
            audio_b64 = body.get("audio_base64", "")
            if not audio_b64:
                self._json({"ok": False, "error": "audio_base64 mancante"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            dst = os.path.join(GAIA_WAKEWORD_DIR, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            with open(wav_path, "wb") as f:
                f.write(audio_bytes)
            log.info(f"Campione Gaia wakeword salvato: {wav_path}")
            self._json({"ok": True, "label": label, "path": wav_path})

        elif path == "/api/gaia-wakeword/upload":
            label     = body.get("label", "positive")
            audio_b64 = body.get("audio_base64", "")
            if not audio_b64:
                self._json({"ok": False, "error": "audio_base64 mancante"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            dst = os.path.join(GAIA_WAKEWORD_DIR, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            with open(wav_path, "wb") as f:
                f.write(audio_bytes)
            log.info(f"Campione Gaia wakeword caricato: {wav_path}")
            self._json({"ok": True, "label": label, "path": wav_path})

        elif path == "/api/gaia-wakeword/train":
            def _do_train_gaia():
                try:
                    import sys
                    sys.path.insert(0, os.path.dirname(DB_PATH))
                    from train_doorbell_model import train_and_save
                    ok, msg = train_and_save(samples_dir=GAIA_WAKEWORD_DIR,
                                             output_path=GAIA_MODEL_PATH)
                    log.info(f"Training Gaia wakeword: {msg}")
                    if ok:
                        _distribute_model_via_ota(
                            src_path      = GAIA_MODEL_PATH,
                            service_subpath = "models/gaia_verifier.pkl",
                            service_type  = "voice",
                            service_unit  = "gaia-voice",
                            target_devices = VOICE_MODEL_TARGETS["pi"],
                            restart       = True,
                        )
                except Exception as e:
                    log.error(f"Errore training Gaia: {e}")
            threading.Thread(target=_do_train_gaia, daemon=True).start()
            self._json({"ok": True, "message": "Training Gaia wakeword avviato in background"})

        elif path == "/api/doorbell/record":
            label      = body.get("label", "positive")
            duration_s = int(body.get("duration_s", 5))
            target     = body.get("stanza", "ingresso")  # stanza del Pi ingresso
            if _mqtt:
                _mqtt.publish(f"gaia/voice/record_clip/{target}",
                              json.dumps({"label": label, "duration_s": duration_s}))
            self._json({"ok": True, "label": label, "duration_s": duration_s, "target": target})

        elif path == "/api/doorbell/sample":
            raw_label = body.get("label", "positive")
            audio_b64 = body.get("audio_base64", "")
            if not audio_b64:
                self._json({"ok": False, "error": "audio_base64 mancante"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            # Smista per prefisso label E stanza: "gaia_*" → dataset wakeword
            # della macchina giusta (cucina=OPS, default=Pi), resto → citofono.
            # I voice più vecchi non mandano "stanza" → default dataset Pi.
            dev_src = body.get("device_id", "")
            if raw_label.startswith("gaia_"):
                label = raw_label[len("gaia_"):]
                base_dir = GAIA_WW_DIR_BY_DEVICE.get(dev_src, GAIA_WAKEWORD_DIR)
                kind = f"Gaia wakeword ({dev_src or 'pi'})"
            else:
                label = raw_label
                base_dir = DOORBELL_DIR
                kind = "citofono"
            dst = os.path.join(base_dir, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            with open(wav_path, "wb") as f:
                f.write(audio_bytes)
            log.info(f"Campione {kind} salvato: {wav_path}")
            self._json({"ok": True, "label": label, "path": wav_path})

        elif path == "/api/doorbell/upload":
            label     = body.get("label", "positive")
            audio_b64 = body.get("audio_base64", "")
            if not audio_b64:
                self._json({"ok": False, "error": "audio_base64 mancante"}, 400); return
            try:
                audio_bytes = base64.b64decode(audio_b64.split(",")[-1])
            except Exception:
                self._json({"ok": False, "error": "audio_base64 non valido"}, 400); return
            dst = os.path.join(DOORBELL_DIR, label)
            os.makedirs(dst, exist_ok=True)
            idx = len([f for f in os.listdir(dst) if f.endswith(".wav")])
            wav_path = os.path.join(dst, f"clip_{idx:04d}.wav")
            with open(wav_path, "wb") as f:
                f.write(audio_bytes)
            log.info(f"Campione citofono caricato: {wav_path}")
            self._json({"ok": True, "label": label, "path": wav_path})

        elif path == "/api/doorbell/train":
            def _do_train():
                try:
                    import sys
                    sys.path.insert(0, os.path.dirname(DB_PATH))
                    from train_doorbell_model import train_and_save, DEFAULT_OUTPUT
                    ok, msg = train_and_save()
                    log.info(f"Training citofono: {msg}")
                    if ok:
                        _distribute_model_via_ota(
                            src_path      = DEFAULT_OUTPUT,
                            service_subpath = "models/doorbell_verifier.pkl",
                            service_type  = "voice",
                            service_unit  = "gaia-voice",
                            restart       = True,
                        )
                except Exception as e:
                    log.error(f"Errore training: {e}")
            threading.Thread(target=_do_train, daemon=True).start()
            self._json({"ok": True, "message": "Training avviato in background"})

        elif path.startswith("/api/gaia-wakeword/clip/") and len(path.split("/")) >= 6:
            # POST fallback per delete (massima compatibilità browser con CORS)
            parts = path.split("/")
            if body.get("_method") == "DELETE":
                self._delete_clip(GAIA_WAKEWORD_DIR, parts[4], int(parts[5]))
            else:
                self._json({"ok": False, "error": "_method:DELETE richiesto"}, 400)

        elif path.startswith("/api/gaia-wakeword-minipc/clip/") and len(path.split("/")) >= 6:
            parts = path.split("/")
            if body.get("_method") == "DELETE":
                self._delete_clip(GAIA_WAKEWORD_DIR_MINIPC, parts[4], int(parts[5]))
            else:
                self._json({"ok": False, "error": "_method:DELETE richiesto"}, 400)

        elif path.startswith("/api/gaia-wakeword-ops/clip/") and len(path.split("/")) >= 6:
            parts = path.split("/")
            if body.get("_method") == "DELETE":
                self._delete_clip(GAIA_WAKEWORD_DIR_OPS, parts[4], int(parts[5]))
            else:
                self._json({"ok": False, "error": "_method:DELETE richiesto"}, 400)

        elif path.startswith("/api/doorbell/clip/") and len(path.split("/")) >= 6:
            parts = path.split("/")
            if body.get("_method") == "DELETE":
                self._delete_clip(DOORBELL_DIR, parts[4], int(parts[5]))
            else:
                self._json({"ok": False, "error": "_method:DELETE richiesto"}, 400)

        elif path == "/api/provision":
            device_id = (body.get("device_id") or "").strip()
            if not device_id:
                self._json({"ok": False, "error": "device_id mancante"}, 400); return
            now = int(time.time() * 1000)
            with _provision_lock:
                reg = _load_provision_registry()
                entry = reg.setdefault(device_id, {"first_seen": now})
                for k in ("mac", "hw", "sw_version", "capabilities"):
                    if k in body:
                        entry[k] = body[k]
                entry["ip"]        = self.client_address[0]
                entry["last_seen"] = now
                claimed = (body.get("stanza") or "").strip()
                if claimed:
                    entry["stanza_claim"] = claimed
                _save_provision_registry(reg)
            assigned = bool(entry.get("stanza"))
            state = f"stanza assegnata: {entry.get('stanza')}" if assigned else "da assegnare"
            log.info(f"Provision: {device_id} da {entry['ip']} ({state})")
            self._json({
                "ok":             True,
                "assigned":       assigned,
                "stanza":         entry.get("stanza"),
                "name":           entry.get("name"),
                "mqtt_host":      MINIPC_IP,
                "mqtt_port":      MQTT_PORT,
                "server_version": GAIA_SERVER_VERSION,
            })

        elif path == "/api/provision/assign":
            device_id = (body.get("device_id") or "").strip()
            stanza    = (body.get("stanza") or "").strip()
            if not device_id or not stanza:
                self._json({"ok": False, "error": "device_id e stanza richiesti"}, 400); return
            with _provision_lock:
                reg = _load_provision_registry()
                entry = reg.setdefault(device_id, {"first_seen": int(time.time() * 1000)})
                entry["stanza"] = stanza
                if body.get("name"):
                    entry["name"] = body["name"]
                _save_provision_registry(reg)
            # Applica subito al device se è online (stesso comando del Pi Manager)
            cmd = {"action": "set_config", "stanza": stanza}
            if body.get("name"):
                cmd["name"] = body["name"]
            if _mqtt:
                _mqtt.publish(f"gaia/device/{device_id}/command", json.dumps(cmd))
            # Sincronizza il Device Registry di Node-RED (autoritativo per la
            # room dei topic yolo/mediapipe): senza questo i due registri
            # divergono e il device pubblica su una stanza diversa da quella
            # assegnata qui (caso reale: ingresso vs ingresso1).
            try:
                import urllib.request
                req = urllib.request.Request(
                    f"http://localhost:{NODERED_PORT}/gaia/device/assign",
                    data=json.dumps({"device_id": device_id, "room": stanza}).encode(),
                    headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=5).read()
                registry_sync = True
            except Exception as e:
                log.warning(f"Provision assign: sync Device Registry fallito: {e}")
                registry_sync = False
            log.info(f"Provision assign: {device_id} → {stanza} (registry_sync={registry_sync})")
            self._json({"ok": True, "device_id": device_id, "stanza": stanza,
                        "registry_sync": registry_sync})

        elif path == "/api/provision/forget":
            device_id = (body.get("device_id") or "").strip()
            if not device_id:
                self._json({"ok": False, "error": "device_id mancante"}, 400); return
            with _provision_lock:
                reg = _load_provision_registry()
                reg.pop(device_id, None)
                _save_provision_registry(reg)
            log.info(f"Provision forget: {device_id}")
            self._json({"ok": True})

        elif path.endswith("/delete") and "/api/speaker/" in path:
            name = path.split("/")[-2]
            remove_speaker(name)
            _sync_voice_db()
            self._json({"ok": True})

        elif path.endswith("/delete") and "/api/face/" in path:
            name = path.split("/")[-2]
            face_dir = os.path.join(FACES_DIR, name)
            if os.path.isdir(face_dir):
                import shutil as _shutil
                _shutil.rmtree(face_dir)
                log.info(f"Volto rimosso: {name} ({face_dir})")
                if _mqtt:
                    _mqtt.publish("gaia/vision/control", json.dumps({"cmd": "reload"}))
            self._json({"ok": True})

        else:
            self.send_response(404); self.end_headers()

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, *_):
        pass  # sopprimi spam HTTP nei log

if __name__ == "__main__":
    threading.Thread(target=_start_mqtt, daemon=True).start()
    log.info(f"Gaia Admin API → http://0.0.0.0:{HTTP_PORT}")
    # ThreadingHTTPServer: /music/ streamma file audio per la durata del
    # brano — col server single-thread bloccherebbe tutta l'admin API
    # (stessa classe di bug del MJPEG camera, 2026-07-15).
    srv = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), AdminHandler)
    srv.daemon_threads = True
    srv.serve_forever()
