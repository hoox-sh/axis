---
type: "Code Module"
title: "src/hp"
description: "High-performance chart engine (HP PR 1–3)."
resource: "src/hp"
tags: [code, hp]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T22:35:28Z
sources:
  - id: tree
    resource: "src/hp"
    title: "src/hp"
    author: process:git
okf_lock: generated
---

# Files

* `capabilities.ts` — HpRung, IsolationHost, IsolationProbe, SelectHpRungOpts, isolationProbe, rememberHpRung, selectHpRung
* `feature-flag.ts` — HP_DISABLED_KEY, HP_ENABLED_KEY, HP_GPU_KEY, HP_RUNG_SESSION_KEY, HP_SAB_KEY, HpGpuMode, HpSabMode, hpGpuMode, hpSabMode, isHpDisabled, isHpEnabled, resetHpFlags
* `index.ts`
* `isolation-headers.ts` — COEP_HEADER, COEP_VALUE, COOP_HEADER, COOP_VALUE, CORP_HEADER, CORP_VALUE, HP_ISOLATION_HEADERS, sourceHasIsolationHeaders

# Depends on

* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/hp/calc](/code/src/hp/calc.md)

# Used by

* [src/hp/workers](/code/src/hp/workers.md)
* [src/sw](/code/src/sw.md)
* [tests/hp](/code/tests/hp.md)

# Nested

* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/hp/calc](/code/src/hp/calc.md)
* [src/hp/workers](/code/src/hp/workers.md)
