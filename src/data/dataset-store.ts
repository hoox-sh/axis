// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DatasetStore — single source of truth for OHLCV datasets.
 *
 * Every consumer (chart loads, DSM jobs, live ticks, compare overlays, CSV
 * upload) reads and writes datasets through this store instead of touching
 * `bars-cache` directly. A memory mirror keeps paints instant; the active
 * {@link PersistenceMode} sink (session | local | git | worker) is the
 * durable layer behind the Settings switch.
 *
 * Merges run through {@link mergeWithConflictPolicy} (`newest-wins` default)
 * so overlapping datasets are validated against each other on every write.
 *
 * @module data/dataset-store
 */

import type { Bar } from '../store/types';
import { listCachedSeries } from './bars-cache';
import {
  datasetKey,
  flushDatasetSinks,
  removeDatasetFromAllSinks,
  sinkForMode,
  type PersistenceMode,
  type DatasetSink,
} from './dataset-sinks';
import {
  isSortedUnique,
  mergeSortedSeries,
  mergeWithConflictPolicy,
  type MergePolicy,
  type MergeResult,
} from './merge-datasets';
import { repairBars } from './dataset-validate';

/** Soft cap on memory-mirrored series (matches bars-cache series cap). */
const MEMORY_MAX_SERIES = 48;

export interface DatasetMeta {
  key: string;
  sourceId: string;
  symbol: string;
  interval: string;
  barCount: number;
  oldestSec: number | null;
  newestSec: number | null;
  /** Provider lock of a non-spot series (empty = public spot). */
  market?: string;
  /** Auth mode of a keyed series (empty = public). */
  authMode?: string;
}

export interface PutResult {
  bars: Bar[];
  added: number;
  conflicts: number;
}

type ChangeListener = (key: string, bars: Bar[]) => void;

const listeners = new Set<ChangeListener>();

let persistenceMode: PersistenceMode = 'local';
/** Active merge policy for dataset-vs-dataset conflicts. */
let mergePolicy: MergePolicy = 'newest-wins';

/**
 * Memory mirror: key → sorted bars (fast paint, sink fallback on miss).
 *
 * Insertion-ordered `Map`, evicted **LRU**: `Map.set` on an existing key does
 * not move it, so a plain FIFO would drop the hottest series (the one a
 * backfill writes on every page) first. `remember` re-inserts on access.
 */
const memory = new Map<string, Bar[]>();

function notify(key: string, bars: Bar[]): void {
  if (!listeners.size) return;
  // Hand out a copy: the array is the live memory mirror and the sink write
  // uses the same reference — a listener that mutated it would corrupt both.
  // One copy for all listeners, not one per listener.
  const payload = bars.slice();
  for (const fn of listeners) {
    try {
      fn(key, payload);
    } catch {
      /* listener errors are swallowed */
    }
  }
}

function remember(key: string, bars: Bar[]): void {
  // Refresh recency: delete + re-insert moves the key to the end of the
  // insertion order, so the eviction below drops the coldest series first.
  if (memory.has(key)) memory.delete(key);
  memory.set(key, bars);
  while (memory.size > MEMORY_MAX_SERIES) {
    const oldest = memory.keys().next().value;
    if (oldest == null || oldest === key) break;
    memory.delete(oldest);
  }
}

/** Current persistence mode (settings switch). */
export function getPersistenceMode(): PersistenceMode {
  return persistenceMode;
}

/**
 * In-flight persistence-mode copies.
 *
 * Switching the sink copies every mirrored series into the new backend in
 * the background. A delete that runs while a copy is still writing can be
 * overwritten by it (the dataset comes back from the dead). Deletes and
 * flushes await this chain first so the sweep always wins.
 */
let pendingCopies: Promise<void> = Promise.resolve();

function trackCopy(p: Promise<unknown>): void {
  pendingCopies = pendingCopies.then(() => p).then(
    () => undefined,
    () => undefined,
  );
}

/** Wait for every in-flight persistence-mode copy to settle. */
export async function awaitPendingCopies(): Promise<void> {
  await pendingCopies;
}

