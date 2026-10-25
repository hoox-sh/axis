---
type: "Code Module"
title: "src/hp/workers"
description: "src/hp/workers contains host.ts, ingest-core.ts, ingest.worker.ts, and 1 more file."
resource: "src/hp/workers"
tags: [code, hp, workers]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-25T21:44:50Z
sources:
  - id: tree
    resource: "src/hp/workers"
    title: "src/hp/workers"
    author: process:git
okf_lock: generated
---

# Files

* `host.ts` — IngestHostClient, IngestHostOptions, IngestWorkerFactory, IngestWorkerTransport, createLiveWsClient, ingestWorkerAvailable, setIngestWorkerAvailableForTests, setIngestWorkerFactory
* `ingest-core.ts` — CursorBar, IngestCursorTable, IngestDecode, TipCoalescer, decodeInbound, decodeInboundAsync
* `ingest.worker.ts`
* `protocol.ts` — HostToIngest, INGEST_CONNECT_TIMEOUT_MS, INGEST_HEARTBEAT_MS, INGEST_PONG_TIMEOUT_MS, INGEST_TIP_COALESCE_MS, IngestToHost

# Depends on

* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/engine](/code/src/engine.md)
* [src/engine/v1](/code/src/engine/v1.md)
* [src/hp/axb1](/code/src/hp/axb1.md)

# Used by

* [src/streams](/code/src/streams.md)
* [tests/engine](/code/tests/engine.md)
* [tests/hp](/code/tests/hp.md)
