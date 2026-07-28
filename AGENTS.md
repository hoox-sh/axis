# AGENTS.md — AXIS

Compact guide for AI agents working in the **axis** repo.

## What this is

**AXIS** (product name; repo `axis`) is a SolidJS + Vite charting PWA for
running Pine Script™ against pluggable **sources**, **streams**, and **engines**.
Cloudflare Worker under `worker/` (API, WebSocket, D1/KV). Calculation can use:

- Local **pyne** Pro API (`http://127.0.0.1:5002`)
- This repo’s Worker
- In-browser Pyodide

## Quick commands

```bash
bun install
bun run dev              # Vite :3000
bun run test             # unit + worker tests
bun run test:e2e:smoke   # Playwright smoke
cd worker && bun run dev # wrangler :8787
```

## Layout

| Path | Role |
|------|------|
| `src/` | Product UI (Solid) — prefer this over legacy root JS |
| `worker/` | Cloudflare Worker |
| `tests/` | Bun unit tests |
| `e2e/` | Playwright |
| `docs/` | Product docs (Mintlify-style MDX) |
| `LEGACY.md` | Old static shell notes |

## Hard constraints

- **Do not commit** `node_modules/`, `dist/`, `.wrangler/`, `.env`, coverage, or debug screenshots (`.axis-*.png`).
- Keep API base URL configurable (default local pyne on `:5002`).
- License headers / SPDX: **AGPL-3.0-only**, author **jango_blockchained**.
- Worker bindings (`DB`, KV, etc.) are environment-specific — do not invent production IDs in docs without checking `worker/wrangler.toml`.

## Sister projects & websites

**Site:** [hoox.sh](https://hoox.sh)

| Product | GitHub | Local path | Website |
|---------|--------|------------|---------|
| **HOOX** | [jango-blockchained/hoox](https://github.com/jango-blockchained/hoox) | `/home/jango/Git/hoox` | [hoox.sh](https://hoox.sh) · [docs.hoox.sh](https://docs.hoox.sh) |
| **PYNE** | [jango-blockchained/pyne](https://github.com/jango-blockchained/pyne) | `/home/jango/Git/pynescript` | [hoox.sh/pyne](https://hoox.sh/pyne) · [docs](https://hoox.sh/pyne/docs) |
| **AXIS** (this repo) | [jango-blockchained/axis](https://github.com/jango-blockchained/axis) | `/home/jango/Git/axis` | [hoox.sh/axis](https://hoox.sh/axis) · [docs](https://hoox.sh/axis/docs) |

Also: `pine-worker` / `pyne-worker` for edge evaluation.

Coordinate API contract changes with **pyne** (`backend/`).
