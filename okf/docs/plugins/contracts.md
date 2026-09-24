---
type: "Document"
title: "Plugin contracts"
description: "Formal TypeScript interfaces for AXIS source, stream, engine, storage, and component plugins (pynescript.axis.plugins.v1)."
resource: "docs/plugins/contracts.mdx"
tags: [contracts, doc, docs, plugins]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/contracts.mdx"
    title: "docs/plugins/contracts.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/contracts.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * PluginKind
  * PluginBase
  * ConfigSchema / FieldSchema
  * PluginContext
  * pluginKey
* SourcePlugin
* StreamPlugin
* EnginePlugin
* StoragePlugin
* ComponentPlugin (reserved)
* Capabilities
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [src/plugins](/code/src/plugins.md)
