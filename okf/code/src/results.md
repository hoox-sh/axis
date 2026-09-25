---
type: "Code Module"
title: "src/results"
description: "src/results contains dataview.ts, debug-pins.ts, events.ts, and 10 more files."
resource: "src/results"
tags: [code, results]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-25T05:15:59Z
sources:
  - id: tree
    resource: "src/results"
    title: "src/results"
    author: process:git
okf_lock: generated
---

# Files

* `dataview.ts` — BuildDataViewOpts, DataViewOnchainSeries, DataViewRow, DataViewTimePoint, barIndexAtTime, buildDataViewRows, buildDrawingDataViewRows, buildOnchainDataViewRows, fmtUsdCompact, isTimeOnLineKind, linePriceAtTime, onchainValueAtTime
* `debug-pins.ts` — DebugPin, DebugPinSource, PinsFromDebugOptions, countDebugPins, debugPinsToMarkers, normalizePinTime, parseBarIndexFromText, parseTimeFromText, pinsFromDebugEntries, pinsFromLastRun, resolveDebugPinTarget
* `events.ts` — EventsToMarkersOptions, NormalizeOptions, StrategyFillMode, TradeMarker, alignTimeToBars, applyStrategyFills, buildEquityCurve, eventsToMarkers, formatTradeQty, isNoFillCloseEvent, normalizeStrategyEvent, normalizeStrategyEvents
* `inline-debug.ts` — InlineDebugAnnotation, InlineDebugLevel, collapseAnnotationsByLine, collectInlineDebugAnnotations, filterPinableAnnotations, isPinableAnnotation, parseSourceLine
* `pine-color.ts` — resolvePineColor
* `plot-sources.ts` — IndicatorSeriesCache, PLOT_SOURCE_PREFIX, PlotSourceOption, formatPlotSourceId, isPlotSourceRef, listPlotSourceOptions, listStorePlotSourceOptions, orderIndicatorsByPlotDeps, parsePlotSourceId, resolveInputSourceValues, sourceOptionsWithPlots
* `plot-visuals.ts` — BgcolorBandSpec, LineOverlaySpec, OhlcBarPoint, OhlcOverlaySpec, PLOT_DISPLAY, PlotFillBandSpec, PlotKind, PlotMetaEntry, PlotSeriesKind, SeriesMap, ShapeMarkerSpec, barcolorSeriesToMap
* `positions.ts` — BuildPositionViewsOptions, PositionCloseFill, PositionFill, PositionView, StreamEventView, buildPositionViews
* `profiler.ts` — ProfileLineStat, RunProfile, normalizeRunProfile, profileLineMap
* `pyne-logs.ts` — PyneLogEntry, PyneLogLevel, filterPyneLogs, normalizePyneLogs, pyneLogsToText
* `script-inputs.ts` — DEFAULT_SOURCE_OPTIONS, InputFormGroup, InputFormRow, PineEnumDef, PineEnumMember, ScriptInputDef, ScriptInputType, applyInputOverrides, collectImportAliases, collectPineEnumsFromSources, collectStringConsts, findLhsIdent
* `strategy-props.ts` — COMMISSION_TYPE_OPTIONS, QTY_TYPE_OPTIONS, STRATEGY_PROP_CATALOG, StrategyPropDef, StrategyPropType, applyStrategyOverrides, applyStrategyPropsToSource, findStrategyCall, hasStrategyDeclaration, normalizeStrategyEnum, parseStrategyDeclaration, resolveStrategyProps
* `strategy.ts` — BuildStrategyReportOptions, ClosedTrade, EquityStep, PositionCloseFill, PositionFill, PositionView, StrategyEvent, StrategyStats, StrategyStatsSnapshot, StrategyWalk, StreamEventView, SvgPolylineResult

# Depends on

* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)

# Used by

* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/indicators](/code/src/indicators.md)
* [src/optimize](/code/src/optimize.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
