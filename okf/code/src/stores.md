---
type: "Code Module"
title: "src/stores"
description: "Narrow bar plane — canonical OHLCV state separated from the giant app store so chart/data paths can subscribe to exactly the slice they need."
resource: "src/stores"
tags: [code, stores]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-16T08:41:35Z
sources:
  - id: tree
    resource: "src/stores"
    title: "src/stores"
    author: process:git
okf_lock: generated
---

# Files

* `bars.ts` — BarPlaneState, applyFeedDelta, barPlane, setBarPlaneAppend, setBarPlaneFull, setBarPlaneSnapshot, setBarPlaneTip

# Packages

`solid-js`, `solid-js/store`

# Depends on

* [src/engine](/code/src/engine.md)
* [src/store](/code/src/store.md)

# Used by

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/dev](/code/src/dev.md)
* [src/indicators](/code/src/indicators.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/extras](/code/src/ui/extras.md)
* [tests](/code/tests.md)
