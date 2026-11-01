---
type: "Code Module"
title: "src/stores"
description: "Narrow bar plane — canonical OHLCV state separated from the giant app store so chart/data paths can subscribe to exactly the slice they need."
resource: "src/stores"
tags: [code, stores]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-01T17:22:22Z
sources:
  - id: tree
    resource: "src/stores"
    title: "src/stores"
    author: process:git
okf_lock: generated
---

# Files

* `bars.ts` — BarPlaneState, barPlane, setBarPlaneAppend, setBarPlaneFull, setBarPlaneTip

# Packages

`solid-js`, `solid-js/store`

# Depends on

* [src/store](/code/src/store.md)

# Used by

* [src](/code/src.md)
* [src/indicators](/code/src/indicators.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/extras](/code/src/ui/extras.md)
