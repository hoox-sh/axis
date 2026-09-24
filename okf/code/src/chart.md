---
type: "Code Module"
title: "src/chart"
description: "Solid chart host — mounts PaneManager for one layout slot."
resource: "src/chart"
tags: [chart, code]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/chart"
    title: "src/chart"
    author: process:git
okf_lock: generated
---

# Files

* `ChartHost.tsx` — ChartHost, ChartHostProps, applyDebugPinsToChart, getActiveDrawingLayer, getDrawingLayer, getManager, getReplayState, getVisibleBars, isReplayActive, jumpToDebugPin, setDataToChart, startReplaySession
* `ChartScaleControls.tsx` — ChartScaleControls
* `ChartWorkspace.tsx` — ChartWorkspace
* `DrawingToolbar.tsx` — DrawingToolbar
* `PyneTableHud.tsx` — PyneTableHud
* `bar-replay.ts` — REPLAY_SPEEDS, REPLAY_TICK_MS, ReplayState, createReplay, formatReplaySpeedLabel, getReplayBarsLength, getReplayState, getVisibleBars, idleReplay, isAtEnd, isAtStart, isReplayActive
* `chart-registry.ts` — ChartSlotRuntime, disposeSlotChart, getActiveDrawingLayer, getActiveManager, getActiveSlotId, getSlotBars, getSlotChartDataGen, getSlotDrawingLayer, getSlotManager, getSlotRuntime, removeSlotRuntime, setActiveDrawingLayer
* `chart-type.ts` — CHART_TYPES, ChartType, ChartTypeInfo, DEFAULT_CHART_TYPE, OhlcDatum, PriceSeriesDatum, ValueDatum, chartTypeInfo, isOhlcChartType, lastBarDirection, mapBarUpdate, mapBarsToPriceData
* `compare-overlay.ts` — AlignedPair, ApplyCompareOpts, COMPARE_COLOR, COMPARE_MAIN_PCT_COLOR, COMPARE_MAIN_PCT_KEY, COMPARE_PRICE_SCALE_ID, COMPARE_SERIES_KEY, CompareMode, LinePoint, TimedClose, alignAbsolute, alignByTime
* `crosshair-sync.ts`
* `drawing-layer.ts` — DrawingChangeHandler, DrawingLayer, SelectionChangeHandler, StylePrefs, ToolChangeHandler, fibPrices, fillBandRunBounds, getActiveDrawingLayer, linefillQuadCorners, plotFillsSignature, shiftDrawing
* `drawing-types.ts` — DRAWING_COLORS, Drawing, DrawingBase, DrawingKind, DrawingLineStyle, DrawingToolId, FIB_EXT_LEVELS, FIB_LEVELS, HLineDrawing, MultiPointDrawing, Point, TextDrawing
* `heavy-data.ts` — CONFLATION_BARS_THRESHOLD, HEAVY_BARS_THRESHOLD, MAX_CHART_MARKERS, VERY_HEAVY_BARS_THRESHOLD, barIndexAtTimeBinary, barIndexRangeForTimeWindow, capNewest, createRafCoalescer, heavyTimeScaleOptions, indexRangeForSortedTimes, isHeavyBarLoad, isVeryHeavyBarLoad
* `keymap-actions.ts` — applyChartGrid, cancelDraft, deleteSelectedDrawing, panChartBy, resetChartZoom, selectDrawingTool, toggleCrosshair, toggleMagnet, zoomChartBy
* `last-value-labels.ts` — lastValueNamesOn, seriesLabelTitle
* `layout-recipes.ts` — LAYOUT_RECIPES, LayoutRecipe, LayoutRecipeSeed, LayoutRecipeSlotSpec, MAJOR_SYMBOLS, applyLayoutRecipe, findLayoutRecipe, recipeToLayout, resolveRecipeSlots
* `layout.ts` — CHART_GRID_MODES, ChartGridMode, ChartLayoutState, ChartSlot, SavedChartLayout, createChartSlot, defaultChartLayout, findSlot, gridClassForMode, isChartGridMode, normalizeChartLayout, slotCountForMode
* `line-break-primitive.ts` — LineBreakOverlayPoint, LineBreakPrimitive, LineBreakPrimitiveOpts
* `manager-access.ts` — SetDataToChartOpts, applyDebugPinsToChart, applyPriceScaleDecimals, clearScriptPaneLayer, clearScriptPaneLayers, ensurePriceSeries, ensureScriptPaneLayer, getActiveDrawingLayer, getDrawingLayer, getManager, jumpToDebugPin, setDataToChart
* `onchain-events.ts` — ONCHAIN_EVENTS_SERIES_KEY, OnchainEventInput, OnchainEventMarker, applyOnchainEventMarkers, clearOnchainEventMarkers, eventsToMarkers
* `onchain-overlay.ts` — ONCHAIN_PRICE_SCALE_ID, ONCHAIN_SERIES_PREFIX, OnchainLineSpec, applyOnchainOverlays, clearOnchainOverlays
* `pane-badge.ts` — mountPaneBadge, refreshAllPaneBadges, refreshPaneBadge, setPaneBadgeLabel
* `pane-manager.ts` — ManagedPane, OVERLAY_OHLC_PREFIX, OverlayLineSpec, OverlayOhlcSpec, OverlayOwnerOpts, OverlayPoint, OverlayTipPeek, PaneManager, inferOverlayTitle, isFiniteOhlcBar, makeBgcolorKey, makeOverlayLineKey
* `pine-tables.ts` — CollectTablesOpts, PineTable, PineTableCell, buildTableGrid, cellTextAlign, cellTextVerticalAlign, collectVisiblePineTables, isPineTable, normalizePineTable, parsePineTableCell, pineTablePositionClass, tablesFromRunPayload
* `plot-rect.ts` — ChartPlotRect, PlotRectChart, PlotRectHost, measureChartPlotRect
* `price-precision.ts` — PRICE_SCALE_DECIMALS_MAX, PRICE_SCALE_DECIMALS_MIN, PriceFormatOpts, PriceScaleDecimalsMode, clampPriceDecimals, countSignificantDecimals, cyclePriceScaleDecimalsMode, decimalsFromMagnitude, detectDecimalsFromBars, detectDecimalsFromSymbol, formatPriceWithDecimals, normalizePriceScaleDecimalsMode
* `pyne-drawings.ts` — DEFAULT_DRAWING_LIMITS, DrawingLimits, ScriptDrawing, YLOC_PAD_PX, clampScriptDrawingTimes, clampTimeToLastBar, dedupeScriptLabelsAtSameTime, garbageCollectScriptDrawings, labelBubbleLayout, labelFontSizePx, normalizeExtend, normalizeLabelStyle
* `screenshot.ts` — DEFAULT_SCREENSHOT_OPTIONS, ScreenshotOptions, ScreenshotScale, ScreenshotScope, canvasToBlob, captureScreenshot, copyBlob, copyScreenshot, downloadBlob, downloadScreenshot, loadScreenshotOptions, saveScreenshotOptions
* `series-factory.ts` — PLOT_PALETTE, RIGHT_PRICE_SCALE_WIDTH, TV, VOID, colorWithAlpha, createAreaSeries, createBarSeries, createBaseChart, createBgcolorSeries, createCandleSeries, createHollowCandleSeries, createLineSeries
* `volume-profile.ts` — DEFAULT_VALUE_AREA_PCT, DEFAULT_VP_ROWS, VolumeDistribution, VolumeProfileBin, VolumeProfileOptions, VolumeProfileResult, VpBar, computeVolumeProfile, expandValueArea, formatVpPrice, formatVpVolume, priceToBinIndex

# Packages

`lightweight-charts`, `solid-js`, `solid-js/store`, `solid-js/web`

# Depends on

* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/chart/drawings/toolbar](/code/src/chart/drawings/toolbar.md)
* [src/chart/drawings/tools](/code/src/chart/drawings/tools.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/indicators](/code/src/indicators.md)
* [src/onchain](/code/src/onchain.md)
* [src/plugins](/code/src/plugins.md)
* [src/results](/code/src/results.md)
* [src/sources](/code/src/sources.md)
* [src/store](/code/src/store.md)
* [src/theme](/code/src/theme.md)
* [src/ui](/code/src/ui.md)
* [src/ui/panels](/code/src/ui/panels.md)

# Used by

* [src](/code/src.md)
* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/chart/drawings/tools](/code/src/chart/drawings/tools.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/results](/code/src/results.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/layers](/code/src/ui/layers.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [src/ui/shortcuts](/code/src/ui/shortcuts.md)
* [tests](/code/tests.md)

# Nested

* [src/chart/drawings](/code/src/chart/drawings.md)
