---
type: "Code Module"
title: "worker/src/feed"
description: "Feed-key parsing for the shared market feed (/api/feed)."
resource: "worker/src/feed"
tags: [code, feed, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-14T19:43:13Z
sources:
  - id: tree
    resource: "worker/src/feed"
    title: "worker/src/feed"
    author: process:git
okf_lock: generated
---

# Files

* `feed-http.ts` — FeedRouteContext, handleFeedBars, handleFeedDelta
* `feed-key.ts` — FEED_INTERVALS, FeedInterval, FeedKey, INTERVAL_TO_MS, USER_SCOPE_RE, binanceInterval, feedKeyToBinanceSymbol, feedKeyToString, parseFeedKey, parseFeedKeyAllowUserScope
* `frames.ts` — FeedBar, FeedDeltaArrays, barsFromKlines, buildDeltaFrame, buildSnapshotFrame
* `ingest.ts` — DELTA_RING_CAP, DeltaRingEntry, DeltasSince, MAX_INGEST_BARS, ValidateBarsResult, deltasSince, pushDelta, userScopeForApiKey, validateIngestBars

# Depends on

* [worker/src](/code/worker/src.md)

# Used by

* [worker/src](/code/worker/src.md)
* [worker/src/durable-objects](/code/worker/src/durable-objects.md)
* [worker/tests](/code/worker/tests.md)
