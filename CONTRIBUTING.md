# Contributing to AXIS

Thanks for helping with **AXIS** — the charting PWA for Pine Script™ evaluation.

## Sister repos & websites

| Product | Repo | Website |
|---------|------|---------|
| **HOOX** | [hoox](https://github.com/jango-blockchained/hoox) | [hoox.sh](https://hoox.sh) |
| **PYNE** | [pyne](https://github.com/jango-blockchained/pyne) | [hoox.sh/pyne](https://hoox.sh/pyne) |
| **AXIS** | [axis](https://github.com/jango-blockchained/axis) (this repo) | [hoox.sh/axis](https://hoox.sh/axis) |

## Setup

```bash
bun install
cd worker && bun install && cd ..

# Terminal A — Pyne Pro API (from the pyne repo)
# make run   # http://127.0.0.1:5002

# Terminal B — AXIS
bun run dev  # http://127.0.0.1:3000
```

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

AGPL-3.0-or-later. See [LICENSE](LICENSE).
