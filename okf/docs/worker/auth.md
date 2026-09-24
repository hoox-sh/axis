---
type: "Document"
title: "Worker auth"
description: "API keys (pn…), fail-closed D1 without KV, admin token, Bearer, ALLOWOPENKEYS, and /api/run gating."
resource: "docs/worker/auth.mdx"
tags: [auth, doc, docs, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/worker/auth.mdx"
    title: "docs/worker/auth.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/worker/auth.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * AuthContext
  * extractBearer
  * requireApiKey
  * Fail-closed with durable storage (2.0.1+)
  * MCP (POST /mcp)
  * /api/run auth gate
  * Admin keys API (/api/keys)
  * ALLOWOPENKEYS
* Internals
  * Key format
* Invariants & edge cases
* Worked examples
  * Create a key (admin)
  * Validate
* Failure modes
* See also

# Mentions

* [worker/src](/code/worker/src.md)
