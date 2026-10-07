---
type: "Code Module"
title: "worker/src"
description: "AXIS Cloudflare Worker entrypoint — JSON API + WebSocket relay for the charting PWA."
resource: "worker/src"
tags: [code, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-07T03:59:37Z
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
* `http.ts` — API_CORS, CorsOptions, ErrorBody, ErrorResponseOptions, JsonOptions, MARKET_CORS, MCP_CORS, ORIGIN_ONLY, READ_CORS, SCRIPTS_CORS, WRITE_CORS, clientIp
* `index.ts` — Env, McpBridgeDO, SessionDO, pickOrigin
* `keys.ts` — handleKeys
* `market.ts` — _resetMarketCacheForTests, handleMarket, marketAllowlist
* `onchain.ts` — _resetOnchainCacheForTests, handleOnchain, onchainAllowlist
* `proxy-router.ts` — NotFoundBody, ProxyContext, ProxyHandler, ProxyRoute, ProxyRouter, ProxyRouterOptions, createProxyRouter, proxyJson
* `pyodide_runtime.ts` — tryRunInWorker
* `rate-limit.ts` — _resetRateLimitsForTests, allowRate
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
