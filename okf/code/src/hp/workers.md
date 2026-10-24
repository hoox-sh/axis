---
type: "Code Module"
title: "src/hp/workers"
description: "src/hp/workers contains calc-core.ts, calc-engine.ts, calc-protocol.ts, and 6 more files."
resource: "src/hp/workers"
tags: [code, hp, workers]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-24T01:24:00Z
sources:
  - id: tree
    resource: "src/hp/workers"
    title: "src/hp/workers"
    author: process:git
okf_lock: generated
---

# Files

* `calc-core.ts` — CalcBar, CalcEvaluator, CalcPlotValues, CalcSession, CommittedSeries
* `calc-engine.ts` — CalcEngine, FrameValuesEvaluator
* `calc-protocol.ts` — CalcToHost, HostToCalc, TimedValues
* `calc.worker.ts`
* `host.ts` — IngestHostClient, IngestHostOptions, IngestWorkerFactory, IngestWorkerTransport, createLiveWsClient, ingestWorkerAvailable, setIngestWorkerFactory
* `hot-ring-writer.ts` — HotRingWriter, routeThroughRing
* `ingest-core.ts` — CursorBar, IngestCursorTable, IngestDecode, TipCoalescer, decodeInbound
* `ingest.worker.ts`
* `protocol.ts` — ColdKey, HostToIngest, INGEST_CONNECT_TIMEOUT_MS, INGEST_HEARTBEAT_MS, INGEST_PONG_TIMEOUT_MS, INGEST_TIP_COALESCE_MS, IngestToHost

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
