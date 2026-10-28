"""
Guardiano del laser gateway: aspetta che il processo del gateway finisca
(per qualunque motivo, anche terminate()/crash) e allora spegne tutti i
cubi della configurazione: CLEAR_RINGBUFFER + SET_OUTPUT 0, ripetuti.

Uso (lo avvia il gateway): python laser_guard.py <pid_gateway> <cubes.json>
"""
import json
import os
import socket
import sys
import time

import laser_proto as P


def wait_pid(pid):
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x00100000, False, pid)        # SYNCHRONIZE
        if not h:
            return
        k32.WaitForSingleObject(h, 0xFFFFFFFF)
        k32.CloseHandle(h)
    else:
        while True:
            try:
                os.kill(pid, 0)
            except OSError:
                return
            time.sleep(0.05)


def blank_all(config_file):
    try:
        with open(config_file, encoding="utf-8") as f:
            cubes = json.load(f).get("cubes", {})
    except (OSError, ValueError):
        return
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for _ in range(3):
        for conf in cubes.values():
            ip = conf.get("ip")
            if not ip:
                continue
            port = int(conf.get("port_base", P.PORT_ALIVE)) + P.PORT_CMD - P.PORT_ALIVE
            for payload in (bytes((P.OPC_CLEAR_RINGBUFFER,)), P.cmd_set_output(False)):
                try:
                    s.sendto(payload, (ip, port))
                except OSError:
                    pass
        time.sleep(0.02)
    s.close()


if __name__ == "__main__":
    wait_pid(int(sys.argv[1]))
    blank_all(sys.argv[2])
