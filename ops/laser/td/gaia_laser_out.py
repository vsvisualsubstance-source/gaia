"""
gaia_laser_out -- da TouchDesigner al laser gateway di OPS (frame GLF1).

Copiare in un Text DAT chiamato `gaia_laser_out` e chiamare da un
Execute DAT a fine frame, per esempio:

    def onFrameEnd(frame):
        mod('gaia_laser_out').send_sop(op('laser_null'), source='dmx', target='*')

Oppure da una CHOP con canali x, y, r, g, b (x,y in -1..1, colori 0..1),
la stessa che si darebbe a un Laser Device CHOP:

        mod('gaia_laser_out').send_chop(op('laser_chop'), source='patchdeck')

source = modalita' del cubo che deve prendere questo frame: 'dmx',
'patchdeck' o 'yolo'. target = id del cubo ('c1', 'c2', 'c3') oppure '*'
per tutti i cubi in quella modalita'. La sicurezza (zona, intensita'
massima, blanking, raggio fermo) la fa il gateway: qui si manda solo il
disegno. 30 frame al secondo bastano; tenere i frame sotto ~1000 punti.

Formato del pacchetto: vedi ops/laser/laser_proto.py nel repo gaia.
"""
import socket
import struct

import numpy as np

GATEWAY = ('192.168.1.240', 7480)   # OPS (e la touring, stesso IP); 127.0.0.1 se TD gira su OPS
MAX_PER_CHUNK = 170
MAX_POINTS = 4000

_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
_seq = [0]
_PT = np.dtype([('x', '<i2'), ('y', '<i2'), ('r', 'u1'), ('g', 'u1'), ('b', 'u1'), ('pad', 'u1')])


def send_points(x, y, r, g, b, source, target='*', gateway=None):
    """x, y: array -1..1; r, g, b: array 0..1 (un punto nero = spostamento al buio)."""
    n = min(len(x), MAX_POINTS)
    a = np.zeros(n, dtype=_PT)
    a['x'] = np.round(np.clip(np.asarray(x[:n], dtype=np.float32), -1, 1) * 32767)
    a['y'] = np.round(np.clip(np.asarray(y[:n], dtype=np.float32), -1, 1) * 32767)
    for k, v in (('r', r), ('g', g), ('b', b)):
        a[k] = np.clip(np.asarray(v[:n], dtype=np.float32) * 255, 0, 255)
    src, tgt = source.encode('ascii'), target.encode('ascii')
    chunks = max(1, (n + MAX_PER_CHUNK - 1) // MAX_PER_CHUNK)
    seq = _seq[0] & 0xFFFF
    _seq[0] += 1
    for i in range(chunks):
        part = a[i * MAX_PER_CHUNK:(i + 1) * MAX_PER_CHUNK]
        head = (b'GLF1' + struct.pack('<HBB', seq, i, chunks) + bytes((len(src),)) + src
                + bytes((len(tgt),)) + tgt + struct.pack('<H', len(part)))
        _sock.sendto(head + part.tobytes(), gateway or GATEWAY)


def send_chop(chop, source, target='*', gateway=None):
    """CHOP con 5 canali nell'ordine x, y, r, g, b (come il Laser Device CHOP)."""
    ch = chop.chans()
    if len(ch) < 5:
        return
    send_points(*(c.numpyArray() for c in ch[:5]), source=source, target=target, gateway=gateway)


def send_sop(sop, source, target='*', rgb=None, gateway=None):
    """Ogni primitiva della SOP e' una linea; tra una primitiva e l'altra il
    raggio si sposta spento. Colore dal Cd dei punti, altrimenti rgb (0..1)."""
    xs, ys, rs, gs, bs = [], [], [], [], []
    has_cd = sop.pointAttribs.get('Cd') is not None if hasattr(sop, 'pointAttribs') else False
    base = rgb or (1.0, 1.0, 1.0)
    for prim in sop.prims:
        verts = list(prim)
        if not verts:
            continue
        if getattr(prim, 'isClosed', False) or getattr(prim, 'closed', False):
            verts = verts + [verts[0]]
        p0 = verts[0].point
        xs.append(p0.x); ys.append(p0.y); rs.append(0); gs.append(0); bs.append(0)
        for v in verts:
            p = v.point
            c = p.Cd if has_cd else base
            xs.append(p.x); ys.append(p.y); rs.append(c[0]); gs.append(c[1]); bs.append(c[2])
    if xs:
        send_points(xs, ys, rs, gs, bs, source=source, target=target, gateway=gateway)


def blackout(source, target='*', gateway=None):
    """Frame vuoto: il gateway proietta il buio (resta armato)."""
    send_points([0.0], [0.0], [0.0], [0.0], [0.0], source=source, target=target, gateway=gateway)
