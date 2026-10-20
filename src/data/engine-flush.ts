// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Flush the engine's own copy of the venue data.
 *
 * The engine store is shared, so the purge is per key: every local dataset
 * (memory mirror and IndexedDB) plus the chart series. AXIS market stays on
 * the dataset key; {@link seriesKeyString} maps it to the PYNE wire market.
 *
 * @module data/engine-flush
 */

import {
  deleteDataSeries,
  seriesKeyString,
  type DataSeriesKey,
} from '../engines/data-sessions';
import { flushDatasets, listMemoryDatasets } from './dataset-store';
import { listCachedSeries, lockFromBarsKey } from './bars-cache';
import { getActiveEngineConfig } from '../plugins/active';
import { store } from '../store';
import { exchangeForSource } from './symbol-exchange';

export interface EngineFlushResult {
  /** Engine series keys the flush asked for. */
  keys: string[];
  /** Bars the engine reported as dropped. */
  removed: number;
  /** Keys the engine refused or could not drop (e.g. an older engine). */
  failed: Array<{ key: string; message: string }>;
}

function addSeries(out: Map<string, DataSeriesKey>, key: DataSeriesKey): void {
  const symbol = String(key.symbol || '').trim();
  const interval = String(key.interval || '').trim();
  if (!symbol || !interval) return;
  const id = seriesKeyString({ ...key, symbol, interval });
  if (id && !out.has(id)) out.set(id, { ...key, symbol, interval });
}

function addDataset(
  out: Map<string, DataSeriesKey>,
  sourceId: string,
  symbol: string,
  interval: string,
  market?: string,
): void {
  // Plugin id ("binance-rest") → venue ("binance"). Market stays AXIS;
  // seriesKeyString applies pyneMarket once.
  const venue = exchangeForSource(sourceId);
  addSeries(out, {
    exchange: venue && venue !== 'generic' ? venue : String(store.exchange || 'binance'),
    market: market || 'spot',
    symbol,
    interval,
  });
}

function addChartSeries(out: Map<string, DataSeriesKey>): void {
  const symbol = String(store.symbol || '').trim();
  const interval = String(store.interval || '').trim();
  if (!symbol || !interval) return;
  addSeries(out, {
    exchange: String(store.exchange || 'binance').trim().toLowerCase(),
    market: store.provider?.market || 'spot',
    symbol,
    interval,
  });
}

/**
 * Engine series keys from the memory mirror plus the chart series.
 * Prefer {@link collectEngineSeriesKeys} — this misses IndexedDB-only rows.
 */
export function knownEngineSeriesKeys(): DataSeriesKey[] {
  const out = new Map<string, DataSeriesKey>();
  for (const meta of listMemoryDatasets()) {
    addDataset(out, meta.sourceId, meta.symbol, meta.interval, meta.market);
  }
  addChartSeries(out);
  return [...out.values()];
}

/** Sentinel: the cache list failed, so IndexedDB-only series were not named. */
const UNLISTED_SERIES = '*';

function unlistedSeriesFailure(err: unknown): { key: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  return {
    key: UNLISTED_SERIES,
    message: `cached series list failed; IndexedDB-only series were not deleted (${message})`,
  };
}

/**
 * Every engine series key AXIS can name right now, plus a list error when
 * IndexedDB could not be read. A list failure is not an empty catalog.
 */
export async function collectEngineSeriesKeys(): Promise<{
  keys: DataSeriesKey[];
  listError: unknown | null;
}> {
  const out = new Map<string, DataSeriesKey>();
  for (const meta of listMemoryDatasets()) {
    addDataset(out, meta.sourceId, meta.symbol, meta.interval, meta.market);
  }
  let listError: unknown | null = null;
  try {
    for (const row of await listCachedSeries()) {
      const lock = lockFromBarsKey(row.key);
      addDataset(out, row.sourceId, row.symbol, row.interval, lock.market);
    }
  } catch (err: unknown) {
    listError = err;
    console.warn('[engine-flush] could not list cached datasets', err);
  }
  addChartSeries(out);
  return { keys: [...out.values()], listError };
}

/**
 * Drop the engine's stored series for the given keys (or every key AXIS
 * knows about, when omitted).
 *
 * Best effort: an engine without the purge endpoint (or without a key)
 * reports what it could not drop. Does not clear the local stores — call
 * {@link flushLocalAndEngine} so the engine delete happens first.
 */
export async function flushEngineSeries(
  preset?: readonly DataSeriesKey[],
): Promise<EngineFlushResult> {
  const cfg = getActiveEngineConfig();
  const endpoint = String(cfg?.endpoint || store.endpoint || '').trim();
  const apiKey = String(cfg?.apiKey || '').trim();
  let listError: unknown | null = null;
  let keys: DataSeriesKey[];
  if (preset) {
    keys = [...preset];
  } else {
    const collected = await collectEngineSeriesKeys();
    keys = collected.keys;
    listError = collected.listError;
  }
  const result: EngineFlushResult = { keys: [], removed: 0, failed: [] };
  if (listError) result.failed.push(unlistedSeriesFailure(listError));
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

/**
 * Delete the engine series for every local dataset, then wipe the local stores.
 *
 * Keys are captured before either side is cleared, so an IndexedDB-only row
 * (the memory mirror caps at 48) is still deleted on the engine.
 */
export async function flushLocalAndEngine(): Promise<{
  local: number;
  engine: EngineFlushResult;
}> {
  const collected = await collectEngineSeriesKeys();
  const engine = await flushEngineSeries(collected.keys);
  if (collected.listError) engine.failed.push(unlistedSeriesFailure(collected.listError));
  const local = await flushDatasets();
  return { local, engine };
}
