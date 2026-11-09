---
type: "Code Module"
title: "worker/src"
description: "AXIS Cloudflare Worker entrypoint — JSON API + WebSocket relay for the charting PWA."
resource: "worker/src"
tags: [code, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-09T16:28:30Z
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
* `hash.ts` — partitionIdFromKey, sha256Hex
* `http.ts` — API_CORS, CorsOptions, DeepHealth, ErrorBody, ErrorResponseOptions, HSTS_VALUE, HandleErrorOptions, HealthFlags, JsonBuilder, JsonOptions, MARKET_CORS, MCP_CORS
* `index.ts` — Env, McpBridgeDO, SessionDO, pickOrigin
* `keys.ts` — handleKeys
* `live-metrics.ts` — LiveMetric, RelayClosedBy, RelayStats, emitLiveMetric, frameBytes
* `live-proxy.ts` — LIVE_TICKET_TTL_S, _resetLiveTicketsForTests, engineLiveWsUrl, handleLiveProxy, openUpstreamLiveWs, relayFrame, upstreamLiveFetchUrl
* `market.ts` — _resetMarketCacheForTests, handleMarket, marketAllowlist
* `onchain.ts` — LLAMA_PROTOCOLS_RATE_LIMIT, LLAMA_PROTOCOLS_RATE_WINDOW_MS, LLAMA_PROTOCOLS_RESPONSE_MAX_BYTES, LLAMA_PROTOCOLS_UPSTREAM_MAX_BYTES, ONCHAIN_IP_LIMIT, ONCHAIN_IP_WINDOW_MS, ONCHAIN_UPSTREAM_MAX_BYTES, _resetOnchainCacheForTests, handleOnchain, onchainAllowlist, slimLlamaProtocols
* `proxy-plane.ts` — CacheEntry, CacheEviction, ProxyPlane, ProxyPlaneOptions, createProxyPlane
* `proxy-router.ts` — NotFoundBody, ProxyContext, ProxyHandler, ProxyRoute, ProxyRouter, ProxyRouterOptions, createProxyRouter, proxyJson
* `pyodide_runtime.ts` — tryRunInWorker
* `rate-limit.ts` — _resetRateLimitsForTests, allowRate
* `routes.ts` — BRIDGE_ROUTE, MCP_ROUTE, ROUTES, RouteContext, RouteDef, RouteKind, RouteMatch, STREAM_ROUTE, healthBody, matchRoute, mcpRoutes, routeMatchesPath
* `runtime.ts` — _resetRunRateLimitForTests, handleRun
* `scripts.ts` — ScriptMeta, ScriptRow, ScriptVersionRow, _clearMemScripts, handleScripts
* `tenant.ts` — BILLING_UPGRADE_URL, FlushUsageOpts, QueueTenantUsageInput, TenantAllow, TenantDeny, TenantGate, TenantHttpError, TenantScope, TenantUsageEvent, TenantUsageUnits, USAGE_BATCH_MAX, USAGE_FLUSH_TIMEOUT_MS
* `version.ts` — WORKER_VERSION, normalizeGitSha, workerGitSha

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
