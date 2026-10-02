"""
Sender Art-Net minimale (pacchetto ArtDMX, OpCode 0x5000) — nessuna
dipendenza esterna, solo socket/struct di libreria standard. Spec: Art-Net 4
(Artistic Licence), stesso indirizzamento a 3 campi (net/subnet/universo)
già osservato lato TD nello scan di DMX V8 (TD4Gaia GAIA_INTERFACE.md
"TD/Win-PD, 7": "U net:subnet:universo").

Non implementa ArtPoll/ArtPollReply (discovery dei nodi): qui l'host di
destinazione è configurato a mano (vedi config.ARTNET_HOST, mai indovinato),
niente scan di rete — quello resta un lavoro del lato TD (dmx_patch), non
necessario per un servizio "base" su Pi con una fixture nota.
"""
import socket
import struct

_ART_NET_ID = b"Art-Net\x00"
_OPCODE_DMX = 0x5000


class ArtNetSender:
    def __init__(self, host, port=6454, net=0, subnet=0, universe=0):
        self.host = host
        self.port = port
        self.net = net & 0x7F
        self.subnet = subnet & 0x0F
        self.universe = universe & 0x0F
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self._seq = 0

    def send(self, channels):
        """channels: lista/bytes di valori 0-255. Il pacchetto va mandato
        comunque se host non è impostato -> il chiamante deve controllare
        prima (vedi main.py), questa classe non decide se spedire o no."""
        if not self.host:
            return
        data = bytes(max(0, min(255, int(c))) for c in channels)
        if len(data) % 2 == 1:
            data += b"\x00"   # ArtDMX vuole un numero pari di canali
        self._seq = (self._seq % 255) + 1   # 1-255, 0 = "sequenza disabilitata"
        sub_uni = ((self.subnet & 0x0F) << 4) | (self.universe & 0x0F)
        # Tutto il pacchetto è little-endian TRANNE Length, che la spec vuole
        # big-endian -- due struct.pack separati invece di una format string
        # unica con endianness mista (non esprimibile in un solo formato).
        head = struct.pack("<HBBBBBB", _OPCODE_DMX, 0, 14, self._seq, 0, sub_uni, self.net)
        length = struct.pack(">H", len(data))
        header = _ART_NET_ID + head + length
        try:
            self._sock.sendto(header + data, (self.host, self.port))
        except OSError as e:
            print(f"[ArtNet] invio fallito verso {self.host}:{self.port}: {e}")

    def close(self):
        self._sock.close()
