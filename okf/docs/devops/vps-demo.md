---
type: "Document"
title: "VPS demo topology"
description: "Single-box demo: static AXIS dist + Flask Pro API (+ optional reverse proxy) without Cloudflare."
resource: "docs/devops/vps-demo.mdx"
tags: [devops, doc, docs, vps-demo]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/devops/vps-demo.mdx"
    title: "docs/devops/vps-demo.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/devops/vps-demo.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * Processes
  * Same-origin proxy sketch (Caddy)
  * Production (split: Pages PWA + Hetzner API)
  * Hardened network (UFW) + health checks
  * Minimal without TLS
* Internals
* Worked example — systemd sketch
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [scripts](/code/scripts.md)
