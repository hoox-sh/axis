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
 * Selection + resolution for the **Data Manager (cache)** chart source.
 *
 * Cached series are keyed by underlying venue source id (`binance-rest|BTCUSDT|1d`).
 * The chart source `data-manager` reads from that local cache without network I/O.
 *
 * @module data/data-manager-source
 */

import type { Bar } from '../store/types';
import {
  barsCacheKey,
  getCachedBars,
  listCachedSeries,
  type BarsCacheMeta,
} from './bars-cache';

/** Source plugin id registered in the sources catalog. */
export const DATA_MANAGER_SOURCE_ID = 'data-manager';

export interface DataManagerSelection {
  sourceId: string;
  symbol: string;
  interval: string;
}

let selection: DataManagerSelection | null = null;

/** Remember which cache entry the Data Manager source should load. */
export function setDataManagerSelection(
  sourceId: string,
  symbol: string,
  interval: string,
): void {
  selection = {
    sourceId: String(sourceId || '').trim(),
    symbol: String(symbol || '').trim().toUpperCase(),
    interval: String(interval || '').trim(),
  };
}

/** Clear explicit selection (next load falls back to best match). */
export function clearDataManagerSelection(): void {
  selection = null;
}

export function getDataManagerSelection(): DataManagerSelection | null {
  return selection ? { ...selection } : null;
}

export interface ResolvedCacheSeries {
  sourceId: string;
  symbol: string;
  interval: string;
  bars: Bar[];
  meta?: BarsCacheMeta;
}

/**
 * Resolve bars for the Data Manager source.
 *
 * 1. Explicit selection (from datasets modal) when it has bars
 * 2. Best match for requested symbol + interval (most bars)
 * 3. Best match for symbol alone (any interval) if still empty
 */
export async function resolveDataManagerBars(
  symbol: string,
  interval: string,
): Promise<ResolvedCacheSeries | null> {
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || '').trim();

  if (selection?.sourceId) {
    const sSym = selection.symbol || sym;
    const sIv = selection.interval || iv;
    const bars = await getCachedBars(selection.sourceId, sSym, sIv);
    if (bars.length) {
      return {
        sourceId: selection.sourceId,
        symbol: sSym,
        interval: sIv,
        bars,
      };
    }
  }

  const all = await listCachedSeries();
  if (!all.length) return null;

  const bySymIv = all
    .filter((m) => m.symbol === sym && m.interval === iv && m.count > 0)
    .sort((a, b) => b.count - a.count);
  const pick =
    bySymIv[0] ||
    all
      .filter((m) => m.symbol === sym && m.count > 0)
      .sort((a, b) => b.count - a.count)[0] ||
    null;

  if (!pick) return null;

  const bars = await getCachedBars(pick.sourceId, pick.symbol, pick.interval);
  if (!bars.length) return null;

  // Stick selection so subsequent reloads stay on the same series
  setDataManagerSelection(pick.sourceId, pick.symbol, pick.interval);

  return {
    sourceId: pick.sourceId,
    symbol: pick.symbol,
    interval: pick.interval,
    bars,
    meta: pick,
  };
}

/** Label for status bar / telemetry. */
export function dataManagerLabel(sel: DataManagerSelection | ResolvedCacheSeries | null): string {
  if (!sel) return 'Data Manager cache';
  return `${sel.symbol} ${sel.interval} · ${sel.sourceId}`;
}

/** Stable cache key for a selection. */
export function dataManagerCacheKey(sel: DataManagerSelection): string {
  return barsCacheKey(sel.sourceId, sel.symbol, sel.interval);
}
