---
type: "Document"
title: "Charting"
description: "AXIS chart: ChartHost, PaneManager, series factory, drawings, crosshair sync, and trade markers."
resource: "docs/ui/charting.mdx"
tags: [charting, doc, docs, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-04T15:15:00Z
sources:
  - id: tree
    resource: "docs/ui/charting.mdx"
    title: "docs/ui/charting.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/ui/charting.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * Panes
  * Price chart styles (store.chartType)
  * Empty / status overlay
  * Price-scale decimals
  * Plot style parity
  * Multi-chart layouts
  * Bar Replay
  * Compare & volume profile
  * Layers panel
  * Pane badges
  * Screenshot
  * Drawings toolbar
  * Crosshair & time
* Internals
  * Solid vs imperative boundary
  * Data path
  * Run apply (chart side)
  * History vs live bars
  * series-factory
* Invariants
* Failure modes
* Worked example (dev)
* See also
