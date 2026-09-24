---
type: "Document"
title: "Evaluation map"
description: "How AXIS runs Pine: Flask Pro API, Worker proxy, in-browser Pyodide. AXIS does not import PyneTS and does not place HOOX orders."
resource: "docs/architecture/evaluation.mdx"
tags: [architecture, doc, docs, evaluation]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/architecture/evaluation.mdx"
    title: "docs/architecture/evaluation.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/evaluation.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
* Internals
* Invariants & edge cases
* Worked examples
  * Local desk
  * Offline
  * Edge proxy
  * Pyodide in Worker (scaffold — not production yet)
* Failure modes
* See also

# Mentions

* [scripts](/code/scripts.md)
* [src/engines](/code/src/engines.md)
* [src/streams](/code/src/streams.md)
* [src/workers](/code/src/workers.md)
* [worker/src](/code/worker/src.md)
