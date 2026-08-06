# AGENTS.md — AXIS

Compact guide for AI agents working in the **axis** repo.

## What this is

**AXIS** (product name; repo `axis`) is a SolidJS + Vite charting PWA for
running Pine Script™ against pluggable **sources**, **streams**, and **engines**.
Cloudflare Worker under `worker/` (API, WebSocket, D1/KV). Calculation can use:

- Local **pyne** Pro API (`http://127.0.0.1:5002`)
- This repo’s Worker
- In-browser Pyodide

AXIS is **independent** of TradingView, Inc. Pine Script™ and TradingView® are
trademarks of TradingView, Inc. Do not claim affiliation or invent TradingView
product APIs.

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
| `src/data/data-source-manager.ts` | Background OHLCV backfill + validate + gap-fill |
| `src/theme/` | Chart theme catalog + curated presets |
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

## Pine Script™ / naming parity (critical)

AXIS runs **real Pine** via **PYNE**. Naming must match the language reference
and this repo’s builtins — never invent “TV JS” APIs or invent Pine identifiers.

### Forbidden (do not invent or document as real)

| Wrong | Why |
|-------|-----|
| `TV.set`, `TV.get`, `TV.plot`, `TV.run` | No such AXIS/browser API |
| `TradingView.set`, `TradingView.plot` | Not a public product API here |
| `pine.set`, `pine.chart.setTheme` | Fictional host glue |
| `study("…")` (as v5) | Pine v3 name; use `indicator()` / `strategy()` |
| `security(…)` bare | Prefer `request.security` (v4+) |
| `tickerid` | Prefer `syminfo.tickerid` |
| inventing `ta.*` / `input.*` / `strategy.*` members | Check builtins first |

### Correct surfaces

| Domain | Source of truth |
|--------|-----------------|
| Pine builtins / signatures | `src/editor/data/pine-builtins.json` (sync from pyne via `scripts/sync-pine-builtins.sh`) |
| Engine evaluation | pyne Pro API / worker / pyodide — not the editor |
| Chart brand colors | `VOID` in `src/chart/series-factory.ts` (**not** a Pine/TradingView API) |
| Drawing object kinds | Pine: `line` / `label` / `box` / `polyline` / `table` + methods like `line.new`, `line.set_xy2` |
| Plot kinds from engine | `plot`, `hline`, `bgcolor`, `plotshape`, `plotchar`, `plotarrow` |

### Chart palette name

- Use **`VOID`** for AXIS void-theme chart tokens (`VOID.bg`, `VOID.indigo`, …).
- Legacy export `TV` is an **alias of `VOID` only** — never add methods to it;
  do not treat `TV` as TradingView.
- Comments: prefer “Pine default”, “platform UX”, “void theme” — not “TV.set”
  or inventing a TradingView host SDK.

### Demo / docs Pine snippets

- Always `//@version=5` (or 6) with real `indicator()` / `strategy()`.
- Prefer `overlay=false` + raw oscillator scale for RSI/MACD (not faked price scale).
- Community scrape chrome: `Expand (N lines)` is **not** Pine — stripped on
  import (`src/storage/import-pine-files.ts`); warn that those N lines were
  never in the file.

### Trademark / wording

- First mention in user-facing docs: **Pine Script™**, **TradingView®**.
- UI copy: “void dark”, not “TV Dark”.
- “Parity” means matching **language/runtime behavior**, not claiming to be
  TradingView.

## Sister projects & websites

**Site:** [hoox.sh](https://hoox.sh)

| Product | GitHub | Local path | Website |
|---------|--------|------------|---------|
| **HOOX** | [hoox-sh/hoox](https://github.com/hoox-sh/hoox) | `/home/jango/Git/hoox` | [hoox.sh](https://hoox.sh) · [docs.hoox.sh](https://docs.hoox.sh) |
| **PYNE** | [hoox-sh/pyne](https://github.com/hoox-sh/pyne) | `/home/jango/Git/pynescript` | [hoox.sh/pyne](https://hoox.sh/pyne) · [docs](https://hoox.sh/pyne/docs) |
| **AXIS** (this repo) | [hoox-sh/axis](https://github.com/hoox-sh/axis) | `/home/jango/Git/axis` | [hoox.sh/axis](https://hoox.sh/axis) · [docs](https://hoox.sh/axis/docs) |

Also: `pine-worker` / `pyne-worker` for edge evaluation.

Coordinate API contract changes with **pyne** (`backend/`).
