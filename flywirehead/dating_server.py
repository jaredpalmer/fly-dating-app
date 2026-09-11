from collections import deque
import copy
import csv
import fcntl
from functools import partial
import hashlib
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import parse_qs, urlsplit
import webbrowser

from .dating import DatingSession
from .dating_store import DatingStore, archived, archived_frame
from .engine import FRAME_HEIGHT, FRAME_WIDTH, FlyEngine, decode_frame
from .profiles import account, catalog, catalog_hash
from .server import Handler, atomic_json


class DatingExperiment:
    def __init__(self, run_dir, *, neural_ms=50, tonic_mv=0, learning=False, seed=7, factory=FlyEngine, verifier=None):
        self.run_dir = Path(run_dir).resolve()
        self.neural_ms, self.tonic_mv, self.learning, self.seed = neural_ms, tonic_mv, learning, seed
        self.factory, self.verifier = factory, verifier
        self.token = secrets.token_urlsafe(24)
        self.condition = threading.Condition()
        self.pending = None
        self.commands = deque()
        self.stopping = False
        self.owner, self.owner_seen = None, 0
        self.session = self.engine = self.store = None
        self.last_submission = None
        self.history = deque(maxlen=120)
        self.state = {"phase": "loading", "message": "Loading the full fly connectome", "busy": False, "paused": False, "sequence": 0, "telemetry": None, "history": [], "dating": None, "checkpoint": None, "model": None}
        self.export_state = None
        self.thread = threading.Thread(target=self._work, name="wing-brain", daemon=False)

    def start(self):
        self.thread.start()

    def snapshot(self):
        with self.condition:
            return copy.deepcopy(self.state)

    def export(self):
        with self.condition:
            return {"version": 1, "interpretation": "Neural firing is measured; decisions use an engineered policy; profiles, reciprocity and messages are fictional. No claim of biological attraction or language understanding.", "catalog": catalog(), "account": account(), "session": copy.deepcopy(self.export_state), "model": copy.deepcopy(self.state["model"])}

    def _claim(self, client):
        if not isinstance(client, str) or not 1 <= len(client) <= 80:
            raise ValueError("A client ID is required")
        now = time.monotonic()
        if self.owner not in (None, client) and now - self.owner_seen < 4:
            raise RuntimeError("Another window owns the sensory stream")
        self.owner, self.owner_seen = client, now

    def submit(self, body, client, *, screen_key, sample_id, session_id):
        frame = decode_frame(body)
        if not isinstance(sample_id, int) or sample_id < 1:
            raise ValueError("A positive sample ID is required")
        fingerprint = hashlib.sha256(body).hexdigest()
        request = (client, session_id, sample_id, screen_key, fingerprint)
        with self.condition:
            if self.state["phase"] != "ready":
                raise RuntimeError(self.state["message"])
            if request == self.last_submission:
                return {"accepted": True, "duplicate": True}
            dating = self.state["dating"]
            if session_id != dating["session_id"] or screen_key != dating["screen_key"] or sample_id != dating["next_sample"]:
                raise RuntimeError("Stale observation; refresh the active screen")
            if dating["phase"] not in ("calibration", "warmup", "baseline", "photo", "outcome", "washout"):
                raise RuntimeError("This screen cannot supply observations")
            if self.state["paused"] or self.state["busy"] or self.pending is not None or self.commands:
                raise RuntimeError("Neural worker is paused or busy")
            self._claim(client)
            self.pending = (frame, request, time.time())
            self.last_submission = request
            self.condition.notify_all()
        return {"accepted": True, "duplicate": False}

    def control(self, data, client):
        allowed = {"pause", "resume", "step", "save", "advance", "manual_like", "manual_pass", "rose", "review", "message", "invite", "date", "unmatch", "new_round"}
        if not isinstance(data, dict) or set(data) - {"action", "id", "trial_id", "profile_id", "text"}:
            raise ValueError("Invalid control object")
        action, identifier = data.get("action"), data.get("id")
        if not isinstance(action, str) or action not in allowed:
            raise ValueError("Unknown dating action")
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", identifier):
            raise ValueError("An idempotency ID is required")
        for key, limit in (("profile_id", 40), ("trial_id", 100), ("text", 500)):
            if key in data and (not isinstance(data[key], str) or len(data[key]) > limit):
                raise ValueError(f"Invalid {key}")
        with self.condition:
            if self.state["phase"] != "ready":
                raise RuntimeError(self.state["message"])
            self._claim(client)
            if len(self.commands) >= 8:
                raise RuntimeError("Too many pending commands")
            done = threading.Event()
            command = {"data": data, "done": done, "error": None}
            self.commands.append(command)
            if self.pending is not None:
                self.pending = None
                self.last_submission = None
            self.condition.notify_all()
        if not done.wait(60):
            raise RuntimeError("Command is still pending; retry with the same idempotency ID")
        if command["error"]:
            raise command["error"]
        return self.snapshot()

    def _publish(self):
        s = self.session
        with self.condition:
            self.state.update(dating=s.snapshot(), paused=s.state["paused"], sequence=s.state["seq"], history=list(self.history))
            self.export_state = copy.deepcopy(s.state)

    def _save(self):
        saved = self.store.save(self.engine.brain, self.session.state)
        with self.condition:
            self.state["checkpoint"] = saved

    def _command(self, data):
        s = self.session
        identifier = data["id"]
        fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, allow_nan=False).encode()).hexdigest()
        if self.store.command_seen(s.state["session_id"], identifier, fingerprint) or identifier in s.state["commands"]:
            return
        action = data["action"]
        if action in {"advance", "manual_like", "manual_pass", "rose", "review", "date"} and data.get("trial_id") != s.state["trial_id"]:
            raise RuntimeError("This command belongs to an old profile")
        if action == "pause":
            s.state["paused"] = True
        elif action in ("resume", "step"):
            if s.phase == "complete":
                raise RuntimeError("The deck is complete; start another round")
            s.state.update(paused=False, mode="step" if action == "step" else "auto")
        elif action == "advance":
            s.advance()
        elif action in ("manual_like", "manual_pass", "rose"):
            was_paused = s.state["paused"]
            s.manual({"manual_like": "like", "manual_pass": "pass", "rose": "rose"}[action])
            if was_paused:
                s.state.update(paused=False, mode="step")
        elif action == "review":
            s.review(data.get("profile_id"))
        elif action == "message":
            s.message(data.get("profile_id"), data.get("text"))
        elif action == "invite":
            s.invite(data.get("profile_id"))
        elif action == "date":
            s.start_date(data.get("profile_id"))
        elif action == "unmatch":
            s.unmatch(data.get("profile_id"))
        elif action == "new_round":
            s.new_round()
        s.state["commands"].append(identifier)
        s.state["commands"] = s.state["commands"][-256:]
        self.store.record_command(s.state["session_id"], identifier, fingerprint)
        self._save()
        self._publish()

    def _work(self):
        current = None
        try:
            if self.verifier is None:
                from .data import verify
                verified = verify()
            else:
                verified = self.verifier()
            self.store = DatingStore(self.run_dir)
            saved = self.store.latest()
            self.engine = self.factory(frozen=not self.learning)
            b = self.engine.brain
            b.tonic[b.circuit["reward"]] = self.tonic_mv
            if saved:
                self.session = DatingSession.restore(saved["state"])
                if self.session.state["tonic_mv"] != self.tonic_mv or self.session.state["learning"] != self.learning or self.session.state["seed"] != self.seed:
                    raise ValueError("Experiment settings differ from this checkpoint; use a new --run-dir")
                b.restore(self.run_dir / "checkpoints" / saved["brain"])
                self.session.state["paused"] = True
            else:
                self.session = DatingSession(seed=self.seed, tonic_mv=self.tonic_mv, learning=self.learning)
            model = {**verified, "backend": "Python / C++17", "retinal_inputs": len(b.retina) + len(b.r8), "dt_ms": b.dt, "plastic_edges": len(b.circuit["edges"]), "frozen": not self.learning, "tonic_mv": self.tonic_mv, "automatic_video_reward": False, "learning": self.learning, "learning_validated": False, "selectivity_validated": False, "catalog_hash": catalog_hash()}
            atomic_json(self.run_dir / "provenance.json", {"model": model, "policy": self.session.state["policy"], "neural_ms": self.neural_ms, "started_at": time.time(), "reward": "Only optional post-decision simulated-match outcomes; never part of the decision window.", "social_world": "Seeded fiction, independent of neural measurements."})
            with self.condition:
                self.state.update(message="Ready for WING screen pixels", model=model)
            self._save()
            self._publish()
            with self.condition:
                self.state["phase"] = "ready"
            print(f"WING ready: {b.n:,} neurons; tonic={self.tonic_mv:g} mV; learning={self.learning}", flush=True)
            while True:
                with self.condition:
                    self.condition.wait_for(lambda: self.stopping or self.commands or self.pending is not None)
                    if self.stopping:
                        break
                    current = self.commands.popleft() if self.commands else None
                    item = None if current else self.pending
                    if item:
                        self.pending = None
                    self.state["busy"] = True
                if current:
                    try:
                        self._command(current["data"])
                    except (ValueError, RuntimeError) as error:
                        current["error"] = error
                    finally:
                        with self.condition:
                            self.state["busy"] = False
                        current["done"].set()
                        current = None
                    continue
                frame, request, received = item
                s = self.session
                if request[3] != s.screen_key or request[2] != s.state["seq"] + 1 or s.state["paused"]:
                    self.last_submission = None
                    with self.condition:
                        self.state["busy"] = False
                    continue
                phase, trial_id, photo, profile_id = s.phase, s.state["trial_id"], s.state["photo"], s.state["profile_id"]
                interval = min(self.neural_ms, s.target_ms - s.state["elapsed_ms"])
                if phase == "calibration":
                    interval = min(interval, s.state["photo_ms"] - s.state["elapsed_ms"] % s.state["photo_ms"])
                result = self.engine.observe(frame, interval, video_reward=phase == "outcome")
                result.pop("bins", None)
                decision = s.observe(result)
                event = {**result, "seq": s.state["seq"], "session_id": s.state["session_id"], "trial_id": trial_id, "profile_id": profile_id, "screen_key": request[3], "stage": phase, "photo": photo, "received_at": received, "completed_at": time.time()}
                self.store.observe(frame, event)
                self.history.append({"sim_ms": result["sim_ms"], "pam11_hz": result["pam11_hz"], "stage": phase, "trial_id": trial_id})
                if decision:
                    self._save()
                with self.condition:
                    self.state.update(telemetry=event, message="Receiving WING screen pixels")
                self._publish()
                with self.condition:
                    self.state["busy"] = False
            self._save()
        except Exception as error:
            with self.condition:
                self.state.update(phase="error", busy=False, message=f"{type(error).__name__}: {error}")
                if current:
                    current["error"] = RuntimeError(str(error))
                    current["done"].set()
                for command in self.commands:
                    command["error"] = RuntimeError(str(error))
                    command["done"].set()
                self.commands.clear()
            print(f"WING error: {error}", flush=True)
        finally:
            if self.store:
                self.store.close()

    def stop(self):
        with self.condition:
            self.stopping = True
            self.condition.notify_all()
        self.thread.join()


