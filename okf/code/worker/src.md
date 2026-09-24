---
type: "Code Module"
title: "worker/src"
description: "AXIS Cloudflare Worker entrypoint — JSON API + WebSocket relay for the charting PWA."
resource: "worker/src"
tags: [code, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "worker/src"
    title: "worker/src"
    author: process:git
okf_lock: generated
---

# Files

* `auth.ts` — AuthContext, extractBearer, requireApiKey
* `git-oauth.ts` — GitOAuthEnv, GitOAuthProvider, handleGitOAuth
* `index.ts` — Env, McpBridgeDO, SessionDO, pickOrigin
* `keys.ts` — handleKeys
* `market.ts` — _resetMarketCacheForTests, handleMarket
* `onchain.ts` — _resetOnchainCacheForTests, handleOnchain
* `pyodide_runtime.ts` — tryRunInWorker
* `runtime.ts` — _resetRunRateLimitForTests, handleRun
* `scripts.ts` — ScriptMeta, ScriptRow, ScriptVersionRow, _clearMemScripts, handleScripts
* `version.ts` — WORKER_VERSION

# Depends on

* [worker/src/durable-objects](/code/worker/src/durable-objects.md)
* [worker/src/mcp](/code/worker/src/mcp.md)

# Used by

* [tests](/code/tests.md)
* [tests/security](/code/tests/security.md)
* [worker/src/durable-objects](/code/worker/src/durable-objects.md)
* [worker/src/mcp](/code/worker/src/mcp.md)
* [worker/tests](/code/worker/tests.md)

# Nested

* [worker/src/durable-objects](/code/worker/src/durable-objects.md)
* [worker/src/mcp](/code/worker/src/mcp.md)
