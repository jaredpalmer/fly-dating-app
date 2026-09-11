from functools import partial
import hashlib
import json
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
import pytest

from flywirehead.dating_server import DatingExperiment, DatingHandler, ThreadingHTTPServer


class TestBrain:
    __test__ = False
    n, dt = 15, .1
    retina, r8 = list(range(5)), list(range(2))

    def __init__(self):
        self.circuit = {"reward": np.arange(15), "edges": []}
        self.tonic = np.zeros(15)
        self.sim_ms = 0

    def checkpoint(self, path):
        path.write_text(json.dumps({"sim_ms": self.sim_ms}))

    def restore(self, path):
        self.sim_ms = json.loads(path.read_text())["sim_ms"]


class TestEngine:
    __test__ = False

    def __init__(self, **kwargs):
        self.brain = TestBrain()

    def observe(self, frame, interval, *, video_reward=False):
        self.brain.sim_ms += interval
        spikes = 15 if frame.mean() > 200 else 0
        return {"sim_ms": self.brain.sim_ms, "interval_ms": interval, "pam11_hz": spikes / (15 * interval / 1000), "pam11_spikes": spikes, "stimulus_ms": interval if video_reward else 0, "input_sha256": hashlib.sha256(frame.tobytes()).hexdigest(), "spike_sha256": str(spikes), "total_spikes": spikes, "bins": []}


def wait_for(exp, predicate):
    until = time.monotonic() + 5
    while time.monotonic() < until:
        s = exp.snapshot()
        assert s["phase"] != "error", s["message"]
        if predicate(s):
            return s
        time.sleep(.01)
    pytest.fail("Worker did not reach expected state")


@pytest.fixture
def app(tmp_path):
    exp = DatingExperiment(tmp_path, neural_ms=100, factory=TestEngine, verifier=lambda: {"neurons": 15})
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(DatingHandler, experiment=exp))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    exp.start()
    wait_for(exp, lambda s: s["phase"] == "ready")
    yield exp, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()
    thread.join()
    exp.stop()


def request(exp, url, path, body=None, **headers):
    defaults = {"X-Fly-Token": exp.token, "X-Fly-Client": "test", "Content-Type": "application/json"}
    defaults.update(headers)
    try:
        with urlopen(Request(url + path, body, headers=defaults), timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def control(exp, url, action, identifier, **args):
    return request(exp, url, "/api/wing/control", json.dumps({"action": action, "id": identifier, **args}).encode())


def frame(exp, url, state=None, **headers):
    d = (state or exp.snapshot())["dating"]
    return request(exp, url, "/api/frame", bytes(90 * 160 * 4), **{"Content-Type": "application/octet-stream", "X-Wing-Screen": d["screen_key"], "X-Wing-Session": d["session_id"], "X-Wing-Sample": str(d["next_sample"]), **headers})


def test_stale_and_duplicate_frames_cannot_advance_twice(app):
    exp, url = app
    old = exp.snapshot()
    assert frame(exp, url, old)[0] == 202
    wait_for(exp, lambda s: s["sequence"] == 1 and not s["busy"])
    code, reply = frame(exp, url, old)
    assert code == 202 and reply["duplicate"]
    time.sleep(.04)
    assert exp.snapshot()["sequence"] == 1
    assert frame(exp, url, old, **{"X-Wing-Screen": "old-screen"})[0] == 409
    assert frame(exp, url, **{"X-Fly-Client": "other"})[0] == 409
    assert frame(exp, url, **{"Origin": "https://example.com"})[0] == 403


def test_manual_decision_is_idempotent_and_survives_restart(app):
    exp, url = app
    trial = exp.snapshot()["dating"]["trial_id"]
    args = {"trial_id": trial}
    assert control(exp, url, "manual_like", "like-once", **args)[0] == 200
    assert control(exp, url, "manual_like", "like-once", **args)[0] == 200
    decisions = exp.snapshot()["dating"]["decisions"]
    assert len(decisions) == 1 and decisions[0]["source"] == "operator"
    assert control(exp, url, "advance", "advance-once", **args)[0] == 200
    assert control(exp, url, "manual_like", "stale-like", **args)[0] == 409
    exp.stop()
    restored = DatingExperiment(exp.run_dir, factory=TestEngine, verifier=lambda: {"neurons": 15})
    restored.start()
    try:
        state = wait_for(restored, lambda s: s["phase"] == "ready")
        assert state["paused"] and state["dating"]["decisions"] == decisions
    finally:
        restored.stop()


def test_pause_and_invalid_commands_do_not_poison_worker(app):
    exp, url = app
    assert control(exp, url, "pause", "pause-1")[0] == 200
    assert frame(exp, url)[0] == 409
    assert control(exp, url, "message", "bad-profile", profile_id=[])[0] == 400
    assert control(exp, url, "stimulate", "no-stimulus")[0] == 400
    assert control(exp, url, "resume", "resume-1")[0] == 200
    assert frame(exp, url)[0] == 202
    wait_for(exp, lambda s: s["sequence"] == 1 and not s["busy"])
    assert request(exp, url, "/api/wing/catalog")[1]["profiles"][0]["name"] == "Juniper"


def test_reusing_a_control_id_with_different_payload_is_rejected(app):
    exp, url = app
    assert control(exp, url, "pause", "same-id")[0] == 200
    assert control(exp, url, "resume", "same-id")[0] == 409
    assert exp.snapshot()["paused"]
