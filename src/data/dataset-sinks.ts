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
 * Dataset persistence sinks — pluggable backends behind the settings switch.
 *
 * | Mode     | Backend                                    | Notes |
 * |----------|--------------------------------------------|-------|
 * | session  | in-memory Map                              | wiped on reload |
 * | local    | `bars-cache` (IndexedDB)                   | default |
 * | git      | git storage plugin (`datasets/…` docs)     | debounced push |
 * | worker   | cloud storage plugin (`datasets/…` docs)   | debounced push |
 *
 * Sinks are dumb get/put/replace/remove backends — merge policy lives in
 * {@link ./dataset-store}. Remote sinks never throw on write failure: the
 * write is queued with retry and surfaced via `onSinkError`.
 *
 * @module data/dataset-sinks
 */

import type { Bar } from '../store/types';
import {
  barsCacheKey,
  clearCachedBars,
  getCachedBars,
  putCachedBars,
} from './bars-cache';

export type PersistenceMode = 'session' | 'local' | 'git' | 'worker';

export const PERSISTENCE_MODES: readonly PersistenceMode[] = [
  'session',
  'local',
  'git',
  'worker',
];

export type SinkErrorListener = (mode: PersistenceMode, key: string, err: unknown) => void;

let sinkErrorListener: SinkErrorListener | null = null;

/** Register a listener for sink write failures (DSM panel / system logs). */
export function onSinkError(fn: SinkErrorListener | null): void {
  sinkErrorListener = fn;
}

function reportSinkError(mode: PersistenceMode, key: string, err: unknown): void {
  try {
    sinkErrorListener?.(mode, key, err);
  } catch {
    /* listener errors are swallowed */
  }
  console.warn(`[dataset-sinks] ${mode} write failed for ${key}`, err);
}

/** A dataset persistence backend. Keys are `sourceId|symbol|interval`. */
export interface DatasetSink {
  readonly mode: PersistenceMode;
  get(key: string): Promise<Bar[] | null>;
  /** Merge bars into the stored series; returns merged count. */
  put(key: string, bars: readonly Bar[]): Promise<number>;
  /** Full replace of the stored series. */
  replace(key: string, bars: readonly Bar[]): Promise<void>;
  remove(key: string): Promise<void>;
}

// ── session (in-memory) ────────────────────────────────────────────────

const sessionSeries = new Map<string, Bar[]>();

export const sessionSink: DatasetSink = {
  mode: 'session',
  async get(key) {
    return sessionSeries.get(key) ?? null;
  },
  async put(key, bars) {
    const existing = sessionSeries.get(key) ?? [];
    const merged = mergeSorted(existing, bars);
    sessionSeries.set(key, merged);
    return merged.length;
  },
  async replace(key, bars) {
    sessionSeries.set(key, [...bars]);
  },
  async remove(key) {
    sessionSeries.delete(key);
  },
};

/** Sorted union by time; later duplicates win (caller merges by policy first). */
function mergeSorted(existing: readonly Bar[], incoming: readonly Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const b of existing) if (b && Number.isFinite(b.time)) byTime.set(b.time, b);
  for (const b of incoming) if (b && Number.isFinite(b.time)) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// ── local (bars-cache / IndexedDB) ─────────────────────────────────────

export const localSink: DatasetSink = {
  mode: 'local',
  async get(key) {
    const [sourceId, symbol, interval] = splitKey(key);
    if (!sourceId) return null;
    try {
      const bars = await getCachedBars(sourceId, symbol, interval);
      return bars.length ? bars : null;
    } catch {
      return null;
    }
  },
  async put(key, bars) {
    const [sourceId, symbol, interval] = splitKey(key);
    if (!sourceId) return 0;
    const merged = await putCachedBars(sourceId, symbol, interval, bars as Bar[]);
    return merged.length;
  },
  async replace(key, bars) {
    const [sourceId, symbol, interval] = splitKey(key);
    if (!sourceId) return;
    await clearCachedBars(sourceId, symbol, interval);
    if (bars.length) await putCachedBars(sourceId, symbol, interval, bars as Bar[]);
  },
  async remove(key) {
    const [sourceId, symbol, interval] = splitKey(key);
    if (!sourceId) return;
    await clearCachedBars(sourceId, symbol, interval);
  },
};

function splitKey(key: string): [string, string, string] {
  const parts = String(key || '').split('|');
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
}

// ── remote (git / worker via storage plugins) ──────────────────────────

/** Debounce window for remote dataset pushes (ms). Local IDB is the durable front. */
const REMOTE_PUSH_DEBOUNCE_MS = 15_000;
/** Retry cap per failed remote write. */
const REMOTE_PUSH_RETRIES = 3;

interface RemotePending {
  bars: Bar[];
  timer: ReturnType<typeof setTimeout> | null;
  retries: number;
  flushing: boolean;
  gen: number;
}

const remotePending = new Map<string, RemotePending>();

/** Storage plugin id per remote mode. */
function storageIdFor(mode: 'git' | 'worker'): string {
  return mode === 'git' ? 'git' : 'cloud';
}

