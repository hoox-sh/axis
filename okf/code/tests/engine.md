---
type: "Code Module"
title: "tests/engine"
description: "Calculator-profile parity (F-26): engines without livestream resolve to the bars-in path, with or without /health."
resource: "tests/engine"
tags: [code, engine, tests]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-25T18:32:15Z
sources:
  - id: tree
    resource: "tests/engine"
    title: "tests/engine"
    author: process:git
okf_lock: generated
---

# Files

* `apply-bridge.test.ts`
* `apply-extras.test.ts`
* `calculator-profile.test.ts`
* `capability-gating.test.ts`
* `client-apply.test.ts`
* `feature-flag.test.ts`
* `feed-status.test.ts`
* `frames-contract.test.ts`
* `frames.test.ts`
* `live-wire.test.ts`
* `market-identity.test.ts`
* `policy.test.ts`
* `rest-fallback.test.ts`
* `session-broker.test.ts`
* `session-multiplexer.test.ts`
* `subscribe-history.test.ts`
* `v1-apply-transaction.test.ts`
* `v1-metrics.test.ts`
* `v1-transport.test.ts`
* `verify-strength.test.ts`
* `ws-client.test.ts`
* `ws-send.test.ts`

# Packages

`bun:test`

# Depends on

* [src/engine](/code/src/engine.md)
* [src/engine/v1](/code/src/engine/v1.md)
* [src/engines](/code/src/engines.md)
* [src/hp/workers](/code/src/hp/workers.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
