---
type: "Code Module"
title: "src/hp/workers"
description: "src/hp/workers contains calc-core.ts, host.ts, hot-ring-writer.ts, and 3 more files."
resource: "src/hp/workers"
tags: [code, hp, workers]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-24T01:05:33Z
sources:
  - id: tree
    resource: "src/hp/workers"
    title: "src/hp/workers"
    author: process:git
okf_lock: generated
---

# Files

* `calc-core.ts` — CalcBar, CalcEvaluator, CalcPlotValues, CalcSession, CommittedSeries
* `host.ts` — IngestHostClient, IngestWorkerFactory, IngestWorkerTransport, createLiveWsClient, ingestWorkerAvailable, setIngestWorkerFactory
* `hot-ring-writer.ts` — HotRingWriter, routeThroughRing
* `ingest-core.ts` — CursorBar, IngestCursorTable, IngestDecode, TipCoalescer, decodeInbound
* `ingest.worker.ts`
* `protocol.ts` — HostToIngest, INGEST_CONNECT_TIMEOUT_MS, INGEST_HEARTBEAT_MS, INGEST_PONG_TIMEOUT_MS, INGEST_TIP_COALESCE_MS, IngestToHost

# Depends on

* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/engine](/code/src/engine.md)
* [src/hp](/code/src/hp.md)
* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/hp/calc](/code/src/hp/calc.md)
* [src/hp/memory](/code/src/hp/memory.md)
* [src/store](/code/src/store.md)

# Used by

* [src/hp](/code/src/hp.md)
* [src/streams](/code/src/streams.md)
* [tests/hp](/code/tests/hp.md)
