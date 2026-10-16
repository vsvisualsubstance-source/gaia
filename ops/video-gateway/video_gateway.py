"""
Plancia Video Service -- PoC: gateway NDI -> WebRTC.

Implementazione alternativa a quella proposta in TD4PatchDeck
(GStreamer+webrtcbin): stesso obiettivo e stessa API (vedi
docs/architecture/plancia-video-service.md in TD4PatchDeck), ma in
Python puro con aiortc (WebRTC nativo, niente GStreamer da
compilare/wire-are su Windows) + ndi-python (bindings sul runtime NDI 6
gia' installato in C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime).

Avvio: C:\\Program Files\\Python311\\python.exe video_gateway.py
Ascolta su 0.0.0.0:8788. Persistente su OPS via Scheduled Task
GAIA-OPS-VideoGateway (run_video_gateway_hidden.vbs -> run_video_gateway.bat).
"""
import asyncio
import logging
import os
import threading
import time
import uuid

import numpy as np
import NDIlib as ndi
from aiohttp import web
from av import VideoFrame
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.mediastreams import MediaStreamError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("video_gateway")

TARGET_FPS = 18  # nel range 15-20fps della proposta
TARGET_W, TARGET_H = 640, 360

if not ndi.initialize():
    raise SystemExit("ndi.initialize() fallito -- NDI runtime non trovato")

# ---------------------------------------------------------------- discovery
_find = ndi.find_create_v2()
_sources_lock = threading.Lock()
_sources = {}  # nome -> oggetto source NDI (ri-creato ad ogni refresh)


def _discovery_loop():
    while True:
        ndi.find_wait_for_sources(_find, 2000)
        found = ndi.find_get_current_sources(_find)
        with _sources_lock:
            _sources.clear()
            for s in found:
                _sources[s.ndi_name] = s
        time.sleep(0.5)


threading.Thread(target=_discovery_loop, daemon=True).start()


def list_sources():
    with _sources_lock:
        return sorted(_sources.keys())


# ------------------------------------------------------------- NDI receiver
class NdiReceiver:
    """Un ricevitore NDI per sorgente, condiviso fra piu' preview dello
    stesso source invece di aprire N connessioni NDI separate."""

    _registry = {}
    _registry_lock = threading.Lock()

    def __init__(self, source_name):
        self.source_name = source_name
        self.refcount = 0
        self._lock = threading.Lock()
        self._latest = None  # (ndarray RGB, monotonic_ts)
        self._stop = False
        self._recv = None
        self._thread = threading.Thread(target=self._run, daemon=True)

    @classmethod
    def acquire(cls, source_name):
        with cls._registry_lock:
            r = cls._registry.get(source_name)
            if r is None:
                r = cls(source_name)
                cls._registry[source_name] = r
                r._thread.start()
            r.refcount += 1
            return r

    def release(self):
        with self._registry_lock:
            self.refcount -= 1
            if self.refcount <= 0:
                self._stop = True
                self._registry.pop(self.source_name, None)

    def _run(self):
        with _sources_lock:
            src = _sources.get(self.source_name)
        if src is None:
            log.warning("sorgente NDI '%s' non (piu') trovata", self.source_name)
            return
        settings = ndi.RecvCreateV3()
        settings.source_to_connect_to = src
        settings.color_format = ndi.RECV_COLOR_FORMAT_BGRX_BGRA
        settings.bandwidth = ndi.RECV_BANDWIDTH_LOWEST  # preview, non e' l'output dello show
        recv = ndi.recv_create_v3(settings)
        self._recv = recv
        log.info("NDI receiver connesso a '%s'", self.source_name)
        while not self._stop:
            t, v, a, m = ndi.recv_capture_v2(recv, 200)
            if t == ndi.FRAME_TYPE_VIDEO:
                img = v.data  # BGRA, shape (H,W,4)
                rgb = img[:, :, [2, 1, 0]]  # BGRA -> RGB (scarta alpha)
                with self._lock:
                    self._latest = (rgb.copy(), time.monotonic())
                ndi.recv_free_video_v2(recv, v)
        ndi.recv_destroy(recv)
        log.info("NDI receiver per '%s' chiuso", self.source_name)

    def latest(self):
        with self._lock:
            return self._latest


