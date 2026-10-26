---
type: "Document"
title: "Local development"
description: "Day-to-day AXIS loop: Vite, Flask, Worker wrangler, endpoints, and plugin examples."
resource: "docs/devops/local-dev.mdx"
tags: [devops, doc, docs, local-dev]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-26T00:24:45Z
sources:
  - id: tree
    resource: "docs/devops/local-dev.mdx"
    title: "docs/devops/local-dev.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/devops/local-dev.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface — commands
  * Bootstrap (CLI-first)
  * Frontend (preferred product path)
  * Desktop (optional Tauri shell)
  * Flask Pro API (engine backend)
  * Worker
  * AXIS CLI
  * Makefile helpers
  * Storybook (component lab)
* Debug mode (chart + engine)
* Internals — useful paths
* Worked loop
  * Load an example plugin
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [src](/code/src.md)
* [src/engines](/code/src/engines.md)