/**
 * Switch the durable sink. Memory mirror stays the read source; series are
 * copied into the new sink so a Settings switch cannot drop the active view.
 *
 * Every dataset the **old** sink knows about is migrated — not only the
 * mirrored ones. A dataset that lived only in the old sink (evicted from the
 * mirror, or written before it was warmed) was invisible in the new mode.
 */
export function setPersistenceMode(mode: PersistenceMode): void {
  if (mode === persistenceMode) return;
  const from = activeSink();
  persistenceMode = mode;
  const sink = activeSink();

  // Mirror first (synchronous — the active view must not wait for a listing).
  const gen = generation;
  for (const [key, bars] of memory) {
    if (!bars.length) continue;
    if (gen !== generation) break; // the store was reset mid-migration
    trackCopy(
      sink.replace(key, bars).catch((err: unknown) => {
        console.warn(`[dataset-store] copy to ${mode} failed for ${key}`, err);
      }),
    );
  }

  // Then the datasets that only the old sink holds. The whole migration is
  // tracked, so a delete that runs right after the switch waits for it (a
  // late copy would otherwise resurrect the dataset).
  trackCopy(
    (async () => {
      let listed: string[] = [];
      try {
        listed = (await from.list?.()) ?? [];
      } catch {
        listed = [];
      }
      for (const key of listed) {
        if (gen !== generation) break; // the store was reset mid-migration
        if (memory.has(key)) continue; // already copied above
        let bars: Bar[] | null = null;
        try {
          bars = await from.get(key);
        } catch {
          bars = null;
        }
        if (!bars?.length) continue;
        try {
          await sink.replace(key, bars);
        } catch (err: unknown) {
          console.warn(`[dataset-store] copy to ${mode} failed for ${key}`, err);
        }
      }
    })(),
  );
}

/** Current conflict-resolution policy for dataset merges. */
export function getMergePolicy(): MergePolicy {
  return mergePolicy;
}

export function setMergePolicy(policy: MergePolicy): void {
  mergePolicy = policy;
}

