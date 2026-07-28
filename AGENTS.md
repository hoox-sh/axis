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
- License headers / SPDX: **AGPL-3.0-or-later**, author **jango_blockchained**.
- Worker bindings (`DB`, KV, etc.) are environment-specific — do not invent production IDs in docs without checking `worker/wrangler.toml`.

## Sister projects

- **pyne** — parser, evaluator, Flask Pro API, LSP  
- **pine-worker** / **pyne-worker** — edge evaluation  

Coordinate API contract changes with **pyne** (`backend/`).
