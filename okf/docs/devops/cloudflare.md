---
type: "Document"
title: "Cloudflare deployment"
description: "Pages + Worker for AXIS: Pages axis.hoox.sh (project axis), Worker worker.axis.hoox.sh, CLI deploy, bindings, security checklist."
resource: "docs/devops/cloudflare.mdx"
tags: [cloudflare, devops, doc, docs]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/devops/cloudflare.mdx"
    title: "docs/devops/cloudflare.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/devops/cloudflare.mdx`.

# Outline

* Abstract
* Conceptual model
* Deploy procedure
  * 1. Provision bindings (once)
  * 2. Configure secrets / vars
  * 3. Deploy Worker
  * 4. Build & deploy Pages
  * 5. Point the PWA
* Internals
  * Health check
* Invariants & edge cases
* Failure modes
* See also
