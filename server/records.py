import json
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

def connect(path):
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

@contextmanager
def session(path):
    conn = connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def entry(row):
    return {**json.loads(row["body"]), "id": str(row["number"]), "number": row["number"],
            "revision": row["revision"]}

def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with session(path) as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("""CREATE TABLE IF NOT EXISTS productions(
            number INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL DEFAULT 1,
            body TEXT NOT NULL)""")
        db.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY)")
        if db.execute("SELECT 1 FROM settings WHERE key = 'seeded'").fetchone():
            return
        samples = [
            ("Paper in motion", "Studio desk", "Approved", "Approved", "Pending", False,
             "Follow one sheet as its lines ripple from a flat drawing into a moving pattern.",
             "Open on the first line. Hold as the waves build, then pull back to reveal the full pattern.",
             "First cut received. Check motion and contrast before the final render.", "/demo/motion-study.mp4"),
            ("Meet the printmakers", "Features desk", "Approved", "Pending", "Pending", False,
             "Profile two makers setting up the weekend workshop.", "Open on the inks and cut to the workbench.", "Location confirmed.", ""),
            ("A guide to open studios", "Weekend desk", "Pending", "Pending", "Pending", False,
             "Walk through the spaces taking part this season.", "", "Awaiting the first script.", ""),
            ("The colour study", "Studio desk", "Approved", "Approved", "Approved", True,
             "An animated colour study for the studio newsletter.", "Start with a wave of colour.", "Final delivered.", "/demo/motion-study.mp4"),
        ]
        for i, (title, proposer, script_ok, production_ok, video_ok, published, idea, script, notes, url) in enumerate(reversed(samples)):
            record = dict(date=str(date.today()-timedelta(days=len(samples)-i-1)), topic="General",
                          proposer_name=proposer, idea=title + " — " + idea, script=script, production_notes=notes,
                          script_approval=script_ok, production_approval=production_ok, video_approval=video_ok,
                          distribution_published=published, script_pending=False, idea_pending=False, video_url=url)
            db.execute("INSERT INTO productions(body) VALUES (?)", (json.dumps(record),))
        db.execute("INSERT INTO settings VALUES ('seeded')")
