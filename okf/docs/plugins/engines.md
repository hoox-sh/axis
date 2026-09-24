---
type: "Document"
title: "Engines"
description: "Calculation engines: server (Flask/Worker) and client Pyodide — run contracts, assets, and readiness."
resource: "docs/plugins/engines.mdx"
tags: [doc, docs, engines, plugins]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/engines.mdx"
    title: "docs/plugins/engines.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/engines.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * server engine
  * pyne-worker engine
  * pyodide engine
* Internals
* Invariants & edge cases
* Worked examples
  * Desk research (Flask)
  * Offline lab
  * Tiny non-Python engine
* Failure modes
* See also

# Mentions

* [scripts](/code/scripts.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [worker/src](/code/worker/src.md)
