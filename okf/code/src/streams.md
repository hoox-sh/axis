---
type: "Code Module"
title: "src/streams"
description: "Legacy live datastream plugins (pre-Solid path)."
resource: "src/streams"
tags: [code, streams]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/streams"
    title: "src/streams"
    author: process:git
okf_lock: generated
---

# Files

* `binance.ts` — StreamPlugin, binanceStream
* `catalog.ts` — BUILTIN_STREAMS, StreamPlugin, _resetStreamRegistrationFlag, binanceStream, bybitStream, ccxtWsStream, coinbaseStream, defaultStreamForSource, ensureStreamsRegistered, foldVenueCandle, getStream, krakenStream
* `index.js` — binanceWs, mockPoll, none
* `multiplex.ts` — HEAVY_LIVE_RERUN_BARS, StopLiveOpts, StopLiveReason, StreamPlugin, _getLiveEpochForTests, _getRerunAttemptCountForTests, _resetMultiplexForTests, defaultStreamForSource, effectiveLiveRerunMode, getAvailableStreams, listStreams, scheduleLiveRerun
* `reconnect-ws.ts` — RECONNECT_DEFAULTS, ReconnectableWsOpts, WsStatus, nextBackoffMs, openReconnectableWs
* `ws-venues.ts` — VENUE_WS_HOSTS, VenueId, VenueWsConfig, buildVenueWs

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/data/venues](/code/src/data/venues.md)
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
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
