---
type: "Code Module"
title: "src/sources"
description: "Legacy historical source plugins (pre-Solid path)."
resource: "src/sources"
tags: [code, sources]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/sources"
    title: "src/sources"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — BUILTIN_SOURCES, GeckoPoolRef, SourceConfigSchema, SourcePlugin, _resetSourceRegistrationFlag, binanceRest, bybitRest, ccxtRest, coinbaseRest, csvUpload, dataManagerSource, ensureSourcesRegistered
* `index.js` — binanceRest, csvUpload, mockWalk, setUploadedBars
* `upload-store.ts` — clearUploadedBars, getUploadedBars, getUploadedFileName, setUploadedBars

# Depends on

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/data/venues](/code/src/data/venues.md)
* [src/onchain](/code/src/onchain.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/plugins](/code/src/plugins.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
