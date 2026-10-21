---
type: "Code Module"
title: "worker/src"
description: "AXIS Cloudflare Worker entrypoint — JSON API + WebSocket relay for the charting PWA."
resource: "worker/src"
tags: [code, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T17:20:00Z
sources:
  - id: tree
    resource: "worker/src"
    title: "worker/src"
    author: process:git
okf_lock: generated
---

# Files

* `artifacts-git.ts` — ArtifactsCommitMeta, ArtifactsCreatedRepo, ArtifactsNamespace, ArtifactsRepoHandle, ArtifactsRepoInfo, ArtifactsTokenResult, CLONE_TOKEN_DEFAULT_TTL, CLONE_TOKEN_MAX_TTL, CLONE_TOKEN_MIN_TTL, CloneCredential, GitScriptVersion, GitTreePusher
* `auth.ts` — AuthContext, BearerClassification, BearerKind, classifyBearer, classifyBearerToken, extractBearer, requireApiKey
* `git-memfs.ts` — MemoryFS
* `git-oauth.ts` — GitOAuthEnv, GitOAuthProvider, handleGitOAuth
* `http.ts` — API_CORS, CorsOptions, DeepHealth, ErrorBody, ErrorResponseOptions, HandleErrorOptions, HealthFlags, JsonOptions, MARKET_CORS, MCP_CORS, ORIGIN_ONLY, READ_CORS
* `index.ts` — Env, McpBridgeDO, SessionDO, pickOrigin
* `keys.ts` — handleKeys
* `live-proxy.ts` — LIVE_TICKET_TTL_S, _resetLiveTicketsForTests, engineLiveWsUrl, handleLiveProxy
* `market.ts` — _resetMarketCacheForTests, handleMarket, marketAllowlist
* `onchain.ts` — _resetOnchainCacheForTests, handleOnchain, onchainAllowlist
* `proxy-router.ts` — NotFoundBody, ProxyContext, ProxyHandler, ProxyRoute, ProxyRouter, ProxyRouterOptions, createProxyRouter, proxyJson
* `pyodide_runtime.ts` — tryRunInWorker
* `rate-limit.ts` — _resetRateLimitsForTests, allowRate
* `runtime.ts` — _resetRunRateLimitForTests, handleRun
* `scripts.ts` — ScriptMeta, ScriptRow, ScriptVersionRow, _clearMemScripts, handleScripts
* `tenant.ts` — BILLING_UPGRADE_URL, FlushUsageOpts, QueueTenantUsageInput, TenantAllow, TenantDeny, TenantGate, TenantHttpError, TenantScope, TenantUsageEvent, TenantUsageUnits, USAGE_BATCH_MAX, USAGE_FLUSH_TIMEOUT_MS
* `version.ts` — WORKER_VERSION

# Packages

`isomorphic-git`, `isomorphic-git/http/web`

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
