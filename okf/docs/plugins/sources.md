---
type: "Document"
title: "Sources"
description: "Built-in historical data sources: venue REST, mock walk, CSV upload — contracts, config, and fallbacks."
resource: "docs/plugins/sources.mdx"
tags: [doc, docs, plugins, sources]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/sources.mdx"
    title: "docs/plugins/sources.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/sources.mdx`.

# Outline

* Abstract
* Conceptual model
* Built-in catalog
* Interface surface
  * One-shot Load vs Data Source Manager
  * Config highlights
* Internals
  * Interval → venue codes
  * Dynamic registration
* Invariants & edge cases
* Worked example
* Failure modes
* See also

# Mentions

* [src/data](/code/src/data.md)
* [src/sources](/code/src/sources.md)
