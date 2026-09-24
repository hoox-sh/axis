---
type: "Document"
title: "Streams"
description: "Live bar plugins: venue WebSockets, mock poll, and Cloudflare Durable Object relay example."
resource: "docs/plugins/streams.mdx"
tags: [doc, docs, plugins, streams]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/streams.mdx"
    title: "docs/plugins/streams.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/streams.mdx`.

# Outline

* Abstract
* Conceptual model
* Built-in catalog
* Interface surface
* Internals
  * Binance kline mapping
  * mock-poll behavior
  * Cloudflare DO stream (example plugin)
* Reconnect & status honesty
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [src/streams](/code/src/streams.md)
* [worker/src/durable-objects](/code/worker/src/durable-objects.md)
