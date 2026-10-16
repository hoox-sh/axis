---
type: "Document"
title: "Engine-owned data plane (PYNE Pro every tick)"
description: "Migration plan and wire contract for PYNE Pro owning OHLCV data in every-tick live mode, with AXIS as cache-miss broker."
resource: "docs/devops/engine-owned-data-plane.mdx"
tags: [devops, doc, docs, engine-owned-data-plane]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-16T18:28:57Z
sources:
  - id: tree
    resource: "docs/devops/engine-owned-data-plane.mdx"
    title: "docs/devops/engine-owned-data-plane.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/devops/engine-owned-data-plane.mdx`.

# Outline

* Goal
* Decisions
* Engine capabilities (GET /health → features)
* Data store (PYNE Pro)
* Endpoints (PYNE Pro)
  * GET /data/series
  * POST /data/series/provide
  * POST /data/series/fetch
  * GET /data/series/bars
  * POST /data/session
  * POST /data/session/{id}/tick
  * DELETE /session/{id}
* AXIS broker (calculator profile — engines without livestream)
* Stream plane (engines with livestream)
* Migration steps

# Mentions

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/engines](/code/src/engines.md)
* [src/streams](/code/src/streams.md)
* [src/workers](/code/src/workers.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
