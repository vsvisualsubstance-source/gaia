"""
Laser gateway -- unico mittente verso i LaserCube WiFi (via cavo LAN).

Le sorgenti TD (DMX, PatchDeck, Yolo) mandano frame GLF1 in UDP sulla
porta 45480 (vedi laser_proto.py); il gateway sceglie per ogni cubo la
sorgente della sua modalita', applica la sicurezza (laser_render.py) e
alimenta il cubo col protocollo LaserOS ufficiale, a ritmo costante con
il controllo di flusso della specifica (par. 6 e 8).

Controllo e stato via MQTT, stesse convenzioni dei device Gaia:
  gaia/device/<id>/status   retained, ogni 2-5 s e a ogni cambio
  gaia/device/<id>/command  {"action": "arm"|"disarm"|"blackout"|"set"|
                             "status"|"scan"|"add_cube"|"remove_cube", ...}
Sicurezza: si parte sempre disarmati; blackout = disarma tutto; broker
perso da piu' di MQTT_LOSS_S -> disarma tutto; sorgente ferma da piu' di
STALE_S -> uscita spenta; un processo guardiano (laser_guard.py) spegne
i cubi se questo processo muore senza poterlo fare (l'agent lo ferma con
terminate(), che su Windows non lascia eseguire nessun cleanup).

Avvio: C:\\gaia\\venv\\Scripts\\python.exe laser_gateway.py
(servizio "laser" dell'agent; MQTT_HOST/MQTT_PORT arrivano dall'agent).
"""
import json
import logging
import math
import os
import signal
import socket
import subprocess
import sys
import threading
import time

import paho.mqtt.client as mqtt

import laser_proto as P
import laser_scene as SC
from laser_render import DEFAULTS as RENDER_DEFAULTS, circle, render

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.getenv("LASER_CONFIG", os.path.join(BASE_DIR, "cubes.json"))
DEVICE_ID = os.getenv("LASER_DEVICE_ID", "laser-ops")
MQTT_HOST = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "11883"))
GLF_PORT = int(os.getenv("LASER_GLF_PORT", str(P.GLF_PORT)))
STALE_S = 0.5          # sorgente zitta da piu' di cosi' -> uscita spenta
ONLINE_S = 3.5         # nessuna risposta GET_FULL_INFO da piu' di cosi' -> offline
MQTT_LOSS_S = 5.0
MODES = ("off", "test", "scene", "dmx", "patchdeck", "yolo")
INTERNAL_FPS = 30      # test e scene: frame generati dal gateway
PREVIEW_POINTS = 80    # anteprima per il Render della Plancia: punti per cubo...
PREVIEW_S = 0.16       # ...e ogni quanto (~6/s, solo mentre un cubo e' in uscita)
DARK = P.pack_sample(0x800, 0x800, 0, 0, 0) * P.SAMPLES_PER_PACKET   # campioni al buio, al centro

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("laser_gateway")


def now():
    return time.monotonic()


# ---------------------------------------------------------------- config
def load_config():
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
    except FileNotFoundError:
        cfg = {}
    cfg.setdefault("cubes", {})
    return cfg


def save_config(cfg):
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    os.replace(tmp, CONFIG_FILE)


def clean_value(key, v):
    """Valida un parametro di cubo; ValueError se non va bene."""
    if key == "mode":
        if v not in MODES:
            raise ValueError(f"modalita' sconosciuta: {v}")
        return v
    if key in ("name", "ip"):
        v = str(v).strip()
        if key == "ip":
            socket.inet_aton(v)
        return v
    if key in ("pps", "port_base"):
        v = int(v)
        if key == "pps" and not P.PPS_MIN <= v <= 35000:
            raise ValueError("pps fuori da 6000..35000")
        return v
    if key in ("flip_x", "flip_y"):
        return bool(v)
    if key == "zone":
        z = [float(a) for a in v]
        if len(z) != 4:
            raise ValueError("zone vuole [x0, y0, x1, y1]")
        return [max(-1.0, min(1.0, a)) for a in z]
    if key in ("master", "max_intensity"):
        return max(0.0, min(1.0, float(v)))
    if key == "scale":
        return max(0.05, min(1.0, float(v)))
    if key in ("offset_x", "offset_y"):
        return max(-1.0, min(1.0, float(v)))
    raise ValueError(f"parametro sconosciuto: {key}")


