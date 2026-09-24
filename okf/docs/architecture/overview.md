---
type: "Document"
title: "Architecture overview"
description: "End-to-end AXIS architecture: Solid AXIS UI, unified registry, three built-in engines, chart apply pipeline, and optional edge plane."
resource: "docs/architecture/overview.mdx"
tags: [architecture, doc, docs, overview]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/architecture/overview.mdx"
    title: "docs/architecture/overview.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/overview.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface (module map)
* Control plane vs data plane
  * Transport preference (ADR-014)
* Built-in engines
* Chart apply pipeline
* Plugin registry
* Edge plane (optional)
* Invariants
* Failure modes (architectural)
* See also

# Mentions

* [src](/code/src.md)
