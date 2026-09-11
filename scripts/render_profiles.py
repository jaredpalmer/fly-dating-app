import argparse
import base64
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4173")
    parser.add_argument("--output", type=Path, default=Path("runs/profile-fixtures"))
    parser.add_argument("--count", type=int, default=6)
    args = parser.parse_args()
    if not 1 <= args.count <= 36:
        parser.error("Count must be 1–36")
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page()
        page.route("**/assay-render", lambda route: route.fulfill(content_type="text/html", body='<html><head><script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script></head><body></body></html>'))
        page.goto(args.url + "/assay-render")
        frames = page.evaluate("""async count => {
            const { PortraitStudio } = await import('./wing-portraits.js');
            const { WingScreen } = await import('./wing-screen.js');
            const { createLab } = await import('./scene.js');
            const { profiles } = await (await fetch('/api/wing/catalog')).json();
            const studio = new PortraitStudio(), canvas = document.createElement('canvas');
            canvas.width = 720; canvas.height = 1280;
            const screen = new WingScreen(canvas, studio, profiles, true);
            const chamber = document.createElement('canvas'); chamber.style.width = '640px'; chamber.style.height = '480px'; document.body.append(chamber);
            const lab = createLab(chamber, canvas), frames = [];
            const capture = (name, state) => {
                screen.render(state, 0); lab.render(0, 0, { paused: true, pam11Hz: 0, motorHz: 0, turnHz: 0 });
                frames.push({ name, bytes: btoa(String.fromCharCode(...lab.captureFrame())) });
            };
            capture('neutral', { phase: 'baseline', screen_key: 'neutral', paused: true });
            for (const profile of profiles.slice(0, count)) for (let photo = 0; photo < 3; photo++) capture(`${profile.id}-${photo}`, { profile_id: profile.id, photo, phase: 'photo', screen_key: `${profile.id}:${photo}`, context: 'discover', paused: true });
            lab.dispose(); studio.dispose(); return frames;
        }""", args.count)
        browser.close()
    for frame in frames:
        rgba = np.frombuffer(base64.b64decode(frame["bytes"]), np.uint8).reshape(160, 90, 4)
        Image.fromarray(rgba[::-1, :, :3]).save(args.output / f'{frame["name"]}.png')
    print(f"Rendered {len(frames)} exact retinal fixtures without advancing the live experiment.")


if __name__ == "__main__":
    main()
