---
type: "Code Module"
title: "src/data"
description: "Background Data Source Manager — multi-page OHLCV backfill to a past date."
resource: "src/data"
tags: [code, data]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:08:48Z
sources:
  - id: tree
    resource: "src/data"
    title: "src/data"
    author: process:git
okf_lock: generated
---

# Files

* `bars-cache.ts` — BARS_CACHE_MAX, BARS_CACHE_MAX_SERIES, BarLoadWindow, BarsCacheMeta, BarsCacheRecord, _resetBarsCacheForTests, barsCacheKey, clearCachedBars, countBarsForLoad, flushPendingIdbPuts, getCachedBarCount, getCachedBars
* `bars-gaps.ts` — BarGap, CoverageReport, CoverageSegment, alignDown, buildCoverageMap, findBarGaps, intervalToSec, mergeGaps, validateBarCoverage
* `binance-http.ts` — BINANCE_REST_HOSTS, BinanceFetchOpts, BinanceRestPath, DEFAULT_MARKET_WORKER_BASE, binanceKlineWsUrls, binanceTickerWsUrls, fetchBinanceJson, resolveMarketWorkerBase
* `ccxt-session.ts` — bindCcxtSession, unbindCcxtSession
* `credentials.ts` — CREDENTIALS_MEMORY_ONLY, CredentialMeta, ExchangeCredential, activeCcxtExchange, activeCcxtGateway, ccxtCredentialId, clearCredentials, deleteCredential, getCcxtCredential, getCredential, getCredentialForVenue, hasCcxtCredential
* `data-manager-source.ts` — DATA_MANAGER_SOURCE_ID, DataManagerSelection, ResolvedCacheSeries, clearDataManagerSelection, dataManagerCacheKey, dataManagerLabel, getDataManagerSelection, resolveDataManagerBars, setDataManagerSelection
* `data-source-manager.ts` — DataSourceJob, DataSourceJobPhase, DataSourceJobStatus, StartBackfillOpts, _resetDataSourceManagerForTests, _waitForJob, applyCachedToChart, applyJobToChart, cancelBackfill, dataSourceManagerState, dateInputToEndSec, defaultPastDateInput
* `dataset-sinks.ts` — DatasetSink, PERSISTENCE_MODES, PersistenceMode, SinkErrorListener, _resetDatasetSinksForTests, datasetKey, localSink, onSinkError, remoteSink, sessionSink, sinkForMode
* `dataset-store.ts` — DatasetMeta, PutResult, _resetDatasetStoreForTests, getDataset, getMergePolicy, getPersistenceMode, keyFor, listMemoryDatasets, peekDataset, putDatasetBars, removeDataset, replaceDataset
* `dataset-validate.ts` — ClassifyOpts, DatasetReport, GapClassification, RepairResult, RepairStats, ValidateOpts, VenueClass, classifyGaps, findClassifiedGaps, repairBars, validateDataset, venueClassForSourceCaps
* `dsm-orchestrator.ts` — DatasetFirstResult, _resetDsmOrchestratorForTests, announceDatasetPaint, ensureDatasetComplete, paintDataset, seedDatasetFromBars
* `expand-cache.ts` — ExpandCacheResult, _flushDataManagerLiveBarForTests, canExpandFromSource, expandCachedSeriesToNow, noteDataManagerLiveBar
* `gateway.ts` — DATAFEED_DEFAULT_PORT, GatewayMode, GatewaySessionBody, gatewayBase, gatewayDeleteSession, gatewayFetch, gatewayPutSession, gatewayWs, isRemotePageOrigin, probeSidecar
* `load-symbol.ts` — _currentLoadGeneration, _resetLoadGeneration, exchangeForSource, loadSymbolData, normalizeLoadSymbol, reloadChart
* `market-worker.ts` — DEFAULT_MARKET_WORKER_BASE, resolveMarketWorkerBase
* `merge-datasets.ts` — BarConflict, DEFAULT_CONFLICT_TOLERANCE, MergePolicy, MergeResult, barsConflict, mergeWithConflictPolicy
* `mexc-http.ts` — DEFAULT_MARKET_WORKER_BASE, MEXC_REST_HOSTS, MexcFetchOpts, MexcRestPath, fetchMexcJson, resolveMarketWorkerBase
* `parse-bars.ts` — barTimeToPineMs, barsForPine, normalizeBarTime, normalizeHistoricalBars, parseOhlcvFile, parseOhlcvText, sanitizeBar
* `provider.ts` — DEFAULT_PROVIDER, ProviderAuthMode, ProviderGateway, ProviderMarket, ProviderSession, ProviderVenue, buildProviderSession, defaultStreamForSource, formatProviderLabel, hydrateProviderSession, isSourceStreamPaired, persistProviderSession
* `signed-fetch.ts` — SignedFetchOpts, fetchSignedJson, hasSignedCreds
* `symbol-catalog.ts` — FALLBACK_MAJORS, SymbolCatalogResult, SymbolEntry, SymbolVenue, compactPair, filterSymbols, listQuotes, loadSymbolCatalog, resolveSymbolVenue, venueLabel
* `venue-picker.ts` — NATIVE_VENUE_SOURCES, OTHER_VENUE_SOURCES, PINNED_CCXT, VenueGroup, VenueOption, applyVenueToken, exchangeIdFromToken, isCcxtVenueToken, listVenueOptions, parseVenueToken, prettyCcxtLabel, venueTokenFromState
* `watchlist-live.ts` — QuoteMuxHandle, QuoteMuxStatus, QuoteUpdate, StartWatchlistQuotesOpts, parseBinanceTickerMessage, startWatchlistQuotes
* `watchlist-tickers.ts` — WATCHLIST_INTERVALS, WATCHLIST_REFRESH_OPTIONS, WatchTicker, coinbaseProduct, fetchWatchlistTickers, okxInst, sourceSupportsRestPoll, toUsdt
* `worker-origin.ts` — DEFAULT_AXIS_WORKER_BASE, looksLikeOnchainWorkerEndpoint, normalizeEndpointBase

# Packages

`solid-js/store`

# Depends on

* [src/chart](/code/src/chart.md)
* [src/data/venues](/code/src/data/venues.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/sources](/code/src/sources.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/engines](/code/src/engines.md)
* [src/mcp](/code/src/mcp.md)
* [src/onchain](/code/src/onchain.md)
* [src/plugins](/code/src/plugins.md)
* [src/sources](/code/src/sources.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/dsm](/code/src/ui/dsm.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [src/workers](/code/src/workers.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)

# Nested

* [src/data/venues](/code/src/data/venues.md)
