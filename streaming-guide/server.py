#!/usr/bin/env python3
"""Streaming Guide — broadcast + streaming listings in a TV Guide grid."""
import json
import os
import sqlite3
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import date
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).parent
STATIC = ROOT / "static"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

DB_PATH = DATA / "cache.db"

# ── Cache ──────────────────────────────────────────────────────────

def init_db():
    db = sqlite3.connect(str(DB_PATH))
    db.execute("""
        CREATE TABLE IF NOT EXISTS cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            expires_at REAL NOT NULL
        )
    """)
    db.commit()
    return db

def cache_get(db, key):
    row = db.execute(
        "SELECT value, expires_at FROM cache WHERE key = ?", (key,)
    ).fetchone()
    if row and row[1] > time.time():
        return json.loads(row[0])
    return None

def cache_set(db, key, value, ttl=300):
    db.execute(
        "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
        (key, json.dumps(value), time.time() + ttl)
    )
    db.commit()

# ── TVmaze API ─────────────────────────────────────────────────────

TVMAZE_BASE = "https://api.tvmaze.com"

def fetch_tvmaze(path, db):
    key = f"tvmaze:{path}"
    cached = cache_get(db, key)
    if cached:
        return cached

    url = f"{TVMAZE_BASE}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "StreamingGuide/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            cache_set(db, key, data, ttl=3600)
            return data
    except urllib.error.URLError as e:
        print(f"TVmaze error: {e}")
        return None

def get_us_schedule(db):
    today = date.today().isoformat()
    return fetch_tvmaze(f"/schedule?country=US&date={today}", db) or []

# ── TMDB API ───────────────────────────────────────────────────────

TMDB_KEY = os.environ.get("TMDB_API_KEY", "")
TMDB_BASE = "https://api.themoviedb.org/3"

def search_tmdb(query, db):
    key = f"tmdb:search:{query}"
    cached = cache_get(db, key)
    if cached:
        return cached
    if not TMDB_KEY:
        return None

    url = f"{TMDB_BASE}/search/tv?api_key={TMDB_KEY}&query={urllib.parse.quote(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "StreamingGuide/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            cache_set(db, key, data, ttl=86400)
            return data
    except Exception as e:
        print(f"TMDB search error: {e}")
        return None

def get_streaming_providers(tmdb_id, db):
    key = f"tmdb:providers:{tmdb_id}"
    cached = cache_get(db, key)
    if cached:
        return cached
    if not TMDB_KEY:
        return {}

    url = f"{TMDB_BASE}/tv/{tmdb_id}/watch/providers?api_key={TMDB_KEY}"
    req = urllib.request.Request(url, headers={"User-Agent": "StreamingGuide/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            us = data.get("results", {}).get("US", {})
            flatrate = [p["provider_name"] for p in us.get("flatrate", [])]
            result = {"flatrate": flatrate}
            cache_set(db, key, result, ttl=86400)
            return result
    except Exception as e:
        print(f"TMDB provider error: {e}")
        return {}

# ── HTTP Server ────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        query = parse_qs(urlparse(self.path).query)

        if path == "/api/health":
            self.send_json({"status": "ok"})

        elif path == "/api/schedule":
            db = sqlite3.connect(str(DB_PATH))
            shows = get_us_schedule(db)

            result = []
            seen = set()
            for entry in (shows or []):
                show = entry.get("show", {})
                name = show.get("name", "")
                item = {
                    "name": name,
                    "network": (
                        show.get("network", {}).get("name", "")
                        if show.get("network")
                        else show.get("webChannel", {}).get("name", "")
                    ),
                    "season": entry.get("season"),
                    "episode": entry.get("number"),
                    "title": entry.get("name", ""),
                    "time": entry.get("airtime", ""),
                    "summary": (
                        (show.get("summary") or "")
                        .replace("<p>", "").replace("</p>", "")
                        .replace("<b>", "").replace("</b>", "")[:200]
                    ),
                    "streaming": [],
                }

                # Enrich with streaming providers (first occurrence only)
                if name and name not in seen:
                    seen.add(name)
                    if TMDB_KEY:
                        tmdb_results = search_tmdb(name, db)
                        if tmdb_results and tmdb_results.get("results"):
                            tmdb_id = tmdb_results["results"][0]["id"]
                            providers = get_streaming_providers(tmdb_id, db)
                            item["streaming"] = providers.get("flatrate", [])

                result.append(item)

            db.close()
            self.send_json(result)

        elif path == "/api/search":
            q = query.get("q", [""])[0]
            if not q or len(q) < 2:
                self.send_json([])
                return

            db = sqlite3.connect(str(DB_PATH))
            results = search_tmdb(q, db)
            if results:
                simplified = [{
                    "name": r.get("name", ""),
                    "id": r.get("id"),
                    "year": (r.get("first_air_date", "") or "")[:4],
                    "overview": (r.get("overview", "") or "")[:200],
                    "poster": (
                        f"https://image.tmdb.org/t/p/w200{r['poster_path']}"
                        if r.get("poster_path") else None
                    ),
                } for r in results.get("results", [])[:10]]
                self.send_json(simplified)
            else:
                self.send_json([])
            db.close()

        else:
            super().do_GET()

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 8788))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"Streaming Guide on :{port}")
    server.serve_forever()