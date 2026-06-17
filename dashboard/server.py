"""
AgentOS Dashboard Backend
=========================
A self-hosted web dashboard for the AgentOS crew (Ferret, Scribe, Dev)
plus VPS metrics and a unified schedule view. Designed to be served
over Tailscale on Bradley's devices (redmi-pad, homebox laptop, etc.).

Stack: Python stdlib http.server + psutil. No Flask, no build step.
Pattern lifted from nesquena/hermes-webui (architecture only — not a fork).

Usage:
    python3 server.py                 # serve on 0.0.0.0:8787
    python3 server.py --port 9000     # custom port
    python3 server.py --host 127.0.0.1 # localhost only (testing)

Endpoints:
    GET  /                  → index.html (single-page app)
    GET  /api/metrics       → VPS CPU, RAM, storage snapshot
    GET  /api/agents        → 3-agent status (Ferret, Scribe, Dev)
    GET  /api/schedule      → cron jobs (system) + hermes cron jobs (unified)
    GET  /api/health        → liveness check
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import psutil

# ---- Paths ------------------------------------------------------------------
DASHBOARD_DIR = Path(__file__).resolve().parent
STATIC_DIR = DASHBOARD_DIR / "static"
VAULT_TASKS_DIR = Path("/home/omar/BradleyVault/Projects/AgentOS/tasks")
AGENT_PERSONAS_DIR = Path("/home/omar/BradleyVault/Projects/AgentOS/agents")
HERMES_CRON = ["hermes", "cron", "list"]
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8787

# ---- Static MIME types ------------------------------------------------------
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
}


# ---- Metrics ----------------------------------------------------------------
def get_metrics() -> dict:
    """Snapshot of VPS resource use. Cheap to call, safe to poll every 2s."""
    # CPU: psutil.cpu_percent(interval=None) returns the value since last call;
    # the first call returns 0.0, so we use a small blocking sample for accuracy.
    cpu_pct = psutil.cpu_percent(interval=0.4)
    cpu_count = psutil.cpu_count(logical=True) or 1
    load1, load5, load15 = (x / cpu_count * 100 for x in psutil.getloadavg()) \
        if hasattr(psutil, "getloadavg") else (0.0, 0.0, 0.0)

    # RAM
    mem = psutil.virtual_memory()

    # Storage — root partition by default
    disk = psutil.disk_usage("/")

    # Uptime + boot time
    boot = psutil.boot_time()
    import time
    uptime_s = int(time.time() - boot)

    return {
        "cpu": {
            "percent": round(cpu_pct, 1),
            "load_pct": {
                "1m": round(load1, 1),
                "5m": round(load5, 1),
                "15m": round(load15, 1),
            },
            "cores": cpu_count,
        },
        "memory": {
            "percent": round(mem.percent, 1),
            "used_gb": round(mem.used / (1024 ** 3), 2),
            "total_gb": round(mem.total / (1024 ** 3), 2),
            "available_gb": round(mem.available / (1024 ** 3), 2),
        },
        "storage": {
            "percent": round(disk.percent, 1),
            "used_gb": round(disk.used / (1024 ** 3), 2),
            "total_gb": round(disk.total / (1024 ** 3), 2),
            "free_gb": round(disk.free / (1024 ** 3), 2),
        },
        "uptime_seconds": uptime_s,
    }


# ---- Schedule ---------------------------------------------------------------
def _parse_system_cron_line(line: str, source: str) -> dict | None:
    """Parse a single line from a system crontab. Returns None for blanks/comments."""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    # Crontab format: MIN HOUR DOM MON DOW CMD  (5 time fields, then command)
    # Environment vars (KEY=VAL) and aliases (SHELL=, PATH=, MAILTO=) don't have 5+ fields.
    parts = line.split(None, 5)
    if len(parts) < 6:
        return None
    schedule, command = " ".join(parts[:5]), parts[5]
    return {
        "schedule": schedule,
        "command": command,
        "source": source,
        "kind": "system-cron",
    }


def get_system_cron_jobs() -> list[dict]:
    """Collect cron jobs from /etc/cron.d/* and user crontab."""
    jobs: list[dict] = []

    # /etc/cron.d/* — system-level cron drop-ins
    cron_d = Path("/etc/cron.d")
    if cron_d.is_dir():
        for f in sorted(cron_d.iterdir()):
            if not f.is_file():
                continue
            try:
                content = f.read_text()
            except (PermissionError, OSError):
                continue
            for i, line in enumerate(content.splitlines(), 1):
                job = _parse_system_cron_line(line, f"/etc/cron.d/{f.name}:{i}")
                if job:
                    jobs.append(job)

    # User crontab (crontab -l)
    try:
        result = subprocess.run(
            ["crontab", "-l"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for i, line in enumerate(result.stdout.splitlines(), 1):
                job = _parse_system_cron_line(line, f"crontab:{i}")
                if job:
                    jobs.append(job)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return jobs


def get_hermes_cron_jobs() -> list[dict]:
    """Collect jobs from the Hermes cron scheduler via `hermes cron list`."""
    try:
        result = subprocess.run(
            HERMES_CRON,
            capture_output=True, text=True, timeout=10,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    if result.returncode != 0 or not result.stdout.strip():
        return []

    # `hermes cron list` output is human-formatted, not JSON. Parse it.
    # Expected shape (typical):
    #   job_id   name                schedule         next_run
    #   ──────   ──────────────────  ──────────────   ─────────────
    #   abc123   daily-backup        every 1d         2026-06-17 03:00
    #
    # Be defensive: skip the header line, skip the separator, parse the rest.
    jobs: list[dict] = []
    lines = [ln.rstrip() for ln in result.stdout.splitlines()]
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("─") or stripped.startswith("-"):
            continue
        # Skip the header row
        if "job_id" in stripped.lower() and "name" in stripped.lower():
            continue
        if "No scheduled jobs" in stripped:
            continue
        # Try to split on 2+ spaces as field separator
        parts = re.split(r"\s{2,}", stripped)
        if len(parts) < 2:
            continue
        job_id = parts[0]
        name = parts[1] if len(parts) > 1 else ""
        schedule = parts[2] if len(parts) > 2 else ""
        next_run = parts[3] if len(parts) > 3 else ""
        jobs.append({
            "id": job_id,
            "name": name,
            "schedule": schedule,
            "next_run": next_run,
            "kind": "hermes-cron",
        })
    return jobs


def get_schedule() -> dict:
    return {
        "system_cron": get_system_cron_jobs(),
        "hermes_cron": get_hermes_cron_jobs(),
    }


# ---- Agents -----------------------------------------------------------------
def get_agents() -> list[dict]:
    """
    Read each agent's persona file to get identity, then scan tasks/ for
    tasks by their `assigned_to` frontmatter field. This is a read-only
    view — the dashboard never writes task state.
    """
    agents = [
        ("ferret", "Ferret", "🔍", "Research"),
        ("scribe", "Scribe", "✍️", "Writing"),
        ("dev", "Dev", "🛠️", "Engineering"),
    ]

    out = []
    for slug, name, emoji, role in agents:
        persona_path = AGENT_PERSONAS_DIR / f"{slug}.md"
        first_line = ""
        if persona_path.is_file():
            in_frontmatter = False
            past_frontmatter = False
            for line in persona_path.read_text().splitlines():
                s = line.strip()
                if s == "---":
                    if not in_frontmatter:
                        in_frontmatter = True
                        continue
                    past_frontmatter = True
                    in_frontmatter = False
                    continue
                if in_frontmatter:
                    continue
                if past_frontmatter and s:
                    # Prefer the first # heading as a one-line description
                    if s.startswith("# "):
                        first_line = s.lstrip("# ").strip()[:80]
                    else:
                        first_line = s[:80]
                    break
        out.append({
            "slug": slug,
            "name": name,
            "emoji": emoji,
            "role": role,
            "persona_excerpt": first_line,
        })
    return out


def get_tasks_summary() -> list[dict]:
    """
    Scan the vault's task folder, parse frontmatter, group by `assigned_to`.
    Read-only — does not write.
    """
    if not VAULT_TASKS_DIR.is_dir():
        return []
    tasks = []
    for f in VAULT_TASKS_DIR.glob("*.md"):
        try:
            text = f.read_text()
        except OSError:
            continue
        # Naive frontmatter parser (good enough for our schema)
        fm = {}
        if text.startswith("---"):
            end = text.find("\n---", 3)
            if end > 0:
                fm_block = text[3:end]
                for ln in fm_block.splitlines():
                    if ":" in ln:
                        k, _, v = ln.partition(":")
                        fm[k.strip()] = v.strip()
        tasks.append({
            "file": str(f.relative_to(VAULT_TASKS_DIR.parent.parent)),
            "title": fm.get("title", f.stem),
            "phase": fm.get("phase", "unknown"),
            "assigned_to": fm.get("assigned_to", "captain"),
            "created": fm.get("created", ""),
        })
    return tasks


# ---- HTTP handler -----------------------------------------------------------
class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "AgentOSDashboard/0.1"

    # Silence default stderr access log — we use a structured one below.
    def log_message(self, format, *args):
        sys.stderr.write(
            f"[dashboard] {self.address_string()} - {format % args}\n"
        )

    # ---- Routing ----
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/" or path == "/index.html":
            return self._serve_static("index.html")
        if path.startswith("/static/"):
            return self._serve_static(path[len("/static/"):])
        if path == "/api/metrics":
            return self._serve_json(get_metrics())
        if path == "/api/agents":
            return self._serve_json({
                "agents": get_agents(),
                "tasks": get_tasks_summary(),
            })
        if path == "/api/schedule":
            return self._serve_json(get_schedule())
        if path == "/api/health":
            return self._serve_json({"status": "ok"})
        return self._send_error(404, f"No route for {path}")

    # ---- Helpers ----
    def _serve_static(self, rel_path: str):
        rel_path = rel_path.lstrip("/")
        # Defend against path traversal
        target = (STATIC_DIR / rel_path).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())):
            return self._send_error(403, "Path traversal blocked")
        if not target.is_file():
            return self._send_error(404, f"No such file: {rel_path}")
        try:
            body = target.read_bytes()
        except OSError as e:
            return self._send_error(500, f"Read error: {e}")
        mime = MIME.get(target.suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _serve_json(self, data):
        body = json.dumps(data, indent=2, sort_keys=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code: int, message: str):
        body = json.dumps({"error": message, "code": code}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---- Entrypoint -------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="AgentOS Dashboard")
    parser.add_argument("--host", default=DEFAULT_HOST,
                        help=f"Bind host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"Bind port (default: {DEFAULT_PORT})")
    parser.add_argument("--quiet", action="store_true",
                        help="Suppress per-request logs")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"[dashboard] AgentOS Dashboard serving on http://{args.host}:{args.port}")
    print(f"[dashboard] Tailscale IP: 100.98.6.47 (try http://100.98.6.47:{args.port} from your tailnet)")
    print(f"[dashboard] Static dir: {STATIC_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[dashboard] Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
