"""
Emulatore di LaserCube WiFi (protocollo UDP LaserOS, spec v1.1) per
provare il gateway senza laser. Consuma il ringbuffer al ritmo impostato
e registra cosa avrebbe proiettato, per i test di sicurezza.

Uso a mano: python cube_emulator.py [porta_base=45456]
Le porte reali sono fisse; per piu' emulatori sulla stessa macchina si
usa una porta base diversa ("port_base" nella config del cubo).
"""
import socket
import struct
import sys
import threading
import time

import laser_proto as P


class CubeEmulator:
    def __init__(self, host="127.0.0.1", port_base=P.PORT_ALIVE, mac=b"\x02\x00\x00\x00\x00\x01",
                 model="LaserCube WiFi EMU", interlock=True):
        self.host, self.port_base = host, port_base
        self.mac, self.model, self.interlock = mac, model, interlock
        self.pps, self.output = P.PPS_DEFAULT, False
        self.ring = []                 # campioni in coda (x, y, r, g, b)
        self.played = []               # campioni "proiettati" (con limite)
        self.keep_played = 200000
        self.lock = threading.Lock()
        self.errors = 0
        self.packets = 0
        self.last_rnum = None
        self.stream_ip = None
        self.running = True
        self.socks = []
        for i in range(3):
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.bind((host, port_base + i))
            s.settimeout(0.1)
            self.socks.append(s)
        self.threads = [threading.Thread(target=f, daemon=True)
                        for f in (self._alive, self._cmd, self._data, self._dac)]
        for t in self.threads:
            t.start()

    def close(self):
        self.running = False
        for t in self.threads:
            t.join(timeout=1)
        for s in self.socks:
            s.close()

    def _loop(self, sock, fn):
        while self.running:
            try:
                pkt, peer = sock.recvfrom(2048)
            except (socket.timeout, ConnectionResetError):
                continue
            except OSError:
                return
            fn(pkt, peer, sock)

    def _alive(self):
        def fn(pkt, peer, sock):
            if pkt[:1] == bytes((P.OPC_ALIVE,)):
                sock.sendto(bytes((P.OPC_ALIVE, 0)), peer)
            elif pkt[:1] == bytes((P.OPC_ALIVE_WITH_ID,)):
                sock.sendto(bytes((P.OPC_ALIVE_WITH_ID,)) + self.mac, peer)
        self._loop(self.socks[0], fn)

    def _cmd(self):
        def fn(pkt, peer, sock):
            op = pkt[0]
            with self.lock:
                if op == P.OPC_GET_FULL_INFO:
                    st = (1 if self.output else 0) | (2 if self.interlock else 0) | (min(self.errors, 15) << 4)
                    self.errors = 0
                    r = bytearray(64)
                    r[0], r[1], r[3], r[4], r[5] = op, 0, 2, 2, st
                    struct.pack_into("<HHIIBHHBbB", r, 6, 0, P.DAC_MAX, self.pps, 35000, 3,
                                     8000 - len(self.ring), 8000, 80, 35, 2)
                    r[26:32] = self.mac
                    r[32:36] = socket.inet_aton(self.host)
                    name = self.model.encode()[:24]
                    r[38:38 + len(name)] = name
                    sock.sendto(bytes(r), peer)
                elif op == P.OPC_SET_OUTPUT:
                    self.output = bool(pkt[1])
                    sock.sendto(bytes((op, 0)), peer)
                elif op == P.OPC_SET_ILDA_RATE:
                    v = struct.unpack_from("<I", pkt, 1)[0]
                    ok = P.PPS_MIN <= v <= 35000
                    if ok:
                        self.pps = v
                    sock.sendto(bytes((op, 0 if ok else 1)), peer)
                elif op == P.OPC_CLEAR_RINGBUFFER:
                    self.ring.clear()
                    sock.sendto(bytes((op, 0)), peer)
                elif op == P.OPC_GET_RING_FREE:
                    f = 8000 - len(self.ring)
                    sock.sendto(bytes((op, 0, f & 0xFF, f >> 8)), peer)
                else:
                    sock.sendto(bytes((op, 1)), peer)
        self._loop(self.socks[1], fn)

    def _data(self):
        def fn(pkt, peer, sock):
            if len(pkt) < 4 or pkt[0] != P.MAGIC_DATA:
                return
            if (len(pkt) - 4) % 10:
                with self.lock:
                    self.errors += 1
                return
            rnum = pkt[2]
            with self.lock:
                if self.last_rnum is not None and rnum == self.last_rnum:
                    return
                if self.last_rnum is not None and rnum != (self.last_rnum + 1) & 0xFF:
                    self.errors += 1
                self.last_rnum = rnum
                samples = list(P.SAMPLE.iter_unpack(pkt[4:]))
                if len(self.ring) + len(samples) > 8000:
                    self.errors += 1
                else:
                    self.ring.extend(samples)
                    self.output = True          # auto DAC enable (spec par. 5.5)
                self.packets += 1
                f = 8000 - len(self.ring)
            sock.sendto(bytes((P.OPC_GET_RING_FREE, rnum, f & 0xFF, f >> 8)), peer)
        self._loop(self.socks[2], fn)

    def _dac(self):
        last = time.monotonic()
        while self.running:
            time.sleep(0.005)
            t = time.monotonic()
            n = int((t - last) * self.pps)
            if n <= 0:
                continue
            last = t
            with self.lock:
                if not self.output:
                    continue
                out, self.ring = self.ring[:n], self.ring[n:]
                self.played.extend(out)
                if len(self.played) > self.keep_played:
                    del self.played[:len(self.played) - self.keep_played]

    def take_played(self):
        with self.lock:
            p, self.played = self.played, []
            return p


if __name__ == "__main__":
    base = int(sys.argv[1]) if len(sys.argv) > 1 else P.PORT_ALIVE
    emu = CubeEmulator("0.0.0.0" if base == P.PORT_ALIVE else "127.0.0.1", base)
    print(f"emulatore LaserCube su udp/{base}-{base + 2}, Ctrl-C per uscire")
    try:
        while True:
            time.sleep(1)
            p = emu.take_played()
            lit = sum(1 for s in p if s[2] or s[3] or s[4])
            print(f"out={'ON ' if emu.output else 'off'} ring={len(emu.ring)} played={len(p)} lit={lit} err={emu.errors}")
    except KeyboardInterrupt:
        emu.close()
