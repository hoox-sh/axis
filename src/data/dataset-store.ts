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
import {
  datasetKey,
  sinkForMode,
  type PersistenceMode,
  type DatasetSink,
} from './dataset-sinks';
import {
  mergeWithConflictPolicy,
  type MergePolicy,
} from './merge-datasets';

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

/** Memory mirror: key → sorted bars (fast paint, sink fallback on miss). */
const memory = new Map<string, Bar[]>();

function notify(key: string, bars: Bar[]): void {
  for (const fn of listeners) {
    try {
      fn(key, bars);
    } catch {
      /* listener errors are swallowed */
    }
  }
}

function remember(key: string, bars: Bar[]): void {
  memory.set(key, bars);
  if (memory.size > MEMORY_MAX_SERIES) {
    // Evict oldest inserted key (Map preserves insertion order)
    const oldest = memory.keys().next().value;
    if (oldest != null && oldest !== key) memory.delete(oldest);
  }
}

/** Current persistence mode (settings switch). */
export function getPersistenceMode(): PersistenceMode {
  return persistenceMode;
}

/**
 * Switch the durable sink. Memory mirror is preserved so the chart keeps
 * painting while the new sink warms up.
 */
export function setPersistenceMode(mode: PersistenceMode): void {
  if (mode === persistenceMode) return;
  persistenceMode = mode;
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

/** Canonical key for a dataset. */
export function keyFor(sourceId: string, symbol: string, interval: string): string {
  return datasetKey(sourceId, symbol, interval);
}

function activeSink(): DatasetSink {
  return sinkForMode(persistenceMode);
}

/**
 * Read a dataset: memory mirror first, then the active sink.
 * Returns a copy — callers must not mutate.
 */
export async function getDataset(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<Bar[]> {
  const key = keyFor(sourceId, symbol, interval);
  const mem = memory.get(key);
  if (mem) return mem.slice();
  const bars = await activeSink().get(key);
  if (bars?.length) {
    remember(key, bars);
    return bars.slice();
  }
  return [];
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
  const incoming = bars.filter((b) => b && Number.isFinite(b.time));
  if (!incoming.length) {
    const existing = memory.get(key) ?? [];
    return { bars: existing.slice(), added: 0, conflicts: 0 };
  }

  const current = memory.get(key) ?? (await activeSink().get(key)) ?? [];
  const merged = mergeWithConflictPolicy(current, incoming, {
    policy: opts?.policy ?? mergePolicy,
  });

  remember(key, merged.bars);
  notify(key, merged.bars);

  // Session mode = memory only; every other mode persists through its sink.
  if (persistenceMode !== 'session') {
    try {
      await activeSink().put(key, merged.bars);
    } catch (err: unknown) {
      console.warn(`[dataset-store] sink put failed for ${key}`, err);
    }
  }
  return { bars: merged.bars, added: merged.added, conflicts: merged.conflicts.length };
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
  const clean = bars.filter((b) => b && Number.isFinite(b.time));
  remember(key, clean);
  notify(key, clean);
  if (persistenceMode !== 'session') {
    try {
      await activeSink().replace(key, clean);
    } catch (err: unknown) {
      console.warn(`[dataset-store] sink replace failed for ${key}`, err);
    }
  }
  return clean.slice();
}

/** Remove a dataset from memory + sink. */
export async function removeDataset(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<void> {
  const key = keyFor(sourceId, symbol, interval);
  memory.delete(key);
  try {
    await activeSink().remove(key);
  } catch (err: unknown) {
    console.warn(`[dataset-store] sink remove failed for ${key}`, err);
  }
}

/** List memory-mirrored datasets (cheap; sink listing stays in bars-cache UI). */
export function listMemoryDatasets(): DatasetMeta[] {
  const out: DatasetMeta[] = [];
  for (const [key, bars] of memory) {
    const [sourceId, symbol, interval] = key.split('|');
    out.push({
      key,
      sourceId: sourceId ?? '',
      symbol: symbol ?? '',
      interval: interval ?? '',
      barCount: bars.length,
      oldestSec: bars.length ? bars[0]!.time : null,
      newestSec: bars.length ? bars[bars.length - 1]!.time : null,
    });
  }
  return out;
}

/** @internal test helper — reset memory, mode, policy, listeners. */
export function _resetDatasetStoreForTests(): void {
  memory.clear();
  listeners.clear();
  persistenceMode = 'local';
  mergePolicy = 'newest-wins';
}
