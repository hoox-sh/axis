---
type: "Code Module"
title: "src/indicators"
description: "src/indicators contains IndicatorCard.tsx, IndicatorPanel.tsx, apply-context.ts, and 14 more files."
resource: "src/indicators"
tags: [code, indicators]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-26T04:05:35Z
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
* `apply-context.ts` — AlignedApplySeries, ResolvedRunContext, _resetNoEngineAxisWarnForTests, alignApplySeries, resolveRunContext
* `apply-drawings.ts` — DrawingsApplyContext, appliedScriptStillOnChart, applyDrawings
* `apply-live.ts` — ApplyLiveDeps, ApplyLiveOpts, _clearLiveTipCachesForTests, applyPrecomputedChart
* `apply-mutations.ts` — ChartMutationContext, PlotsAndMarkersInput, applyChartMutations, applyPlotsAndMarkers, applyShapeMarkers, buildShapeMarkers
* `apply-overlays.ts` — OverlayBuildContext, OverlayBuildOutcome, OverlayLine, OverlayOhlc, buildOverlayPayloads, pickOverlayColor
* `apply-pane.ts` — PaneSetupContext, ensureApplyPane
* `apply-store.ts` — StoreUpdateContext, updateIndicatorStore
* `apply-strategy.ts` — StrategyApplyContext, StrategyMarkerPlan, applyStrategyMarkers, buildStrategyMarkerPlan
* `detach.ts` — detachIndicatorFromChart
* `reapply.ts` — REAPPLY_MAX_CONCURRENT, ReapplyChartScriptsOpts, _resetBatchRouteMemoForTests, _resetReapplyGuardForTests, listReapplicableScripts, reapplyChartScripts
* `run-helpers.ts` — NormalizedRunResult, _resetRunEpochForTests, beginRunEpoch, claimRunStatus, coercePlotSample, coerceSeriesSample, currentRunEpoch, formatRunError, getRunStatusEpoch, isInteractiveRunInFlight, isRunEpochCurrent, lineDataHasSample
* `run-target.ts` — EditorRunMode, countChartScriptsForEditor, editorHasChartInstance, extractScriptTitle, findChartScriptForEditor, normalizeScriptSource, pickPreferredScript, resolveScriptDisplayName, runFromEditor
* `runner.ts` — NormalizedRunResult, RunOptions, RunResult, StrategyPropsPrecedenceOpts, _resetOhlcvTimesCacheForTests, _resetRunEpochForTests, alignSeriesMapToTimes, alignSeriesToTimes, applyRollingWindow, beginRunEpoch, claimRunStatus, coercePlotSample
* `script-meta.ts` — EngineFamily, LastRunStatus, LiveRerunOn, ScriptKind, activeChartContext, cycleLiveRerunOn, detectDeclaredOverlay, detectPineVersion, detectScriptKind, engineFamily, engineFamilyLabel, formatScriptUpdatedAt
* `visibility.ts` — clearScriptChartOverlays, setScriptChartVisible, toggleScriptChartVisible

# Packages

`solid-js`

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/chart/v1](/code/src/chart/v1.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/engine/v1](/code/src/engine/v1.md)
* [src/engines](/code/src/engines.md)
* [src/indicators/builtins](/code/src/indicators/builtins.md)
* [src/plugins](/code/src/plugins.md)
* [src/results](/code/src/results.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/utils](/code/src/utils.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/engine](/code/src/engine.md)
* [src/engines](/code/src/engines.md)
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
* [tests/chart](/code/tests/chart.md)
* [tests/engine](/code/tests/engine.md)
* [tests/indicators](/code/tests/indicators.md)
* [tests/integration](/code/tests/integration.md)

# Nested

* [src/indicators/builtins](/code/src/indicators/builtins.md)
