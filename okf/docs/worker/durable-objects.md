---
type: "Document"
title: "Durable Objects"
description: "SessionDO WebSocket relay: one Binance upstream per session, fan-out to browser clients."
resource: "docs/worker/durable-objects.mdx"
tags: [doc, docs, durable-objects, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/worker/durable-objects.mdx"
    title: "docs/worker/durable-objects.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/worker/durable-objects.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * Client → Worker
  * DO HTTP surface
  * Client → DO messages (JSON)
  * DO → client
  * Example plugin
* Internals
  * wrangler binding (often commented until ready)
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [src](/code/src.md)
* [worker/src](/code/worker/src.md)
* [worker/src/durable-objects](/code/worker/src/durable-objects.md)
* [worker/src/mcp](/code/worker/src/mcp.md)
