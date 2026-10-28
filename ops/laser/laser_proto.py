"""
Protocolli del laser gateway.

1. Verso il LaserCube WiFi: protocollo UDP LaserOS ufficiale
   (Wicked Lasers, "UDP DAC Streaming Protocol Specification" v1.1,
   10/10/2026, firmware 2.2 -- laserdockdocs/developers/udp-streaming-protocol.pdf).
   Tre porte: 45456 scoperta, 45457 comandi, 45458 campioni.

2. Dalle sorgenti TD al gateway: formato "GLF1" (Gaia Laser Frame),
   definito qui e descritto in TD4Gaia/GAIA_INTERFACE.md (nota OPS 33).
   Un frame e' una polilinea di punti x,y in -1..1 (y in alto, come TD)
   con colore r,g,b 0..255; un punto nero e' uno spostamento a raggio
   spento. Il frame viaggia in uno o piu' pacchetti UDP (chunk).
"""
import struct

# ---------------------------------------------------------------- LaserCube
PORT_ALIVE, PORT_CMD, PORT_DATA = 45456, 45457, 45458

OPC_ALIVE = 0x27
OPC_ALIVE_WITH_ID = 0x28
OPC_GET_FULL_INFO = 0x77
OPC_ENABLE_BUFFER_RESPONSE = 0x78
OPC_SET_OUTPUT = 0x80
OPC_SET_ILDA_RATE = 0x82
OPC_GET_RING_FREE = 0x8A
OPC_CLEAR_RINGBUFFER = 0x8D
MAGIC_DATA = 0xA9

DAC_MAX = 0xFFF
RING_DEFAULT = 8000
PPS_MIN, PPS_DEFAULT = 6000, 30000
SAMPLES_PER_PACKET = 140     # <= 146 per stare nella MTU (spec par. 5.1)
TARGET_USED = 1500           # riempimento del ringbuffer consigliato (spec par. 6)
TOS_CS4 = 0x80               # coda video WMM, come marca il cubo (spec par. 2)

SAMPLE = struct.Struct("<HHHHH")


def pack_sample(x, y, r, g, b):
    return SAMPLE.pack(x & DAC_MAX, y & DAC_MAX, r & DAC_MAX, g & DAC_MAX, b & DAC_MAX)


def data_packet(rnum, payload):
    return bytes((MAGIC_DATA, 0, rnum & 0xFF, 0)) + payload


def cmd_set_output(on):
    return bytes((OPC_SET_OUTPUT, 1 if on else 0))


def cmd_set_rate(pps):
    return bytes((OPC_SET_ILDA_RATE,)) + struct.pack("<I", int(pps))


def parse_full_info(reply):
    """Risposta a GET_FULL_INFO (64 byte, spec par. 4.3) -> dict, o None."""
    if len(reply) < 64 or reply[0] != OPC_GET_FULL_INFO:
        return None
    st = reply[5]
    battery = reply[23]
    return {
        "fw": f"{reply[3]}.{reply[4]}",
        "output_on": bool(st & 0x01),
        "interlock": bool(st & 0x02),
        "temp_warn": bool(st & 0x04),
        "temp_fault": bool(st & 0x08),
        "pkt_errors": (st >> 4) & 0x0F,
        "pps": int.from_bytes(reply[10:14], "little"),
        "max_pps": int.from_bytes(reply[14:18], "little"),
        "ring_free": int.from_bytes(reply[19:21], "little"),
        "ring_total": int.from_bytes(reply[21:23], "little") or RING_DEFAULT,
        "battery": None if battery == 0xFF else battery,
        "charging": battery == 0xFF,
        "temp_c": struct.unpack("b", reply[24:25])[0],
        "conn_mode": ("lan_server", "wifi_server", "lan_client", "wifi_client")[reply[25]]
                     if reply[25] < 4 else str(reply[25]),
        "mac": ":".join(f"{b:02x}" for b in reply[26:32]),
        "ip": ".".join(str(b) for b in reply[32:36]),
        "model": reply[38:63].split(b"\x00", 1)[0].decode("ascii", "replace"),
    }


# ---------------------------------------------------------------- GLF1
GLF_MAGIC = b"GLF1"
GLF_PORT = 7480            # fuori da 44624-48712, riservato da Windows su OPS
GLF_POINT = struct.Struct("<hhBBBx")   # x, y (-32767..32767 = -1..1), r, g, b, riservato
GLF_MAX_POINTS_PER_CHUNK = 170         # 170*8 + intestazione < 1400 byte
GLF_MAX_POINTS = 4000


def glf_encode(points, source, target="*", seq=0):
    """points: sequenza di (x, y, r, g, b) con x,y in -1..1 e r,g,b 0..255.
    Restituisce la lista dei pacchetti UDP da spedire (in ordine)."""
    src = source.encode("ascii")[:32]
    tgt = target.encode("ascii")[:32]
    pts = list(points)[:GLF_MAX_POINTS]
    chunks = [pts[i:i + GLF_MAX_POINTS_PER_CHUNK]
              for i in range(0, len(pts), GLF_MAX_POINTS_PER_CHUNK)] or [[]]
    out = []
    for idx, chunk in enumerate(chunks):
        body = b"".join(GLF_POINT.pack(_q(x), _q(y), _c(r), _c(g), _c(b))
                        for x, y, r, g, b in chunk)
        out.append(GLF_MAGIC + struct.pack("<HBB", seq & 0xFFFF, idx, len(chunks))
                   + bytes((len(src),)) + src + bytes((len(tgt),)) + tgt
                   + struct.pack("<H", len(chunk)) + body)
    return out


def glf_decode(pkt):
    """Un pacchetto GLF1 -> (source, target, seq, idx, count, points) o None."""
    try:
        if pkt[:4] != GLF_MAGIC:
            return None
        seq, idx, count = struct.unpack_from("<HBB", pkt, 4)
        o = 8
        ls = pkt[o]; src = pkt[o + 1:o + 1 + ls].decode("ascii"); o += 1 + ls
        lt = pkt[o]; tgt = pkt[o + 1:o + 1 + lt].decode("ascii"); o += 1 + lt
        (n,) = struct.unpack_from("<H", pkt, o); o += 2
        if count == 0 or idx >= count or len(pkt) != o + n * GLF_POINT.size:
            return None
        pts = [(x / 32767.0, y / 32767.0, r, g, b)
               for x, y, r, g, b in GLF_POINT.iter_unpack(pkt[o:])]
        return src, tgt or "*", seq, idx, count, pts
    except (IndexError, struct.error, UnicodeDecodeError):
        return None


def _q(v):
    v = max(-1.0, min(1.0, float(v)))
    return int(round(v * 32767))


def _c(v):
    return max(0, min(255, int(v)))
