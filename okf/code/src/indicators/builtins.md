---
type: "Code Module"
title: "src/indicators/builtins"
description: "AXIS first-party built-in scripts — original Pine, not third-party templates."
resource: "src/indicators/builtins"
tags: [builtins, code, indicators]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/indicators/builtins"
    title: "src/indicators/builtins"
    author: process:git
okf_lock: generated
---

# Files

* `apply.ts` — ApplyBuiltinResult, applyBuiltinScript
* `catalog.ts` — BUILTIN_SCRIPTS, builtinCategoryLabel, builtinsInCategory, filterBuiltinScripts, getBuiltinScript, listBuiltinCategories
* `channels.ts` — CHANNEL_BUILTINS
* `index.ts` — AXIS_PINE_BANNER, BUILTIN_SCRIPTS, BuiltinCategory, BuiltinKind, BuiltinScript, COL, SKIPPED_STUDIES, SkippedStudy, applyBuiltinScript, builtinCategoryLabel, builtinsInCategory, filterBuiltinScripts
* `ma.ts` — MA_BUILTINS
* `oscillators.ts` — OSCILLATOR_BUILTINS
* `pine.ts` — AXIS_PINE_BANNER, COL, def, pineIndicator, pineStrategy
* `pivots.ts` — PIVOT_BUILTINS
* `skipped.ts` — SKIPPED_STUDIES
* `strategies.ts` — STRATEGY_BUILTINS
* `trend.ts` — TREND_BUILTINS
* `types.ts` — BuiltinCategory, BuiltinKind, BuiltinScript, SkippedStudy
* `volatility.ts` — VOLATILITY_BUILTINS
* `volume.ts` — VOLUME_BUILTINS

# Depends on

* [src/indicators](/code/src/indicators.md)
* [src/store](/code/src/store.md)

# Used by

* [src/indicators](/code/src/indicators.md)
* [src/ui](/code/src/ui.md)
* [src/ui/library](/code/src/ui/library.md)
* [tests](/code/tests.md)
