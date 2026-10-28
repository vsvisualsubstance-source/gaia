"""Test del laser gateway contro l'emulatore del cubo.

    cd ops/laser && python -m unittest -v test_laser
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

TMP = tempfile.mkdtemp(prefix="laser-test-")
os.environ["LASER_CONFIG"] = os.path.join(TMP, "cubes.json")
os.environ["LASER_GLF_PORT"] = "39480"
os.environ["LASER_NO_GUARD"] = "1"

import laser_proto as P                      # noqa: E402
import laser_render as R                     # noqa: E402
import laser_gateway as G                    # noqa: E402
import laser_scene as SC                    # noqa: E402
from cube_emulator import CubeEmulator       # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def wait(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def lit(samples):
    return [s for s in samples if s[2] or s[3] or s[4]]


def unpack(buf):
    return list(P.SAMPLE.iter_unpack(buf))


class TestProto(unittest.TestCase):
    def test_glf_roundtrip_multichunk(self):
        pts = [(i / 500 - 1, -(i / 500 - 1), i % 256, 0, 255) for i in range(1000)]
        pkts = P.glf_encode(pts, "dmx", "c2", seq=7)
        self.assertEqual(len(pkts), 6)
        self.assertTrue(all(len(p) < 1400 for p in pkts))
        got = []
        for p in pkts:
            src, tgt, seq, idx, count, chunk = P.glf_decode(p)
            self.assertEqual((src, tgt, seq, count), ("dmx", "c2", 7, 6))
            got += chunk
        self.assertEqual(len(got), 1000)
        self.assertAlmostEqual(got[10][0], pts[10][0], places=4)
        self.assertEqual(got[10][2:], pts[10][2:])

    def test_glf_rejects_garbage(self):
        self.assertIsNone(P.glf_decode(b"GLF1\x00"))
        self.assertIsNone(P.glf_decode(b"XXXX" + bytes(20)))
        good = P.glf_encode([(0, 0, 255, 0, 0)], "dmx")[0]
        self.assertIsNone(P.glf_decode(good[:-1]))


class TestTdHelper(unittest.TestCase):
    """td/gaia_laser_out.py con una SOP finta che imita l'API di TD (nota TD 49:
    td.Attributes non ha .get, il Trace SOP da' primitive con closed = False)."""
    def test_send_sop_reads_cd_and_closes(self):
        sys.path.insert(0, os.path.join(HERE, "td"))
        import gaia_laser_out as T

        class Pt:
            def __init__(s, x, y, cd): s.x, s.y, s.Cd = x, y, cd
        class V:
            def __init__(s, p): s.point = p
        class Prim(list):
            closed = False
        class A:
            def __init__(s, n): s.name = n
        class Sop:
            pointAttribs = [A("P"), A("Cd")]
            prims = [Prim([V(Pt(0, 0, (1, 0, 0))), V(Pt(.5, 0, (1, 0, 0))), V(Pt(.5, .5, (1, 0, 0)))])]
        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx.bind(("127.0.0.1", 39491)); rx.settimeout(1)
        T.send_sop(Sop(), "dmx", gateway=("127.0.0.1", 39491), close=True)
        pts = P.glf_decode(rx.recvfrom(2048)[0])[5]
        rx.close()
        self.assertEqual(len(pts), 5)                    # punto nero d'attacco + 3 + chiusura
        self.assertEqual(pts[0][2:], (0, 0, 0))
        self.assertEqual(pts[1][2:], (255, 0, 0))        # colore dal Cd
        self.assertEqual(pts[-1][:2], pts[1][:2])        # richiusa sul primo vertice


SQUARE = {"id": "q", "name": "Quadrato", "strokes": [{"pts": [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]], "closed": True}],
          "color": {"mode": "fixed", "rgb": [0, 0, 1]}, "anim": {"scale": 1}}


