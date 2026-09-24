---
type: "Document"
title: "CORS and origins"
description: "Worker pickOrigin: local-dev, product hosts, project-scoped Pages previews, ALLOWEDORIGIN list, Flask constraints."
resource: "docs/devops/cors-and-origins.mdx"
tags: [cors-and-origins, devops, doc, docs]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/devops/cors-and-origins.mdx"
    title: "docs/devops/cors-and-origins.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/devops/cors-and-origins.mdx`.

# Outline

* Abstract
* Conceptual model
* Worker behavior
  * 1. Local-dev (always echoed)
  * 2. Product hosts (2.0.1+)
  * 3. Project-scoped Cloudflare® Pages (not open .pages.dev)
  * 4. ALLOWEDORIGIN allowlist
  * Production implication
* Flask / server engine
* Venue sources/streams
* Dynamic plugins
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [src/data](/code/src/data.md)
* [worker/src](/code/worker/src.md)
