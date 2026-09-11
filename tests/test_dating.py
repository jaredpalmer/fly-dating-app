import json

import pytest

from flywirehead.dating import DatingSession, DopaminePolicy
from flywirehead.profiles import catalog


def sample(spikes, ms=100):
    return {"pam11_spikes": spikes, "interval_ms": ms, "stimulus_ms": 0}


def test_catalog_is_fictional_female_adult_and_reproducible():
    profiles = catalog()
    assert profiles == catalog() and len(profiles) == 36
    assert len({p["id"] for p in profiles}) == 36
    assert len({p["name"] for p in profiles}) == 36
    for p in profiles:
        assert p["sex"] == "female" and p["adult_days"] > 0 and p["fictional"]
        assert len(p["prompts"]) == 3 and len(p["photos"]) == 3
        assert "desirability" not in p and "score" not in p


def test_policy_uses_duration_weighted_spikes_not_profile_metadata():
    policy = DopaminePolicy(threshold_hz=3)
    baseline = [sample(15)] * 3
    photos = [[sample(30)] * 3, [sample(45)] * 3, [sample(36)] * 3]
    result = policy.decide(baseline, photos)
    assert result["choice"] == "like"
    assert result["baseline_hz"] == 10
    assert result["response_hz"] == pytest.approx(24.6666667)
    assert result["photo"] == 1 and result["source"] == "neural"
    assert policy.decide([sample(30, 200)], [[sample(60, 200)]] * 3)["response_hz"] == 20


def test_flat_and_zero_signals_are_not_invented_preferences():
    policy = DopaminePolicy(threshold_hz=3)
    assert policy.decide([sample(0)] * 3, [[sample(0)] * 3] * 3)["reason"] == "insufficient_signal"
    flat = policy.decide([sample(15)] * 3, [[sample(15)] * 3] * 3)
    assert flat["choice"] == "pass" and flat["delta_hz"] == 0
    assert policy.decide([], [[], [], []])["reason"] == "incomplete_observation"


def test_policy_rejects_invalid_or_reward_contaminated_samples():
    policy = DopaminePolicy()
    for invalid in [sample(-1), sample(float("nan")), sample(2, 0), {**sample(20), "stimulus_ms": 50}]:
        with pytest.raises(ValueError):
            policy.decide([invalid], [[sample(0)]] * 3)


def test_controller_counts_neural_time_and_commits_once():
    s = DatingSession(seed=7, calibration_ms=200, warmup_ms=100, baseline_ms=100, photo_ms=100)
    for _ in range(2):
        assert s.observe(sample(0)) is None
    assert s.phase == "warmup"
    s.observe(sample(0))
    assert s.phase == "baseline"
    s.observe(sample(0))
    for _ in range(2):
        assert s.observe(sample(30)) is None
    result = s.observe(sample(30))
    assert result["choice"] == "like" and s.phase == "decision"
    assert s.state["decisions"][-1] == result
    with pytest.raises(RuntimeError):
        s.observe(sample(30))
    old_trial = s.state["trial_id"]
    s.advance()
    assert s.phase == "warmup" and s.state["trial_id"] != old_trial
    with pytest.raises(RuntimeError):
        s.advance()


def test_manual_decisions_are_labeled_and_restoration_is_exact():
    s = DatingSession(seed=9)
    s.manual("like")
    assert s.state["decisions"][-1]["source"] == "operator"
    restored = DatingSession.restore(json.loads(json.dumps(s.state)))
    assert restored.state == s.state
    restored.advance()
    s.advance()
    assert restored.state == s.state


def test_social_world_is_seeded_and_separate_from_neural_policy():
    a, b = DatingSession(seed=11), DatingSession(seed=11)
    assert a.state["incoming"] == b.state["incoming"]
    profile = a.state["incoming"][0]
    for s in (a, b):
        s.review(profile)
        s.manual("like")
        assert profile in s.state["matches"]
        s.message(profile, "Any good windowsills?")
        s.invite(profile)
        assert s.state["matches"][profile]["date"]["status"] == "invited"
    assert a.state["matches"] == b.state["matches"]
    with pytest.raises(ValueError):
        a.message(profile, "x" * 501)


def test_reference_calibration_cannot_create_a_like_from_zero():
    s = DatingSession(calibration_ms=200, warmup_ms=100, baseline_ms=100, photo_ms=100)
    for _ in range(7):
        result = s.observe(sample(0))
    assert s.phase == "decision"
    assert result["choice"] == "pass" and result["reason"] == "insufficient_signal"
    assert s.state["policy"]["threshold_hz"] >= 1


def test_manual_override_during_calibration_does_not_bypass_reference_measurement():
    s = DatingSession(calibration_ms=200)
    s.observe(sample(0))
    s.manual("like")
    s.advance()
    assert s.phase == "calibration" and not s.state["calibrated"]
    assert s.state["calibration"] == []


def test_calibration_uses_matched_exposure_windows_not_per_frame_quantization():
    s = DatingSession(calibration_ms=1800, photo_ms=300)
    for i in range(36):
        s.observe(sample(0 if i % 2 else 15, 50))
    assert s.state["calibrated"]
    assert s.state["policy"]["threshold_hz"] == 1


def test_learning_current_follows_decision_and_is_never_scored():
    s = DatingSession(learning=True, calibration_ms=200, warmup_ms=100, baseline_ms=100, photo_ms=100)
    s.review(s.state["incoming"][0])
    while s.phase != "photo":
        s.observe(sample(0))
    for _ in range(3):
        receipt = s.observe(sample(30))
    assert receipt["simulated_outcome"] and receipt["source"] == "neural"
    original = json.loads(json.dumps(receipt))
    s.advance()
    assert s.phase == "outcome"
    for _ in range(2):
        s.observe({**sample(100), "stimulus_ms": 100})
    assert s.phase == "washout" and s.state["decisions"][-1] == original
    for _ in range(5):
        s.observe(sample(0))
    assert s.phase == "warmup" and s.state["baseline"] == []
