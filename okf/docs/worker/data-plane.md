---
type: "Document"
title: "Worker data plane"
description: "Script library API: /api/scripts, D1 schema, drafts, revisions, and in-memory fallback."
resource: "docs/worker/data-plane.mdx"
tags: [data-plane, doc, docs, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/worker/data-plane.mdx"
    title: "docs/worker/data-plane.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/worker/data-plane.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * Document fields
  * Concurrency
* Internals
  * D1 schema (schemas/scripts.sql)
  * Partitioning
  * Health feature flags
  * Optional R2
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [scripts](/code/scripts.md)
* [worker/src](/code/worker/src.md)