# --------------------------------------------------------------- video track
class NdiVideoTrack(VideoStreamTrack):
    def __init__(self, receiver: NdiReceiver):
        super().__init__()
        self.receiver = receiver

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        frame_data = None
        for _ in range(100):
            frame_data = self.receiver.latest()
            if frame_data is not None:
                break
            await asyncio.sleep(0.02)
        if frame_data is None:
            raise MediaStreamError("nessun frame NDI disponibile")
        rgb, _ts = frame_data
        h, w, _ = rgb.shape
        # downscale al profilo di preview (nota: letterbox non gestito nel
        # PoC, resize diretto -- va bene per validare la pipeline)
        frame = VideoFrame.from_ndarray(rgb, format="rgb24")
        if (w, h) != (TARGET_W, TARGET_H):
            frame = frame.reformat(width=TARGET_W, height=TARGET_H)
        frame.pts = pts
        frame.time_base = time_base
        return frame


# ------------------------------------------------------------------- server
pcs = {}  # preview_id -> {"pc": RTCPeerConnection, "receiver": NdiReceiver, "source": str}


async def handle_sources(request):
    return web.json_response({"sources": list_sources()})


async def handle_create_preview(request):
    body = await request.json()
    source_name = body.get("source")
    offer = body.get("offer")
    if not source_name or not offer:
        return web.json_response({"error": "serve 'source' e 'offer'"}, status=400)
    if source_name not in list_sources():
        return web.json_response({"error": f"sorgente '{source_name}' non trovata"}, status=404)

    receiver = NdiReceiver.acquire(source_name)
    pc = RTCPeerConnection()
    preview_id = str(uuid.uuid4())

    @pc.on("connectionstatechange")
    async def on_state_change():
        log.info("preview %s: connection state -> %s", preview_id, pc.connectionState)
        if pc.connectionState in ("failed", "closed"):
            await _cleanup(preview_id)

    pc.addTrack(NdiVideoTrack(receiver))

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    pcs[preview_id] = {"pc": pc, "receiver": receiver, "source": source_name}
    log.info("preview %s creata per sorgente '%s'", preview_id, source_name)

    return web.json_response({
        "id": preview_id,
        "answer": {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
    })


async def _cleanup(preview_id):
    entry = pcs.pop(preview_id, None)
    if not entry:
        return
    await entry["pc"].close()
    entry["receiver"].release()
    log.info("preview %s chiusa e pulita", preview_id)


async def handle_delete_preview(request):
    preview_id = request.match_info["id"]
    if preview_id not in pcs:
        return web.json_response({"error": "non trovata"}, status=404)
    await _cleanup(preview_id)
    return web.json_response({"ok": True})


async def handle_preview_status(request):
    preview_id = request.match_info["id"]
    entry = pcs.get(preview_id)
    if not entry:
        return web.json_response({"error": "non trovata"}, status=404)
    return web.json_response({
        "id": preview_id,
        "source": entry["source"],
        "connectionState": entry["pc"].connectionState,
    })


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        resp = web.Response()
    else:
        resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


async def handle_index(request):
    with open(os.path.join(BASE_DIR, "test_preview.html"), "r", encoding="utf-8") as f:
        return web.Response(text=f.read(), content_type="text/html")


app = web.Application(middlewares=[cors_middleware])
app.router.add_get("/", handle_index)
app.router.add_get("/api/sources", handle_sources)
app.router.add_post("/api/previews", handle_create_preview)
app.router.add_get("/api/previews/{id}/status", handle_preview_status)
app.router.add_delete("/api/previews/{id}", handle_delete_preview)
app.router.add_route("OPTIONS", "/{tail:.*}", lambda r: web.Response())

if __name__ == "__main__":
    log.info("Plancia Video Service (PoC) in ascolto su :8788")
    web.run_app(app, host="0.0.0.0", port=8788)
