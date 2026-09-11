import io
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid

from PIL import Image


class DatingStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "checkpoints").mkdir(exist_ok=True)
        self.db = sqlite3.connect(self.root / "wing.sqlite3")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS frames (sha TEXT PRIMARY KEY, png BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS observations (session_id TEXT NOT NULL, seq INTEGER NOT NULL, trial_id TEXT NOT NULL, frame_sha TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session_id, seq));
            CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, receipt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS commands (session_id TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY (session_id, id));
            CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, seq INTEGER NOT NULL, brain TEXT NOT NULL, state TEXT NOT NULL, saved_at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS observation_trial ON observations(trial_id);
        """)
        latest = self.latest()
        self.last_seq = latest["seq"] if latest else None
        self.last_brain = latest["brain"] if latest else None

    def latest(self):
        row = self.db.execute("SELECT seq, brain, state, saved_at FROM checkpoints ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        if not re.fullmatch(r"[a-f0-9]{32}\.npz", row[1]):
            raise ValueError("Invalid checkpoint filename")
        return {"seq": row[0], "brain": row[1], "state": json.loads(row[2]), "saved_at": row[3]}

    def observe(self, frame, event):
        sha = event["input_sha256"]
        if not self.db.execute("SELECT 1 FROM frames WHERE sha=?", (sha,)).fetchone():
            image = io.BytesIO()
            Image.fromarray(frame).save(image, format="PNG")
            self.db.execute("INSERT INTO frames VALUES (?,?)", (sha, image.getvalue()))
        self.db.execute("INSERT INTO observations VALUES (?,?,?,?,?)", (event["session_id"], event["seq"], event["trial_id"], sha, json.dumps(event, allow_nan=False)))

    def command_seen(self, session_id, identifier, fingerprint):
        row = self.db.execute("SELECT fingerprint FROM commands WHERE session_id=? AND id=?", (session_id, identifier)).fetchone()
        if row and row[0] != fingerprint:
            raise RuntimeError("Idempotency ID already used for a different command")
        return row is not None

    def record_command(self, session_id, identifier, fingerprint):
        self.db.execute("INSERT INTO commands VALUES (?,?,?)", (session_id, identifier, fingerprint))

    def save(self, brain, state):
        name = self.last_brain
        if name is None or state["seq"] != self.last_seq:
            name = f"{uuid.uuid4().hex}.npz"
            brain.checkpoint(self.root / "checkpoints" / name)
        now = time.time()
        self.db.execute("INSERT INTO checkpoints (session_id,seq,brain,state,saved_at) VALUES (?,?,?,?,?)", (state["session_id"], state["seq"], name, json.dumps(state, allow_nan=False), now))
        for decision in state["decisions"]:
            self.db.execute("INSERT OR IGNORE INTO decisions VALUES (?,?,?)", (decision["id"], state["session_id"], json.dumps(decision, allow_nan=False)))
        self.db.commit()
        self.last_seq, self.last_brain = state["seq"], name
        return {"saved_at": now, "sim_ms": brain.sim_ms, "sequence": state["seq"], "brain": name}

    def close(self):
        self.db.close()


def archived(root, trial_id=None):
    path = Path(root) / "wing.sqlite3"
    if not path.exists():
        return []
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        query = "SELECT event FROM observations"
        params = ()
        if trial_id is not None:
            query += " WHERE trial_id=?"
            params = (trial_id,)
        query += " ORDER BY seq"
        return [json.loads(row[0]) for row in db.execute(query, params)]


def archived_frame(root, sha):
    if not re.fullmatch(r"[a-f0-9]{64}", sha):
        raise ValueError("Invalid frame hash")
    with sqlite3.connect((Path(root) / "wing.sqlite3").as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT png FROM frames WHERE sha=?", (sha,)).fetchone()
        return row[0] if row else None
