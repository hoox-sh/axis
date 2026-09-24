---
type: "Document"
title: "Worker runtime"
description: "POST /api/run — auth gate, rate limits, size caps, EXTERNALBACKEND proxy, feature-gated in-worker Pyodide."
resource: "docs/worker/runtime.mdx"
tags: [doc, docs, runtime, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/worker/runtime.mdx"
    title: "docs/worker/runtime.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/worker/runtime.mdx`.

# Outline

* Abstract
  * Auth & abuse controls (2.0.1+)
* Conceptual model
* Interface surface
  * Request body
  * Success / upstream
  * Error codes (Worker-originated)
  * Usage metering
* Internals
  * pyodideruntime scaffold
  * Constraints (from RUNTIME.md)
  * Roll-out flag
* Invariants & edge cases
* Worked examples
  * Local proxy to Flask
  * Force 503 for missing backend
* Failure modes
* See also

# Mentions

* [worker/src](/code/worker/src.md)
