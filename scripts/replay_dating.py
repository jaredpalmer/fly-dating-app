import argparse
import io
import json
from pathlib import Path
import sqlite3

import numpy as np
from PIL import Image

from flywirehead.engine import FlyEngine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    args = parser.parse_args()
    root = args.run_dir.resolve()
    with sqlite3.connect((root / "wing.sqlite3").as_uri() + "?mode=ro", uri=True) as db:
        first = db.execute("SELECT seq,brain,state FROM checkpoints ORDER BY id LIMIT 1").fetchone()
        if not first:
            raise SystemExit("No committed dating checkpoint exists")
        state = json.loads(first[2])
        engine = FlyEngine(frozen=not state["learning"])
        engine.brain.tonic[engine.brain.circuit["reward"]] = state["tonic_mv"]
        engine.brain.restore(root / "checkpoints" / first[1])
        count = 0
        for raw, png in db.execute("SELECT o.event, f.png FROM observations o JOIN frames f ON f.sha=o.frame_sha WHERE o.session_id=? AND o.seq>? ORDER BY o.seq", (state["session_id"], first[0])):
            expected = json.loads(raw)
            frame = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
            result = engine.observe(frame, expected["interval_ms"], video_reward=expected["stage"] == "outcome")
            for key in ("input_sha256", "spike_sha256", "sim_ms", "pam11_spikes", "stimulus_ms"):
                if result[key] != expected[key]:
                    raise SystemExit(f'Replay mismatch at observation {expected["seq"]}: {key}')
            count += 1
        print(json.dumps({"observations_replayed": count, "sim_ms": engine.brain.sim_ms, "exact_spike_replay": True, "source_run_unchanged": True}, indent=2))


if __name__ == "__main__":
    main()