# ---------------------------------------------------------------- cubo
class Cube:
    """Un LaserCube: un thread che legge la telemetria e, se armato e con
    un frame fresco, tiene il ringbuffer del cubo al livello consigliato."""

    def __init__(self, cid, conf, gw):
        self.id = cid
        self.conf = conf
        self.gw = gw
        self.lock = threading.Lock()
        self.armed = False
        self.frame = None          # campioni del frame in uscita
        self.pending = None        # nuovo frame, preso al giro successivo
        self.frame_ts = 0.0
        self.info = None
        self.info_ts = 0.0
        self.streaming = False
        self.stats = {"packets": 0, "replies": 0, "pkt_errors": 0}
        self.ring_total = P.RING_DEFAULT
        self.rnum = 0
        self.pos = 0
        self.reply_used = None
        self.reply_inflight = 0
        self.reply_time = 0.0
        self.test_ts = 0.0
        self.scene_t0 = now()
        self.stop_flag = False
        self.thread = threading.Thread(target=self._run, name=f"cube-{cid}", daemon=True)

    # -- stato
    @property
    def mode(self):
        return self.conf.get("mode", "off")

    @property
    def pps(self):
        p = int(self.conf.get("pps", P.PPS_DEFAULT))
        if self.info and self.info.get("max_pps"):
            p = min(p, self.info["max_pps"])
        return max(P.PPS_MIN, p)

    def addr(self, port):
        return (self.conf["ip"], int(self.conf.get("port_base", P.PORT_ALIVE)) + port - P.PORT_ALIVE)

    def online(self):
        return self.info is not None and now() - self.info_ts < ONLINE_S

    def set_frame(self, samples):
        """samples None = frame vuoto o tutto spento: si proiettano campioni
        al buio, mai il frame precedente."""
        with self.lock:
            self.pending = samples if samples else DARK
            self.frame_ts = now()

    def drop_frame(self):
        """Cambio di sorgente: niente piu' contenuto finche' non arriva quello nuovo."""
        with self.lock:
            self.pending = None
            self.frame_ts = 0.0

    def summary(self):
        i = self.info or {}
        return {
            "id": self.id, "name": self.conf.get("name", self.id), "ip": self.conf.get("ip"),
            "mode": self.mode, "armed": self.armed, "streaming": self.streaming,
            "online": self.online(), "frame_age_ms": int((now() - self.frame_ts) * 1000) if self.frame_ts else None,
            "pps": self.pps, **{k: self.conf.get(k, d) for k, d in RENDER_DEFAULTS.items()},
            "scene": {"id": self.conf["scene"]["id"], "name": self.conf["scene"]["name"]} if self.conf.get("scene") else None,
            "model": i.get("model"), "fw": i.get("fw"), "mac": i.get("mac"),
            "battery": i.get("battery"), "charging": i.get("charging"), "temp_c": i.get("temp_c"),
            "interlock": i.get("interlock"), "temp_warn": i.get("temp_warn"),
            "temp_fault": i.get("temp_fault"), "conn_mode": i.get("conn_mode"),
            "pkt_errors": self.stats["pkt_errors"],
        }

    def preview(self, n=PREVIEW_POINTS):
        """Quello che il cubo sta proiettando davvero (dopo zona e intensita'),
        decimato per il Render della Plancia: [[x, y, colore], ...] con x,y in
        -100..100 e colore "rrggbb" (0 = spostamento al buio)."""
        frame = self.frame
        if not self.streaming or not frame:
            return None
        count = len(frame) // 10
        step = max(1, math.ceil(count / n))
        out = []
        for i in range(0, count, step):
            x, y, r, g, b = P.SAMPLE.unpack_from(frame, i * 10)
            col = f"{r >> 4:02x}{g >> 4:02x}{b >> 4:02x}" if (r | g | b) else 0
            out.append([round((x / P.DAC_MAX * 2 - 1) * 100), round((y / P.DAC_MAX * 2 - 1) * 100), col])
        return out

    # -- comandi verso il cubo
    def _cmd(self, payload, repeat=1):
        for _ in range(repeat):
            try:
                self.cmd_sock.sendto(payload, self.addr(P.PORT_CMD))
            except OSError as e:
                log.warning("%s: comando non spedito (%s)", self.id, e)

    def _stop_output(self):
        # UDP non garantisce la consegna: ripetuto, e' l'unico modo che
        # abbiamo per essere sicuri che il fascio si spenga
        self._cmd(bytes((P.OPC_CLEAR_RINGBUFFER,)), 3)
        self._cmd(P.cmd_set_output(False), 3)

    def _want_output(self):
        return (self.armed and self.mode != "off" and self.online()
                and not (self.info or {}).get("temp_fault")
                and (self.frame is not None or self.pending is not None)
                and now() - self.frame_ts < STALE_S)

    # -- thread
    def _run(self):
        self.data_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.data_sock.bind(("", 0))        # porta sorgente fissa per tutta la sessione
        try:
            self.data_sock.setsockopt(socket.IPPROTO_IP, socket.IP_TOS, P.TOS_CS4)
        except OSError:
            pass
        self.data_sock.setblocking(False)
        self.cmd_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.cmd_sock.bind(("", 0))
        self.cmd_sock.setblocking(False)
        next_info = 0.0
        while not self.stop_flag and not self.gw.stopping:
            t = now()
            if t >= next_info:
                self._cmd(bytes((P.OPC_GET_FULL_INFO,)))
                next_info = t + 1.0
            self._drain()
            want = self._want_output()
            if want and not self.streaming:
                self._start_stream()
            elif not want and self.streaming:
                self._end_stream()
            if self.streaming:
                self._stream_tick()
            else:
                time.sleep(0.02)
        if self.streaming:
            self._end_stream()
        for s in (self.data_sock, self.cmd_sock):
            s.close()

    def _drain(self):
        while True:
            try:
                reply, _ = self.data_sock.recvfrom(64)
            except (BlockingIOError, ConnectionResetError):
                break
            if len(reply) >= 4 and reply[0] == P.OPC_GET_RING_FREE:
                self.stats["replies"] += 1
                self.reply_used = self.ring_total - (reply[2] | (reply[3] << 8))
                self.reply_inflight = (self.rnum - reply[1] - 1) & 0xFF
                self.reply_time = now()
        while True:
            try:
                reply, _ = self.cmd_sock.recvfrom(128)
            except (BlockingIOError, ConnectionResetError):
                break
            info = P.parse_full_info(reply)
            if info:
                was = self.online()
                self.stats["pkt_errors"] += info["pkt_errors"]
                self.info, self.info_ts = info, now()
                if not was:
                    log.info("%s online: %s fw %s (%s)", self.id, info["model"], info["fw"], info["conn_mode"])
                    self.gw.status_dirty = True

    def _start_stream(self):
        pps = self.pps
        self.ring_total = (self.info or {}).get("ring_total") or P.RING_DEFAULT
        self._cmd(P.cmd_set_rate(pps))
        self._cmd(bytes((P.OPC_CLEAR_RINGBUFFER,)))
        self.rnum = 0
        self.pos = 0
        self.reply_used = None
        self.reply_inflight = 0
        self.reply_time = 0.0
        self.stream_pps = pps
        self.period = P.SAMPLES_PER_PACKET / pps
        self.streaming = True
        self.gw.status_dirty = True
        log.info("%s: uscita accesa (%s, %d pps)", self.id, self.mode, pps)
        # pre-riempimento: a raffica fino al livello consigliato (spec par. 6)
        for _ in range(40):
            self._send_one()
            time.sleep(0.001)
            self._drain()
            used = self._used_now()
            if used is not None and used >= P.TARGET_USED:
                break
        self.next_tick = now()

    def _end_stream(self):
        self._stop_output()
        self.streaming = False
        with self.lock:
            self.frame = None
        self.gw.status_dirty = True
        log.info("%s: uscita spenta", self.id)

    def _used_now(self):
        if self.reply_used is None:
            return None
        played = self.stream_pps * (now() - self.reply_time)
        return self.reply_used + self.reply_inflight * P.SAMPLES_PER_PACKET - played

    def _next_payload(self):
        need = P.SAMPLES_PER_PACKET * 10
        out = bytearray()
        while len(out) < need:
            if self.pos == 0 or self.frame is None:
                with self.lock:
                    if self.pending is not None:
                        self.frame, self.pending = self.pending, None
                        self.pos = 0
            frame = self.frame
            if frame is None:
                frame = self.frame = DARK
                self.pos = 0
            take = frame[self.pos:self.pos + need - len(out)]
            out += take
            self.pos = (self.pos + len(take)) % len(frame)
        return bytes(out)

    def _send_one(self):
        try:
            self.data_sock.sendto(P.data_packet(self.rnum, self._next_payload()), self.addr(P.PORT_DATA))
        except OSError as e:
            log.warning("%s: invio campioni fallito (%s)", self.id, e)
            return
        self.stats["packets"] += 1
        self.rnum = (self.rnum + 1) & 0xFF

    def _stream_tick(self):
        used = self._used_now()
        pkt = P.SAMPLES_PER_PACKET
        if used is None:
            burst = 1
        elif used < P.TARGET_USED - pkt:
            burst = 2
        elif used > P.TARGET_USED + pkt:
            burst = 0
        else:
            burst = 1
        for _ in range(burst):
            self._send_one()
        self.next_tick += self.period
        delay = self.next_tick - now()
        if delay > 0:
            time.sleep(delay)
        elif delay < -0.05:
            self.next_tick = now()


