#!/usr/bin/env python3
"""Low-risk runtime health probe for GAIA.

Checks the public HTTP surfaces that were already documented during the current
runtime review, without starting or modifying any service.

Usage:
  python3 scripts/gaia_runtime_probe.py
  python3 scripts/gaia_runtime_probe.py --nodered-host 192.168.1.240 --admin-host 192.168.1.240
"""

import argparse
import json
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_NODERED_HOST = "192.168.1.240"
DEFAULT_NODERED_PORT = 1880
DEFAULT_ADMIN_HOST = "192.168.1.240"
DEFAULT_ADMIN_PORT = 8765


def http_probe(host: str, port: int, path: str, timeout_s: float = 2.5) -> dict:
    url = f"http://{host}:{port}{path}"
    result = {
        "url": url,
        "ok": False,
        "http_status": None,
        "reason": None,
        "bytes": None,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            payload = resp.read(2048)
            result["ok"] = True
            result["http_status"] = resp.status
            result["bytes"] = len(payload)
            try:
                result["content_type"] = resp.headers.get("Content-Type")
            except Exception:
                pass
    except urllib.error.HTTPError as e:
        result["ok"] = False
        result["http_status"] = e.code
        result["reason"] = str(e)
    except urllib.error.URLError as e:
        result["ok"] = False
        result["reason"] = f"URLError: {e.reason}"
    except Exception as e:
        result["ok"] = False
        result["reason"] = f"Exception: {type(e).__name__}: {e}"
    return result


def tcp_probe(host: str, port: int, timeout_s: float = 1.5) -> dict:
    result = {
        "host": host,
        "port": port,
        "ok": False,
        "reason": None,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout_s)
    try:
        s.connect((host, port))
        result["ok"] = True
    except Exception as e:
        result["reason"] = f"{type(e).__name__}: {e}"
    finally:
        s.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nodered-host", default=DEFAULT_NODERED_HOST)
    parser.add_argument("--nodered-port", type=int, default=DEFAULT_NODERED_PORT)
    parser.add_argument("--admin-host", default=DEFAULT_ADMIN_HOST)
    parser.add_argument("--admin-port", type=int, default=DEFAULT_ADMIN_PORT)
    parser.add_argument("--admin-path", default="/api/status")
    args = parser.parse_args()

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "nodered": http_probe(args.nodered_host, args.nodered_port, "/", timeout_s=2.5),
        "admin": http_probe(args.admin_host, args.admin_port, args.admin_path, timeout_s=2.5),
        "broker_tcp": tcp_probe(args.nodered_host, 1883, timeout_s=1.0),
    }

    print(json.dumps(payload, indent=2))

    # Conservative exit code: a Node-RED 200 is success, admin API may be timeout
    # and we don't want a failure to be read as a hard event in automation.
    if not payload["nodered"]["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
