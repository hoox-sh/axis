---
type: "Document"
title: "State namespaces"
description: "AXIS persistence keys, key migration, pluginsConfig, editor docs, library IDB, and URL hash state."
resource: "docs/architecture/state-namespaces.mdx"
tags: [architecture, doc, docs, state-namespaces]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/architecture/state-namespaces.mdx"
    title: "docs/architecture/state-namespaces.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/state-namespaces.mdx`.

# Outline

* Abstract
* Conceptual model
* App state key pynescript.axis.v1
  * Legacy migration
* pluginsConfig
* Editor document
* Local library IDB
* Cloud / git (remote namespaces)
* URL hash state (legacy helper)
* Invariants
* Failure modes
* Internals
* See also

# Mentions

* [src](/code/src.md)
* [src/plugins](/code/src/plugins.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
