---
type: "Code Module"
title: "tests/helpers"
description: "tests/helpers contains mock-chart-host.ts, mock-fetch.ts, mock-lwc.ts, and 3 more files."
resource: "tests/helpers"
tags: [code, helpers, tests]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-16T21:28:50Z
sources:
  - id: tree
    resource: "tests/helpers"
    title: "tests/helpers"
    author: process:git
okf_lock: generated
---

# Files

* `mock-chart-host.ts` — installChartHostMock
* `mock-fetch.ts` — FetchHandler, jsonResponse, mockFetch
* `mock-lwc.ts` — FakeChart, FakePriceLine, FakeSeries, installLightweightChartsMock, makeFakeChart
* `mock-solid.ts`
* `mock-ws.ts` — MockWebSocket
* `offline-source.ts` — TEST_OFFLINE_SOURCE_ID, registerTestOfflineSource, testOfflineSource

# Packages

`bun:test`, `lightweight-charts`, `solid-js/h/jsx-dev-runtime`

# Depends on

* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)

# Used by

* [tests](/code/tests.md)
* [tests/engine](/code/tests/engine.md)
* [tests/integration](/code/tests/integration.md)
