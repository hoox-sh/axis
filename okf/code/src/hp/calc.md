---
type: "Code Module"
title: "src/hp/calc"
description: "src/hp/calc contains barstate.ts, execution-context.ts."
resource: "src/hp/calc"
tags: [calc, code, hp]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-22T10:43:52Z
sources:
  - id: tree
    resource: "src/hp/calc"
    title: "src/hp/calc"
    author: process:git
okf_lock: generated
---

# Files

* `barstate.ts` — BarStateContext, appendCloseBarState, commitsAccumulators, snapshotBarState, snapshotTipBarState, tipBarState
* `execution-context.ts` — ExecutionContext, executionContextFromDelta, executionContextFromJsonFrame, executionContextFromOpcode, isExecutionContext

# Depends on

* [src/hp/axb1](/code/src/hp/axb1.md)

# Used by

* [src/engine](/code/src/engine.md)
* [src/hp](/code/src/hp.md)
* [src/hp/workers](/code/src/hp/workers.md)
* [tests/hp](/code/tests/hp.md)
