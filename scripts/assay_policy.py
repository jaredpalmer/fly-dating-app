import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from flywirehead.dating import DatingSession
from flywirehead.engine import FlyEngine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", type=Path, default=Path("runs/profile-fixtures"))
    parser.add_argument("--output", type=Path, default=Path("runs/dating-policy-assay.json"))
    parser.add_argument("--tonic", type=float, nargs="+", default=[0, 7])
    parser.add_argument("--count", type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.count <= 36 or any(not 0 <= t <= 12 for t in args.tonic):
        parser.error("Count must be 1–36; tonic currents must be 0–12 mV")
    frames = {p.stem: np.asarray(Image.open(p).convert("RGB")) for p in args.frames.glob("*.png")}
    if "neutral" not in frames:
        parser.error("Render fixtures first with scripts/render_profiles.py --count 36")
    engine = FlyEngine(frozen=True)
    runs = []
    for tonic in args.tonic:
        engine.brain.reset()
        engine.brain.tonic[engine.brain.circuit["reward"]] = tonic
        session = DatingSession(tonic_mv=tonic)
        while len(session.state["decisions"]) < args.count:
            if session.phase == "decision":
                session.advance()
                continue
            key = f'{session.state["profile_id"]}-{session.state["photo"]}' if session.phase == "photo" else "neutral"
            interval = min(50, session.target_ms - session.state["elapsed_ms"])
            result = engine.observe(frames[key], interval)
            decision = session.observe(result)
            if decision:
                print(json.dumps({"tonic_mv": tonic, "profile": decision["profile_id"], "choice": decision["choice"], "delta_hz": decision["delta_hz"], "threshold_hz": decision["threshold_hz"], "photo_rates_hz": decision["photo_rates_hz"]}), flush=True)
        runs.append({"tonic_mv": tonic, "reference_windows_hz": session.state["reference_windows_hz"], "policy": session.state["policy"], "decisions": session.state["decisions"]})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"version": 1, "frozen": True, "seed": 7, "interpretation": "Closed-loop visual-response assay using rendered profile pixels. This does not establish attraction or learned preference.", "runs": runs}, indent=2) + "\n")


if __name__ == "__main__":
    main()
