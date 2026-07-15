"""
GAIA Camera Server — apre la camera una sola volta e pubblica ogni frame in
shared memory (protocollo seqlock), così YOLO e MediaPipe possono leggere lo
stesso flusso senza aprire ciascuno il proprio cv2.VideoCapture sullo stesso
device V4L2 (inaffidabile/spesso fallisce con due processi concorrenti).

Vedi camera_client.py per il lato lettore (duplicato in yolo/ e mediapipe/).
"""
import struct
import time
import signal
import logging
import queue
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from multiprocessing.shared_memory import SharedMemory

import cv2
import config
from camera_client import SHM_HEADER_NAME, SHM_FRAME_NAME, HEADER_FMT, HEADER_SIZE

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('gaia-camera')

_running = True


# ── MJPEG HTTP stream (porting dalla versione minipc, F2 gaia-semantico) ─────
# Encode JPEG SOLO quando ci sono client connessi: a riposo costo zero per il Pi.
_clients: list = []
_clients_lock = threading.Lock()


class MJPEGHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

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
                    jpg = q.get(timeout=2.0)
                except queue.Empty:
                    continue
                try:
                    self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpg + b'\r\n')
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
    # ThreadingHTTPServer: ogni client MJPEG tiene la connessione per sempre
    # (kiosk!) — col server single-thread il primo client monopolizzava lo
    # stream e tutti gli altri restavano in coda senza mai essere accettati.
    srv = ThreadingHTTPServer(('0.0.0.0', config.MJPEG_PORT), MJPEGHandler)
    srv.daemon_threads = True
    srv.timeout = 1.0
    log.info(f"MJPEG stream attivo: http://0.0.0.0:{config.MJPEG_PORT}/video")
    while _running:
        srv.handle_request()
    srv.server_close()


def _mjpeg_broadcast(frame, state):
    """Encode+push ai client connessi, throttled a MJPEG_FPS."""
    with _clients_lock:
        if not _clients:
            return
    now = time.time()
    if now - state.get('last', 0) < 1.0 / max(config.MJPEG_FPS, 1):
        return
    state['last'] = now
    ok, jpg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, config.MJPEG_QUALITY])
    if not ok:
        return
    data = jpg.tobytes()
    with _clients_lock:
        for q in _clients:
            try:
                q.put_nowait(data)
            except queue.Full:
                pass   # client lento: salta il frame


def _shutdown(sig, frame):
    global _running
    log.info(f"Segnale {sig} ricevuto, shutdown...")
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


def _unlink_if_exists(name):
    """Pulisce segmenti residui di un avvio precedente non terminato pulitamente
    (altrimenti create=True solleva FileExistsError)."""
    try:
        stale = SharedMemory(name=name, create=False)
        stale.close()
        stale.unlink()
        log.warning(f"Rimosso segmento residuo: {name}")
    except FileNotFoundError:
        pass


def _open_camera():
    cap = cv2.VideoCapture(config.CAMERA_INDEX)
    if not cap.isOpened():
        return None, 0, 0

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)

    # Il driver V4L2 può arrotondare alla risoluzione supportata più vicina:
    # usa SEMPRE i valori realmente negoziati per dimensionare la shared memory.
    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if actual_w != config.FRAME_WIDTH or actual_h != config.FRAME_HEIGHT:
        log.warning(
            f"Risoluzione negoziata {actual_w}x{actual_h} diversa da quella "
            f"richiesta {config.FRAME_WIDTH}x{config.FRAME_HEIGHT}"
        )
    return cap, actual_w, actual_h


def main():
    log.info(f"Apertura camera index={config.CAMERA_INDEX}...")
    cap, width, height = _open_camera()
    if cap is None:
        log.error(f"Camera {config.CAMERA_INDEX} non accessibile, esco")
        raise SystemExit(1)

    channels = 3  # BGR
    frame_bytes = width * height * channels
    log.info(f"Camera aperta: {width}x{height}x{channels} ({frame_bytes} byte/frame)")

    _unlink_if_exists(SHM_HEADER_NAME)
    _unlink_if_exists(SHM_FRAME_NAME)

    header_shm = SharedMemory(name=SHM_HEADER_NAME, create=True, size=max(HEADER_SIZE, 64))
    frame_shm = SharedMemory(name=SHM_FRAME_NAME, create=True, size=frame_bytes)
    log.info(f"Shared memory creata: {SHM_HEADER_NAME}, {SHM_FRAME_NAME}")

    if config.MJPEG_PORT > 0:
        threading.Thread(target=_mjpeg_server_thread, daemon=True).start()
    _mjpeg_state = {}

    seq = 0
    min_frame_interval = (1.0 / config.FPS_LIMIT) if config.FPS_LIMIT > 0 else 0.0
    last_loop = 0.0

    try:
        while _running:
            if min_frame_interval:
                elapsed = time.time() - last_loop
                if elapsed < min_frame_interval:
                    time.sleep(min_frame_interval - elapsed)
            last_loop = time.time()

            if cap is None or not cap.isOpened():
                log.warning("Camera persa, riapro tra 5s...")
                time.sleep(5)
                cap, new_w, new_h = _open_camera()
                if cap is not None and (new_w != width or new_h != height):
                    log.error(
                        f"La camera è tornata con risoluzione diversa "
                        f"({new_w}x{new_h} invece di {width}x{height}) — riavvio richiesto"
                    )
                    raise SystemExit(1)
                continue

            ret, frame = cap.read()
            if not ret:
                log.warning("Frame non letto")
                time.sleep(0.1)
                continue

            if frame.shape[1] != width or frame.shape[0] != height:
                # non dovrebbe succedere dato cap.set() sopra, ma per sicurezza scarta
                continue

            # ── SEQLOCK: seq dispari = scrittura in corso ────────────────────
            seq += 1
            struct.pack_into("<Q", header_shm.buf, 0, seq)
            frame_shm.buf[:frame_bytes] = frame.tobytes()
            seq += 1
            struct.pack_into(
                HEADER_FMT, header_shm.buf, 0,
                seq, time.monotonic_ns(), width, height, frame_bytes, channels
            )

            if config.MJPEG_PORT > 0:
                _mjpeg_broadcast(frame, _mjpeg_state)

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
