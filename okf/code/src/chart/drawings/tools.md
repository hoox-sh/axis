---
type: "Code Module"
title: "src/chart/drawings/tools"
description: "Side-effect imports that register extended drawing tools."
resource: "src/chart/drawings/tools"
tags: [chart, code, drawings, tools]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/chart/drawings/tools"
    title: "src/chart/drawings/tools"
    author: process:git
okf_lock: generated
---

# Files

* `annotation-extra.ts`
* `annotation.ts`
* `fib-extra.ts`
* `fib.ts`
* `gann.ts`
* `index.ts` — getToolHandler, listToolHandlers, registerToolHandler, toolArity, toolNeedsMultiClick
* `lines.ts`
* `measure-trading.ts`
* `patterns-extra.ts` — priceRatio
* `patterns.ts`
* `registry.ts` — PointArity, ToolHandler, ToolHitCtx, ToolViewCtx, getToolHandler, listToolHandlers, registerToolHandler, toolArity, toolNeedsMultiClick
* `safe.ts` — DRAWING_POINTS_MAX, DRAWING_TEXT_MAX, clampOpacity, clampStrokeWidth, finiteOr, isFinitePoint, safePrompt, sanitizeDrawingText, sanitizePoints, sanitizeStrokeColor
* `shapes-extra.ts` — arcPathD, curveControls, curvePathD, rotatedRectCorners, sampleArc, sampleCurve
* `shapes.ts`
* `text-prompt.ts` — DrawingTextPromptOptions, isDrawingTextPromptOpen, promptDrawingText
* `trading-extra.ts`

# Depends on

* [src/chart](/code/src/chart.md)
* [src/chart/drawings](/code/src/chart/drawings.md)

# Used by

* [src/chart](/code/src/chart.md)
* [src/chart/drawings](/code/src/chart/drawings.md)
* [tests](/code/tests.md)
