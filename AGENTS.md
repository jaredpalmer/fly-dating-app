# Local setup notes

- Setup, run, and test commands are documented in `README.md`. The checked-in `dist/` is served directly; no frontend build or npm install is required.
- On Apple Silicon without Homebrew, the video tools can be installed after `uv sync --locked --extra test` with `uv pip install 'yt-dlp[default]==2026.8.19' 'ffmpeg-downloader==0.5.3'` and `.venv/bin/ffdl install --no-simlinks -y 9`.
- That FFmpeg installation does not change shell profiles. Prepare media with `PATH="$HOME/Library/Application Support/ffmpeg-downloader/ffmpeg:$PATH" uv run --locked python scripts/download_videos.py`. The downloader regenerates the tracked playlist metadata and hashes to match the local MP4 files.
- FFmpeg and yt-dlp are only needed for media preparation. Once data and videos are prepared, `uv run --locked flywirehead run` or `./run.command` starts the application without those tools on PATH.
- A subsequent `uv sync` can remove the extra video-tool packages; reinstall them before downloading new media if needed.
- Full-network tests require prepared data and run with `FLYWIREHEAD_FULL_TEST=1 uv run --locked pytest -q -s tests/test_full_connectome.py`. They use temporary run directories rather than the interactive session's checkpoint.
- The server binds to loopback and validates Host and Origin. Use `http://127.0.0.1:4173` directly if a preview proxy causes API origin errors; do not weaken the origin checks.

# WING development and verification

- `uv run --locked flywirehead run` defaults to WING dating mode and `runs/wing`. It requires prepared neural data but no downloaded videos. The original app is `uv run --locked flywirehead run --experience shorts`, using `runs/local`.
- Use a separate run directory when changing `--dopamine-tonic`, `--learning`, or `--seed`. Dating restarts restore paired SQLite/neural checkpoints paused. `--fresh` refuses to overwrite an existing dating database.
- Install test tools with `uv sync --locked --extra test --extra browser`. Browser tests use an installed Google Chrome through Playwright; they do not access the user's browser profile.
- Fast checks: `uv run --locked pytest -q` and `node --test tests/*.test.mjs`. All integration checks: `FLYWIREHEAD_FULL_TEST=1 FLYWIREHEAD_BROWSER_TEST=1 uv run --locked pytest -q`.
- Against a running dating server, `uv run --locked python scripts/check_browser.py --url http://127.0.0.1:4173` verifies desktop/mobile rendering and saves screenshots under `runs/browser-check`. It advances the active experiment to a profile, then pauses it. Prefer a separate test run directory.
- `scripts/render_profiles.py --count 36` creates all 108 profile retinal fixtures plus a neutral fixture without advancing the live experiment. It expects a running dating server, configurable with `--url`.
- `scripts/assay_dating.py --frames runs/profile-fixtures` measures repeated, reset-checkpoint visual responses. `scripts/assay_policy.py` checks the complete frozen decision loop. Both write their results under `runs/` and never replace the live brain.
- `uv run --locked python scripts/replay_dating.py runs/wing` replays committed archived pixels from the initial checkpoint and verifies exact spike hashes without modifying the source run.
- Do not replace measured dopamine with profile metadata or tune thresholds to force a like ratio. The tested unboosted model produced insufficient-signal passes, and the 7 mV closed-loop assay also produced no threshold-crossing likes. Calibration and outcome learning remain explicitly experimental; manual actions and the seeded social world must remain separately labeled.
- The user selected the active dopamine mode for the live demo: `uv run --locked flywirehead run --dopamine-tonic 7 --run-dir runs/wing-active`. The earlier unboosted brain, matches, and history remain in `runs/wing`. The active mode is profile-independent tonic stimulation, not evidence of attraction; plain `flywirehead run` still selects the unboosted control.
