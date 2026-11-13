---
type: "Code Module"
title: "src/market"
description: "src/market contains price-object.ts."
resource: "src/market"
tags: [code, market]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-13T18:54:12Z
sources:
  - id: tree
    resource: "src/market"
    title: "src/market"
    author: process:git
okf_lock: generated
---

# Role

The one price. Every surface that shows the chart instrument's price reads this object — the tab title, the HUD Last chip, the quote / price panels, the mobile header, the chart last-value label, alerts, and the MCP snapshot. Why The old path fanned the price out: each consumer re-derived it from telemetry.lastTick, barPlane.tip, and the stream state with its own precedence, so the tab could show one number while the candle showed another. Here there is exactly one writer and one value.…

# Files

* `price-object.ts` — PriceCommit, PriceDirection, PriceView, _resetPriceForTests, commitPrice, formatPrice, formatPriceChange, priceChangePct, priceDirection, priceTone, priceView, resetPrice

# Packages

`solid-js`

# Depends on

* [src/chart](/code/src/chart.md)

# Used by

* [src](/code/src.md)
* [src/mcp](/code/src/mcp.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/extras](/code/src/ui/extras.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [tests](/code/tests.md)
