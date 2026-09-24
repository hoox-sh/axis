---
type: "Code Module"
title: "tests/security"
description: "Client security: untrusted plugin install, storage path isolation, no secret leakage."
resource: "tests/security"
tags: [code, security, tests]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "tests/security"
    title: "tests/security"
    author: process:git
okf_lock: generated
---

# Files

* `client-security.test.ts` — notAPlugin
* `worker-security.test.ts`

# Packages

`bun:test`, `node:path`, `node:url`

# Depends on

* [src/engines](/code/src/engines.md)
* [src/plugins](/code/src/plugins.md)
* [src/sources](/code/src/sources.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [worker/src](/code/worker/src.md)
