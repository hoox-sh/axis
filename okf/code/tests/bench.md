---
type: "Code Module"
title: "tests/bench"
description: "Optional bench: the dataset write path on a deep series."
resource: "tests/bench"
tags: [bench, code, tests]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-19T23:38:00Z
sources:
  - id: tree
    resource: "tests/bench"
    title: "tests/bench"
    author: process:git
okf_lock: generated
---

# Files

* `append-bar-firehose.bench.test.ts`
* `dataset-write.bench.test.ts`
* `fixtures-scale.ts` — BENCH_HISTORY_BARS, BENCH_TICK_COUNT, makeScaleBars, nextFirehoseBar
* `metrics.ts` — BenchSample, FIREHOSE_SOFT_BUDGET_MS, formatSample, measureOps, nowMs

# Packages

`bun:test`

# Depends on

* [src/data](/code/src/data.md)
* [src/store](/code/src/store.md)
