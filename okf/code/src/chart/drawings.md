---
type: "Code Module"
title: "src/chart/drawings"
description: "Interactive drawings package — D0 foundation barrel."
resource: "src/chart/drawings"
tags: [chart, code, drawings]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T20:35:52Z
sources:
  - id: tree
    resource: "src/chart/drawings"
    title: "src/chart/drawings"
    author: process:git
okf_lock: generated
---

# Files

* `coords.ts` — CoordContext, CreateCoordContextOpts, DRAWING_FUTURE_BARS, DRAWING_RIGHT_OFFSET_DEFAULT, TimeBarLike, ViewSize, clampTimeToFutureHorizon, createCoordContext, estimateBarPeriod, logicalIndexToUnixTime, unixTimeToLogicalIndex
* `defaults.ts` — ALL_DRAWING_TOOLS, DEFAULT_STYLE, DRAWING_COLORS, DrawingColorKey, FIB_EXT_LEVELS, FIB_LEVELS, RequiredPoints, TOOL_SPECS, needsTwoPoints, requiredPoints, toolLabel
* `draft.ts` — ChartPoint, DraftController, DraftPayload, DraftPhase, TOOL_SPECS, ToolArity, ToolSpec, createDraftController
* `geometry.ts` — ChartPoint, SegmentExtend, channelEdges, distToSegment, ellipseBBox, extendSegment, fibExtensionPrices, fibPrices, nearPoint, nearRectEdge, rayExtendPixels, resizePoint
* `index.ts` — ALL_DRAWING_KINDS, ALL_DRAWING_TOOLS, BarLike, ChartPoint, CloneDrawingsOptions, CoordContext, CreateCoordContextOpts, DEFAULT_STYLE, DRAWING_COLORS, DRAWING_FUTURE_BARS, DRAWING_RIGHT_OFFSET_DEFAULT, DRAWING_TEMPLATES_KEY
* `level-palette.ts` — isMultiColorKind, levelKey, levelSwatches, resolveLevelPaint
* `normalize.ts` — DRAWING_LIST_MAX, Drawing, DrawingLineStyle, DrawingMeta, DrawingStyle, NewDrawing, attachLegacyFields, normalizeDrawing, normalizeUserDrawings
* `snap.ts` — BarLike, MagnetMode, SnapOptions, SnapTarget, findNearestBarIndex, snapToBars
* `svg-primitives.ts` — circle, el, finiteAttr, label, line, strokeDashFor
* `sync.ts` — CloneDrawingsOptions, DrawingSyncLike, DrawingsForSymbolOptions, MergeDrawingsMode, MergeLayerDrawingsOptions, OffsetDrawingOptions, cloneDrawing, cloneDrawings, cloneDrawingsOffset, deepCloneDrawing, drawingsExceptSymbol, drawingsForSymbol
* `templates.ts` — DRAWING_TEMPLATES_KEY, DrawingTemplate, DrawingTemplateExport, DrawingTemplateMeta, DrawingTemplateSummary, DrawingTemplatesExport, DrawingTemplatesStore, LoadTemplateMode, SerializedDrawing, TEMPLATE_FORMAT, TEMPLATE_VERSION, applyTemplateDrawings
* `tool-catalog.ts` — TOOL_GROUPS, ToolGroupDef, ToolGroupId, defaultToolForGroup, groupForTool
* `tool-icons.tsx` — DrawingToolIcon, toolIconPath
* `tool-settings.ts` — ALL_DRAWING_KINDS, FIB_TIME_LEVELS, KindDrawingPrefs, ToolSettingId, arrowEndOf, arrowStartOf, clampFontSize, clampRiskReward, defaultExtendFlags, defaultFibLevels, defaultKindPrefs, drawingTextOf
* `types.ts` — ChartPoint, DraftPhase, DraftState, DragState, Drawing, DrawingKind, DrawingMeta, DrawingStyle, DrawingToolId, HLineDrawing, Handle, HandleId

# Packages

`lightweight-charts`, `solid-js`

# Depends on

* [src/chart](/code/src/chart.md)
* [src/chart/drawings/tools](/code/src/chart/drawings/tools.md)

# Used by

* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/chart/drawings/toolbar](/code/src/chart/drawings/toolbar.md)
* [src/chart/drawings/tools](/code/src/chart/drawings/tools.md)
* [src/mcp](/code/src/mcp.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/layers](/code/src/ui/layers.md)
* [tests](/code/tests.md)

# Nested

* [src/chart/drawings/toolbar](/code/src/chart/drawings/toolbar.md)
* [src/chart/drawings/tools](/code/src/chart/drawings/tools.md)
