---
type: "Code Module"
title: "src/hp/render"
description: "WebGL2 candle renderer — the HP-3 GPU rung (HP PR 8, §4 / §11.4)."
resource: "src/hp/render"
tags: [code, hp, render]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-22T14:47:03Z
sources:
  - id: tree
    resource: "src/hp/render"
    title: "src/hp/render"
    author: process:git
okf_lock: generated
---

# Files

* `select-renderer.ts` — probeRendererKind, resolveGpuFlag
* `types.ts` — CandleRenderer, RenderViewport, RendererHandle, RendererKind
* `webgl2-renderer.ts` — createWebgl2Renderer

# Depends on

* [src/hp](/code/src/hp.md)
* [src/hp/paint](/code/src/hp/paint.md)

# Used by

* [src/hp](/code/src/hp.md)
* [tests/hp](/code/tests/hp.md)
