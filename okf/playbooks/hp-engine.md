---
type: "Playbook"
title: "Live chart engine"
description: "Lightweight Charts paints the chart. The ingest worker decodes AXB1. The shared-memory ring and GPU overlay are gone."
tags: [axis, playbook, okf, hp, engine, chart]
status: stable
okf_lock: human
generated:
  by: human:opencode
  at: 2026-10-25T00:00:00Z
sources:
  - id: hp
    resource: "src/hp"
    title: "AXB1, ingest worker, execution context"
  - id: docs
    resource: "docs/architecture/hp-engine.mdx"
    title: "Live chart engine"
---

# What this is

Lightweight Charts is the only candle painter. The ingest worker
([host](/code/src/hp/workers.md)) owns `/ws/live` by default and decodes
AXB1 ([axb1](/code/src/hp/axb1.md)) off the window thread.
`axis.engine.transport=json` is the main-thread rollback.
The docs page is [Live chart engine](/docs/architecture/hp-engine.md).

Do not reintroduce a SharedArrayBuffer ring, a GPU candle overlay, HP flags
(`axis.engine.hp.*`), a HUD chip, or MCP `hp.get` / `hp.sample` / `dev.trace`.
Those were removed. A forming tip still must not commit a closed bar
([execution context](/code/src/hp/calc.md)).

# What remains under `src/hp`

* [axb1](/code/src/hp/axb1.md) — binary envelope. Prices are int64 ticks.
* [workers](/code/src/hp/workers.md) — ingest worker and host. No hot SAB,
  no cold page, no calc worker.
* [calc/execution-context](/code/src/hp/calc.md) — tip versus append.
* [isolation-headers](/code/src/hp/index.md) — COOP / COEP / CORP for static
  hosts and the service worker. Not a painter switch.

# Transport

`wantsWorkerTransport()` is true unless the flag is exactly `json`.
The worker negotiates `encoding: 'axb1'`. The JSON client does not.
A missing Worker counts one JSON fallback and uses the main-thread client.
