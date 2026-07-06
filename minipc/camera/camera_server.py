"""
GAIA Camera Server (miniPC) — stesso pattern del Pi (shared memory seqlock)
+ MJPEG HTTP stream sulla porta MJPEG_PORT (default 8766).

Il MJPEG serve la welcome page (e qualsiasi altro client HTTP locale) senza
che questi debbano aprire il device V4L2 direttamente — evita il conflitto
con YOLO e MediaPipe che leggono dalla shared memory.

Shared memory:
  gaia_cam_header  — header seqlock (seq, ts_ns, w, h, bytes, ch)
  gaia_cam_frame   — frame grezzo BGR

MJPEG:
  GET http://localhost:8766/video  — stream multipart/x-mixed-replace
"""
import os
import sys
import struct
import time
import signal
import logging
import threading
import queue
from http.server import HTTPServer, BaseHTTPRequestHandler
from multiprocessing.shared_memory import SharedMemory

import cv2
import numpy as np
import config
from camera_client import SHM_HEADER_NAME, SHM_FRAME_NAME, HEADER_FMT, HEADER_SIZE

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('gaia-camera')

MJPEG_PORT    = int(os.environ.get('MJPEG_PORT', '8766'))
MJPEG_QUALITY = int(os.environ.get('MJPEG_QUALITY', '70'))

_running = True

# Registro client MJPEG: ogni connessione ha la propria coda
_clients: list[queue.Queue] = []
_clients_lock = threading.Lock()


def _shutdown(sig, frame):
    global _running
    log.info(f"Segnale {sig} ricevuto, shutdown...")
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


# ── MJPEG HTTP server ─────────────────────────────────────────────────────────

class MJPEGHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silenzia il log HTTP (troppo verboso a 15fps)

    def do_GET(self):
        if self.path not in ('/', '/video'):
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store')
        self.send_header('Pragma', 'no-cache')
        self.end_headers()

        q: queue.Queue = queue.Queue(maxsize=2)
        with _clients_lock:
            _clients.append(q)
        log.info(f"MJPEG client connesso ({len(_clients)} totali)")

        try:
            while _running:
                try:
                    jpg_bytes = q.get(timeout=2.0)
                except queue.Empty:
                    # Invia keep-alive vuoto per mantenere la connessione
                    continue
                try:
                    self.wfile.write(
                        b'--frame\r\n'
                        b'Content-Type: image/jpeg\r\n\r\n'
                        + jpg_bytes +
                        b'\r\n'
                    )
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
        finally:
            with _clients_lock:
                try:
                    _clients.remove(q)
                except ValueError:
                    pass
            log.info(f"MJPEG client disconnesso ({len(_clients)} rimasti)")


def _mjpeg_server_thread():
    srv = HTTPServer(('0.0.0.0', MJPEG_PORT), MJPEGHandler)
    srv.timeout = 1.0
    log.info(f"MJPEG stream attivo: http://0.0.0.0:{MJPEG_PORT}/video")
    while _running:
        srv.handle_request()
    srv.server_close()


# ── Shared memory helpers ─────────────────────────────────────────────────────

def _unlink_if_exists(name):
    try:
        stale = SharedMemory(name=name, create=False)
        stale.close()
        stale.unlink()
        log.warning(f"Rimosso segmento residuo: {name}")
    except FileNotFoundError:
        pass


def _open_camera():
    # Su Windows il backend MSMF di default fallisce silenziosamente il grab
    # (isOpened()==True ma read() non ritorna mai un frame) su alcune webcam
    # (es. HD Pro Webcam C920) — DSHOW funziona in modo affidabile. Su
    # Linux/Pi resta CAP_ANY (V4L2), comportamento invariato.
    backend = cv2.CAP_DSHOW if sys.platform == 'win32' else cv2.CAP_ANY
    cap = cv2.VideoCapture(config.CAMERA_INDEX, backend)
    if not cap.isOpened():
        return None, 0, 0
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  config.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)
    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if actual_w != config.FRAME_WIDTH or actual_h != config.FRAME_HEIGHT:
        log.warning(f"Risoluzione negoziata {actual_w}x{actual_h} (richiesta {config.FRAME_WIDTH}x{config.FRAME_HEIGHT})")
    return cap, actual_w, actual_h


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log.info(f"Apertura camera index={config.CAMERA_INDEX}...")
    cap, width, height = _open_camera()
    if cap is None:
        log.error(f"Camera {config.CAMERA_INDEX} non accessibile, esco")
        raise SystemExit(1)

    channels   = 3  # BGR
    frame_bytes = width * height * channels
    log.info(f"Camera aperta: {width}x{height} ({frame_bytes} byte/frame)")

    _unlink_if_exists(SHM_HEADER_NAME)
    _unlink_if_exists(SHM_FRAME_NAME)

    header_shm = SharedMemory(name=SHM_HEADER_NAME, create=True, size=max(HEADER_SIZE, 64))
    frame_shm  = SharedMemory(name=SHM_FRAME_NAME,  create=True, size=frame_bytes)
    log.info(f"Shared memory creata: {SHM_HEADER_NAME}, {SHM_FRAME_NAME}")

    # Avvia MJPEG server in background
    t = threading.Thread(target=_mjpeg_server_thread, daemon=True)
    t.start()

    seq = 0
    min_interval = (1.0 / config.FPS_LIMIT) if config.FPS_LIMIT > 0 else 0.0
    last_loop    = 0.0
    encode_param = [cv2.IMWRITE_JPEG_QUALITY, MJPEG_QUALITY]

    try:
        while _running:
            if min_interval:
                elapsed = time.time() - last_loop
                if elapsed < min_interval:
                    time.sleep(min_interval - elapsed)
            last_loop = time.time()

            if cap is None or not cap.isOpened():
                log.warning("Camera persa, riapro tra 5s...")
                time.sleep(5)
                cap, new_w, new_h = _open_camera()
                if cap is not None and (new_w != width or new_h != height):
                    log.error(f"Risoluzione cambiata al riavvio ({new_w}x{new_h}) — esco")
                    raise SystemExit(1)
                continue

            ret, frame = cap.read()
            if not ret:
                log.warning("Frame non letto")
                time.sleep(0.1)
                continue

            if frame.shape[1] != width or frame.shape[0] != height:
                continue

            # ── Seqlock write ────────────────────────────────────────────────
            seq += 1
            struct.pack_into("<Q", header_shm.buf, 0, seq)
            frame_shm.buf[:frame_bytes] = frame.tobytes()
            seq += 1
            struct.pack_into(HEADER_FMT, header_shm.buf, 0,
                             seq, time.monotonic_ns(), width, height, frame_bytes, channels)

            # ── MJPEG distribution ───────────────────────────────────────────
            with _clients_lock:
                if _clients:
                    _, jpg = cv2.imencode('.jpg', frame, encode_param)
                    jpg_bytes = jpg.tobytes()
                    for q in _clients:
                        if q.full():
                            try: q.get_nowait()  # scarta frame vecchio
                            except queue.Empty: pass
                        try: q.put_nowait(jpg_bytes)
                        except queue.Full: pass

    finally:
        log.info("Chiusura camera_server...")
        if cap is not None:
            cap.release()
        header_shm.close()
        header_shm.unlink()
        frame_shm.close()
        frame_shm.unlink()
        log.info("Shared memory rilasciata. Terminato.")


if __name__ == "__main__":
    main()
