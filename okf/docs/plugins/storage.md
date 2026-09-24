---
type: "Document"
title: "Storage"
description: "Script library backends: local (IndexedDB), cloud (Worker /api/scripts), and git (GitHub/GitLab)."
resource: "docs/plugins/storage.mdx"
tags: [doc, docs, plugins, storage]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/storage.mdx"
    title: "docs/plugins/storage.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/storage.mdx`.

# Outline

* Abstract
* Conceptual model
* Built-in plugins
  * local (src/storage/local.ts)
  * cloud (src/storage/cloud.ts)
  * git (src/storage/git.ts)
* Interface surface
  * service.ts API (UI-facing)
  * Catalog helpers
* Internals
  * D1 schema (cloud)
* Invariants & edge cases
* Worked examples
  * Export / import
  * Point cloud at local Worker
* Failure modes
* See also

# Mentions

* [src/storage](/code/src/storage.md)
* [tests](/code/tests.md)
* [worker/src](/code/worker/src.md)
