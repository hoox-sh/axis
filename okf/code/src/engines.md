---
type: "Code Module"
title: "src/engines"
description: "src/engines contains batch.ts, catalog.ts, chart-data-session.ts, and 14 more files."
resource: "src/engines"
tags: [code, engines]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-21T20:55:05Z
sources:
  - id: tree
    resource: "src/engines"
    title: "src/engines"
    author: process:git
okf_lock: generated
---

# Files

* `batch.ts` — BatchEntry, BatchRunOptions, BatchRunOutcome, BatchRunResult, BatchScript, RUN_BATCH_MAX_SCRIPTS, runBatch, splitBatchScripts
* `catalog.ts` — BUILTIN_ENGINES, DEFAULT_ENGINE_CAPABILITIES, DEFAULT_PYNE_WORKER_ENDPOINT, EngineHealthProbe, LOCAL_PYODIDE_INDEX, LOCAL_PYODIDE_VERSION, _resetEngineRegistrationFlag, _resetPyodideEngineState, _setCachedEngineCapabilitiesForTests, _setCachedEngineHealthForTests, callPyodideRunScript, capabilitiesFromHealth
* `chart-data-session.ts` — _resetChartDataSessionForTests, ensureChartDataSession, getChartSessionInfo, releaseChartDataSession, tickChartDataSession
* `data-sessions.ts` — CanonicalSeriesKey, DATA_PROVIDE_CHUNK, DATA_SESSION_RETRY_COOLDOWN_MS, DataSeriesKey, DataSeriesStatus, DataSessionCreateInput, DataSessionCreateResult, DataSessionHandle, DataSessionMiss, DataSessionRunResult, EnsureDataSessionOptions, RunDataSessionOptions
* `engine-ws.ts` — EngineWsResult, EngineWsRunRequest, _resetEngineWsClients, endpointToRunWsUrl, getEngineWsClient, probeEngineWs
* `health.ts` — AdvertisedRunMode, CompileReadiness, DEFAULT_ENGINE_HEALTH, EngineCompileHealth, EngineFeatureHealth, EngineHealth, advertisedRunMode, compileReadiness, healthAdvertises, healthFromBody
* `json-sanitize.ts` — parseEngineJson, sanitizeNonFiniteJson
* `live-sessions.ts` — LiveSessionHit, LiveSessionKeyFields, LiveSessionModeFields, LiveSessionStatus, LiveSessionStatusResult, LiveSessionTickOpts, LiveSessionVia, SESSION_GROWTH_SLACK, SESSION_RETRY_COOLDOWN_MS, SESSION_STATUS_IDLE_RECONCILE_MS, SESSION_STATUS_MIN_INTERVAL_MS, _liveSessionStateForTests
* `ownership.ts` — isEngineOwnedLive
* `prewarm.ts` — MAX_PREWARM_SCRIPTS, PrewarmOptions, PrewarmResult, _resetPrewarmMemoForTests, collectAppliedScriptSources, prewarmAppliedScripts, prewarmEngine
* `pro.ts` — BacktestSummary, PREVIEW_MAX_BARS, PreviewOptions, PreviewResult, ProCallOptions, QuickBacktestResult, UsageResult, fetchUsage, renderChartPreview, renderIndicatorPreview, runQuickBacktest
* `result-mapper.ts` — MapEnginePayloadOptions, OverlayPolicy, ScriptTypePolicy, mapEnginePayload, normalizeOverlayFlag, payloadEngineTimes
* `runner.ts` — DeployHostedScriptInput, HostedJob, HostedJobCronState, HostedScript, RunnerCallOptions, RunnerResult, deployHostedScript, listHostedJobs, runHostedJobNow, runnerAvailable, setHostedJobEnabled
* `series-drive.ts` — SERIES_DRIVE_MIN_MS, SeriesDriveOptions, SeriesDriveResult, SeriesDriveTick, SeriesDriveTickFn, _resetSeriesDriveForTests, driveEngineSeries
* `series-freshness.ts` — ENGINE_SERIES_STALE_STEPS, engineWindowBehindChart, newestBarTime, seriesBehind, seriesBehindNow, stepsBehind
* `series-repair.ts` — ENGINE_STALE_LOG_MIN_MS, StaleEngineSeriesNotice, _resetEngineStaleNoticeForTests, engineSeriesStale, noteStaleEngineSeries
* `session-delta.ts` — SessionDeltaInfo, readDeltaInfo, resolveSessionPayload

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/data](/code/src/data.md)
* [src/engine](/code/src/engine.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/utils](/code/src/utils.md)
* [src/workers](/code/src/workers.md)

# Used by

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/engine](/code/src/engine.md)
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
* [tests/engine](/code/tests/engine.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
