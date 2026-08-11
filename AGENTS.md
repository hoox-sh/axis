# AGENTS.md — AXIS

Compact guide for AI agents working in the **axis** repo.

## What this is

**AXIS** (product name; repo `axis`) is a SolidJS + Vite charting PWA for
running Pine Script™ against pluggable **sources**, **streams**, **engines**,
and **datasets** (on-chain TVL / DEX). Cloudflare Worker under `worker/`
(API, WebSocket, D1/KV, `/api/onchain` allowlisted proxy). Calculation can use:

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
bun run desktop:dev      # Tauri 2 shell + Vite (needs Rust + system webview)
bun run test             # unit + worker tests
bun run test:e2e:smoke   # Playwright smoke
cd worker && bun run dev # wrangler :8787

# AXIS CLI (setup / deploy / doctor) — packages/cli
bun run axis --help
bun run axis:install
bun run axis:doctor
bun run axis:setup -- --github-client-id Ov23li…
bun run axis:deploy
bun run axis:health -- --oauth
```

## Layout

| Path | Role |
|------|------|
| `packages/cli/` | **axis** CLI (`@hoox-sh/axis-cli`) — install, doctor, setup, deploy, secrets, health |
| `src/` | Product UI (Solid) — prefer this over legacy root JS |
| `src/data/data-source-manager.ts` | Background OHLCV backfill + validate + gap-fill |
| `src/onchain/` | On-chain plane: DefiLlama TVL, GeckoTerminal, events, jobs |
| `src/theme/` | Chart theme catalog + curated presets |
| `src-tauri/` | Tauri 2 desktop host (`tauri.conf.json`, Rust, icons, native menu) |
| `src/desktop/` | Desktop shell JS (menu events, open-script, About) |
| `src/workers/` | Workers Manager catalog + health probes (Pro API, CF Worker, Pyodide, SW) |
| `src/ui/WorkersManager.tsx` | Workers Manager modal (overview / detail / install / configure) |
| `worker/` | Cloudflare Worker (+ `/api/onchain/*` proxy) |
| `tests/` | Bun unit tests |
| `e2e/` | Playwright |
| `docs/` | Product docs (Mintlify-style MDX) |
| `docs/devops/desktop.mdx` | Desktop (Tauri) guide |
| `docs/enduser/guides/on-chain.mdx` | End-user on-chain guide |
| `CHANGELOG.md` | Recursive release notes + full git history |
| `scripts/generate-changelog.py` | Regenerate changelog history block |
| `LEGACY.md` | Old static shell notes |

## Hard constraints

- **Do not commit** `node_modules/`, `dist/`, `src-tauri/target/`, `.wrangler/`, `.env`, coverage, or debug screenshots (`.axis-*.png`).
- Keep API base URL configurable (default local pyne on `:5002`).
- License headers / SPDX: **AGPL-3.0-only**, author **jango_blockchained**.
- Worker bindings (`DB`, KV, etc.) are environment-specific — do not invent production IDs in docs without checking `worker/wrangler.toml`.
- **Keep `CHANGELOG.md` current** — see [Changelog & releases](#changelog--releases) below. Do not ship a tag without updating it.

## Changelog & releases

### Changelog (recursive — keep updating)

| Path | Role |
|------|------|
| `CHANGELOG.md` | Human release notes + **full recursive git history** (month × type) |
| `scripts/generate-changelog.py` | Regenerates the **Full history** block; preserves hand-written version sections |

**Agents must continue updating the changelog** on every meaningful change set and before any tag/publish:

1. **During work** — append bullets under `## [Unreleased]` (what / why, not only commit subjects).
2. **Before release** — move Unreleased into `## [X.Y.Z] — YYYY-MM-DD`, bump `package.json` `version`, then:
   ```bash
   python3 scripts/generate-changelog.py   # refresh recursive history; keeps version sections
   ```
3. **Commit** the changelog with the release (or a dedicated `docs(changelog): …` commit).
4. Never invent history; regenerate from git. Prefer conventional commits (`feat:`, `fix:`, `perf:`, `docs:`, …) so the recursive sections group cleanly.

### Commit

```bash
# Review
git status && git diff && git log -5 --oneline

# Stage intentional paths only (never secrets / dist / node_modules)
git add <paths>
git commit -m "$(cat <<'EOF'
type(scope): short summary

Why this change matters (1–2 sentences).
EOF
)"
```

- Use **conventional commits** when possible: `feat`, `fix`, `perf`, `docs`, `refactor`, `test`, `ci`, `chore`.
- One logical change per commit when practical; security/perf hardening can be a small stack.
- **Do not** commit `.env`, wrangler secrets, or real production KV/D1 ids invented in docs.

### Build

```bash
bun install                 # app
cd worker && bun install    # worker deps
bun run build               # Vite → dist/
bun run test                # unit + worker tests
# optional:
bunx tsc --noEmit && (cd worker && bun run typecheck)
make docker-bake            # local PWA image
```

### Tag

Semver follows root `package.json` `version` (e.g. `2.0.1` → tag `v2.0.1`).

```bash
# After changelog + version bump are committed on main
git tag -a "v$(node -p "require('./package.json').version")" -m "AXIS v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
# or push all: git push origin --tags
```

- Annotated tags only (`-a`).
- Tag only from a clean `main` (or release branch) that includes the changelog section for that version.

### Push

```bash
git push origin main
git push origin --tags
```

- Confirm `git status` is clean and CI-green when required.
- Pushing `main` triggers GitHub Actions (desktop build, docker workflows under `.github/workflows/`).

### Publish (deploy)

“Publish” here means shipping artifacts users hit, not npm (root package is `private`).

| Target | Command | Notes |
|--------|---------|--------|
| **Worker** (API/WS) | `bun run axis:deploy` or `make worker-deploy` / `axis deploy worker` | Wrangler → `pynescript-axis` |
| **Pages** (PWA static) | `make pages-deploy` or `axis deploy pages` | `vite build` + `wrangler pages deploy dist --project-name=pynescript-axis` |
| **All** | `bun packages/cli/bin/axis.js deploy all` | Worker then Pages |
| **Health** | `bun run axis:health` | Probe deployed Worker `/health` |
| **GHCR / Docker** | `make docker-push` | Multi-arch bake release (needs registry login) |

```bash
# Typical product publish after tag
bun run build
bun packages/cli/bin/axis.js deploy all
bun run axis:health
```

- Production Worker must **not** ship `ALLOW_OPEN_KEYS=1` with real D1; bind `API_KEYS` KV (see harden-perf audit).
- Never invent CF resource IDs — use `worker/wrangler.toml` / dashboard values.

### Sync

Keep remotes, sister tools, and vendored PYNE assets aligned after publish:

```bash
# Git
git fetch origin
git status   # main should match origin/main after push

# PYNE builtins / wheel (when pyne releases change runtime surface)
scripts/sync-pyne-builtins.sh
scripts/sync-pyne-wheel.sh

# Optional: doctor deployed stack
bun run axis:doctor
bun run axis:health -- --oauth
```

| Sync target | When |
|-------------|------|
| `origin/main` + tags | After every release push |
| `src/editor/data/pyne-builtins.json` | After pyne language/builtin changes |
| Vendored wheel under `vendor/` / `public/pyodide/` | After pyne runtime releases |
| Docs site (Mintlify / Pages docs) | After user-facing doc changes under `docs/` |

### Release checklist (agents)

1. Update `CHANGELOG.md` `[Unreleased]` → version section; run `python3 scripts/generate-changelog.py`.
2. Bump `package.json` `version` if not already.
3. `git commit` (changelog + version + product commits already on branch).
4. `bun run test` and `bun run build`.
5. `git tag -a vX.Y.Z -m "AXIS vX.Y.Z"`.
6. `git push origin main && git push origin vX.Y.Z`.
7. Publish: `axis deploy all` (or Worker/Pages separately) + `axis:health`.
8. Sync: `git fetch` / status clean; pyne scripts if needed.

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
| Pine builtins / signatures | `src/editor/data/pyne-builtins.json` (sync from pyne via `scripts/sync-pyne-builtins.sh`) |
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
  import (`src/storage/import-pyne-files.ts`); warn that those N lines were
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
