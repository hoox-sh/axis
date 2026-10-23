---
type: "Document"
title: "High-performance engine"
description: "The opt-in HP plane: rungs HP-0…HP-4, feature flags, isolation, AXB1 transport, SAB memory, the GPU paint rung, HUD chip, and fallback rules."
resource: "docs/architecture/hp-engine.mdx"
tags: [architecture, doc, docs, hp-engine]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-23T19:00:54Z
sources:
  - id: tree
    resource: "docs/architecture/hp-engine.mdx"
    title: "docs/architecture/hp-engine.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/hp-engine.mdx`.

# Outline

* Rungs
* Flags
* Isolation
* Transport: AXB1
* Memory: SAB double-buffer + IndexedDB cold
* Paint: LWC, then the GPU rung
* HUD chip
* MCP observability
* Invariants
* Status on engine/high-performance
* Tests

# Mentions

* [src/hp](/code/src/hp.md)
* [src/hp/paint](/code/src/hp/paint.md)
* [src/hp/render](/code/src/hp/render.md)
* [src/hp/workers](/code/src/hp/workers.md)
* [src/mcp](/code/src/mcp.md)
* [src/streams](/code/src/streams.md)
* [tests](/code/tests.md)
* [worker/src](/code/worker/src.md)
