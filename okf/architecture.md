---
type: Reference
title: Architecture
description: The project shape and the OpenOrchestrate team.
tags: [architecture, openorchestrate]
status: stable
---

# Architecture

axis uses OpenOrchestrate. Languages: TypeScript, JavaScript, Python, Shell, Rust.

## Runtime surfaces

AXIS is a SolidJS + Vite charting PWA. Historical bars, live streams, and
calculation backends are plugins behind one TypeScript contract; evaluation
runs against the local PYNE Pro API, the bundled Worker, or in-browser Pyodide.

- **Entry points:** `src/` (product UI), `worker/` (Cloudflare Worker: API,
  WebSocket, D1/KV, `/api/onchain`), `packages/cli/` (`axis` CLI), and
  `src-tauri/` (desktop host).
- **Run:** `bun install && bun run dev` serves the PWA on `:3000`; the Worker
  runs from `worker/` via `bun run dev` on `:8787`.
- **Verify:** `./scripts/verify.sh` runs Prettier, `bun run lint`,
  `bun run typecheck`, and `bun run test`.

## The team

| Seat | Title | Agent |
| --- | --- | --- |
| Chief | Chief of Staff | `oo-chief` |
| Ops | Head of Operations | `oo-ops` |
| Checker | Quality Gate | `oo-checker` |
| Docs | Head of Docs | `oo-spec-1` |
| Engineering | Head of Engineering | `oo-spec-2` |
| Misc | General Desk | `oo-misc` |

## The board

The board lives at `.openorchestrate/board.md`. It has five statuses:
Todo, Working, Blocked, Ready for Review, Done. A card moves to Done only with proof.

## Related

- [Development](/development.md)
- [Security](/security.md)
