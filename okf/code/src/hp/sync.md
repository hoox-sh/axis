---
type: "Code Module"
title: "src/hp/sync"
description: "src/hp/sync contains atomics.ts, is-main-thread.ts, raf-poll.ts."
resource: "src/hp/sync"
tags: [code, hp, sync]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T23:35:56Z
sources:
  - id: tree
    resource: "src/hp/sync"
    title: "src/hp/sync"
    author: process:git
okf_lock: generated
---

# Files

* `atomics.ts` — WaitResult, loadGen, notify, storeGen, waitInWorker
* `is-main-thread.ts` — isMainThread
* `raf-poll.ts` — CancelRafFn, RafFn, SubscribeGenerationOpts, subscribeGeneration

# Depends on

* [src/hp/memory](/code/src/hp/memory.md)

# Used by

* [src/hp](/code/src/hp.md)
* [tests/hp](/code/tests/hp.md)
