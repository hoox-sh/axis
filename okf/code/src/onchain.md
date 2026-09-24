---
type: "Code Module"
title: "src/onchain"
description: "Public entry for the AXIS on-chain data plane (Phase 1–3 light)."
resource: "src/onchain"
tags: [code, onchain]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/onchain"
    title: "src/onchain"
    author: process:git
okf_lock: generated
---

# Files

* `adapters.ts` — LineDataPoint, datasetToBars, datasetToScalarPoints, normalizeProtocolSlug, pointsToLineData
* `alerts-bridge.ts` — EvaluateOnchainEventAlertsOpts, evaluateOnchainEventAlerts, notifyOnchainEventsLoaded, toOnchainEvalEvents
* `cache.ts` — ONCHAIN_CACHE_MAX_SERIES, OnchainCacheRecord, _clearOnchainMemoryCache, deleteCachedDataset, getCachedDataset, listCachedDatasetKeys, putCachedDataset
* `catalog.ts` — BUILTIN_DATASETS, DEFILLAMA_DATASET_ID, DEFILLAMA_PROVIDER_ID, _resetOnchainCatalogForTests, _resetOnchainDatasetRegistrationFlag, defillamaTvlDatasetPlugin, ensureOnchainDatasetsRegistered, getDataset, getDatasetPlugin, listDatasetPlugins, listDatasets, registerDynamicDataset
* `defillama.ts` — DEFILLAMA_DEFAULT_BASE, DEFILLAMA_PROVIDER_ID, DefiLlamaProtocolSummary, _clearDefiLlamaProtocolsCache, fetchDefiLlamaProtocolTvl, parseDefiLlamaTvlHistory, searchDefiLlamaProtocols
* `events.ts` — BuildTvlSpikeEventsOpts, DEFAULT_TVL_SPIKE_THRESHOLD_PCT, DEFILLAMA_RAISES_UNLOCKS_NOTE, EVENT_TYPE_TVL_DROP, EVENT_TYPE_TVL_SPIKE, TvlSpikeEventType, buildTvlSpikeEvents, normalizeEventPoints, sortEventPoints, tvlSpikeEventSourceLabel
* `export.ts` — ExportEvent, ExportSeries, downloadTextFile, eventsToCsv, seriesToCsv
* `geckoterminal.ts` — GECKOTERMINAL_DEFAULT_BASE, GECKOTERMINAL_PROVIDER_ID, GECKO_OHLCV_MAX_LIMIT, GeckoIntervalMap, GeckoPoolSearchHit, SearchGeckoPoolsOpts, fetchGeckoPoolOhlcv, mapAxisIntervalToGecko, mapAxisNetworkToGecko, parseGeckoOhlcvList, resolveGeckoBeforeTimestamp, searchGeckoPools
* `health.ts` — CheckOnchainProxyHealthOpts, ONCHAIN_HEALTH_PATH, OnchainProxyHealthResult, _resetOnchainHealthProbeState, checkOnchainProxyHealth, kickOnchainHealthProbe, refreshOnchainTelemetry
* `index.ts` — AttachDefiLlamaArg, AttachPopularTvlResult, BUILTIN_DATASETS, BuildTvlSpikeEventsOpts, CheckOnchainProxyHealthOpts, DEFAULT_ONCHAIN_WORKER_BASE, DEFAULT_TVL_SPIKE_THRESHOLD_PCT, DEFILLAMA_DATASET_ID, DEFILLAMA_DEFAULT_BASE, DEFILLAMA_PROVIDER_ID, DEFILLAMA_RAISES_UNLOCKS_NOTE, DEX_NETWORK_PRESETS
* `jobs.ts` — OnchainJob, OnchainJobStatus, _resetOnchainJobsForTests, _setAttachTvlForTests, cancelOnchainJob, dismissOnchainJob, listOnchainJobs, onchainJobsState, refreshAllAttachedTvl, refreshAttachment
* `keys.ts` — instrumentCacheKey, seriesSeriesKey
* `manager.ts` — AttachDefiLlamaArg, DefiLlamaProtocolHit, MAX_ONCHAIN_SERIES, OnchainJob, OnchainJobStatus, OnchainManagerState, OnchainSeriesRow, ProtocolSearchHit, _resetOnchainJobsForTests, _resetOnchainManagerState, _seedOnchainAttachmentsForTests, _setAttachTvlForTests
* `presets.ts` — AttachPopularTvlResult, DEX_NETWORK_PRESETS, POPULAR_TVL_PROTOCOLS, attachPopularTvl
* `proxy.ts` — DEFAULT_ONCHAIN_WORKER_BASE, ONCHAIN_GECKO_PROXY_PATH, ONCHAIN_LLAMA_PROXY_PATH, isWorkerGeckoProxy, isWorkerLlamaProxy, looksLikeOnchainWorkerEndpoint, normalizeEndpointBase, resolveDefiLlamaBaseUrl, resolveGeckoTerminalBaseUrl, resolveOnchainWorkerBase
* `types.ts` — DatasetFetchOpts, DatasetKind, EventPoint, Finality, OnchainDataset, OnchainInstrument, OnchainSeriesAttachment, TimePoint

# Packages

`solid-js/store`

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/data](/code/src/data.md)
* [src/plugins](/code/src/plugins.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)

# Used by

* [src/chart](/code/src/chart.md)
* [src/plugins](/code/src/plugins.md)
* [src/sources](/code/src/sources.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
