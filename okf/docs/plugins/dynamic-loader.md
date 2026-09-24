---
type: "Document"
title: "Dynamic plugin loader"
description: "Install ES-module plugins from URL (source, stream, engine, dataset, component), persist, restore, safety rules."
resource: "docs/plugins/dynamic-loader.mdx"
tags: [doc, docs, dynamic-loader, plugins]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/dynamic-loader.mdx"
    title: "docs/plugins/dynamic-loader.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/dynamic-loader.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * InstalledPlugin
  * Module export shapes accepted
* Internals
  * URL normalization
  * Safety
  * Dedup on install
  * Unregister
  * Bootstrap coupling
* Manager UX (product)
* Invariants & edge cases
* Worked example
* Failure modes
* See also

# Mentions

* [src/plugins](/code/src/plugins.md)
