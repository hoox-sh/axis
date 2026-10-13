---
type: "Code Module"
title: "src/engines"
description: "src/engines contains catalog.ts, chart-data-session.ts, data-sessions.ts, and 4 more files."
resource: "src/engines"
tags: [code, engines]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-13T20:51:45Z
sources:
  - id: tree
    resource: "src/engines"
    title: "src/engines"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — BUILTIN_ENGINES, DEFAULT_ENGINE_CAPABILITIES, DEFAULT_PYNE_WORKER_ENDPOINT, LOCAL_PYODIDE_INDEX, LOCAL_PYODIDE_VERSION, _resetEngineRegistrationFlag, _resetPyodideEngineState, _setCachedEngineCapabilitiesForTests, callPyodideRunScript, capabilitiesFromHealth, confirmEngineApiKeyTarget, ensureEnginesRegistered
* `chart-data-session.ts` — _resetChartDataSessionForTests, ensureChartDataSession, releaseChartDataSession, tickChartDataSession
* `data-sessions.ts` — CanonicalSeriesKey, DATA_PROVIDE_CHUNK, DataSeriesKey, DataSeriesStatus, DataSessionCreateInput, DataSessionCreateResult, DataSessionHandle, DataSessionMiss, DataSessionRunResult, EnsureDataSessionOptions, RunDataSessionOptions, _resetDataSessionMemo
* `engine-ws.ts` — EngineWsResult, EngineWsRunRequest, _resetEngineWsClients, endpointToRunWsUrl, getEngineWsClient, probeEngineWs
* `json-sanitize.ts` — parseEngineJson, sanitizeNonFiniteJson
* `live-sessions.ts` — LiveSessionHit, LiveSessionKeyFields, LiveSessionModeFields, LiveSessionTickOpts, LiveSessionVia, SESSION_GROWTH_SLACK, SESSION_RETRY_COOLDOWN_MS, _liveSessionStateForTests, _resetLiveSessionsForTests, noteRunMode, releaseLiveSessions, runModeAllowsSessions
* `ownership.ts` — isEngineOwnedLive

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/data](/code/src/data.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/workers](/code/src/workers.md)

# Used by

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/optimize](/code/src/optimize.md)
* [src/plugins](/code/src/plugins.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [src/ui/workers](/code/src/ui/workers.md)
* [src/workers](/code/src/workers.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
