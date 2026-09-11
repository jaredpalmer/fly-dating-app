import copy
from dataclasses import asdict, dataclass
import hashlib
import math
import random
import uuid

from .profiles import catalog, catalog_hash


def measured_rate(samples):
    spikes = duration = 0
    for s in samples:
        count, ms = s["pam11_spikes"], s["interval_ms"]
        if not isinstance(count, (int, float)) or not math.isfinite(count) or count < 0 or int(count) != count:
            raise ValueError("Invalid dopamine spike count")
        if not isinstance(ms, (int, float)) or not math.isfinite(ms) or ms <= 0:
            raise ValueError("Invalid neural interval")
        if s.get("stimulus_ms", 0) != 0:
            raise ValueError("Reward-contaminated observation cannot be scored")
        spikes += count
        duration += ms
    return (spikes / (15 * duration / 1000) if duration else None), spikes, duration


@dataclass(frozen=True)
class DopaminePolicy:
    threshold_hz: float = 2.0
    version: str = "baseline-delta-v1"

    def __post_init__(self):
        if not math.isfinite(self.threshold_hz) or self.threshold_hz < 1:
            raise ValueError("Threshold must be finite and at least 1 Hz")

    def decide(self, baseline, photos):
        base, _, baseline_ms = measured_rate(baseline)
        exposure = [s for photo in photos for s in photo]
        response, spikes, exposure_ms = measured_rate(exposure)
        rates = [measured_rate(photo)[0] for photo in photos]
        delta = response - base if response is not None and base is not None else None
        complete = base is not None and len(rates) == 3 and all(r is not None for r in rates)
        consistent = complete and sum(r > base for r in rates) >= 2
        like = complete and spikes > 0 and consistent and delta > self.threshold_hz
        reason = "above_threshold" if like else "below_threshold"
        if not complete:
            reason = "incomplete_observation"
        elif spikes == 0:
            reason = "insufficient_signal"
        elif delta > self.threshold_hz and not consistent:
            reason = "unstable_response"
        return {"choice": "like" if like else "pass", "source": "neural", "reason": reason, "baseline_hz": base, "response_hz": response, "delta_hz": delta, "threshold_hz": self.threshold_hz, "photo_rates_hz": rates, "photo": max(range(len(rates)), key=lambda i: rates[i] if rates[i] is not None else -1) if rates else 0, "baseline_ms": baseline_ms, "exposure_ms": exposure_ms, "spikes": spikes, "policy_version": self.version}


