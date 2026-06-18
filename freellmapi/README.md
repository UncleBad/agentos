# freellmapi on AgentOS

Multi-provider LLM gateway running on `remotebox` (the VPS). Used by
AgentOS sub-agents (Ferret/Scribe/Dev) for free-tier inference via
custom providers in `~/.hermes/config.yaml`.

Upstream: https://github.com/tashfeenahmed/freellmapi (MIT, 10.6k stars).
Full review: `BradleyVault/wiki/freellmapi-spike.md`.

## What's here

| Path | Purpose | Tracked in git? |
|---|---|---|
| `AGENTS.md` | local rules, layout, ops | ✅ |
| `README.md` | this file | ✅ |
| `freellmapi.service` | systemd unit | ✅ |
| `.env.example` | env template | ✅ |
| `hermes-snippet.yaml` | sample Hermes config | ✅ |
| `.gitignore` | excludes runtime + secrets | ✅ |
| `src/` | cloned upstream code | ❌ gitignored |
| `data/` | SQLite DB + dashboard state | ❌ gitignored |
| `.secrets/` | ENCRYPTION_KEY + tokens | ❌ gitignored |
| `.env` | runtime config (real values) | ❌ gitignored |

## Architecture

```
┌──────────────────────────┐    ┌──────────────────────────────────────┐
│  Hermes on remotebox     │    │  freellmapi on remotebox            │
│                          │    │                                      │
│  ferret_research ────────┼──► │  POST /v1/chat/completions           │
│  scribe_writing  ────────┼──► │  bearer: $FREELLMAPI_UNIFIED_KEY     │
│  dev_coding      ────────┼──► │                                      │
│                          │    │  routes to:                          │
│  base_url: 127.0.0.1:3001│    │   - Groq       (Llama 3.3, Qwen3)    │
│                          │    │   - OpenRouter (21 free models)      │
└──────────────────────────┘    │   - Gemini     (2.5 Flash)           │
                               │   - Mistral    (Codestral, Devstral) │
                               │   - HuggingFace                      │
                               │   - Pollinations, LLM7 (anon)        │
                               │   - ... 14 more providers             │
                               └──────────────────────────────────────┘
                                            │
                                            ▼
                               ┌──────────────────────────────────────┐
                               │  Encrypted SQLite DB + keys          │
                               │  /home/omar/agentos/freellmapi/data   │
                               └──────────────────────────────────────┘
```

## Install

### One-time setup (requires `sudo` only for the systemd step)

```bash
cd ~/agentos/freellmapi

# 1. Clone upstream
git clone https://github.com/tashfeenahmed/freellmapi.git src

# 2. Install deps
cd src && npm install --omit=dev && cd ..

# 3. Generate encryption key (CRITICAL: back this up!)
openssl rand -hex 32 > .secrets/encryption_key
chmod 600 .secrets/encryption_key

# 4. Configure
cp .env.example .env
# .env is ready to use — defaults bind to 127.0.0.1:3001

# 5. Systemd
sudo cp freellmapi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now freellmapi

# 6. First-run setup (browser)
# Visit http://127.0.0.1:3001 (or http://100.98.6.47:3001 from Tailscale)
# Create admin user, add provider keys, generate unified bearer token
```

### After install — wire to Hermes

1. Generate a unified bearer token on the freellmapi dashboard
   (Settings → Tokens → Generate).
2. Save it to `~/.hermes/.env`:
   ```
   FREELLMAPI_UNIFIED_KEY=freellmapi-...
   ```
3. Copy the relevant block from `hermes-snippet.yaml` into
   `~/.hermes/config.yaml` under `custom_providers:`.
4. Restart Hermes (new session picks up the providers).
5. Test with a small Ferret task — confirm cost/quality vs current.

### Provider starter set (recommended)

Start with 2-3 free providers (no card required):

| Provider | How to get key | Models exposed |
|---|---|---|
| **OpenRouter** | https://openrouter.ai/keys (reuse Bradley's existing `OPENROUTER_API_KEY` from `~/.hermes/.env`) | 21 free models including `minimax/minimax-m2.5:free` |
| **Groq** | https://console.groq.com (no card) | Llama 3.3 70B, GPT-OSS, Qwen3 |
| **Pollinations** | none — anonymous | GPT-OSS 20B |

Skip initially: Cohere (ToS forbids personal use), NVIDIA NIM
(eval-only, 40 RPM cap).

## Operations

| Task | Command |
|---|---|
| Status | `sudo systemctl status freellmapi` |
| Logs (live) | `journalctl -u freellmapi -f` |
| Restart | `sudo systemctl restart freellmapi` |
| Update | `cd src && git pull && npm install --omit=dev && sudo systemctl restart freellmapi` |
| Health check | `curl -fsS http://127.0.0.1:3001/api/ping` |
| List models | `curl -fsS -H "Authorization: Bearer $FREELLMAPI_UNIFIED_KEY" http://127.0.0.1:3001/v1/models` |

## Security posture

- **Bind:** `127.0.0.1:3001` only (loopback). ufw allows this by default.
- **No reverse proxy.** `trust proxy = false` is load-bearing.
- **Bearer auth** on `/v1/*`; **email+password** on `/api/*`. Two-factor separation.
- **AES-256-GCM at rest** for provider keys (sealed with `ENCRYPTION_KEY`).
- **No request bodies logged** — only latency/tokens/success rate.
- **Container hardening** in the systemd unit: `NoNewPrivileges`,
  `ProtectSystem=strict`, `MemoryDenyWriteExecute`, etc.

If Bradley ever needs external access, use Tailscale or SSH tunnel,
NOT a public reverse proxy.

## Backups

| What | Where | Frequency |
|---|---|---|
| `ENCRYPTION_KEY` | `.secrets/encryption_key` | Once — save to a password manager / off-host |
| Provider keys | SQLite DB in `data/` | Back up `data/*.db` after adding any new keys |
| Config | `.env`, `~/.hermes/config.yaml` | As needed — version-controlled or in vault |

## Files

- `AGENTS.md` — local rules for agents editing this dir
- `freellmapi.service` — systemd unit (user `omar`, hardened)
- `.env.example` — env template (gitignored when copied to `.env`)
- `hermes-snippet.yaml` — sample `custom_providers` for `~/.hermes/config.yaml`
- `.gitignore` — excludes `src/`, `data/`, `.secrets/`, `.env`, `node_modules/`

## References

- Upstream: https://github.com/tashfeenahmed/freellmapi
- Review: `BradleyVault/wiki/freellmapi-spike.md`
- Battle plan source: `BradleyVault/Inbox/resources for agents.md`
- AgentOS sub-agent design: `BradleyVault/Projects/AgentOS/routing.md`