class TestScene(unittest.TestCase):
    def test_clean_limits_and_rejects(self):
        with self.assertRaises(ValueError):
            SC.clean_scene({"strokes": []})
        s = SC.clean_scene({"strokes": [{"pts": [[5, -9], ["x", 0]]}], "anim": {"rotate": 99999, "scale": 3},
                            "color": {"mode": "boh"}})
        self.assertEqual(s["strokes"][0]["pts"][0], [1.0, -1.0])
        self.assertEqual(s["anim"]["rotate"], 720)
        self.assertEqual(s["anim"]["scale"], 1)
        self.assertEqual(s["color"]["mode"], "fixed")
        big = {"strokes": [{"pts": [[0, 0]] * 1500}, {"pts": [[0, 0]] * 1500}]}
        self.assertEqual(len(SC.clean_scene(big)["strokes"]), 1)      # oltre MAX_POINTS si scarta

    def test_animate_closed_blue_and_rotation(self):
        s = SC.clean_scene(SQUARE)
        pts = SC.animate(s, 0)
        self.assertEqual(pts[0][2:], (0, 0, 0))                           # attacco al buio
        self.assertEqual(len(pts), 6)                                     # buio + 4 + chiusura
        self.assertEqual(pts[1][2:], (0, 0, 255))
        s["anim"]["rotate"] = 90
        x, y = SC.animate(s, 1.0)[1][:2]                                  # (-.5,-.5) ruotato di 90 gradi
        self.assertAlmostEqual(x, 0.5, places=3); self.assertAlmostEqual(y, -0.5, places=3)

    def test_audio_scale_and_draw(self):
        s = SC.clean_scene({**SQUARE, "audio": {"amount": 1, "to": "scale"}})
        quiet = max(abs(p[0]) for p in SC.animate(s, 0, level=0))
        loud = max(abs(p[0]) for p in SC.animate(s, 0, level=1))
        self.assertGreater(loud, quiet * 1.4)
        s = SC.clean_scene({**SQUARE, "anim": {"scale": 1, "draw_hz": 1}})
        self.assertLess(len(SC.animate(s, 0.3)), len(SC.animate(s, 0.9)))  # si scrive pian piano