class DatingSession:
    def __init__(self, *, seed=7, tonic_mv=0.0, learning=False, calibration_ms=2400, warmup_ms=300, baseline_ms=300, photo_ms=300):
        profiles = catalog()
        deck = [p["id"] for p in profiles]
        tail = deck[1:]
        random.Random(seed).shuffle(tail)
        deck = deck[:1] + tail
        self.state = {
            "version": 1, "session_id": str(uuid.uuid4()), "catalog_hash": catalog_hash(),
            "seed": seed, "tonic_mv": tonic_mv, "learning": learning, "learning_validated": False,
            "seq": 0, "round": 1, "deck": deck, "index": 0, "trial_number": 0,
            "mode": "auto", "paused": False, "phase": "calibration", "elapsed_ms": 0,
            "calibration_ms": calibration_ms, "warmup_ms": warmup_ms, "baseline_ms": baseline_ms, "photo_ms": photo_ms,
            "policy": asdict(DopaminePolicy()), "calibration": [], "calibrated": False,
            "baseline": [], "photos": [[], [], []], "photo": 0, "decisions": [],
            "matches": {}, "incoming": [], "aborted": [], "commands": [], "context": "discover",
            "profile_id": deck[0], "trial_id": "", "revision": 0,
        }
        self.state["incoming"] = [p["id"] for p in profiles if self.chance(p["id"], "incoming") < .28]
        if not self.state["incoming"]:
            self.state["incoming"] = [deck[0]]
        self._begin(deck[0], "calibration")

    @classmethod
    def restore(cls, state):
        if state.get("version") != 1 or state.get("catalog_hash") != catalog_hash():
            raise ValueError("Dating checkpoint does not match this profile catalog")
        instance = cls.__new__(cls)
        instance.state = copy.deepcopy(state)
        DopaminePolicy(**state["policy"])
        return instance

    @property
    def phase(self):
        return self.state["phase"]

    @property
    def screen_key(self):
        s = self.state
        return f'{s["trial_id"]}:{s["revision"]}:{s["phase"]}:{s["photo"]}'

    @property
    def target_ms(self):
        s = self.state
        return {"calibration": s["calibration_ms"], "warmup": s["warmup_ms"], "baseline": s["baseline_ms"], "photo": s["photo_ms"], "outcome": 200, "washout": 500}.get(self.phase, 0)

    def chance(self, profile_id, purpose):
        value = hashlib.sha256(f'{self.state["seed"]}:{profile_id}:{purpose}'.encode()).digest()
        return int.from_bytes(value[:4]) / 2 ** 32

    def snapshot(self):
        s = copy.deepcopy(self.state)
        s.update(screen_key=self.screen_key, target_ms=self.target_ms, next_sample=s["seq"] + 1)
        s["current_decision"] = s["decisions"][-1] if self.phase == "decision" and s["decisions"] else None
        s["decisions"] = s["decisions"][-100:]
        s["stats"] = {
            "viewed": len(self.state["decisions"]),
            "likes": sum(d["choice"] in ("like", "rose") for d in self.state["decisions"]),
            "passes": sum(d["choice"] == "pass" for d in self.state["decisions"]),
            "matches": sum(not m.get("unmatched") for m in s["matches"].values()),
            "neural": sum(d["source"] == "neural" for d in self.state["decisions"]),
        }
        s["standouts"] = sorted([d for d in self.state["decisions"] if d["source"] == "neural" and d["delta_hz"] is not None and d["delta_hz"] > d["threshold_hz"]], key=lambda d: d["delta_hz"], reverse=True)[:8]
        s.pop("commands")
        return s

    def _phase(self, phase):
        self.state.update(phase=phase, elapsed_ms=0, revision=self.state["revision"] + 1)

    def _begin(self, profile_id, phase="warmup"):
        s = self.state
        s["trial_number"] += 1
        s.update(profile_id=profile_id, trial_id=f'{s["session_id"]}:{s["trial_number"]}', baseline=[], photos=[[], [], []], photo=0)
        if phase == "calibration":
            s.update(calibration=[], calibrated=False)
        self._phase(phase)

    def observe(self, observation):
        if self.phase not in ("calibration", "warmup", "baseline", "photo", "outcome", "washout"):
            raise RuntimeError("This screen is not accepting neural observations")
        s = self.state
        if s["paused"]:
            raise RuntimeError("Experiment is paused")
        sample = {k: observation.get(k, 0) for k in ("pam11_spikes", "interval_ms", "stimulus_ms")}
        if self.phase != "outcome":
            measured_rate([sample])
        elif not math.isfinite(sample["interval_ms"]) or sample["interval_ms"] <= 0:
            raise ValueError("Invalid neural interval")
        if sample["interval_ms"] > self.target_ms - s["elapsed_ms"] + 1e-6:
            raise ValueError("Observation exceeds this screen's neural budget")
        s["seq"] += 1
        s["elapsed_ms"] = round(s["elapsed_ms"] + sample["interval_ms"], 4)
        if self.phase == "calibration":
            s["calibration"].append(sample)
        elif self.phase == "baseline":
            s["baseline"].append(sample)
        elif self.phase == "photo":
            s["photos"][s["photo"]].append(sample)
        if s["elapsed_ms"] + 1e-6 < self.target_ms:
            return None
        if self.phase == "calibration":
            windows, window, duration = [], [], 0
            for reference in s["calibration"]:
                window.append(reference)
                duration += reference["interval_ms"]
                if duration + 1e-6 >= s["photo_ms"]:
                    windows.append(measured_rate(window)[0])
                    window, duration = [], 0
            rates = windows[len(windows) // 2:]
            differences = [abs(b - a) for a, b in zip(rates, rates[1:])]
            margin = max(1.0, max(differences, default=0) * 1.5)
            s.update(policy=asdict(DopaminePolicy(threshold_hz=margin)), calibrated=True, reference_windows_hz=rates)
            self._phase("warmup")
        elif self.phase == "warmup":
            self._phase("baseline")
        elif self.phase == "baseline":
            self._phase("photo")
        elif self.phase == "photo":
            if s["photo"] < 2:
                s["photo"] += 1
                self._phase("photo")
            else:
                return self._commit(DopaminePolicy(**s["policy"]).decide(s["baseline"], s["photos"]))
        elif self.phase == "outcome":
            self._phase("washout")
        else:
            self._next()
        return None

    def _commit(self, decision):
        s = self.state
        decision.update(id=s["trial_id"], profile_id=s["profile_id"], seq=s["seq"], round=s["round"], context=s["context"], tonic_mv=s["tonic_mv"], learning=s["learning"], simulated_outcome=False)
        if s["context"] == "date":
            match = s["matches"][s["profile_id"]]
            match["date"]["status"] = "second_date" if decision["choice"] != "pass" else "no_spark"
            match["messages"].append({"from": "system", "text": "Date observation complete. The continue/pass action follows the displayed neural policy.", "seq": s["seq"]})
        elif decision["choice"] in ("like", "rose"):
            p = s["profile_id"]
            reciprocates = p in s["incoming"] or self.chance(p, "reciprocity") < .46
            decision["simulated_outcome"] = reciprocates
            if reciprocates and (p not in s["matches"] or s["matches"][p].get("unmatched")):
                profile = next(x for x in catalog() if x["id"] == p)
                s["matches"][p] = {"profile_id": p, "unmatched": False, "turn": 0, "date": None, "messages": [{"from": "profile", "text": f'You seem like someone who would appreciate {profile["district"].lower()}. Found any good landing spots lately?', "seq": s["seq"]}]}
        s["decisions"].append(decision)
        self._phase("decision")
        return decision

    def manual(self, choice):
        if choice not in ("like", "pass", "rose"):
            raise ValueError("Invalid manual choice")
        if self.phase in ("decision", "complete", "outcome", "washout"):
            raise RuntimeError("No undecided profile on screen")
        decision = DopaminePolicy(**self.state["policy"]).decide(self.state["baseline"], self.state["photos"])
        decision.update(choice=choice, source="operator", reason="operator_override")
        return self._commit(decision)

    def advance(self):
        if self.phase != "decision":
            raise RuntimeError("No committed decision to advance")
        s = self.state
        last = s["decisions"][-1]
        if s["learning"] and last["source"] == "neural" and last["simulated_outcome"]:
            self._phase("outcome")
        else:
            self._next()

    def _next(self):
        s = self.state
        s["context"] = "discover"
        s["index"] += 1
        if s["index"] >= len(s["deck"]):
            self._phase("complete")
            s["paused"] = True
        else:
            self._begin(s["deck"][s["index"]], "warmup" if s["calibrated"] else "calibration")
            if s["mode"] == "step":
                s["paused"] = True

    def review(self, profile_id):
        s = self.state
        if profile_id not in {p["id"] for p in catalog()}:
            raise ValueError("Unknown profile")
        if self.phase in ("decision", "outcome", "washout"):
            raise RuntimeError("Finish the current action before reviewing another profile")
        if self.phase != "complete":
            s["aborted"].append({"trial_id": s["trial_id"], "reason": "operator_selected_profile", "seq": s["seq"]})
        tail = s["deck"][s["index"]:]
        tail = [p for p in tail if p != profile_id]
        s["deck"] = s["deck"][:s["index"]] + [profile_id] + tail
        s["context"] = "discover"
        self._begin(profile_id, "warmup" if s["calibrated"] else "calibration")

    def new_round(self):
        if self.phase != "complete":
            raise RuntimeError("Finish the deck before starting another round")
        s = self.state
        s["round"] += 1
        s["index"] = 0
        s["deck"] = [p["id"] for p in catalog()]
        random.Random(s["seed"] + s["round"]).shuffle(s["deck"])
        s["paused"] = False
        self._begin(s["deck"][0], "warmup" if s["calibrated"] else "calibration")

    def _match(self, profile_id):
        match = self.state["matches"].get(profile_id)
        if not match or match.get("unmatched"):
            raise ValueError("No active match with this profile")
        return match

    def message(self, profile_id, text):
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise ValueError("Message must contain 1–500 characters")
        s = self.state
        match = self._match(profile_id)
        match["messages"].append({"from": "subject", "text": text.strip(), "seq": s["seq"]})
        match["turn"] += 1
        if match["turn"] >= 2 and self.chance(profile_id, "ghost") < .18:
            match["quiet"] = True
            return
        profile = next(p for p in catalog() if p["id"] == profile_id)
        replies = [f'My ideal afternoon? {profile["prompts"][0]["answer"]}', "I like your energy. Very few flies ask a follow-up question.", f'We could meet around {profile["district"]}. Somewhere with a view and no flypaper.', "A picnic sounds lovely. I will bring absolutely nothing and arrive early."]
        match["messages"].append({"from": "profile", "text": replies[(match["turn"] - 1) % len(replies)], "seq": s["seq"]})

    def invite(self, profile_id):
        match = self._match(profile_id)
        if match["date"] is not None:
            raise RuntimeError("This match already has a date invitation")
        if match.get("quiet"):
            match["date"] = {"status": "unanswered", "place": "The fruit bowl"}
        else:
            match["date"] = {"status": "invited", "place": ["The fruit bowl", "The east windowsill", "A very small picnic"][int(self.chance(profile_id, "place") * 3)]}
            match["messages"].append({"from": "profile", "text": f'It is a date. Meet me at {match["date"]["place"].lower()}.', "seq": self.state["seq"]})

    def start_date(self, profile_id):
        match = self._match(profile_id)
        if not match["date"] or match["date"]["status"] != "invited":
            raise RuntimeError("No accepted date invitation")
        self.review(profile_id)
        self.state["context"] = "date"
        match["date"]["status"] = "observing"
        self.state["paused"] = False

    def unmatch(self, profile_id):
        match = self._match(profile_id)
        match["unmatched"] = True
        match["messages"].append({"from": "system", "text": "Conversation archived by the operator.", "seq": self.state["seq"]})
