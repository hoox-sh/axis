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

/** Soft cap on distinct series keys held in the in-memory map. */
export const BARS_CACHE_MAX_SERIES = 48;

export interface BarsCacheRecord {
  key: string;
  sourceId: string;
  symbol: string;
  interval: string;
  bars: Bar[];
  updatedAt: number;
}

/**
 * Optional window when loading a cached series onto the chart.
 * Applied in order: date range (inclusive) → maxBars (keep newest).
 */
export interface BarLoadWindow {
  /** Inclusive lower bound (unix seconds). */
  fromSec?: number | null;
  /** Inclusive upper bound (unix seconds). */
  toSec?: number | null;
  /** Keep at most this many bars after the date filter (newest). */
  maxBars?: number | null;
}

/**
 * Slice a sorted bar series by optional date range and max bar count.
 * Empty / invalid bounds are ignored. Does not mutate the input array.
 */
export function sliceBarsForLoad(bars: Bar[], window?: BarLoadWindow | null): Bar[] {
  if (!Array.isArray(bars) || !bars.length) return [];
  if (!window) return bars.slice();

  const from =
    window.fromSec != null && Number.isFinite(window.fromSec) ? window.fromSec : null;
  const to = window.toSec != null && Number.isFinite(window.toSec) ? window.toSec : null;
  const max =
    window.maxBars != null && Number.isFinite(window.maxBars) && window.maxBars > 0
      ? Math.floor(window.maxBars)
      : null;

  let out = bars;
  if (from != null || to != null) {
    out = bars.filter((b) => {
      if (!b || !Number.isFinite(b.time)) return false;
      if (from != null && b.time < from) return false;
      if (to != null && b.time > to) return false;
      return true;
    });
  } else {
    out = bars.slice();
  }

  if (max != null && out.length > max) {
    out = out.slice(out.length - max);
  }
  return out;
}

/** Count bars that would remain after {@link sliceBarsForLoad} without allocating. */
export function countBarsForLoad(bars: Bar[], window?: BarLoadWindow | null): number {
  if (!Array.isArray(bars) || !bars.length) return 0;
  if (!window) return bars.length;

  const from =
    window.fromSec != null && Number.isFinite(window.fromSec) ? window.fromSec : null;
  const to = window.toSec != null && Number.isFinite(window.toSec) ? window.toSec : null;
  const max =
    window.maxBars != null && Number.isFinite(window.maxBars) && window.maxBars > 0
      ? Math.floor(window.maxBars)
      : null;

  let n = 0;
  if (from == null && to == null) {
    n = bars.length;
  } else {
    for (const b of bars) {
      if (!b || !Number.isFinite(b.time)) continue;
      if (from != null && b.time < from) continue;
      if (to != null && b.time > to) continue;
      n++;
    }
  }
  if (max != null && n > max) return max;
  return n;
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
  const a = Array.isArray(existing) ? existing : [];
  const b = Array.isArray(incoming) ? incoming : [];
  if (!a.length) return dedupeSort(b);
  if (!b.length) return dedupeSort(a);
  const map = new Map<number, Bar>();
  for (const bar of a) {
    if (bar && Number.isFinite(bar.time)) map.set(bar.time, bar);
  }
  for (const bar of b) {
    if (bar && Number.isFinite(bar.time)) map.set(bar.time, bar);
  }
  return Array.from(map.values()).sort((x, y) => x.time - y.time);
}

function dedupeSort(bars: Bar[]): Bar[] {
  if (!Array.isArray(bars) || !bars.length) return [];
  const map = new Map<number, Bar>();
  for (const b of bars) {
    if (b && Number.isFinite(b.time)) map.set(b.time, b);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

function capNewest(bars: Bar[], max: number): Bar[] {
  if (!Array.isArray(bars) || !bars.length) return [];
  if (!Number.isFinite(max) || max <= 0 || bars.length <= max) {
    // Return a copy when caller may hold a shared memory reference
    return bars.slice();
  }
  return bars.slice(bars.length - Math.floor(max));
}

/** Sanitize + merge, then trim to {@link BARS_CACHE_MAX} (keep newest). */
export function mergeAndCap(existing: Bar[], incoming: Bar[], max = BARS_CACHE_MAX): Bar[] {
  const base = Array.isArray(existing) ? existing : [];
  const cap =
    typeof max === 'number' && Number.isFinite(max) && max > 0
      ? Math.floor(max)
      : BARS_CACHE_MAX;

  if (!Array.isArray(incoming) || !incoming.length) {
    return capNewest(base, cap);
  }

  // Hot path: single live tick updating the open bar or appending a new open time.
  // Avoid full Map rebuild + sort on every tick when the series is already sorted.
  if (incoming.length === 1 && base.length > 0) {
    const b = sanitizeBar(incoming[0]);
    if (!b) return capNewest(base, cap);
    const last = base[base.length - 1]!;
    if (Number.isFinite(last.time) && last.time === b.time) {
      const out = base.slice();
      out[out.length - 1] = b;
      return out;
    }
    if (Number.isFinite(last.time) && b.time > last.time) {
      const out =
        base.length >= cap ? base.slice(base.length - (cap - 1)) : base.slice();
      out.push(b);
      return out;
    }
    // Mid/older insert — fall through to full merge
  }

  const cleaned: Bar[] = [];
  for (const raw of incoming) {
    const b = sanitizeBar(raw);
    if (b) cleaned.push(b);
  }
  if (!cleaned.length) return capNewest(base, cap);

  let merged = mergeBars(base, cleaned);
  if (merged.length > cap) {
    merged = merged.slice(merged.length - cap);
  }
  return merged;
}

// ── Memory fallback ──────────────────────────────────────────────────

const memory = new Map<string, BarsCacheRecord>();

/** Evict oldest-updated series when the in-memory map exceeds the series cap. */
function trimMemorySeries(): void {
  if (memory.size <= BARS_CACHE_MAX_SERIES) return;
  const ranked = Array.from(memory.values()).sort(
    (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0),
  );
  const drop = memory.size - BARS_CACHE_MAX_SERIES;
  for (let i = 0; i < drop; i++) {
    const rec = ranked[i];
    if (rec?.key) memory.delete(rec.key);
  }
}

async function openBarsDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'key' });
    }
  });
}

