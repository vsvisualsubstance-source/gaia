"""Prove di dhcp_server.answer() senza rete (nessun socket, nessun pacchetto).

    C:\\gaia\\venv\\Scripts\\python.exe -m unittest ops/dhcp/test_dhcp_server.py
"""
import os
import socket
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dhcp_server as D  # noqa: E402

D.LOG_FILE = os.path.join(tempfile.gettempdir(), "dhcp_test.log")

CLONE = "04:7c:16:a9:78:33"
NEW = "02:00:00:aa:bb:cc"
RES = {CLONE: "192.168.1.73"}


def req(requested=None, ciaddr="0.0.0.0"):
    opts = {}
    if requested:
        opts[50] = socket.inet_aton(requested)
    return {"options": opts, "ciaddr": socket.inet_aton(ciaddr)}


class Answer(unittest.TestCase):
    def test_reserved_client_renewing_old_address_gets_nak(self):
        self.assertEqual(D.answer(D.MSG_REQUEST, req("192.168.1.50"), CLONE, RES, {}), (D.MSG_NAK, "192.168.1.50"))

    def test_reserved_client_renewing_with_ciaddr_only_gets_nak(self):
        self.assertEqual(D.answer(D.MSG_REQUEST, req(ciaddr="192.168.1.50"), CLONE, RES, {}), (D.MSG_NAK, "192.168.1.50"))

    def test_reserved_client_discover_and_request_get_its_address(self):
        self.assertEqual(D.answer(D.MSG_DISCOVER, req(), CLONE, RES, {}), (D.MSG_OFFER, "192.168.1.73"))
        self.assertEqual(D.answer(D.MSG_REQUEST, req("192.168.1.73"), CLONE, RES, {}), (D.MSG_ACK, "192.168.1.73"))

    def test_new_client_gets_pool_address(self):
        kind, ip = D.answer(D.MSG_DISCOVER, req(), NEW, RES, {})
        self.assertEqual(kind, D.MSG_OFFER)
        self.assertEqual(D.answer(D.MSG_REQUEST, req(ip), NEW, RES, {}), (D.MSG_ACK, ip))

    def test_client_asking_for_address_of_another_network_gets_nak(self):
        self.assertEqual(D.answer(D.MSG_REQUEST, req("192.168.0.43"), NEW, RES, {})[0], D.MSG_NAK)

    def test_other_messages_are_ignored(self):
        self.assertIsNone(D.answer(D.MSG_RELEASE, req(), NEW, RES, {}))


if __name__ == "__main__":
    unittest.main()