# ---------------------------------------------------------------- gateway
class Gateway:
    def __init__(self):
        self.cfg = load_config()
        self.client = None
        self.cubes = {}
        self.stopping = False
        self.status_dirty = True
        self.sources = {}          # nome -> {"ts", "frames", "points", "from"}
        self.partial = {}          # (src, tgt, seq) -> {idx: punti}
        self.found = []
        self.last_result = None
        self.mqtt_ok_ts = now()
        self.mqtt_up = False
        self.audio = {"level": 0.0, "at": 0.0, "kick_at": 0.0, "kicks": {}}
        self.cfg_lock = threading.RLock()
        for cid, conf in self.cfg["cubes"].items():
            if conf.get("scene"):
                try:
                    conf["scene"] = SC.clean_scene(conf["scene"])
                except ValueError:
                    conf.pop("scene")
            self._add(cid, conf)

    def _add(self, cid, conf):
        c = Cube(cid, conf, self)
        self.cubes[cid] = c
        c.thread.start()
        if c.mode == "test":
            self._test_frame(c)
        return c

    def save(self):
        with self.cfg_lock:
            save_config(self.cfg)

    # -- sorgenti
    def _glf_loop(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
        sock.bind(("0.0.0.0", GLF_PORT))
        sock.settimeout(0.2)
        log.info("frame GLF1 in ascolto su udp/%d", GLF_PORT)
        while not self.stopping:
            try:
                pkt, peer = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                continue
            d = P.glf_decode(pkt)
            if not d:
                continue
            src, tgt, seq, idx, count, pts = d
            if count == 1:
                self._on_frame(src, tgt, pts, peer[0])
            else:
                key = (src, tgt, seq)
                parts = self.partial.setdefault(key, {})
                parts[idx] = pts
                if len(parts) == count:
                    del self.partial[key]
                    self._on_frame(src, tgt, [p for i in range(count) for p in parts[i]], peer[0])
                if len(self.partial) > 32:      # chunk persi: si butta il vecchio
                    for k in list(self.partial)[:-8]:
                        del self.partial[k]

    def _on_frame(self, src, tgt, pts, ip):
        s = self.sources.setdefault(src, {"frames": 0})
        if "ts" not in s:
            self.status_dirty = True
        s.update(ts=now(), points=len(pts), ip=ip)
        s["frames"] += 1
        for c in list(self.cubes.values()):
            if c.mode == src and tgt in ("*", c.id):
                c.set_frame(render(pts, c.conf, c.pps))

    def _test_frame(self, c):
        c.set_frame(render(circle(0.5, 600, (255, 255, 255)), c.conf, c.pps))
        c.test_ts = now()

    def _internal_loop(self):
        """Sorgenti generate dal gateway: il cerchio di prova (fermo, 10/s
        basta) e le scene animate (INTERNAL_FPS)."""
        period = 1.0 / INTERNAL_FPS
        while not self.stopping:
            t0 = now()
            level, kick = self.audio_now()
            for c in list(self.cubes.values()):
                try:
                    if c.mode == "test" and t0 - c.test_ts > 0.1:
                        self._test_frame(c)
                    elif c.mode == "scene" and c.conf.get("scene"):
                        pts = SC.animate(c.conf["scene"], t0 - c.scene_t0, level, kick)
                        c.set_frame(render(pts, c.conf, c.pps))
                except Exception as e:          # una scena rotta non deve fermare gli altri cubi
                    log.warning("%s: scena non disegnabile (%s)", c.id, e)
            time.sleep(max(0.0, period - (now() - t0)))

    # -- audio dal controller, attraverso i meter dei rig di DMX Master
    def _on_rigs(self, payload):
        try:
            rigs = json.loads(payload).get("rigs") or {}
        except (ValueError, AttributeError):
            return
        level, t = 0.0, now()
        for key, r in rigs.items():
            if not isinstance(r, dict):
                continue
            try:
                level = max(level, float(r.get("level") or 0))
            except (TypeError, ValueError):
                pass
            k = r.get("kicks")
            if k is not None and self.audio["kicks"].get(key) not in (None, k):
                self.audio["kick_at"] = t
            self.audio["kicks"][key] = k
        self.audio.update(level=max(0.0, min(1.0, level)), at=t)

    def audio_now(self):
        t = now()
        level = self.audio["level"] if t - self.audio["at"] < 1.0 else 0.0
        return level, max(0.0, 1.0 - (t - self.audio["kick_at"]) / 0.25)

    def _set_mode(self, c, v):
        with self.cfg_lock:
            c.conf["mode"] = v
        if v == "off":
            c.armed = False
        if v == "test":
            self._test_frame(c)
        else:
            c.drop_frame()
            c.scene_t0 = now()

    # -- MQTT
    def status_payload(self):
        t = now()
        return {
            "device_id": DEVICE_ID, "name": "Laser", "family": "laser", "role": "laser",
            "ip": _lan_ip(), "services": {}, "params": {},
            "laser": {
                "v": 1, "glf_port": GLF_PORT, "modes": list(MODES),
                "cubes": [c.summary() for c in self.cubes.values()],
                "sources": {k: {"age_ms": int((t - v["ts"]) * 1000), "points": v["points"],
                                "frames": v["frames"], "ip": v["ip"]}
                            for k, v in self.sources.items() if "ts" in v},
                "found": self.found,
                "last_result": self.last_result,
            },
            "ts": int(time.time() * 1000),
        }

    def preview_payload(self):
        cubes = {c.id: p for c in list(self.cubes.values()) if (p := c.preview())}
        return {"ts": int(time.time() * 1000), "cubes": cubes} if cubes else None

    def publish_preview(self):
        p = self.preview_payload()
        if p and self.client and self.mqtt_up:
            self.client.publish(f"gaia/devices/{DEVICE_ID}/laser_preview", json.dumps(p, separators=(",", ":")))

    def publish_status(self):
        if self.client and self.mqtt_up:
            self.client.publish(f"gaia/device/{DEVICE_ID}/status", json.dumps(self.status_payload()), retain=True)
        self.status_dirty = False

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            self.mqtt_up = True
            self.mqtt_ok_ts = now()
            client.subscribe(f"gaia/device/{DEVICE_ID}/command")
            client.subscribe("gaia/devices/+/dmx_rigs")
            log.info("MQTT connesso a %s:%d", MQTT_HOST, MQTT_PORT)
            self.status_dirty = True

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        self.mqtt_up = False
        log.warning("MQTT disconnesso (%s)", reason_code)

    def _on_message(self, client, userdata, msg):
        if msg.topic.endswith("/dmx_rigs"):
            self._on_rigs(msg.payload)
            return
        try:
            cmd = json.loads(msg.payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return
        if isinstance(cmd, dict):
            self.handle(cmd)

    def handle(self, cmd):
        action = cmd.get("action", "")
        try:
            msg = self._do(action, cmd)
            res = {"ok": True, "msg": msg}
        except (ValueError, KeyError, TypeError, OSError) as e:
            res = {"ok": False, "msg": str(e)}
            log.warning("comando %s rifiutato: %s", action, e)
        self.last_result = {"action": action, "req": cmd.get("req"), **res, "ts": int(time.time() * 1000)}
        self.status_dirty = True
        return res

    def _targets(self, cmd):
        cid = cmd.get("cube", "all")
        if cid == "all":
            return list(self.cubes.values())
        if cid not in self.cubes:
            raise KeyError(f"cubo sconosciuto: {cid}")
        return [self.cubes[cid]]

    def _do(self, action, cmd):
        if action == "status":
            return "ok"
        if action == "blackout":
            self.disarm_all("blackout")
            return "blackout: tutti i cubi disarmati"
        if action == "disarm":
            for c in self._targets(cmd):
                c.armed = False
            return "disarmato"
        if action == "arm":
            if cmd.get("cube", "all") == "all":
                raise ValueError("si arma un cubo alla volta")
            c = self._targets(cmd)[0]
            if not c.online():
                raise ValueError(f"{c.id} non risponde: controlla rete, chiave e interlock")
            if c.mode == "off":
                raise ValueError(f"{c.id}: scegli prima una modalita'")
            if (c.info or {}).get("temp_fault"):
                raise ValueError(f"{c.id}: surriscaldato")
            c.armed = True
            log.info("%s ARMATO (%s)", c.id, c.mode)
            return f"{c.id} armato"
        if action == "set":
            cid, _, key = str(cmd.get("param", "")).partition("_")
            if cid not in self.cubes:
                raise KeyError(f"cubo sconosciuto: {cid}")
            c = self.cubes[cid]
            v = clean_value(key, cmd.get("value"))
            with self.cfg_lock:
                c.conf[key] = v
            self.save()
            if key == "mode":
                self._set_mode(c, v)
            elif key == "ip":
                c.info = None
                c.armed = False
            elif c.mode == "test":
                self._test_frame(c)
            return f"{cid}.{key} = {v}"
        if action == "mode":
            v = clean_value("mode", cmd.get("value"))
            cubes = self._targets(cmd)
            for c in cubes:
                self._set_mode(c, v)
            self.save()
            return f"modalita' {v} su {', '.join(c.id for c in cubes) or 'nessun cubo'}"
        if action == "scene":
            sc = SC.clean_scene(cmd.get("scene"))
            cubes = self._targets(cmd)
            for c in cubes:
                with self.cfg_lock:
                    c.conf["scene"] = sc
                c.scene_t0 = now()
                if cmd.get("mode", True) and c.mode != "scene":
                    self._set_mode(c, "scene")
            self.save()
            return f"scena {sc['name']} su {', '.join(c.id for c in cubes) or 'nessun cubo'}"
        if action == "add_cube":
            ip = clean_value("ip", cmd["ip"])
            cid = cmd.get("cube") or next(f"c{i}" for i in range(1, 100) if f"c{i}" not in self.cubes)
            if cid in self.cubes or "_" in cid:
                raise ValueError(f"id non valido o gia' usato: {cid}")
            conf = {"name": cmd.get("name") or f"Laser {cid[1:]}", "ip": ip, "mode": "off",
                    **{k: v for k, v in RENDER_DEFAULTS.items()}}
            if "port_base" in cmd:
                conf["port_base"] = int(cmd["port_base"])
            with self.cfg_lock:
                self.cfg["cubes"][cid] = conf
            self.save()
            self._add(cid, conf)
            return f"aggiunto {cid} ({ip})"
        if action == "remove_cube":
            c = self._targets(cmd)[0] if cmd.get("cube", "all") != "all" else None
            if c is None:
                raise ValueError("indica il cubo da togliere")
            c.armed = False
            c.stop_flag = True
            c.thread.join(timeout=2)
            del self.cubes[c.id]
            with self.cfg_lock:
                self.cfg["cubes"].pop(c.id, None)
            self.save()
            return f"tolto {c.id}"
        if action == "scan":
            threading.Thread(target=self._scan, daemon=True).start()
            return "ricerca avviata"
        raise ValueError(f"azione sconosciuta: {action}")

    def disarm_all(self, why):
        any_armed = any(c.armed for c in self.cubes.values())
        for c in self.cubes.values():
            c.armed = False
        if any_armed:
            log.warning("tutti i cubi disarmati: %s", why)
        self.status_dirty = True

    def _scan(self):
        """Ping con ID in broadcast sulla porta di scoperta: la specifica non
        prevede il multicast, ma il cubo ascolta su tutte le interfacce."""
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(0.3)
        seen = {}
        for _ in range(3):
            for dst in ("255.255.255.255", _bcast(_lan_ip())):
                try:
                    s.sendto(bytes((P.OPC_ALIVE_WITH_ID,)), (dst, P.PORT_ALIVE))
                except OSError:
                    pass
            end = now() + 0.4
            while now() < end:
                try:
                    reply, (ip, _) = s.recvfrom(16)
                except (socket.timeout, ConnectionResetError):
                    break
                if reply and reply[0] == P.OPC_ALIVE_WITH_ID:
                    seen[ip] = ":".join(f"{b:02x}" for b in reply[1:7]) if len(reply) >= 7 else None
        s.close()
        known = {c.conf.get("ip"): c.id for c in self.cubes.values()}
        self.found = [{"ip": ip, "mac": mac, "cube": known.get(ip)} for ip, mac in sorted(seen.items())]
        log.info("ricerca cubi: %s", self.found)
        self.status_dirty = True

    # -- main
    def run(self):
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"{DEVICE_ID}-{os.getpid()}")
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.will_set(f"gaia/device/{DEVICE_ID}/status",
                             json.dumps({"device_id": DEVICE_ID, "name": "Laser", "family": "laser",
                                         "role": "laser", "offline": True}), retain=True)
        self.client.reconnect_delay_set(1, 5)
        self.client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=10)
        self.client.loop_start()
        threading.Thread(target=self._glf_loop, name="glf", daemon=True).start()
        threading.Thread(target=self._internal_loop, name="internal", daemon=True).start()
        guard = start_guard()
        next_status = 0.0
        next_preview = 0.0
        try:
            while not self.stopping:
                t = now()
                if t >= next_preview:
                    self.publish_preview()
                    next_preview = t + PREVIEW_S
                if self.mqtt_up:
                    self.mqtt_ok_ts = t
                elif t - self.mqtt_ok_ts > MQTT_LOSS_S and any(c.armed for c in self.cubes.values()):
                    self.disarm_all("broker MQTT perso")
                if self.status_dirty or t >= next_status:
                    self.publish_status()
                    busy = any(c.armed or c.streaming for c in self.cubes.values())
                    next_status = t + (2.0 if busy else 5.0)
                time.sleep(0.1)
        finally:
            self.shutdown()
            if guard:
                guard.terminate()

    def shutdown(self):
        self.stopping = True
        for c in self.cubes.values():
            c.armed = False
        for c in self.cubes.values():
            c.thread.join(timeout=2)
        if self.client is None:
            return
        try:
            self.client.publish(f"gaia/device/{DEVICE_ID}/status",
                                json.dumps({"device_id": DEVICE_ID, "name": "Laser", "family": "laser",
                                            "role": "laser", "offline": True}), retain=True).wait_for_publish(1)
            self.client.loop_stop()
        except (RuntimeError, ValueError):
            pass
        log.info("gateway fermato, uscite spente")


def start_guard():
    """Guardiano: processo separato che spegne i cubi se questo muore."""
    if os.getenv("LASER_NO_GUARD") == "1":
        return None
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        return subprocess.Popen([sys.executable, os.path.join(BASE_DIR, "laser_guard.py"),
                                 str(os.getpid()), CONFIG_FILE], creationflags=flags)
    except OSError as e:
        log.error("guardiano non avviato: %s", e)
        return None


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.1.1", 9))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def _bcast(ip):
    return ".".join(ip.split(".")[:3] + ["255"]) if ip else "255.255.255.255"


def main():
    gw = Gateway()

    def stop(*_):
        gw.stopping = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, stop)
    log.info("laser gateway %s: %d cubi in configurazione", DEVICE_ID, len(gw.cubes))
    gw.run()


if __name__ == "__main__":
    main()
