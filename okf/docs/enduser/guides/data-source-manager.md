---
type: "Document"
title: "Data Source Manager"
description: "Background multi-page OHLCV backfill to a past date, dataset validation, and gap fills — without blocking the chart."
resource: "docs/enduser/guides/data-source-manager.mdx"
tags: [doc, docs, enduser, guides]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-10T12:15:43Z
sources:
  - id: tree
    resource: "docs/enduser/guides/data-source-manager.mdx"
    title: "docs/enduser/guides/data-source-manager.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/enduser/guides/data-source-manager.mdx`.

# Outline

* Abstract
* Conceptual model
* How to use
  * Deleting datasets
* Phases
* Job fields (UI)
* Relation to Reload chart
* Internals
  * bars-cache performance (2.0.1+)
* Limits & safety
* See also

# Mentions

* [src/data](/code/src/data.md)
* [src/plugins](/code/src/plugins.md)
* [src/sources](/code/src/sources.md)
* [src/ui](/code/src/ui.md)
