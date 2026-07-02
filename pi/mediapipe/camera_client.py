"""
GAIA Camera Client — legge i frame dalla shared memory scritta da camera_server.

Questo file è duplicato identico in pi/camera/, pi/yolo/ e pi/mediapipe/
(stessa convenzione già in uso per ota.py) — non importa nulla dal config.py
locale di ciascuna cartella: i nomi dei segmenti e il formato dell'header
sono costanti fisse, devono restare identiche in tutte e tre le copie.
"""
import struct
import time
import logging
from multiprocessing import resource_tracker
from multiprocessing.shared_memory import SharedMemory

import numpy as np

log = logging.getLogger('gaia-camera-client')

SHM_HEADER_NAME = "gaia_cam_header"
SHM_FRAME_NAME  = "gaia_cam_frame"

# seq(u64) ts_ns(u64) width(u32) height(u32) frame_bytes(u32) channels(u8)
HEADER_FMT  = "<QQIIIB"
HEADER_SIZE = struct.calcsize(HEADER_FMT)

STALE_THRESHOLD_NS = 5_000_000_000  # 5s senza un frame fresco -> camera_server considerato morto


def _disable_resource_tracker_unlink(shm):
    """Workaround per bpo-38119 (Python <3.13): ogni processo che attacca una
    SharedMemory la registra nel proprio resource_tracker e la unlinka
    all'uscita, anche con create=False. I client (yolo/mediapipe) non devono
    MAI unlinkare i segmenti — solo camera_server lo fa alla chiusura pulita.
    Su Python 3.13+ si userebbe SharedMemory(..., track=False) al posto di
    questo workaround (qui non applicabile: Pi su Python 3.11)."""
    try:
        resource_tracker.unregister(shm._name, "shared_memory")
    except Exception:
        pass


class CameraClient:
    """Reader per i frame pubblicati da camera_server. Stessa interfaccia
    minimale di cv2.VideoCapture (read() -> (ret, frame)) così l'integrazione
    in yolo/main.py e mediapipe_node.py resta un cambio quasi meccanico."""

    def __init__(self):
        self._header = None
        self._frame = None
        self.attached = False

    def attach(self) -> bool:
        self.close()
        try:
            header = SharedMemory(name=SHM_HEADER_NAME, create=False)
            frame  = SharedMemory(name=SHM_FRAME_NAME,  create=False)
        except FileNotFoundError:
            return False
        _disable_resource_tracker_unlink(header)
        _disable_resource_tracker_unlink(frame)
        self._header = header
        self._frame = frame
        self.attached = True
        return True

    def read(self, max_retries=3):
        """Ritorna (ret, frame) come cv2.VideoCapture.read() — frame BGR HxWxC uint8."""
        if not self.attached:
            return False, None

        for _ in range(max_retries):
            seq1, ts_ns, w, h, n, ch = struct.unpack_from(HEADER_FMT, self._header.buf, 0)

            if (time.monotonic_ns() - ts_ns) > STALE_THRESHOLD_NS:
                log.warning("camera_server fermo (nessun frame fresco da >5s), riaggancio...")
                self.attached = False
                return False, None

            if seq1 & 1:
                # scrittura in corso (seqlock dispari) — ritenta
                time.sleep(0.001)
                continue

            try:
                frame = np.frombuffer(self._frame.buf, dtype=np.uint8, count=n).reshape(h, w, ch).copy()
            except ValueError:
                # dimensioni del frame cambiate (camera_server riavviato con altra risoluzione)
                log.warning("Dimensioni frame inattese, riaggancio...")
                self.attached = False
                return False, None

            seq2 = struct.unpack_from("<Q", self._header.buf, 0)[0]
            if seq1 != seq2:
                continue  # il writer ha aggiornato durante la copia, ritenta

            return True, frame

        return False, None

    def close(self):
        for shm in (self._header, self._frame):
            if shm is not None:
                try:
                    shm.close()
                except Exception:
                    pass
        self._header = None
        self._frame = None
        self.attached = False
