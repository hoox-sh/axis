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
```

## Style

- TypeScript + SolidJS for the product path (`src/`)
- Bun for unit tests; Playwright for e2e
- Prefer small PRs with clear intent

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