class DatingHandler(Handler):
    def _bytes(self, body, content_type, filename=None):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.local_request():
            return self.respond(403, {"error": "Local origin required"})
        parsed = urlsplit(self.path)
        if parsed.path == "/api/wing/catalog":
            return self.respond(200, {"profiles": catalog(), "account": account(), "hash": catalog_hash()})
        if parsed.path == "/api/wing/export":
            exported = self.experiment.export()
            if parse_qs(parsed.query).get("format") == ["csv"]:
                text = io.StringIO()
                fields = ["id", "profile_id", "choice", "source", "reason", "baseline_hz", "response_hz", "delta_hz", "threshold_hz", "tonic_mv", "learning"]
                writer = csv.DictWriter(text, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
                writer.writerows((exported["session"] or {}).get("decisions", []))
                return self._bytes(text.getvalue().encode(), "text/csv; charset=utf-8", "wing-decisions.csv")
            return self._bytes(json.dumps(exported, indent=2, allow_nan=False).encode(), "application/json", "wing-session.json")
        if parsed.path == "/api/wing/observations":
            trial = parse_qs(parsed.query).get("trial", [None])[0]
            if trial is not None and len(trial) > 100:
                return self.respond(400, {"error": "Invalid trial ID"})
            return self.respond(200, {"observations": archived(self.experiment.run_dir, trial)})
        if parsed.path.startswith("/api/wing/frames/"):
            sha = parsed.path.rsplit("/", 1)[-1]
            try:
                image = archived_frame(self.experiment.run_dir, sha)
            except ValueError as error:
                return self.respond(400, {"error": str(error)})
            return self._bytes(image, "image/png") if image else self.respond(404, {"error": "Frame not found"})
        if parsed.path in ("/", "/index.html"):
            self.path = "/wing.html"
        return super().do_GET()

    def do_POST(self):
        if not self.local_request() or not secrets.compare_digest(self.headers.get("X-Fly-Token", ""), self.experiment.token):
            return self.respond(403, {"error": "Valid local session required"})
        try:
            length = int(self.headers.get("Content-Length", "-1"))
            if not 0 <= length <= FRAME_WIDTH * FRAME_HEIGHT * 4:
                return self.respond(413, {"error": "Invalid payload size"})
            self.connection.settimeout(10)
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Truncated request")
            client = self.headers.get("X-Fly-Client", "")
            path = urlsplit(self.path).path
            if path == "/api/frame":
                if self.headers.get("Content-Type") != "application/octet-stream":
                    raise ValueError("Expected raw RGBA bytes")
                result = self.experiment.submit(body, client, screen_key=self.headers.get("X-Wing-Screen", ""), session_id=self.headers.get("X-Wing-Session", ""), sample_id=int(self.headers.get("X-Wing-Sample", "0")))
                return self.respond(202, result)
            if path in ("/api/control", "/api/wing/control"):
                if self.headers.get("Content-Type") != "application/json":
                    raise ValueError("Expected JSON")
                return self.respond(200, self.experiment.control(json.loads(body), client))
            return self.respond(404, {"error": "Unknown API endpoint"})
        except (ValueError, TypeError, UnicodeError) as error:
            return self.respond(400, {"error": str(error)})
        except RuntimeError as error:
            return self.respond(409, {"error": str(error)})


def serve(args):
    run_dir = args.run_dir.resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    lock = (run_dir / "worker.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("This run directory already has an active brain")
    if args.fresh and (run_dir / "wing.sqlite3").exists():
        raise SystemExit("Preserving existing dating history. Choose a new --run-dir for a fresh session.")
    experiment = DatingExperiment(run_dir, neural_ms=args.neural_ms, tonic_mv=args.dopamine_tonic, learning=args.learning and not args.frozen, seed=args.seed)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(DatingHandler, experiment=experiment))
    experiment.start()
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"WING: {url}\nCtrl-C saves the brain and dating session.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:
        print("Saving WING session…", flush=True)
    finally:
        server.server_close()
        experiment.stop()
        lock.close()
