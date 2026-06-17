# AgentOS Dashboard

A self-hosted web dashboard for the AgentOS crew (Ferret, Scribe, Dev) plus
live VPS metrics (CPU, RAM, storage) and a unified schedule view (system
cron + Hermes cron jobs).

**Stack:** Python stdlib `http.server` + psutil. No Flask, no build step,
no node_modules. Single file backend, three files frontend. ~50 MB Docker
image or zero deps under systemd.

**Design pattern:** Lifted from [`nesquena/hermes-webui`](https://github.com/nesquena/hermes-webui)
(three-panel layout, `data-skin` theme system, vanilla JS frontend).
Not a fork — written from scratch in ~400 lines.

## What you get

- **Dashboard tab** — three panels: agent crew (left), live VPS metrics with
  proportional bar graphs (center), recent tasks (right). Metrics poll
  every 2s; tasks refresh every 15s.
- **Schedule tab** — system cron (`/etc/cron.d/*` + `crontab -l`) on the
  left, Hermes cron jobs (`hermes cron list`) on the right.
- **Mobile responsive** — collapses to single column under 900px.
- **Tailscale-ready** — binds `0.0.0.0:8787`. Reach from any tailnet
  device via `http://100.98.6.47:8787` (or hostname).

## Run it

### Quick start (no install)

```bash
cd ~/agentos/dashboard
python3 server.py
# Open http://localhost:8787 in a browser
```

### Production (systemd, recommended for the VPS)

```bash
sudo cp agentos-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agentos-dashboard
sudo systemctl status agentos-dashboard
journalctl -u agentos-dashboard -f   # tail logs
```

### Production (Docker)

```bash
cd ~/agentos/dashboard
docker compose up -d
docker compose logs -f
```

The container mounts the vault read-only at `/vault` so the dashboard can
read tasks and personas without write access.

## API endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/metrics` | CPU, memory, storage snapshot (psutil) |
| `GET /api/agents` | 3 agents + tasks (parsed from vault) |
| `GET /api/schedule` | system_cron + hermes_cron (unified) |
| `GET /api/health` | `{"status": "ok"}` — for health checks |

All endpoints return JSON. Path traversal is blocked. Static files
under `/static/*` are served as-is.

## File layout

```
dashboard/
├── server.py                          # backend (~340 lines, stdlib + psutil)
├── static/
│   ├── index.html                     # single-page app, two tabs
│   ├── styles.css                     # three-panel layout, dark "ares" skin
│   └── app.js                         # tabs, polling, DOM updates (vanilla)
├── Dockerfile                         # python:3.12-slim + psutil
├── docker-compose.yml                 # single-container deploy, mounts vault RO
├── agentos-dashboard.service          # systemd unit (no Docker required)
├── requirements.txt                   # psutil only
└── README.md                          # this file
```

## Design decisions

- **Read-only by design.** The dashboard never writes to the vault or to
  the system. Task state (`phase`) is owned by Captain and the agents —
  the dashboard is purely a viewer. This matches the architecture in
  `Projects/AgentOS/routing.md` "State Ownership" section.
- **No build step.** Vanilla JS + plain CSS. Edit a file, refresh the
  browser. No webpack, no Vite, no npm install. The whole frontend is
  ~20 KB.
- **Thresholds:** metrics > 70% turn yellow ("warn"), > 90% turn red
  ("bad"). Tunable in `app.js` `thresholdClass()`.
- **Polling, not SSE.** Simpler to debug, no keepalive headaches. 2s
  metrics is responsive enough for a dashboard; no need to push
  hundreds of events/s from a 6-core VPS that's mostly idle.

## Future work

- Add more themes (lift the rest from hermes-webui's 11-skin library)
- Per-agent live activity feed (pull from `_activity-log.md`)
- Vault task list with click-through to edit in Obsidian
- Light mode (currently dark only)
- Docker image push to `ghcr.io/unclebad/agentos-dashboard`
