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
 * Durable on-chain dataset cache (IndexedDB + memory fallback).
 *
 * Keys: {@link instrumentCacheKey} → full {@link OnchainDataset}.
 * Cap ~32 series with LRU-ish eviction on put.
 *
 * @module onchain/cache
 */

import { idbAvailable, idbReq, idbTxDone, openDb } from '../storage/idb';
import type { OnchainDataset } from './types';

const DB_NAME = 'axis-onchain-cache';
const DB_VERSION = 1;
const STORE = 'datasets';

/** Soft cap on distinct dataset keys held in cache. */
export const ONCHAIN_CACHE_MAX_SERIES = 32;

export interface OnchainCacheRecord {
  key: string;
  dataset: OnchainDataset;
  updatedAt: number;
}

// ── Memory fallback ──────────────────────────────────────────────────

const memory = new Map<string, OnchainCacheRecord>();

/** Evict oldest-updated entries when over cap (memory map). */
function trimMemorySeries(): void {
  if (memory.size <= ONCHAIN_CACHE_MAX_SERIES) return;
  const ranked = Array.from(memory.values()).sort(
    (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0),
  );
  const drop = memory.size - ONCHAIN_CACHE_MAX_SERIES;
  for (let i = 0; i < drop; i++) {
    const rec = ranked[i];
    if (rec?.key) memory.delete(rec.key);
  }
}

async function openOnchainDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'key' });
    }
  });
}

/** Evict oldest IDB records when over cap (best-effort). */
async function trimIdbSeries(db: IDBDatabase): Promise<void> {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = (await idbReq(store.getAll())) as OnchainCacheRecord[];
    if (!all || all.length <= ONCHAIN_CACHE_MAX_SERIES) {
      await idbTxDone(tx);
      return;
    }
    const ranked = all
      .filter((r) => r?.key)
      .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    const drop = ranked.length - ONCHAIN_CACHE_MAX_SERIES;
    for (let i = 0; i < drop; i++) {
      const rec = ranked[i];
      if (rec?.key) store.delete(rec.key);
    }
    await idbTxDone(tx);
  } catch {
    /* ignore trim failures */
  }
}

/**
 * Read a cached dataset by key. Returns `null` if missing.
 * Touches `updatedAt` in memory for LRU-ish behavior.
 */
export async function getCachedDataset(key: string): Promise<OnchainDataset | null> {
  const k = String(key || '').trim();
  if (!k) return null;

  if (!idbAvailable()) {
    const rec = memory.get(k);
    if (!rec?.dataset) return null;
    // Touch for LRU
    rec.updatedAt = Date.now();
    return structuredCloneSafe(rec.dataset);
  }

  try {
    const db = await openOnchainDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rec = (await idbReq(tx.objectStore(STORE).get(k))) as
        | OnchainCacheRecord
        | undefined;
      await idbTxDone(tx);
      if (!rec?.dataset) {
        return memory.get(k)?.dataset
          ? structuredCloneSafe(memory.get(k)!.dataset)
          : null;
      }
      // Keep memory warm
      memory.set(k, { key: k, dataset: rec.dataset, updatedAt: Date.now() });
      trimMemorySeries();
      return structuredCloneSafe(rec.dataset);
    } finally {
      db.close();
    }
  } catch {
    const rec = memory.get(k);
    return rec?.dataset ? structuredCloneSafe(rec.dataset) : null;
  }
}

/** Write a dataset under the given key. Evicts oldest if over cap. */
export async function putCachedDataset(
  key: string,
  dataset: OnchainDataset,
): Promise<void> {
  const k = String(key || '').trim();
  if (!k || !dataset) return;

  const rec: OnchainCacheRecord = {
    key: k,
    dataset: structuredCloneSafe(dataset),
    updatedAt: Date.now(),
  };

  memory.set(k, rec);
  trimMemorySeries();

  if (!idbAvailable()) return;

  try {
    const db = await openOnchainDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      await idbTxDone(tx);
      await trimIdbSeries(db);
    } finally {
      db.close();
    }
  } catch {
    /* memory-only */
  }
}

/** List all known cache keys (memory ∪ IDB), newest-updated first. */
export async function listCachedDatasetKeys(): Promise<string[]> {
  const byKey = new Map<string, number>();

  for (const rec of memory.values()) {
    if (rec?.key) byKey.set(rec.key, rec.updatedAt || 0);
  }

  if (idbAvailable()) {
    try {
      const db = await openOnchainDb();
      try {
        const tx = db.transaction(STORE, 'readonly');
        const all = (await idbReq(tx.objectStore(STORE).getAll())) as OnchainCacheRecord[];
        await idbTxDone(tx);
        for (const rec of all || []) {
          if (!rec?.key) continue;
          const existing = byKey.get(rec.key) ?? 0;
          if ((rec.updatedAt || 0) >= existing) {
            byKey.set(rec.key, rec.updatedAt || 0);
          }
        }
      } finally {
        db.close();
      }
    } catch {
      /* memory-only */
    }
  }

  return Array.from(byKey.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/** Delete one cached dataset. */
export async function deleteCachedDataset(key: string): Promise<void> {
  const k = String(key || '').trim();
  if (!k) return;
  memory.delete(k);

  if (!idbAvailable()) return;
  try {
    const db = await openOnchainDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(k);
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

/** @internal test helper — clear memory map only. */
export function _clearOnchainMemoryCache(): void {
  memory.clear();
}

function structuredCloneSafe<T>(value: T): T {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
