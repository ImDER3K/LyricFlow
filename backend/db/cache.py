"""
SQLite cache for processed songs.
Keyed by (youtube_video_id) or (title+artist hash).
"""

import sqlite3
import hashlib
import json
import os
import time

DB_PATH = os.getenv("CACHE_DB", "cache.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create cache table if not exists."""
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS song_cache (
                cache_key   TEXT PRIMARY KEY,
                data        TEXT NOT NULL,
                created_at  REAL NOT NULL
            )
        """)
        conn.commit()


def _make_key(youtube_id: str | None = None, title: str = "", artist: str = "") -> str:
    if youtube_id:
        return f"yt:{youtube_id}"
    raw = f"{title.lower().strip()}::{artist.lower().strip()}"
    return "song:" + hashlib.sha1(raw.encode()).hexdigest()


def get_cached(
    youtube_id: str | None = None, title: str = "", artist: str = ""
) -> dict | None:
    key = _make_key(youtube_id, title, artist)
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT data FROM song_cache WHERE cache_key = ?", (key,)
        ).fetchone()
    if row:
        print(f"[cache hit] {key}")
        return json.loads(row["data"])
    return None


def set_cached(
    data: dict,
    youtube_id: str | None = None,
    title: str = "",
    artist: str = "",
) -> None:
    key = _make_key(youtube_id, title, artist)
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO song_cache (cache_key, data, created_at)
            VALUES (?, ?, ?)
            """,
            (key, json.dumps(data), time.time()),
        )
        conn.commit()
    print(f"[cache set] {key}")
