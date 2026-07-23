#!/usr/bin/env python3
"""Piccola utility MQTT per debug/comandi manuali durante lo sviluppo — sostituisce
i one-liner "python3 -c" ripetuti in ogni sessione (quelli non si possono mettere
in permission-allowlist senza concedere esecuzione di codice arbitrario; questo
script sì, visto che il comportamento è fisso e solo gli argomenti cambiano).

Uso:
  gaia_mqtt.py pub <topic> <json-or-text> [--host H] [--retain]
  gaia_mqtt.py sub <topic-filter> [--host H] [--seconds N] [--count N]
"""
import argparse
import json
import time

import paho.mqtt.client as mqtt
import paho.mqtt.publish as publish

DEFAULT_HOST = "192.168.1.142"


def cmd_pub(args):
    publish.single(args.topic, payload=args.payload, hostname=args.host, retain=args.retain)
    print(f"pubblicato su {args.topic}: {args.payload}")


def cmd_sub(args):
    seen = []

    def on_message(client, userdata, msg):
        seen.append((msg.topic, msg.payload.decode(errors="replace")))
        print(f"{time.strftime('%H:%M:%S')}  {msg.topic}  {msg.payload.decode(errors='replace')}")
        if args.count and len(seen) >= args.count:
            client.disconnect()

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:
        client = mqtt.Client()
    client.on_message = on_message
    client.connect(args.host, 1883, 60)
    client.subscribe(args.topic)
    client.loop_start()
    time.sleep(args.seconds)
    client.loop_stop()
    if not seen:
        print("nessun messaggio ricevuto")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("pub")
    pp.add_argument("topic")
    pp.add_argument("payload")
    pp.add_argument("--host", default=DEFAULT_HOST)
    pp.add_argument("--retain", action="store_true")
    pp.set_defaults(func=cmd_pub)

    sp = sub.add_parser("sub")
    sp.add_argument("topic")
    sp.add_argument("--host", default=DEFAULT_HOST)
    sp.add_argument("--seconds", type=float, default=5.0)
    sp.add_argument("--count", type=int, default=0)
    sp.set_defaults(func=cmd_sub)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
