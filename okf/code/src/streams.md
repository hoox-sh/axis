---
type: "Code Module"
title: "src/streams"
description: "src/streams contains catalog.ts, multiplex.ts, reconnect-ws.ts, and 2 more files."
resource: "src/streams"
tags: [code, streams]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T15:23:31Z
sources:
  - id: tree
    resource: "src/streams"
    title: "src/streams"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — BUILTIN_STREAMS, StreamPlugin, _resetStreamRegistrationFlag, binanceStream, bybitStream, ccxtWsStream, coinbaseStream, defaultStreamForSource, ensureStreamsRegistered, foldVenueCandle, getStream, krakenStream
* `multiplex.ts` — ENGINE_OWNED_APPEND_CAP, ENGINE_OWNED_TICK_MIN_MS, EngineOwnedPaintDiff, HEAVY_LIVE_RERUN_BARS, LIVE_RERUN_MAX_CONCURRENT, StopLiveOpts, StopLiveReason, StreamPlugin, _awaitEnginePaintForTests, _getLiveEpochForTests, _getPendingLiveBarCountForTests, _getRerunAttemptCountForTests
* `reconnect-ws.ts` — RECONNECT_DEFAULTS, ReconnectableWsOpts, WsStatus, nextBackoffMs, openReconnectableWs
* `stream-live.ts` — StreamFallbackError, VerifyClosedBarInput, VerifyClosedBarOutcome, VerifyStrength, mergeEngineSnapshot, resetStreamWire, scriptHistoryBars, streamDriveSeries, streamEvalScript, streamRouteActive, streamSeriesTick, streamStop
* `ws-venues.ts` — VENUE_WS_HOSTS, VenueId, VenueWsConfig, buildVenueWs

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/data/venues](/code/src/data/venues.md)
* [src/engine](/code/src/engine.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/optimize](/code/src/optimize.md)
* [src/plugins](/code/src/plugins.md)
* [src/results](/code/src/results.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)

# Used by

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [tests](/code/tests.md)
* [tests/engine](/code/tests/engine.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
