import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from flywirehead.engine import FlyEngine


def stimuli(directory=None):
    gray = np.full((160, 90, 3), 128, dtype=np.uint8)
    y, x = np.indices((160, 90))
    stripes = np.repeat(np.where((x // 9) % 2, 208, 48)[..., None], 3, axis=2).astype(np.uint8)
    checks = np.repeat(np.where((x // 9 + y // 16) % 2, 208, 48)[..., None], 3, axis=2).astype(np.uint8)
    frames = {"neutral": gray, "white": np.full_like(gray, 255), "black": np.zeros_like(gray), "stripes": stripes, "checks": checks}
    if directory:
        reference = Path(directory) / "neutral.png"
        if reference.exists():
            frames["neutral"] = np.asarray(Image.open(reference).convert("RGB").resize((90, 160)))
        for path in [p for p in sorted(Path(directory).glob("*.png")) if p.name != "neutral.png"][::3][:6]:
            frames[path.stem] = np.asarray(Image.open(path).convert("RGB").resize((90, 160)))
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", type=Path)
    parser.add_argument("--output", type=Path, default=Path("runs/dating-assay.json"))
    parser.add_argument("--tonic", type=float, nargs="+", default=[0, 8, 10])
    parser.add_argument("--repeats", type=int, default=2)
    args = parser.parse_args()
    if args.repeats < 2 or any(not 0 <= v <= 12 for v in args.tonic):
        parser.error("Use at least two repeats and tonic currents in 0–12 mV")
    engine = FlyEngine(frozen=True)
    frames = stimuli(args.frames)
    trials = []
    for tonic in args.tonic:
        engine.brain.tonic[engine.brain.circuit["reward"]] = tonic
        for repeat in range(args.repeats):
            order = list(frames.items())[::1 if repeat % 2 == 0 else -1]
            for name, frame in order:
                engine.brain.reset()
                engine.pending_pulse_ms = 0
                engine.observe(frames["neutral"], 500)
                baseline = engine.observe(frames["neutral"], 300)
                response = engine.observe(frame, 300)
                trial = {"tonic_mv": tonic, "repeat": repeat, "stimulus": name, "baseline_hz": baseline["pam11_hz"], "response_hz": response["pam11_hz"], "delta_hz": response["pam11_hz"] - baseline["pam11_hz"], "spikes": response["pam11_spikes"], "input_sha256": response["input_sha256"], "spike_sha256": response["spike_sha256"]}
                trials.append(trial)
                print(json.dumps(trial), flush=True)
    result = {"version": 1, "frozen": True, "automatic_reward": False, "interpretation": "Synthetic visual-control assay, not a test of attraction. Profile selectivity requires actual rendered profile inputs and held-out validation.", "trials": trials}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
