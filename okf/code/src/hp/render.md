---
type: "Code Module"
title: "src/hp/render"
description: "WebGL2 candle renderer — the HP-3 GPU rung (HP PR 8, §4 / §11.4)."
resource: "src/hp/render"
tags: [code, hp, render]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-23T16:26:48Z
sources:
  - id: tree
    resource: "src/hp/render"
    title: "src/hp/render"
    author: process:git
okf_lock: generated
---

# Files

* `gpu-overlay.ts` — GpuCandleSeries, GpuOverlayDeps, MAX_OVERLAY_BARS, OverlayGeometry, overlayViewport, parseCssColorToRgb, ringWindowPlacement, startGpuOverlay
* `lwc-candle-width.ts` — lwcCandleBodyCss, lwcCandleBodyPx, lwcCandleWickCss, lwcCandleWickPx
* `select-renderer.ts` — probeRendererKind, resolveGpuFlag
* `types.ts` — CandleRenderer, RenderViewport, RendererHandle, RendererKind
* `webgl2-renderer.ts` — createWebgl2Renderer

# Packages

`lightweight-charts`

# Depends on

* [src/hp](/code/src/hp.md)
* [src/hp/memory](/code/src/hp/memory.md)
* [src/hp/paint](/code/src/hp/paint.md)

# Used by

* [src/chart](/code/src/chart.md)
* [src/hp](/code/src/hp.md)
* [tests/hp](/code/tests/hp.md)
