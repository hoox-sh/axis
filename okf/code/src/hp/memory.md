---
type: "Code Module"
title: "src/hp/memory"
description: "src/hp/memory contains control-block.ts, hot-buffer.ts, layout.ts."
resource: "src/hp/memory"
tags: [code, hp, memory]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T23:35:56Z
sources:
  - id: tree
    resource: "src/hp/memory"
    title: "src/hp/memory"
    author: process:git
okf_lock: generated
---

# Files

* `control-block.ts` — HP_CONTROL_VERSION, HP_GEN_INDEX, HP_NOTIFY_INDEX, HpControlBlock, HpControlFlag, HpControlSnapshot
* `hot-buffer.ts` — BAR_FLAG_CLOSED, BAR_FLAG_FORMING, HotBarTicks, HotBuffer, allocateHotBuffer, barToTicks
* `layout.ts` — HOT_CAP, HOT_COLUMNS, HOT_COLUMN_BYTES, HP_CONTROL_BYTES, HP_HOT_SLOTS, HP_SECTION_ALIGN, HP_SERIES_HEADER_BYTES, HP_TIP_BYTES, HP_TIP_SLOTS, HotColumnId, HotLayout, HotSlotLayout

# Depends on

* [src/hp](/code/src/hp.md)
* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/store](/code/src/store.md)

# Used by

* [src/hp](/code/src/hp.md)
* [src/hp/paint](/code/src/hp/paint.md)
* [src/hp/sync](/code/src/hp/sync.md)
* [tests/hp](/code/tests/hp.md)
