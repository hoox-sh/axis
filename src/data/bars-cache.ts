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
 * Durable OHLCV cache for the Data Source Manager.
 *
 * Keys: `sourceId|symbol|interval` → sorted unique bars (unix seconds).
 * Uses IndexedDB when available; falls back to an in-memory map (tests / SSR).
 *
 * @module data/bars-cache
 */

import type { Bar } from '../store/types';
import { idbAvailable, idbReq, idbTxDone, openDb } from '../storage/idb';
import { sanitizeBar } from './parse-bars';

const DB_NAME = 'axis-bars-cache';
const DB_VERSION = 1;
const STORE = 'bars';

/** Soft cap per series to avoid unbounded IDB growth. */
export const BARS_CACHE_MAX = 100_000;

export interface BarsCacheRecord {
  key: string;
  sourceId: string;
  symbol: string;
  interval: string;
  bars: Bar[];
  updatedAt: number;
}

/** Build cache key from source / symbol / interval. */
export function barsCacheKey(sourceId: string, symbol: string, interval: string): string {
  const src = String(sourceId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || '').trim();
  return `${src}|${sym}|${iv}`;
}

/** Merge two bar lists: sort by time, last-write wins on duplicate times. */
export function mergeBars(existing: Bar[], incoming: Bar[]): Bar[] {
  if (!existing.length) return dedupeSort(incoming);
  if (!incoming.length) return dedupeSort(existing);
  const map = new Map<number, Bar>();
  for (const b of existing) {
    if (b && Number.isFinite(b.time)) map.set(b.time, b);
  }
  for (const b of incoming) {
    if (b && Number.isFinite(b.time)) map.set(b.time, b);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

function dedupeSort(bars: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of bars) {
    if (b && Number.isFinite(b.time)) map.set(b.time, b);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/** Sanitize + merge, then trim to {@link BARS_CACHE_MAX} (keep newest). */
export function mergeAndCap(existing: Bar[], incoming: Bar[], max = BARS_CACHE_MAX): Bar[] {
  const cleaned: Bar[] = [];
  for (const raw of incoming) {
    const b = sanitizeBar(raw);
    if (b) cleaned.push(b);
  }
  let merged = mergeBars(existing, cleaned);
  if (merged.length > max) {
    merged = merged.slice(merged.length - max);
  }
  return merged;
}

// ── Memory fallback ──────────────────────────────────────────────────

const memory = new Map<string, BarsCacheRecord>();

async function openBarsDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'key' });
    }
  });
}

/** Read full series for a cache key (empty array if missing). */
export async function getCachedBars(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<Bar[]> {
  const key = barsCacheKey(sourceId, symbol, interval);
  if (!idbAvailable()) {
    return memory.get(key)?.bars?.slice() ?? [];
  }
  try {
    const db = await openBarsDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rec = (await idbReq(tx.objectStore(STORE).get(key))) as BarsCacheRecord | undefined;
      await idbTxDone(tx);
      return rec?.bars?.slice() ?? [];
    } finally {
      db.close();
    }
  } catch {
    return memory.get(key)?.bars?.slice() ?? [];
  }
}

/** Read cache metadata (oldest/newest/count) without cloning all bars when possible. */
export async function getCachedRange(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<{ count: number; oldestSec: number | null; newestSec: number | null } | null> {
  const bars = await getCachedBars(sourceId, symbol, interval);
  if (!bars.length) return null;
  return {
    count: bars.length,
    oldestSec: bars[0]!.time,
    newestSec: bars[bars.length - 1]!.time,
  };
}

/**
 * Merge `incoming` into the stored series and persist.
 * @returns the full merged series after write
 */
export async function putCachedBars(
  sourceId: string,
  symbol: string,
  interval: string,
  incoming: Bar[],
): Promise<Bar[]> {
  const key = barsCacheKey(sourceId, symbol, interval);
  const sym = String(symbol || '').trim().toUpperCase();
  const existing = await getCachedBars(sourceId, symbol, interval);
  const bars = mergeAndCap(existing, incoming);
  const rec: BarsCacheRecord = {
    key,
    sourceId: String(sourceId || ''),
    symbol: sym,
    interval: String(interval || ''),
    bars,
    updatedAt: Date.now(),
  };
  memory.set(key, rec);

  if (idbAvailable()) {
    try {
      const db = await openBarsDb();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        await idbTxDone(tx);
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[bars-cache] IDB put failed; kept in memory only', err);
    }
  }
  return bars.slice();
}

/** Drop one series from cache. */
export async function clearCachedBars(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<void> {
  const key = barsCacheKey(sourceId, symbol, interval);
  memory.delete(key);
  if (!idbAvailable()) return;
  try {
    const db = await openBarsDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

/** @internal test helper — wipe memory map (and best-effort IDB). */
export async function _resetBarsCacheForTests(): Promise<void> {
  memory.clear();
  if (!idbAvailable()) return;
  try {
    const db = await openBarsDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}