/**
 * Internal peek: return the in-memory bars array without cloning when warm.
 * Caller must not mutate the returned array.
 */
function peekMemoryBars(key: string): Bar[] | null {
  const rec = memory.get(key);
  if (rec?.bars && Array.isArray(rec.bars)) return rec.bars;
  return null;
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

/** Lightweight list row for the Data Manager datasets browser. */
export interface BarsCacheMeta {
  key: string;
  sourceId: string;
  symbol: string;
  interval: string;
  count: number;
  oldestSec: number | null;
  newestSec: number | null;
  updatedAt: number;
}

function metaFromRecord(rec: BarsCacheRecord): BarsCacheMeta {
  const bars = rec.bars || [];
  return {
    key: rec.key,
    sourceId: rec.sourceId,
    symbol: rec.symbol,
    interval: rec.interval,
    count: bars.length,
    oldestSec: bars.length ? bars[0]!.time : null,
    newestSec: bars.length ? bars[bars.length - 1]!.time : null,
    updatedAt: rec.updatedAt || 0,
  };
}

/**
 * List every cached series (memory + IndexedDB). Sorted newest-updated first.
 * Does not clone bar arrays — only metadata for the datasets browser.
 */
export async function listCachedSeries(): Promise<BarsCacheMeta[]> {
  const byKey = new Map<string, BarsCacheMeta>();

  for (const rec of memory.values()) {
    if (rec?.key) byKey.set(rec.key, metaFromRecord(rec));
  }

  if (idbAvailable()) {
    try {
      const db = await openBarsDb();
      try {
        const tx = db.transaction(STORE, 'readonly');
        const all = (await idbReq(tx.objectStore(STORE).getAll())) as BarsCacheRecord[];
        await idbTxDone(tx);
        for (const rec of all || []) {
          if (!rec?.key) continue;
          // Prefer fresher of memory vs IDB
          const existing = byKey.get(rec.key);
          if (!existing || (rec.updatedAt || 0) >= (existing.updatedAt || 0)) {
            byKey.set(rec.key, metaFromRecord(rec));
          }
        }
      } finally {
        db.close();
      }
    } catch {
      /* memory-only */
    }
  }

  return Array.from(byKey.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Read a full cache record (including bars) by source/symbol/interval. */
export async function getCachedRecord(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<BarsCacheRecord | null> {
  const key = barsCacheKey(sourceId, symbol, interval);
  const mem = memory.get(key);
  if (mem?.bars?.length) {
    return { ...mem, bars: mem.bars.slice() };
  }
  if (!idbAvailable()) {
    return mem ? { ...mem, bars: mem.bars?.slice() ?? [] } : null;
  }
  try {
    const db = await openBarsDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rec = (await idbReq(tx.objectStore(STORE).get(key))) as BarsCacheRecord | undefined;
      await idbTxDone(tx);
      if (!rec) return mem ? { ...mem, bars: mem.bars?.slice() ?? [] } : null;
      return { ...rec, bars: rec.bars?.slice() ?? [] };
    } finally {
      db.close();
    }
  } catch {
    return mem ? { ...mem, bars: mem.bars?.slice() ?? [] } : null;
  }
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
  const safeIncoming = Array.isArray(incoming) ? incoming : [];

  // Prefer warm memory reference (no clone) — mergeAndCap never mutates `existing`.
  // Falls back to IDB/memory clone only when this key is cold.
  let existing = peekMemoryBars(key);
  if (!existing) {
    existing = await getCachedBars(sourceId, symbol, interval);
  }

  const bars = mergeAndCap(existing, safeIncoming);
  const rec: BarsCacheRecord = {
    key,
    sourceId: String(sourceId || ''),
    symbol: sym,
    interval: String(interval || ''),
    bars,
    updatedAt: Date.now(),
  };
  memory.set(key, rec);
  trimMemorySeries();

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
