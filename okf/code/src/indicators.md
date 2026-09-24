---
type: "Code Module"
title: "src/indicators"
description: "src/indicators contains IndicatorCard.tsx, IndicatorPanel.tsx, detach.ts, and 6 more files."
resource: "src/indicators"
tags: [code, indicators]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:05:44Z
sources:
  - id: tree
    resource: "src/indicators"
    title: "src/indicators"
    author: process:git
okf_lock: generated
---

# Files

* `IndicatorCard.tsx` — IndicatorCard
* `IndicatorPanel.tsx` — IndicatorPanel
* `detach.ts` — detachIndicatorFromChart
* `reapply.ts` — ReapplyChartScriptsOpts, listReapplicableScripts, reapplyChartScripts
* `run-helpers.ts` — NormalizedRunResult, _resetRunEpochForTests, beginRunEpoch, claimRunStatus, coercePlotSample, coerceSeriesSample, currentRunEpoch, formatRunError, getRunStatusEpoch, isInteractiveRunInFlight, isRunEpochCurrent, lineDataHasSample
* `run-target.ts` — EditorRunMode, countChartScriptsForEditor, editorHasChartInstance, extractScriptTitle, findChartScriptForEditor, normalizeScriptSource, pickPreferredScript, resolveScriptDisplayName, runFromEditor
* `runner.ts` — NormalizedRunResult, RunOptions, RunResult, _resetOhlcvTimesCacheForTests, _resetRunEpochForTests, beginRunEpoch, claimRunStatus, coercePlotSample, currentRunEpoch, formatRunError, getOhlcvTimesForApply, isInteractiveRunInFlight
* `script-meta.ts` — EngineFamily, LastRunStatus, LiveRerunOn, ScriptKind, activeChartContext, cycleLiveRerunOn, detectDeclaredOverlay, detectPineVersion, detectScriptKind, engineFamily, engineFamilyLabel, formatScriptUpdatedAt
* `visibility.ts` — clearScriptChartOverlays, setScriptChartVisible, toggleScriptChartVisible

# Packages

`solid-js`

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/indicators/builtins](/code/src/indicators/builtins.md)
* [src/plugins](/code/src/plugins.md)
* [src/results](/code/src/results.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/panels](/code/src/ui/panels.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/indicators/builtins](/code/src/indicators/builtins.md)
* [src/mcp](/code/src/mcp.md)
* [src/optimize](/code/src/optimize.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/library](/code/src/ui/library.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)

# Nested

* [src/indicators/builtins](/code/src/indicators/builtins.md)
