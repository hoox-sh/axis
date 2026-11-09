---
type: "Code Module"
title: "src/hp"
description: "What remains of the old HP tree: the AXB1 codec and the Pine execution context."
resource: "src/hp"
tags: [code, hp]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-09T05:20:23Z
sources:
  - id: tree
    resource: "src/hp"
    title: "src/hp"
    author: process:git
okf_lock: generated
---

# Files

* `index.ts`
* `isolation-headers.ts` — COEP_HEADER, COEP_VALUE, COOP_HEADER, COOP_VALUE, CORP_HEADER, CORP_VALUE, HP_ISOLATION_HEADERS, sourceHasIsolationHeaders
* `security-headers.ts` — ASSET_CACHE_CONTROL, CSP_CONNECT_SRC, CSP_CONNECT_SRC_HOSTS, CSP_VALUE, HSTS_VALUE, HTML_CACHE_CONTROL, PAGES_CSP_VALUE, PAGES_SCRIPT_NONCE, PERMISSIONS_POLICY, connectSrcIsAllowlisted

# Depends on

* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/hp/calc](/code/src/hp/calc.md)

# Used by

* [src/sw](/code/src/sw.md)
* [tests/hp](/code/tests/hp.md)

# Nested

* [src/hp/axb1](/code/src/hp/axb1.md)
* [src/hp/calc](/code/src/hp/calc.md)
* [src/hp/workers](/code/src/hp/workers.md)
