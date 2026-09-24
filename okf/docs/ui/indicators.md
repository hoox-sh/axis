---
type: "Document"
title: "Scripts (indicators & strategies)"
description: "AXIS applied-scripts UI: runAndApply pipeline, Scripts panel, overlay routing, and engine binding."
resource: "docs/ui/indicators.mdx"
tags: [doc, docs, indicators, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/ui/indicators.mdx"
    title: "docs/ui/indicators.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/ui/indicators.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * runScript options
  * runAndApply options
  * Overlay routing
  * Persist + reopen
  * Series selection
  * Indicator panel & pane badges
* Active engine binding
* Live re-run coupling
* Internals
* Invariants
* Failure modes
* See also

# Mentions

* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/results](/code/src/results.md)
