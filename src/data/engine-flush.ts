// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Flush the engine's own copy of the venue data.
 *
 * AXIS caches the venue's OHLCV twice: in the local dataset store (memory
 * mirror + IndexedDB + the remote dataset sinks) and in the **engine's**
 * series store (the shared venue cache behind `GET /data/series`). Flushing
 * only the local side leaves the engine serving the old — stale, holed —
 * window, and the chart mirrors the engine's copy in the live path.
 *
 * The flush is **per key**: the engine's store is shared, so a purge never
 * touches another series. Every key AXIS knows about (the local datasets plus
 * the chart's own series) is dropped.
 *
 * @module data/engine-flush
 */

import {
  deleteDataSeries,
  seriesKeyString,
  type DataSeriesKey,
} from '../engines/data-sessions';
import { listMemoryDatasets } from './dataset-store';
import { pairFormSymbol } from '../engine/market-identity';
import { getActiveEngineConfig } from '../plugins/active';
import { store } from '../store';
import { pyneMarket } from './provider';
import { exchangeForSource } from './symbol-exchange';
import { FALLBACK_MAJORS } from './symbol-catalog';

export interface EngineFlushResult {
  /** Engine series keys the flush asked for. */
  keys: string[];
  /** Bars the engine reported as dropped. */
  removed: number;
  /** Keys the engine refused or could not drop (e.g. an older engine). */
  failed: Array<{ key: string; message: string }>;
}

/**
 * The engine series keys AXIS knows about: the local datasets plus the
 * chart's current series.
 */
export function knownEngineSeriesKeys(): DataSeriesKey[] {
  const out = new Map<string, DataSeriesKey>();
  const add = (key: DataSeriesKey): void => {
    const id = seriesKeyString(key);
    if (id && !out.has(id)) out.set(id, key);
  };
  for (const meta of listMemoryDatasets()) {
    // The dataset's source id is the AXIS plugin ("binance-rest"); the engine
    // keys its store by venue ("binance").
    const venue = exchangeForSource(meta.sourceId);
    add({
      exchange: venue && venue !== 'generic' ? venue : String(store.exchange || 'binance'),
      market: meta.market ?? 'spot',
      symbol: meta.symbol || '',
      interval: meta.interval || '',
    });
  }
  // The chart's own series — it is live even when nothing is cached locally.
  const symbol = String(store.symbol || '').trim();
  const interval = String(store.interval || '').trim();
  if (symbol && interval) {
    add({
      exchange: String(store.exchange || 'binance').trim().toLowerCase(),
      market: pyneMarket(store.provider?.market),
      symbol: pairFormSymbol(symbol, FALLBACK_MAJORS),
      interval,
    });
  }
  return [...out.values()];
}

/**
 * Drop the engine's stored series for every key AXIS knows about.
 *
 * Best effort: an engine without the purge endpoint (or without a key)
 * leaves the local datasets flushed and reports what it could not drop.
 */
export async function flushEngineSeries(): Promise<EngineFlushResult> {
  const cfg = getActiveEngineConfig();
  const endpoint = String(cfg?.endpoint || store.endpoint || '').trim();
  const apiKey = String(cfg?.apiKey || '').trim();
  const keys = knownEngineSeriesKeys();
  const result: EngineFlushResult = { keys: [], removed: 0, failed: [] };
  if (!endpoint || !apiKey) {
    for (const key of keys) {
      result.failed.push({ key: seriesKeyString(key), message: 'no engine credentials' });
    }
    return result;
  }
  for (const key of keys) {
    const id = seriesKeyString(key);
    try {
      const out = await deleteDataSeries(endpoint, apiKey, key);
      result.keys.push(id);
      result.removed += out.removed;
    } catch (err: unknown) {
      result.failed.push({
        key: id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
