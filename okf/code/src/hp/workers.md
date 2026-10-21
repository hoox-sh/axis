---
type: "Code Module"
title: "src/hp/workers"
description: "src/hp/workers contains host.ts, ingest-core.ts, ingest.worker.ts, and 1 more file."
resource: "src/hp/workers"
tags: [code, hp, workers]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T22:35:28Z
sources:
  - id: tree
    resource: "src/hp/workers"
    title: "src/hp/workers"
    author: process:git
okf_lock: generated
---

# Files

* `host.ts` — IngestHostClient, IngestWorkerFactory, IngestWorkerTransport, createLiveWsClient, ingestWorkerAvailable, setIngestWorkerFactory
* `ingest-core.ts` — CursorBar, IngestCursorTable, IngestDecode, TipCoalescer, decodeInbound
* `ingest.worker.ts`
* `protocol.ts` — HostToIngest, INGEST_CONNECT_TIMEOUT_MS, INGEST_HEARTBEAT_MS, INGEST_PONG_TIMEOUT_MS, INGEST_TIP_COALESCE_MS, IngestToHost

# Depends on

* [src/engine](/code/src/engine.md)
* [src/hp](/code/src/hp.md)
* [src/hp/axb1](/code/src/hp/axb1.md)

# Used by

* [src/streams](/code/src/streams.md)
* [tests/hp](/code/tests/hp.md)
