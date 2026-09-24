# Contributing to AXIS

Thanks for helping with **AXIS** — the open charting PWA (CEX data, drawings, on-chain overlays, Pine Script™ via PYNE).

## Sister repos & websites

| Product | Repo | Website |
|---------|------|---------|
| **HOOX** | [hoox](https://github.com/hoox-sh/hoox) | [hoox.sh](https://hoox.sh) |
| **PYNE** | [pyne](https://github.com/hoox-sh/pyne) | [hoox.sh/pyne](https://hoox.sh/pyne) |
| **AXIS** | [axis](https://github.com/hoox-sh/axis) (this repo) | [hoox.sh/axis](https://hoox.sh/axis) |

## Setup

```bash
# AXIS CLI (recommended)
bun install
cd packages/cli && bun install && cd ../..
bun run axis install
bun run axis doctor

# Terminal A — Pyne Pro API (from the pyne repo)
# make run   # http://127.0.0.1:5002

# Terminal B — AXIS
bun run dev  # http://127.0.0.1:3000
# or: bun run axis dev
```

Worker bootstrap / deploy: `bun run axis setup`, `bun run axis deploy`. See `packages/cli/README.md` and docs [AXIS CLI](docs/devops/cli.mdx).

## Checks

```bash
bun run test
bun run test:security
cd worker && bun run typecheck
bun run okf:check
```

`bun install` points git at `.githooks/`. The pre-commit hook lints staged files with Biome, then drafts and stages the `okf/` bundle so the commit carries a current map of the repo. Skip that refresh with `OKF_SKIP=1`.

Read `okf/index.md` before searching the tree. `bun run okf:context <path>` prints one module and its neighbors. Curated notes live in `okf/playbooks/` (`okf_lock: human`). Generated concepts are rewritten when their sources change.

## Style

- TypeScript + SolidJS for the product path (`src/`)
- Bun for unit tests; Playwright for e2e
- Prefer small PRs with clear intent

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
