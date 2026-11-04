// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Merged dataset inventory: IndexedDB bars-cache series plus the
 * dataset-store memory mirror.
 *
 * The bars cache lists what the venue writes landed in IndexedDB; the memory
 * mirror lists datasets that only live in RAM (live ticks, worker writes
 * while persistence is off). Either can know about a series the other does
 * not, so the dataset inventory merges both by cache key — memory wins on
 * freshness because it is the write path's own view.
 *
 * @module ui/dsm/datasets-list
 */

import { listCachedSeries, type BarsCacheMeta } from '../../data/bars-cache';
import { listMemoryDatasets } from '../../data/dataset-store';

/** One row per dataset: IndexedDB + memory mirror, merged by cache key. */
export async function listAllDatasetMetas(): Promise<BarsCacheMeta[]> {
  let list: BarsCacheMeta[] = [];
  try {
    list = await listCachedSeries();
  } catch (err: unknown) {
    console.warn('[dsm] could not list IndexedDB series', err);
  }
  const byKey = new Map(list.map((r) => [r.key, r] as const));
  for (const m of listMemoryDatasets()) {
    if (byKey.has(m.key)) continue;
    byKey.set(m.key, {
      key: m.key,
      sourceId: m.sourceId,
      symbol: m.symbol,
      interval: m.interval,
      count: m.barCount,
      oldestSec: m.oldestSec,
      newestSec: m.newestSec,
      updatedAt: Date.now(),
      market: m.market,
      authMode: m.authMode,
    });
  }
  return [...byKey.values()];
}

/** Total cached bars across every dataset row. */
export function totalBarsCached(rows: readonly BarsCacheMeta[]): number {
  return rows.reduce((n, r) => n + (r.count || 0), 0);
}
