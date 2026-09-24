---
type: "Document"
title: "Drawings and plot parity"
description: "Plan to make user drawing tools and Pine plot/drawing outputs match PYNE and render with correct pane, color, geometry, and settings."
resource: "docs/architecture/drawings-parity.mdx"
tags: [architecture, doc, docs, drawings-parity]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/architecture/drawings-parity.mdx"
    title: "docs/architecture/drawings-parity.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/drawings-parity.mdx`.

# Outline

* Phases
  * P0 — AXIS correctness (this pass)
  * P1 — User-tool settings (AXIS)
  * P2 — PYNE export (pynescript repo)
  * P3 — Remaining Pine paint
* Invariants
* Tests

# Mentions

* [src/chart](/code/src/chart.md)
* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/indicators](/code/src/indicators.md)
* [src/results](/code/src/results.md)
