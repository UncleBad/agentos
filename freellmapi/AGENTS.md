# AGENTS.md — `freellmapi/`

> Self-describing context for the freellmapi install on this VPS.
> Read before editing.

## What this is

A multi-provider LLM gateway running on `remotebox`, used by AgentOS
sub-agents (Ferret/Scribe/Dev) for free-tier inference via custom
providers in `~/.hermes/config.yaml`.

Upstream: https://github.com/tashfeenahmed/freellmapi (MIT).
Reviewed 2026-06-17 — see `BradleyVault/wiki/freellmapi-spike.md` for
the full review. Verdict: install, with one security note (no
reverse proxy).

## Architecture constraints

- **Bind to 127.0.0.1:3001 only.** freellmapi's bare-metal default
  is `::` (all interfaces). Override with `HOST=127.0.0.1` in `.env`.
  ufw already allows this (loopback is always allowed). No public
  exposure — if Bradley ever needs external access, use Tailscale
  or SSH tunnel, NOT a reverse proxy.
- **Do NOT put behind nginx/Caddy.** `trust proxy = false` is
  load-bearing for the current security model — see Ferret's review
  for the localhost-bypass-via-XFF history.
- **Back up `ENCRYPTION_KEY`.** It's in `.secrets/encryption_key`.
  Loss of this key = all stored provider keys become unreadable.
- **One secret store per concern.** `.secrets/` for freellmapi
  secrets; `~/.hermes/.env` for Hermes secrets; never mix.

## System dependencies

- **Node.js 20+** — already installed at `~/.hermes/node/bin/node`
  (currently v22.22.3).
- **No Docker, no system-level Node add-ons.** Native npm install.
- **`sqlite3` CLI is optional** — for backup/inspection. `apt install
  -y sqlite3` if needed.

## Files of interest

- `src/` — cloned upstream repo (gitignored). `npm install --omit=dev`
  inside this dir after cloning.
- `.secrets/encryption_key` — 32-byte hex, AES-256-GCM key for at-rest
  provider keys. Generated with `openssl rand -hex 32`.
- `.env` — runtime config (gitignored). Loaded by the systemd unit via
  `EnvironmentFile=`.
- `data/` — SQLite DB + dashboard state (gitignored). Back up
  periodically if Bradley has invested time adding keys.
- `freellmapi.service` — systemd unit, runs as user `omar`.
- `hermes-snippet.yaml` — sample Hermes `custom_providers` entries,
  copy into `~/.hermes/config.yaml` when ready to wire up.

## Deploy

See `README.md` for full instructions. Quick version:

```bash
# One-time setup (already done on this host)
cd ~/agentos/freellmapi
git clone https://github.com/tashfeenahmed/freellmapi.git src
cd src && npm install --omit=dev && cd ..
openssl rand -hex 32 > .secrets/encryption_key
cp .env.example .env  # then edit HOST, ENCRYPTION_KEY_FILE, ports

# Systemd
sudo cp freellmapi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now freellmapi

# First-run setup: visit http://127.0.0.1:3001, create admin user
# Then add provider keys (Groq, OpenRouter reuse from ~/.hermes/.env)
# Generate unified bearer token, save to ~/.hermes/.env as FREELLMAPI_UNIFIED_KEY
```

## Operations

- **Status:** `sudo systemctl status freellmapi`
- **Logs:** `journalctl -u freellmapi -f`
- **Restart:** `sudo systemctl restart freellmapi`
- **Update:** `cd src && git pull && npm install --omit=dev && sudo systemctl restart freellmapi`
- **Health check:** `curl -fsS http://127.0.0.1:3001/api/ping` — should return `{"status":"ok"}`

## Conventions

- Don't commit `.env`, `.secrets/`, `data/`, `src/`, or `node_modules/`.
  `.gitignore` covers these.
- Don't change the bind address from `127.0.0.1` without a security
  review (the current binding is the entire security model).
- Provider keys live in the freellmapi dashboard, NOT in any agentos
  file. The only freellmapi-related secret Bradley needs to back up
  is `ENCRYPTION_KEY` in `.secrets/`.

## Why native, not Docker

Ferret recommended Docker (canonical install path, clean upgrades).
We chose bare-metal + systemd to match the existing
`agentos-dashboard` pattern (also Python via systemd). Docker is a
bigger commitment (~500MB system bloat + daemon) for one service.
If freellmapi ever needs to scale or migrate, Docker compose is the
fallback path.
