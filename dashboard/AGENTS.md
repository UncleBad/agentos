# AGENTS.md — `dashboard/`

> Self-describing context for the AgentOS Dashboard code.
> Bound to this subtree. Read before editing.

## What this is

Self-hosted web dashboard for AgentOS — VPS metrics (CPU/RAM/storage as
bar graphs), 3-agent status (Ferret/Scribe/Dev), and a unified schedule
view (system cron + Hermes cron jobs). Served from the VPS to Bradley's
Tailscale devices (redmi-pad tablet, homebox laptop).

## Architecture constraints

- **Read-only by design.** Never write to the vault or to the system.
  Task state is owned by Captain and the agents (see
  `Projects/AgentOS/routing.md` "State Ownership"). The dashboard
  is purely a viewer.
- **Zero system-level dependencies.** The backend uses only Python
  stdlib + psutil. The frontend uses vanilla JS and plain CSS. No
  build step, no node_modules, no webpack.
- **Tailscale is the network boundary.** Binds `0.0.0.0:8787`. Don't
  expose it publicly. If Bradley ever needs public access, add
  Tailscale Funnel or a reverse proxy with auth — not port-forward.
- **Path traversal is blocked in the static file handler.** Don't
  remove the `STATIC_DIR.resolve()` containment check.

## System dependencies

The systemd unit runs `/usr/bin/python3` (system Python), not a
virtualenv. `psutil` must be available there.

- **Ubuntu/Debian:** `sudo apt install -y python3-psutil`
- **Fedora/RHEL:** `sudo dnf install -y python3-psutil`
- **Alpine:** `sudo apk add py3-psutil`
- **macOS (brew):** `brew install psutil` (but macOS won't run systemd
  anyway — use Docker or `launchd` instead)

If psutil is missing from the system Python, the unit crashes on
start with `ModuleNotFoundError: No module named 'psutil'`. Don't
fix this with a venv — fix it with the system package manager.

## Files of interest

- `server.py` — single-file backend. ~340 lines. Endpoints:
  `/api/metrics`, `/api/agents`, `/api/schedule`, `/api/health`.
- `static/index.html` — two tabs (Dashboard, Schedule), three-panel
  layout on the Dashboard tab.
- `static/styles.css` — `data-skin="ares"` theme (dark + gold accent).
  Easy to add more skins by following the `[data-skin="X"]` pattern.
- `static/app.js` — tabs, polling, DOM updates. ~180 lines.

## Polling intervals

| Data | Interval | Why |
|---|---|---|
| Metrics | 2s | Cheap, makes the bars feel live |
| Agents + tasks | 15s | Changes less often; vault I/O |

Don't tighten these without measuring CPU impact first.

## Conventions

- Keep functions small. The whole backend is one file by design
  (~340 lines is the soft ceiling — split into modules if it
  grows past 500).
- Frontend is three files (HTML, CSS, JS) by design. No bundler.
  If you need a build step, you've outgrown this layout — propose
  the move before doing it.
- Use the `fmtXxx` helpers in `app.js` for consistency in
  formatted output (percent, uptime, timestamps).
- When adding a new metric, also add a card in `index.html`,
  a style for the bar color in `styles.css`, and a `setMetric()`
  call in `app.js`. All three places.
- When adding a new API endpoint, return JSON with the same shape
  as the existing endpoints (top-level keys, not nested arrays).

## Style

- Comments only where the *why* is non-obvious. No section dividers
  in JS, no "this function does X" headers.
- Errors: log to server stderr with the `[dashboard]` prefix.
  Don't expose stack traces over HTTP.

## Deploy

See `README.md` for full instructions. Two options:
1. **systemd** (recommended) — `agentos-dashboard.service`
2. **Docker** — `docker-compose.yml`
