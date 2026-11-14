---
type: "Document"
title: "Shared engine-owned market data plane"
description: "One engine-owned feed per market series, shared by every chart and script on the same AXIS deployment — the wire carries snapshot and delta, never bars the client cannot verify."
resource: "docs/architecture/shared-data-plane.mdx"
tags: [architecture, doc, docs, shared-data-plane]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-14T13:53:48Z
sources:
  - id: tree
    resource: "docs/architecture/shared-data-plane.mdx"
    title: "docs/architecture/shared-data-plane.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/shared-data-plane.mdx`.

# Outline

* Goal
* Status
* D1 — Feed key grammar
* D2 — One writer, append-only
* D3 — Subscribe API
  * Resume
* D4 — Fan-out
* D5 — AXIS client changes
* D6 — Wire encoding
* D7 — Staleness and liveness
* D8 — Multi-tenancy
* D9 — Failure modes
* D10 — Rollout phases
* Verification
* Non-goals

# Mentions

* [src](/code/src.md)
* [src/stores](/code/src/stores.md)
