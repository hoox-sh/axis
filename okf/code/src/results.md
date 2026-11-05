---
type: "Code Module"
title: "src/results"
description: "src/results contains dataview.ts, debug-pins.ts, events.ts, and 12 more files."
resource: "src/results"
tags: [code, results]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-05T12:40:24Z
sources:
  - id: tree
    resource: "src/results"
    title: "src/results"
    author: process:git
okf_lock: generated
---

# Files

* `dataview.ts` — BuildDataViewOpts, DataViewOnchainSeries, DataViewPlotMeta, DataViewRow, DataViewTimePoint, barIndexAtTime, buildDataViewRows, buildDrawingDataViewRows, buildOnchainDataViewRows, fmtUsdCompact, isTimeOnLineKind, linePriceAtTime
* `debug-pins.ts` — DebugPin, DebugPinSource, PinsFromDebugOptions, countDebugPins, debugPinsToMarkers, normalizePinTime, parseBarIndexFromText, parseTimeFromText, pinsFromDebugEntries, pinsFromLastRun, resolveDebugPinTarget
* `events.ts` — EventsToMarkersOptions, NormalizeOptions, StrategyFillMode, TradeMarker, alignTimeToBars, applyStrategyFills, buildEquityCurve, eventsToMarkers, formatTradeQty, isNoFillCloseEvent, normalizeStrategyEvent, normalizeStrategyEvents
* `inline-debug.ts` — InlineDebugAnnotation, InlineDebugLevel, collapseAnnotationsByLine, collectInlineDebugAnnotations, filterPinableAnnotations, isPinableAnnotation, parseSourceLine
* `overlay.ts` — EventDirFilter, EventFilterOptions, SAVED_SORTS, SavedSort, SeriesSummary, countEvents, eventDir, eventSearchText, filterEvents, isCloseEvent, savedRunSearchText, sortSavedRuns
* `pine-color.ts` — resolvePineColor
* `plot-sources.ts` — IndicatorSeriesCache, PLOT_SOURCE_PREFIX, PlotSourceOption, formatPlotSourceId, groupIndicatorsByPlotDepLevel, isPlotSourceRef, listPlotSourceOptions, listStorePlotSourceOptions, mapWithConcurrencyLimit, orderIndicatorsByPlotDeps, parsePlotSourceId, resolveInputSourceValues
* `plot-visuals.ts` — BgcolorBandSpec, LineOverlaySpec, OhlcBarPoint, OhlcOverlaySpec, PLOT_DISPLAY, PlotFillBandSpec, PlotKind, PlotMetaEntry, PlotSeriesKind, SeriesMap, ShapeMarkerSpec, barcolorSeriesToMap
* `positions.ts` — BuildPositionViewsOptions, PositionCloseFill, PositionFill, PositionView, StreamEventView, buildPositionViews
* `profiler.ts` — ProfileLineStat, RunProfile, normalizeRunProfile, profileLineMap
* `pyne-logs.ts` — PyneLogEntry, PyneLogLevel, filterPyneLogs, normalizePyneLogs, pyneLogsToText
* `script-inputs.ts` — DEFAULT_SOURCE_OPTIONS, InputFormGroup, InputFormRow, PineEnumDef, PineEnumMember, ScriptInputDef, ScriptInputType, applyInputOverrides, collectImportAliases, collectPineEnumsFromSources, collectStringConsts, findLhsIdent
* `strategy-props.ts` — COMMISSION_TYPE_OPTIONS, QTY_TYPE_OPTIONS, STRATEGY_PROP_CATALOG, StrategyPropDef, StrategyPropType, applyStrategyOverrides, applyStrategyPropsToSource, findStrategyCall, hasStrategyDeclaration, normalizeStrategyEnum, parseStrategyDeclaration, resolveStrategyProps
* `strategy.ts` — BuildStrategyReportOptions, ClosedTrade, CommissionModel, EquityStep, PositionCloseFill, PositionFill, PositionView, StrategyEvent, StrategyStats, StrategyStatsSnapshot, StrategyWalk, StreamEventView
* `window-axis.ts` — RunWindowAxis, WINDOW_AXIS_KEYS, axisStamp, barIndexForTime, looksLikeBarIndex, timeForBarIndex, windowAxisFromBars, windowAxisFromMeta

# Depends on

* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)

# Used by

* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/engine](/code/src/engine.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
* [tests/engine](/code/tests/engine.md)
* [tests/integration](/code/tests/integration.md)
