#!/usr/bin/env python3
"""
GAIA Herbarium — simulatore di piante (in attesa della scheda MIDI vera).

Scrive note MIDI A CASO (pitch/velocity/tempo casuali — esattamente come farà
un sensore non allenato) sulla porta VirMIDI a indice più BASSO (il "-0" di
midi_devs=2, mai il bus verso Carla che è sempre l'indice più alto — vedi
main.py._find_engine_out). L'hotplug di gaia-herbarium la vede come un
sensore qualsiasi, la osserva con aseqdump, e ogni nota passa dal motore
musicale (music_engine.py) prima di essere risuonata: qui NON c'è nessuna
logica musicale apposta — è il rumore che il motore deve rendere musica.

Uso: python3 plant_simulator.py [--rate 0.3-3]  (secondi tra una nota e l'altra)
Richiede snd-virmidi già caricato con midi_devs=2 (permanente da
/etc/modprobe.d/gaia-herbarium-virmidi.conf — carico da solo se manca).
"""
import argparse
import random
import re
import subprocess
import sys
import time


def _seq_clients():
    out = subprocess.run(["aconnect", "-l"], capture_output=True, text=True, timeout=5).stdout
    clients = []
    for line in out.splitlines():
        m = re.match(r"client (\d+): '(.*?)' \[type=(\w+)", line)
        if m:
            clients.append({"id": int(m.group(1)), "name": m.group(2), "type": m.group(3)})
    return clients


def _find_lowest_virmidi():
    """La porta '-0': indice sub-device più basso tra i client VirMIDI —
    quella riservata al simulatore/sensore, mai il bus del motore."""
    candidates = []
    for c in _seq_clients():
        m = re.match(r"Virtual Raw MIDI (\d+)-(\d+)", c["name"])
        if m:
            candidates.append((int(m.group(2)), int(m.group(1))))
    if not candidates:
        return None
    candidates.sort()
    dev, card = candidates[0]
    return f"/dev/snd/midiC{card}D{dev}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rate-min", type=float, default=0.3, help="secondi minimi tra note")
    ap.add_argument("--rate-max", type=float, default=3.0, help="secondi massimi tra note")
    ap.add_argument("--note-min", type=int, default=36)
    ap.add_argument("--note-max", type=int, default=90)
    args = ap.parse_args()

    subprocess.run(["sudo", "modprobe", "snd-virmidi", "midi_devs=2"], capture_output=True)
    time.sleep(1)
    path = _find_lowest_virmidi()
    if not path:
        print("[Simulatore] Nessuna porta VirMIDI trovata — snd-virmidi caricato?", file=sys.stderr)
        sys.exit(1)
    print(f"[Simulatore] Pianta finta su {path} — Ctrl+C per fermare")

    try:
        while True:
            note = random.randint(args.note_min, args.note_max)
            vel = random.randint(40, 110)
            with open(path, "wb", buffering=0) as f:
                f.write(bytes([0x90, note, vel]))
            print(f"[Simulatore] nota {note} velocity {vel}")
            time.sleep(random.uniform(0.05, 0.2))
            with open(path, "wb", buffering=0) as f:
                f.write(bytes([0x80, note, 0]))
            time.sleep(random.uniform(args.rate_min, args.rate_max))
    except KeyboardInterrupt:
        print("\n[Simulatore] Fermato.")


if __name__ == "__main__":
    main()
