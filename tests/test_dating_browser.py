from functools import partial
import json
import os
import threading
import time

import pytest

from flywirehead.dating_server import DatingExperiment, DatingHandler, ThreadingHTTPServer

pytestmark = pytest.mark.skipif(os.environ.get("FLYWIREHEAD_BROWSER_TEST") != "1", reason="Requires prepared data, browser extra, and Chrome")


def state(page):
    return page.evaluate("async () => await (await fetch('/api/status')).json()")


def wait(page, predicate, timeout=90):
    until = time.monotonic() + timeout
    latest = None
    while time.monotonic() < until:
        latest = state(page)
        assert latest["phase"] != "error", latest["message"]
        if predicate(latest):
            return latest
        page.wait_for_timeout(150)
    pytest.fail(f"Browser state timeout: {latest['dating']['phase']}")


def test_real_browser_dating_social_world_and_persistence(tmp_path):
    from playwright.sync_api import sync_playwright

    exp = DatingExperiment(tmp_path, neural_ms=100)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(DatingHandler, experiment=exp))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    exp.start()
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            page.goto(f"http://127.0.0.1:{server.server_port}", wait_until="domcontentloaded")
            first = wait(page, lambda s: s.get("dating") and len(s["dating"]["decisions"]) >= 1)
            receipt = first["dating"]["decisions"][0]
            assert receipt["source"] == "neural" and receipt["exposure_ms"] == 900
            assert receipt["baseline_ms"] == 300 and receipt["tonic_mv"] == 0
            assert all(s["stimulus_ms"] == 0 for samples in first["dating"]["photos"] for s in samples)
            page.locator('[data-tab="incoming"]').click()
            page.locator("#world-dialog .profile-tile").first.wait_for()
            selected = page.locator("#world-dialog .profile-tile h3").first.inner_text()
            page.locator("#world-dialog .profile-tile").first.click()
            page.get_by_role("button", name="Let Francis meet her", exact=True).click()
            wait(page, lambda s: s["dating"]["phase"] == "photo" and s["dating"]["profile_id"] == selected.lower())
            page.get_by_role("button", name="Manual like", exact=True).click()
            liked = wait(page, lambda s: selected.lower() in s["dating"]["matches"])
            assert liked["dating"]["decisions"][-1]["source"] == "operator"
            page.locator('[data-tab="messages"]').click()
            page.locator("#world-dialog .history-row").first.wait_for()
            page.locator("#world-dialog .history-row").first.click()
            page.get_by_role("textbox", name=f"Message to {selected}").fill("Any favorite windowsills?")
            page.get_by_role("button", name="Send", exact=True).click()
            page.locator(".chat-bubble.subject").get_by_text("Any favorite windowsills?", exact=True).wait_for()
            page.get_by_role("button", name="Invite her on a date", exact=True).click()
            page.get_by_role("button", name="Meet at", exact=False).wait_for()
            paused = wait(page, lambda s: s["paused"] and not s["busy"])
            page.wait_for_timeout(500)
            assert state(page)["sequence"] == paused["sequence"]
            page.get_by_role("button", name="Meet at", exact=False).click()
            date = wait(page, lambda s: s["dating"]["context"] == "date" and s["dating"]["phase"] == "photo")
            assert date["dating"]["matches"][selected.lower()]["date"]["status"] == "observing"
            page.get_by_role("button", name="Pause fly", exact=True).click()
            saved = wait(page, lambda s: s["paused"] and not s["busy"])
            exported = page.request.get(f"http://127.0.0.1:{server.server_port}/api/wing/export").json()
            assert exported["session"]["seq"] == saved["sequence"]
            assert len(exported["session"]["decisions"]) >= 2
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(250)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.reload(wait_until="domcontentloaded")
            restored_ui = wait(page, lambda s: s.get("dating") and s["paused"])
            assert restored_ui["dating"]["matches"] == saved["dating"]["matches"]
            assert not errors, errors
            browser.close()
        exp.stop()
        restored = DatingExperiment(tmp_path, neural_ms=100)
        restored.start()
        until = time.monotonic() + 30
        while restored.snapshot()["phase"] == "loading" and time.monotonic() < until:
            time.sleep(.1)
        try:
            after = restored.snapshot()
            assert after["phase"] == "ready", after["message"]
            assert after["sequence"] == saved["sequence"]
            assert after["dating"]["matches"] == saved["dating"]["matches"]
            assert after["paused"]
        finally:
            restored.stop()
        print(json.dumps({"real_browser": True, "autonomous_decision": True, "manual_match": True, "messages": True, "date": True, "reload_and_checkpoint_restore": True, "mobile_overflow": False, "console_errors": errors}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        exp.stop()


def test_reduced_motion_and_context_loss_stop_neural_input(tmp_path):
    from playwright.sync_api import sync_playwright

    exp = DatingExperiment(tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(DatingHandler, experiment=exp))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    exp.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(reduced_motion="reduce")
            page.goto(f"http://127.0.0.1:{server.server_port}", wait_until="domcontentloaded")
            paused = wait(page, lambda s: s["phase"] == "ready" and s["paused"])
            page.wait_for_timeout(400)
            assert state(page)["sequence"] == paused["sequence"] == 0
            page.get_by_role("button", name="Resume fly", exact=True).click()
            wait(page, lambda s: s["sequence"] >= 2)
            page.evaluate("document.querySelector('#scene').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
            page.get_by_role("alert").get_by_text("Visual input suspended:", exact=False).wait_for()
            stopped = wait(page, lambda s: s["paused"] and not s["busy"])
            page.wait_for_timeout(500)
            assert state(page)["sequence"] == stopped["sequence"]
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        exp.stop()
