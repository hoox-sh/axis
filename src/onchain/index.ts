// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public entry for the AXIS **on-chain data plane** (Phase 1–3 light).
 *
 * Types, keys, adapters, IDB cache, DefiLlama TVL, GeckoTerminal DEX OHLCV,
 * synthetic TVL-spike events, dataset catalog, and attach-manager store.
 * Chart / UI wiring is intentionally out of scope for this module surface.
 *
 * @module onchain
 */

// Types
export type {
  DatasetKind,
  Finality,
  OnchainInstrument,
  TimePoint,
  EventPoint,
  OnchainDataset,
  DatasetFetchOpts,
  OnchainSeriesAttachment,
} from './types';
export type { DatasetPlugin } from '../plugins/types';

// Keys
export { instrumentCacheKey, seriesSeriesKey } from './keys';

// Adapters
export {
  pointsToLineData,
  datasetToScalarPoints,
  datasetToBars,
  normalizeProtocolSlug,
} from './adapters';
export type { LineDataPoint } from './adapters';

// Cache
export {
  ONCHAIN_CACHE_MAX_SERIES,
  getCachedDataset,
  putCachedDataset,
  listCachedDatasetKeys,
  deleteCachedDataset,
} from './cache';
export type { OnchainCacheRecord } from './cache';

// DefiLlama
export {
  DEFILLAMA_PROVIDER_ID,
  DEFILLAMA_DEFAULT_BASE,
  fetchDefiLlamaProtocolTvl,
  searchDefiLlamaProtocols,
  parseDefiLlamaTvlHistory,
} from './defillama';
export type { DefiLlamaProtocolSummary } from './defillama';

// GeckoTerminal (DEX OHLCV)
export {
  GECKOTERMINAL_PROVIDER_ID,
  GECKOTERMINAL_DEFAULT_BASE,
  mapAxisNetworkToGecko,
  mapAxisIntervalToGecko,
  parseGeckoOhlcvList,
  fetchGeckoPoolOhlcv,
  searchGeckoPools,
} from './geckoterminal';
export type {
  GeckoIntervalMap,
  GeckoPoolSearchHit,
} from './geckoterminal';

// Worker proxy resolution
export {
  ONCHAIN_LLAMA_PROXY_PATH,
  ONCHAIN_GECKO_PROXY_PATH,
  normalizeEndpointBase,
  resolveDefiLlamaBaseUrl,
  resolveGeckoTerminalBaseUrl,
  isWorkerLlamaProxy,
  isWorkerGeckoProxy,
} from './proxy';

// Catalog
export {
  DEFILLAMA_DATASET_ID,
  defillamaTvlDatasetPlugin,
  BUILTIN_DATASETS,
  ensureOnchainDatasetsRegistered,
  listDatasetPlugins,
  listDatasets,
  getDatasetPlugin,
  getDataset,
  registerDynamicDataset,
  unregisterDynamicDataset,
} from './catalog';

// Events (Phase 3 light — synthetic TVL spikes; no paid unlock/raise APIs)
export {
  DEFAULT_TVL_SPIKE_THRESHOLD_PCT,
  EVENT_TYPE_TVL_SPIKE,
  EVENT_TYPE_TVL_DROP,
  DEFILLAMA_RAISES_UNLOCKS_NOTE,
  sortEventPoints,
  normalizeEventPoints,
  buildTvlSpikeEvents,
  tvlSpikeEventSourceLabel,
} from './events';
export type { BuildTvlSpikeEventsOpts, TvlSpikeEventType } from './events';

// Manager
export {
  MAX_ONCHAIN_SERIES,
  onchainManagerState,
  getOnchainManagerState,
  attachDefiLlamaTvl,
  detachOnchainSeries,
  setOnchainSeriesVisible,
  clearAllOnchainSeries,
  setOnchainEvents,
  clearOnchainEvents,
  loadTvlSpikeEventsFromAttachment,
  searchProtocols,
} from './manager';
export type {
  OnchainManagerState,
  ProtocolSearchHit,
  DefiLlamaProtocolHit,
  OnchainSeriesRow,
  AttachDefiLlamaArg,
} from './manager';
