"""SQLite storage. One file: data/vietlot.db (gitignored; rebuild any time with `python3 -m vietlot sync`)."""
import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("VIETLOT_DB", ROOT / "data" / "vietlot.db"))

GAMES = {"655": {"n": 55, "days": (1, 3, 5)}, "645": {"n": 45, "days": (2, 4, 6)}}  # draw weekdays, Mon=0

SCHEMA = """
CREATE TABLE IF NOT EXISTS draws (
  game TEXT NOT NULL, id INTEGER NOT NULL, date TEXT NOT NULL,
  b1 INTEGER NOT NULL, b2 INTEGER NOT NULL, b3 INTEGER NOT NULL,
  b4 INTEGER NOT NULL, b5 INTEGER NOT NULL, b6 INTEGER NOT NULL, bonus INTEGER,
  PRIMARY KEY (game, id)
);
CREATE TABLE IF NOT EXISTS prizes (  -- winner counts and jackpot values per draw (xsdlk.net)
  game TEXT NOT NULL, id INTEGER NOT NULL,
  jp1 INTEGER, jp2 INTEGER, n_jp1 INTEGER, n_jp2 INTEGER, n1 INTEGER, n2 INTEGER, n3 INTEGER,
  PRIMARY KEY (game, id)
);
CREATE TABLE IF NOT EXISTS model (game TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, game TEXT NOT NULL, draw_id INTEGER NOT NULL,
  bought_at TEXT, code TEXT, created TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS tickets (
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
  n1 INTEGER NOT NULL, n2 INTEGER NOT NULL, n3 INTEGER NOT NULL,
  n4 INTEGER NOT NULL, n5 INTEGER NOT NULL, n6 INTEGER NOT NULL,
  PRIMARY KEY (purchase_id, idx)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def connect(path=None):
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(p), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")  # server reads while the scheduled sync writes
    con.executescript(SCHEMA)
    return con


def get_meta(con, key, default=None):
    row = con.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(con, key, value):
    con.execute("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def draws(con, game, limit=None):
    """Draws oldest first, with prize rows when known."""
    sql = ("SELECT d.*, p.jp1, p.jp2, p.n_jp1, p.n_jp2, p.n1, p.n2, p.n3, p.id AS pid FROM draws d "
           "LEFT JOIN prizes p ON p.game = d.game AND p.id = d.id WHERE d.game = ? ORDER BY d.id")
    rows = [_draw(r) for r in con.execute(sql, (game,))]
    return rows[-limit:] if limit else rows


def _draw(r):
    prizes = None
    if r["pid"] is not None:
        prizes = {k: r[k] for k in ("jp1", "jp2", "n_jp1", "n_jp2", "n1", "n2", "n3")}
    return {"id": r["id"], "date": r["date"], "main": [r["b%d" % i] for i in range(1, 7)], "bonus": r["bonus"], "prizes": prizes}


def model(con, game):
    row = con.execute("SELECT updated, data FROM model WHERE game = ?", (game,)).fetchone()
    return dict(json.loads(row["data"]), updated=row["updated"]) if row else None
