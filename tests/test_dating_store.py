import hashlib
import json

import numpy as np

from flywirehead.dating import DatingSession
from flywirehead.dating_store import DatingStore, archived, archived_frame


class Brain:
    sim_ms = 0

    def checkpoint(self, path):
        path.write_bytes(b"test-checkpoint")


def test_paired_checkpoint_and_uncommitted_frames_recover_together(tmp_path):
    s = DatingSession()
    store = DatingStore(tmp_path)
    store.save(Brain(), s.state)
    pixels = np.zeros((160, 90, 3), np.uint8)
    sha = hashlib.sha256(pixels.tobytes()).hexdigest()
    event = {"seq": 1, "trial_id": s.state["trial_id"], "session_id": s.state["session_id"], "input_sha256": sha}
    store.observe(pixels, event)
    assert archived(tmp_path) == []
    store.close()
    recovered = DatingStore(tmp_path)
    assert recovered.latest()["seq"] == 0
    assert archived(tmp_path) == []
    recovered.observe(pixels, event)
    s.state["seq"] = 1
    recovered.save(Brain(), s.state)
    assert archived(tmp_path) == [event]
    assert archived_frame(tmp_path, sha).startswith(b"\x89PNG")
    assert json.loads(json.dumps(recovered.latest()["state"])) == s.state
    recovered.close()


def test_unchanged_brain_is_reused_for_social_state_checkpoints(tmp_path):
    s, brain = DatingSession(), Brain()
    store = DatingStore(tmp_path)
    a = store.save(brain, s.state)
    s.state["paused"] = True
    b = store.save(brain, s.state)
    assert a["brain"] == b["brain"]
    assert store.latest()["state"]["paused"]
    store.close()
