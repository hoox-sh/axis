---
type: "Document"
title: "Plugin registry"
description: "PluginRegistry singleton: ordered maps per kind, listeners, built-in protection, and bootstrap wiring."
resource: "docs/plugins/registry.mdx"
tags: [doc, docs, plugins, registry]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/registry.mdx"
    title: "docs/plugins/registry.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/registry.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * Singleton
  * Per-kind API (pattern)
  * Bulk
  * Order preservation
  * Built-in protection
* Internals (repo paths)
  * Bootstrap
  * Active resolution defaults
  * Engine endpoint surface
* Invariants & edge cases
* Worked examples
  * Register a test source
  * Listen for dynamic installs
* Failure modes
* See also

# Mentions

* [src/plugins](/code/src/plugins.md)