class TestRender(unittest.TestCase):
    def test_zone_keeps_beam_inside(self):
        cfg = {"zone": [0.0, 0.0, 1.0, 1.0], "max_intensity": 1.0}
        out = unpack(R.render(R.circle(0.8, 400), cfg, 30000))
        on = lit(out)
        self.assertTrue(on)
        for x, y, *_ in out:              # anche i punti spenti restano nella zona
            self.assertGreaterEqual(x, 2047)
            self.assertGreaterEqual(y, 2047)

    def test_frame_all_outside_zone_is_dark(self):
        cfg = {"zone": [0.5, 0.5, 1.0, 1.0]}
        self.assertIsNone(R.render(R.circle(0.2, 100), cfg, 30000))

    def test_intensity_cap_and_master(self):
        out = unpack(R.render(R.circle(0.5, 300), {"max_intensity": 0.5, "master": 0.5}, 30000))
        self.assertLessEqual(max(s[2] for s in out), int(0.25 * P.DAC_MAX) + 1)

    def test_static_dot_is_dimmed(self):
        dot = [(0.1, 0.1, 255, 255, 255), (0.105, 0.1, 255, 255, 255)]
        out = unpack(R.render(dot, {"max_intensity": 1.0}, 30000))
        self.assertLessEqual(max(s[2] for s in out), int(P.DAC_MAX * R.STATIC_GAIN) + 1)

    def test_steps_are_small_and_blank_jumps(self):
        # due segmenti lontani: il salto tra i due deve essere al buio
        pts = [(-0.9, 0, 0, 0, 0), (-0.5, 0, 255, 0, 0), (0.5, 0.5, 0, 0, 0), (0.9, 0.5, 0, 255, 0)]
        out = unpack(R.render(pts, {"max_intensity": 1.0}, 30000))
        for a, b in zip(out, out[1:]):
            d = max(abs(a[0] - b[0]), abs(a[1] - b[1]))
            if b[2] or b[3] or b[4]:
                self.assertLessEqual(d, R.LIT_STEP * 0.5 * P.DAC_MAX + 2)
            else:
                self.assertLessEqual(d, R.BLANK_STEP * 0.5 * P.DAC_MAX + 2)

    def test_budget(self):
        big = R.circle(1.0, 5000)
        out = unpack(R.render(big, {}, 30000))
        self.assertLessEqual(len(out), 30000 // R.MIN_REFRESH)


class TestGateway(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.emu = CubeEmulator("127.0.0.1", 39456)
        cls.gw = G.Gateway()
        threading.Thread(target=cls.gw._glf_loop, daemon=True).start()
        threading.Thread(target=cls.gw._internal_loop, daemon=True).start()
        res = cls.gw.handle({"action": "add_cube", "ip": "127.0.0.1", "port_base": 39456, "name": "Prova"})
        assert res["ok"], res
        cls.cube = cls.gw.cubes["c1"]

    @classmethod
    def tearDownClass(cls):
        cls.gw.shutdown()
        cls.emu.close()

    def setUp(self):
        self.gw.handle({"action": "blackout"})
        self.gw.handle({"action": "set", "param": "c1_zone", "value": [-1, -1, 1, 1]})
        self.assertTrue(wait(lambda: not self.cube.streaming))
        self.assertTrue(wait(lambda: not self.emu.output))
        self.emu.take_played()

    def test_1_online_and_config_saved(self):
        self.assertTrue(wait(self.cube.online))
        s = self.cube.summary()
        self.assertEqual(s["model"], "LaserCube WiFi EMU")
        self.assertFalse(s["armed"])
        with open(os.environ["LASER_CONFIG"], encoding="utf-8") as f:
            self.assertEqual(json.load(f)["cubes"]["c1"]["ip"], "127.0.0.1")

    def test_2_arm_needs_mode(self):
        self.gw.handle({"action": "set", "param": "c1_mode", "value": "off"})
        self.assertFalse(self.gw.handle({"action": "arm", "cube": "c1"})["ok"])
        self.assertFalse(self.gw.handle({"action": "arm", "cube": "all"})["ok"])
        self.assertFalse(self.gw.handle({"action": "set", "param": "c1_mode", "value": "boh"})["ok"])

    def test_3_test_pattern_streams_and_disarm_stops(self):
        self.assertTrue(wait(self.cube.online))
        self.gw.handle({"action": "set", "param": "c1_mode", "value": "test"})
        self.assertTrue(self.gw.handle({"action": "arm", "cube": "c1"})["ok"])
        self.assertTrue(wait(lambda: len(lit(self.emu.played)) > 3000))
        self.assertTrue(self.emu.output)
        self.assertEqual(self.emu.errors, 0)
        self.gw.handle({"action": "disarm", "cube": "c1"})
        self.assertTrue(wait(lambda: not self.emu.output, 1.0))
        self.assertEqual(len(self.emu.ring), 0)

    def test_4_zone_applies_live(self):
        self.assertTrue(wait(self.cube.online))
        self.gw.handle({"action": "set", "param": "c1_mode", "value": "test"})
        self.gw.handle({"action": "arm", "cube": "c1"})
        self.assertTrue(wait(lambda: self.cube.streaming))
        self.gw.handle({"action": "set", "param": "c1_zone", "value": [0, 0, 1, 1]})
        time.sleep(0.4)                     # il ringbuffer (~50 ms) si svuota del vecchio
        self.emu.take_played()
        time.sleep(0.3)
        on = lit(self.emu.take_played())
        self.assertTrue(on)
        self.assertTrue(all(x >= 2047 and y >= 2047 for x, y, *_ in on))

    def test_5_source_frames_and_stale_blank(self):
        self.assertTrue(wait(self.cube.online))
        self.gw.handle({"action": "set", "param": "c1_mode", "value": "dmx"})
        self.gw.handle({"action": "arm", "cube": "c1"})
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        tri = [(0, 0.5, 0, 255, 0), (0.5, -0.5, 0, 255, 0), (-0.5, -0.5, 0, 255, 0), (0, 0.5, 0, 255, 0)]
        stop = threading.Event()

        def sender(source):
            seq = 0
            while not stop.is_set():
                for p in P.glf_encode(tri, source, "*", seq):
                    sock.sendto(p, ("127.0.0.1", 39480))
                seq += 1
                time.sleep(1 / 30)
        # una sorgente diversa dalla modalita' non deve arrivare al cubo
        t = threading.Thread(target=sender, args=("patchdeck",), daemon=True)
        t.start()
        time.sleep(0.5)
        self.assertFalse(self.cube.streaming)
        stop.set(); t.join()
        stop.clear()
        t = threading.Thread(target=sender, args=("dmx",), daemon=True)
        t.start()
        self.assertTrue(wait(lambda: len(lit(self.emu.played)) > 1000))
        on = lit(self.emu.played)
        self.assertTrue(all(s[3] > 0 and s[2] == 0 for s in on))       # verde, come il frame
        self.assertIn("dmx", self.gw.status_payload()["laser"]["sources"])
        stop.set(); t.join()
        self.assertTrue(wait(lambda: not self.emu.output, G.STALE_S + 1.0))
        self.assertTrue(self.cube.armed)     # resta armato: riparte quando torna la sorgente
        sock.close()

    def test_6_blackout_disarms_everything(self):
        self.assertTrue(wait(self.cube.online))
        self.gw.handle({"action": "set", "param": "c1_mode", "value": "test"})
        self.gw.handle({"action": "arm", "cube": "c1"})
        self.assertTrue(wait(lambda: self.emu.output))
        self.gw.handle({"action": "blackout"})
        self.assertFalse(self.cube.armed)
        self.assertTrue(wait(lambda: not self.emu.output, 1.0))

    def test_8_preview_is_what_goes_out(self):
        self.assertIsNone(self.gw.preview_payload())          # niente in uscita, niente anteprima
        self.assertTrue(wait(self.cube.online))
        self.gw.handle({"action": "set", "param": "c1_mode", "value": "test"})
        self.gw.handle({"action": "set", "param": "c1_zone", "value": [0, -1, 1, 1]})
        self.gw.handle({"action": "arm", "cube": "c1"})
        self.assertTrue(wait(lambda: self.gw.preview_payload() is not None))
        pts = self.gw.preview_payload()["cubes"]["c1"]
        self.assertLessEqual(len(pts), G.PREVIEW_POINTS + 2)
        lit_pts = [p for p in pts if p[2]]
        self.assertTrue(lit_pts)
        self.assertTrue(all(p[0] >= -1 for p in pts))           # la zona vale anche nell'anteprima
        self.assertTrue(all(len(p[2]) == 6 for p in lit_pts))
        self.assertLess(len(json.dumps(self.gw.preview_payload())), 2000)

    def test_9_scene_streams_and_mode_all(self):
        self.assertTrue(wait(self.cube.online))
        self.assertFalse(self.gw.handle({"action": "scene", "cube": "c1", "scene": {"strokes": []}})["ok"])
        self.assertTrue(self.gw.handle({"action": "scene", "cube": "all", "scene": SQUARE})["ok"])
        self.assertEqual(self.cube.mode, "scene")
        self.assertEqual(self.cube.summary()["scene"], {"id": "q", "name": "Quadrato"})
        self.gw.handle({"action": "arm", "cube": "c1"})
        self.assertTrue(wait(lambda: len(lit(self.emu.played)) > 2000))
        on = lit(self.emu.take_played())
        self.assertTrue(all(s[4] > 0 and s[2] == 0 and s[3] == 0 for s in on))     # blu
        # audio dai rig di DMX: il colpo arriva come cambio del contatore kicks
        self.gw._on_rigs(json.dumps({"rigs": {"rig_a": {"level": 0.8, "kicks": 1}}}))
        self.gw._on_rigs(json.dumps({"rigs": {"rig_a": {"level": 0.8, "kicks": 2}}}))
        level, kick = self.gw.audio_now()
        self.assertAlmostEqual(level, 0.8); self.assertGreater(kick, 0.5)
        self.assertTrue(self.gw.handle({"action": "mode", "cube": "all", "value": "off"})["ok"])
        self.assertFalse(self.cube.armed)
        self.assertTrue(wait(lambda: not self.emu.output, 1.0))

    def test_7_status_payload_is_json(self):
        s = json.loads(json.dumps(self.gw.status_payload()))
        self.assertEqual(s["family"], "laser")
        self.assertEqual(s["laser"]["cubes"][0]["id"], "c1")


class TestGuard(unittest.TestCase):
    def test_guard_blanks_when_gateway_dies(self):
        emu = CubeEmulator("127.0.0.1", 38456)
        try:
            cfg = os.path.join(TMP, "guard.json")
            with open(cfg, "w", encoding="utf-8") as f:
                json.dump({"cubes": {"c1": {"ip": "127.0.0.1", "port_base": 38456}}}, f)
            emu.output = True
            emu.ring = [(0x800, 0x800, 4095, 0, 0)] * 500
            victim = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.5)"])
            guard = subprocess.Popen([sys.executable, os.path.join(HERE, "laser_guard.py"), str(victim.pid), cfg])
            victim.terminate()                         # come l'agent: niente cleanup
            guard.wait(timeout=5)
            self.assertTrue(wait(lambda: not emu.output, 1.0))
            self.assertEqual(len(emu.ring), 0)
        finally:
            emu.close()


if __name__ == "__main__":
    unittest.main()