/** Subscribe to dataset changes (progressive paint). Returns unsubscribe. */
export function subscribeDatasets(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Canonical key for a dataset.
 *
 * The provider lock (`market` / `authMode`) is optional: a source that serves
 * more than one market (spot and futures, public and keyed) must pass it, or
 * the two series would share one dataset.
 */
export function keyFor(
  sourceId: string,
  symbol: string,
  interval: string,
  opts?: { market?: string; authMode?: string },
): string {
  return datasetKey(sourceId, symbol, interval, opts);
}

/**
 * Warm memory series without copying. `null` when the mirror is cold.
 * Callers must not mutate the returned array (live ticks / merges replace it).
 */
export function peekDataset(
  sourceId: string,
  symbol: string,
  interval: string,
): Bar[] | null {
  const key = keyFor(sourceId, symbol, interval);
  const mem = memory.get(key);
  if (!mem?.length) return null;
  // Refresh recency (LRU) without changing the array identity.
  memory.delete(key);
  memory.set(key, mem);
  return mem;
}

function activeSink(): DatasetSink {
  return sinkForMode(persistenceMode);
}

/**
 * Read a dataset. Memory mirror wins (never wiped on a sink miss); the active
 * sink is consulted only when the mirror is cold. Returns a copy.
 */
export async function getDataset(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<Bar[]> {
  const key = keyFor(sourceId, symbol, interval);
  const mem = peekDataset(sourceId, symbol, interval);
  if (mem?.length) return mem.slice();
  try {
    const bars = await activeSink().get(key);
    if (bars?.length) {
      remember(key, bars);
      return bars.slice();
    }
  } catch (err: unknown) {
    console.warn(`[dataset-store] sink get failed for ${key}`, err);
  }
  return mem?.length ? mem.slice() : [];
}

/**
 * Per-key write chains.
 *
 * A dataset write is a read-modify-write. When the memory mirror is cold the
 * read goes to the sink and yields the event loop, so two concurrent writers
 * (a DSM page write and the debounced live-bar write, two `seedDatasetFromBars`
 * calls) can read the same base and the second write would drop the first's
 * bars. Serialising the writes per key removes the window entirely.
 */
const writeChains = new Map<string, Promise<unknown>>();

/**
 * Generation of the store's state.
 *
 * A write that was **queued** before a reset must not repopulate the mirror
 * (or the sink) afterwards: the test suite resets the singletons between
 * files, and a late write from the previous file landed in the next file's
 * mirror — a dataset the next file never created, which then failed its
 * "the mirror is empty" assertions.
 */
let generation = 0;

function enqueueWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const gen = generation;
  // A stale write (the store was reset while it waited) is dropped: it must
  // not resurrect the state the reset just cleared.
  const run = (): Promise<T> =>
    gen === generation ? task() : Promise.resolve(undefined as unknown as T);
  const next = prev.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  writeChains.set(key, settled);
  // Drop the chain when it is the tail and has settled.
  void settled.then(() => {
    if (writeChains.get(key) === settled) writeChains.delete(key);
  });
  return next;
}

/**
 * Merge bars into a dataset (conflict-resolved) and persist to the sink.
 * Emits a change event with the merged series.
 */
export async function putDatasetBars(
  sourceId: string,
  symbol: string,
  interval: string,
  bars: readonly Bar[],
  opts?: { policy?: MergePolicy },
): Promise<PutResult> {
  const key = keyFor(sourceId, symbol, interval);
  return enqueueWrite(key, () => putDatasetBarsNow(key, sourceId, symbol, interval, bars, opts));
}

async function putDatasetBarsNow(
  key: string,
  sourceId: string,
  symbol: string,
  interval: string,
  bars: readonly Bar[],
  opts?: { policy?: MergePolicy },
): Promise<PutResult> {
  const incoming = bars.filter((b) => b && Number.isFinite(b.time));
  const mem = memory.get(key);
  let current: Bar[];
  if (mem?.length) {
    current = mem;
  } else {
    let fromSink: Bar[] | null = null;
    try {
      fromSink = await activeSink().get(key);
    } catch (err: unknown) {
      // The sink could not be read. Merging into an *empty* base would replace
      // the whole dataset with the incoming page and destroy it — refuse the
      // write instead and keep whatever the mirror holds.
      console.warn(`[dataset-store] sink read failed for ${key}; write skipped`, err);
      return { bars: mem?.slice() ?? [], added: 0, conflicts: 0 };
    }
    current = fromSink ?? [];
  }
  if (!incoming.length) {
    return { bars: current.slice(), added: 0, conflicts: 0 };
  }

  const policy = opts?.policy ?? mergePolicy;
  // The stored series is already repaired (sorted + unique) — every write
  // path runs the repair before persisting. The page is repaired on its own
  // and merged in one linear pass, instead of rebuilding a Map, re-sorting
  // and re-sanitizing the whole series on every page of a backfill.
  const page = repairBars(incoming, interval).bars;
  let merged: MergeResult;
  if (isSortedUnique(current) && isSortedUnique(page)) {
    merged = mergeSortedSeries(current, page, { policy });
  } else {
    // A series that predates the repair (or arrived unsorted) — fall back to
    // the full merge + repair.
    const full = mergeWithConflictPolicy(current, page, { policy });
    merged = { ...full, bars: repairBars(full.bars, interval).bars };
  }
  const repaired = merged.bars;

  remember(key, repaired);
  notify(key, repaired);

  try {
    await activeSink().put(key, repaired);
  } catch (err: unknown) {
    console.warn(`[dataset-store] sink put failed for ${key}`, err);
  }
  return { bars: repaired, added: merged.added, conflicts: merged.conflicts.length };
}

/**
 * Full replace of a dataset (uploads, authoritative refetches).
 * Emits a change event.
 */
export async function replaceDataset(
  sourceId: string,
  symbol: string,
  interval: string,
  bars: readonly Bar[],
): Promise<Bar[]> {
  const key = keyFor(sourceId, symbol, interval);
  return enqueueWrite(key, async () => {
    const { bars: clean } = repairBars(
      bars.filter((b) => b && Number.isFinite(b.time)),
      interval,
    );
    remember(key, clean);
    notify(key, clean);
    try {
      await activeSink().replace(key, clean);
    } catch (err: unknown) {
      console.warn(`[dataset-store] sink replace failed for ${key}`, err);
    }
    return clean.slice();
  });
}

/** Remove a dataset from memory + sink. */
export async function removeDataset(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<void> {
  const key = keyFor(sourceId, symbol, interval);
  await enqueueWrite(key, async () => {
    memory.delete(key);
    try {
      await activeSink().remove(key);
    } catch (err: unknown) {
      console.warn(`[dataset-store] sink remove failed for ${key}`, err);
    }
  });
}

/**
 * Delete a dataset **in full** — bars *and* metadata, from every sink.
 *
 * The Dataset manager delete used to clear only the local bars cache, so the
 * memory mirror kept the series and its metadata row survived the delete
 * (it re-appeared in the list on the next refresh). This removes the dataset
 * from the mirror and from every sink (session / local / git / worker), so
 * nothing is left behind in any persistence mode.
 */
export async function removeDatasetEverywhere(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<void> {
  const key = keyFor(sourceId, symbol, interval);
  // Let any in-flight sink copy land first — otherwise it re-adds the bars
  // right after the sweep and the dataset comes back from the dead.
  await awaitPendingCopies();
  // Run the sweep inside the write chain: a queued dataset write must not
  // land after the delete and resurrect the series.
  await enqueueWrite(key, async () => {
    memory.delete(key);
    await removeDatasetFromAllSinks(key);
    // Empty series event — listeners (status bar, progressive repaint) drop
    // the stale dataset count. The chart keeps the bars it already painted.
    notify(key, []);
  });
}

/**
 * Flush the dataset manager — drop every dataset (bars + metadata) from the
 * memory mirror and from every sink.
 *
 * @returns how many datasets were known (memory mirror + local cache).
 */
export async function flushDatasets(): Promise<number> {
  await awaitPendingCopies();
  const keys = new Set<string>();
  for (const m of listMemoryDatasets()) keys.add(m.key);
  try {
    for (const c of await listCachedSeries()) keys.add(c.key);
  } catch (err: unknown) {
    console.warn('[dataset-store] could not list cached datasets before flush', err);
  }

  memory.clear();
  for (const key of keys) {
    try {
      // Inside the write chain: a queued dataset write must not land after
      // the sweep and resurrect the dataset.
      await enqueueWrite(key, () => removeDatasetFromAllSinks(key));
    } catch (err: unknown) {
      console.warn(`[dataset-store] flush remove failed for ${key}`, err);
    }
  }
  await flushDatasetSinks();
  for (const key of keys) notify(key, []);
  return keys.size;
}

/** List memory-mirrored datasets (cheap; sink listing stays in bars-cache UI). */
export function listMemoryDatasets(): DatasetMeta[] {
  const out: DatasetMeta[] = [];
  for (const [key, bars] of memory) {
    // A keyed / non-spot series appends `|market|authMode` — the lock is part
    // of the dataset identity and must survive the split.
    const parts = key.split('|');
    out.push({
      key,
      sourceId: parts[0] ?? '',
      symbol: parts[1] ?? '',
      interval: parts[2] ?? '',
      barCount: bars.length,
      oldestSec: bars.length ? bars[0]!.time : null,
      newestSec: bars.length ? bars[bars.length - 1]!.time : null,
      market: parts[3] && parts[3] !== 'spot' ? parts[3] : undefined,
      authMode: parts[4] && parts[4] !== 'public' ? parts[4] : undefined,
    });
  }
  return out;
}

/** @internal test helper — reset memory, mode, policy, listeners. */
export function _resetDatasetStoreForTests(): void {
  // Bump the generation first: a write that is still queued must not
  // repopulate the mirror (or the sink) after the reset.
  generation += 1;
  memory.clear();
  listeners.clear();
  persistenceMode = 'local';
  mergePolicy = 'newest-wins';
  pendingCopies = Promise.resolve();
}
