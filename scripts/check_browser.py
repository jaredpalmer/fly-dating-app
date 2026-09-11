import argparse
import json
from pathlib import Path
import time

from playwright.sync_api import sync_playwright


def wait_state(page, predicate, timeout=90):
    until = time.monotonic() + timeout
    state = None
    while time.monotonic() < until:
        state = page.evaluate("async () => await (await fetch('/api/status')).json()")
        assert state["phase"] != "error", state["message"]
        if predicate(state):
            return state
        page.wait_for_timeout(150)
    raise AssertionError(f"Browser did not reach expected state: {state['dating']['phase']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4173")
    parser.add_argument("--output", type=Path, default=Path("runs/browser-check"))
    parser.add_argument("--resume-after", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1100}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_function("['BRAIN CONNECTED', 'BRAIN PAUSED'].includes(document.querySelector('#connection-label').textContent)", timeout=90000)
        state = wait_state(page, lambda s: s["phase"] == "ready")
        if state["paused"]:
            page.get_by_role("button", name="Resume fly", exact=True).click()
        wait_state(page, lambda s: s["dating"]["phase"] == "photo")
        page.get_by_role("button", name="Pause fly", exact=True).click()
        state = wait_state(page, lambda s: s["paused"] and not s["busy"])
        assert state["dating"]["phase"] == "photo"
        page.wait_for_timeout(500)
        page.screenshot(path=str(args.output / "desktop.png"), full_page=True)
        print(json.dumps({"phase": state["phase"], "dating_phase": state["dating"]["phase"], "processed_frames": state["sequence"], "pam11_hz": state["telemetry"]["pam11_hz"], "errors": errors}, indent=2))
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        page.screenshot(path=str(args.output / "mobile.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile horizontal overflow"
        if args.resume_after:
            page.get_by_role("button", name="Resume fly", exact=True).click()
            wait_state(page, lambda s: not s["paused"])
        browser.close()
    if errors:
        raise SystemExit("Browser errors: " + json.dumps(errors))


if __name__ == "__main__":
    main()
