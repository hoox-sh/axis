---
type: "Code Module"
title: "tests/hp"
description: "AXB1 randomized round-trip fuzz (hp2 E1)."
resource: "tests/hp"
tags: [code, hp, tests]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-25T18:32:15Z
sources:
  - id: tree
    resource: "tests/hp"
    title: "tests/hp"
    author: process:git
okf_lock: generated
---

# Files

* `axb1-codec.test.ts`
* `axb1-fuzz.test.ts`
* `execution-context.test.ts`
* `ingest-core.test.ts`
* `ingest-host.test.ts`
* `isolation-headers.test.ts`
* `ticks-precision.test.ts`

# Other files

* `axb1-vectors.json`

# Packages

`bun:test`, `node:fs`, `node:path`

# Depends on

* [src/engine](/code/src/engine.md)
* [src/engine/v1](/code/src/engine/v1.md)
* [src/hp](/code/src/hp.md)
* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/hp/calc](/code/src/hp/calc.md)
* [src/hp/workers](/code/src/hp/workers.md)
* [src/sw](/code/src/sw.md)