function datasetDocId(key: string): string {
  // Storage-plugin document id; `|` is unsafe in some forges → use `__`
  return `datasets/${key.replace(/\|/g, '__')}`;
}

async function storagePlugin(mode: 'git' | 'worker') {
  const { getStorage } = await import('../storage/catalog');
  return getStorage(storageIdFor(mode));
}

/**
 * Remote sink over a storage plugin. Datasets are stored as JSON documents
 * (`datasets/<sourceId>__<symbol>__<interval>`) via the plugin's read/write.
 * Writes are debounced per key and retried on failure; failures never throw.
 */
export function remoteSink(mode: 'git' | 'worker'): DatasetSink {
  const flush = async (key: string): Promise<void> => {
    const pending = remotePending.get(key);
    if (!pending || pending.flushing) return;
    pending.flushing = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    const gen = pending.gen;
    const snapshot = pending.bars;
    try {
      const plugin = await storagePlugin(mode);
      if (!plugin) throw new Error(`storage plugin "${storageIdFor(mode)}" not registered`);
      const id = datasetDocId(key);
      const [sourceId, symbol, interval] = splitKey(key);
      await plugin.write(
        {
          id,
          name: `${symbol} ${interval} · ${sourceId}`,
          description: 'AXIS dataset (OHLCV)',
          tags: ['dataset'],
          updatedAt: Date.now(),
          content: JSON.stringify({ v: 1, key, bars: snapshot }),
        },
        {},
      );
      const current = remotePending.get(key);
      if (!current) return;
      current.flushing = false;
      if (current.gen === gen) {
        remotePending.delete(key);
      } else {
        current.timer = setTimeout(() => void flush(key), REMOTE_PUSH_DEBOUNCE_MS);
      }
    } catch (err: unknown) {
      const current = remotePending.get(key);
      if (!current) return;
      current.flushing = false;
      if (current.retries < REMOTE_PUSH_RETRIES) {
        current.retries += 1;
        setTimeout(() => void flush(key), REMOTE_PUSH_DEBOUNCE_MS * current.retries);
      } else {
        remotePending.delete(key);
        reportSinkError(mode, key, err);
      }
    }
  };

  const emptyPending = (): RemotePending => ({
    bars: [],
    timer: null,
    retries: 0,
    flushing: false,
    gen: 0,
  });

  return {
    mode,
    async get(key) {
      const pending = remotePending.get(key);
      try {
        const plugin = await storagePlugin(mode);
        let remote: Bar[] = [];
        if (plugin) {
          const doc = await plugin.read(datasetDocId(key), {});
          if (doc?.content) {
            const parsed = JSON.parse(doc.content) as { bars?: Bar[] };
            if (Array.isArray(parsed.bars)) remote = parsed.bars;
          }
        }
        if (pending?.bars.length) return mergeSorted(remote, pending.bars);
        if (remote.length) return remote;
        return localSink.get(key);
      } catch {
        if (pending?.bars.length) return pending.bars.slice();
        return localSink.get(key);
      }
    },
    async put(key, bars) {
      void localSink.put(key, bars).catch(() => {
        /* local front is best-effort; remote pending still holds */
      });
      const pending = remotePending.get(key) ?? emptyPending();
      pending.bars = mergeSorted(pending.bars, bars);
      pending.gen += 1;
      pending.retries = 0;
      if (pending.timer) clearTimeout(pending.timer);
      if (!pending.flushing) {
        pending.timer = setTimeout(() => void flush(key), REMOTE_PUSH_DEBOUNCE_MS);
      }
      remotePending.set(key, pending);
      return pending.bars.length;
    },
    async replace(key, bars) {
      void localSink.replace(key, bars).catch(() => {
        /* local front is best-effort */
      });
      const pending = remotePending.get(key) ?? emptyPending();
      pending.bars = [...bars];
      pending.gen += 1;
      pending.retries = 0;
      remotePending.set(key, pending);
      await flush(key);
    },
    async remove(key) {
      const pending = remotePending.get(key);
      if (pending?.timer) clearTimeout(pending.timer);
      remotePending.delete(key);
      void localSink.remove(key).catch(() => {
        /* ignore */
      });
      try {
        const plugin = await storagePlugin(mode);
        await plugin?.remove?.(datasetDocId(key), {});
      } catch (err: unknown) {
        reportSinkError(mode, key, err);
      }
    },
  };
}

/** Resolve the sink for a persistence mode. */
export function sinkForMode(mode: PersistenceMode): DatasetSink {
  switch (mode) {
    case 'session':
      return sessionSink;
    case 'git':
      return remoteSink('git');
    case 'worker':
      return remoteSink('worker');
    case 'local':
    default:
      return localSink;
  }
}

/** Build the canonical dataset key from parts. */
export function datasetKey(sourceId: string, symbol: string, interval: string): string {
  return barsCacheKey(sourceId, symbol, interval);
}

/** @internal test helper — clear session sink + pending remote pushes. */
export function _resetDatasetSinksForTests(): void {
  sessionSeries.clear();
  for (const p of remotePending.values()) if (p.timer) clearTimeout(p.timer);
  remotePending.clear();
}
