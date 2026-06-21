# AGENTS.md — AgentOS code repo

> Self-describing context for any AI agent editing code in this repo.
> Pattern adopted from [agent0ai/dox](https://github.com/agent0ai/dox)
> (the hierarchical AGENTS.md framework). Adapted for our use.

## What this repo is

Home for code that originates on the VPS — skills, dashboards, configs,
scripts that the AgentOS crew (Ferret, Scribe, Dev) produces. Pushed from
the local mirror at `/home/omar/agentos/` on the VPS.

## Conventions for code here

- **Identity:** commits authored as `Captain <unclebad@gmail.com>`
- **Push:** unattended, via token in HTTPS URL (works without prompts)
- **Issues:** enabled. Use them.
- **Projects:** enabled (GitHub Projects board for bigger tracking).
- **Wiki:** disabled. Docs live in the repo, not the wiki.
- **Default branch:** `main`

## Working with this repo (for agents)

Before any edit:
1. Read this file in full.
2. Walk to the target path; read any `AGENTS.md` along the route.
3. If the target dir has its own `AGENTS.md`, treat its local rules as binding.

After any meaningful change:
1. Update the nearest owning `AGENTS.md` if the change affects structure,
   contracts, workflows, or local rules.
2. Add a Child DOX Index entry if a new directory or file with durable
   purpose was created.
3. Remove stale or contradictory text — don't explain history, just delete.

## Style

- Keep `AGENTS.md` files concise, current, operational. No diary entries.
- Broad rules in this root file. Concrete details in child `AGENTS.md`.
- Delete stale notes; do not preserve history in the docs.
- Prefer direct bullets with explicit names over prose.

## Child DOX Index

| Path | Purpose | Local rules |
|---|---|---|
| `surfduck/` | SurfDuck — curated TV guide grid. surfduck.tv. | Read `surfduck/AGENTS.md` before editing. |
| `dashboard/` | Self-hosted web dashboard — VPS metrics, 3-agent status, schedule view. Served to Tailscale devices. | Read `dashboard/AGENTS.md` before editing. |
