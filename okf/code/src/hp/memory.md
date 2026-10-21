---
type: "Code Module"
title: "src/hp/memory"
description: "src/hp/memory contains cold-store.ts, control-block.ts, hot-buffer.ts, and 2 more files."
resource: "src/hp/memory"
tags: [code, hp, memory]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T23:55:09Z
sources:
  - id: tree
    resource: "src/hp/memory"
    title: "src/hp/memory"
    author: process:git
okf_lock: generated
---

# Files

* `cold-store.ts` — ColdStore, hydrateColdFromCache
* `control-block.ts` — HP_CONTROL_VERSION, HP_GEN_INDEX, HP_NOTIFY_INDEX, HpControlBlock, HpControlFlag, HpControlSnapshot
* `hot-buffer.ts` — BAR_FLAG_CLOSED, BAR_FLAG_FORMING, HotBarTicks, HotBuffer, allocateHotBuffer, barToTicks
* `layout.ts` — HOT_CAP, HOT_COLUMNS, HOT_COLUMN_BYTES, HP_CONTROL_BYTES, HP_HOT_SLOTS, HP_SECTION_ALIGN, HP_SERIES_HEADER_BYTES, HP_TIP_BYTES, HP_TIP_SLOTS, HotColumnId, HotLayout, HotSlotLayout
* `page-buffer.ts` — HotRange, PAGE_CAPACITY, ViewportPagePlan, ViewportRequest, copyOutPageFromCold, planViewportPage, publishViewportPage

# Depends on

* [src/data](/code/src/data.md)
* [src/hp](/code/src/hp.md)
* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/store](/code/src/store.md)

# Used by

* [src/hp](/code/src/hp.md)
* [src/hp/paint](/code/src/hp/paint.md)
* [src/hp/sync](/code/src/hp/sync.md)
* [tests/hp](/code/tests/hp.md)
