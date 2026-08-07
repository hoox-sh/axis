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
 * Expand a bars-cache series toward “now” via the underlying venue REST source.
 *
 * Used when loading Data Manager datasets so the chart is not stuck at the
 * last backfilled candle: network pages walk back from now until they overlap
 * the cache, then merge. Live ticks call {@link noteDataManagerLiveBar} so the
 * dataset keeps growing while Live is on.
 *
 * @module data/expand-cache
 */

import type { Bar } from '../store/types';
import type { SourcePlugin } from '../plugins/types';
import { pluginKey } from '../plugins/types';
import { store } from '../store';
import { normalizeHistoricalBars, sanitizeBar } from './parse-bars';
import { getCachedBars, putCachedBars } from './bars-cache';
import { intervalToSec } from './bars-gaps';
import {
  DATA_MANAGER_SOURCE_ID,
  getDataManagerSelection,
} from './data-manager-source';

/** Soft cap on REST pages when closing the gap to now (avoid runaway). */
const MAX_EXPAND_PAGES = 40;

/** Default wall-clock budget for an expand pass (ms). */
const DEFAULT_EXPAND_BUDGET_MS = 25_000;

/** Debounce live cache writes so open-bar ticks do not thrash IDB every frame. */
const LIVE_CACHE_DEBOUNCE_MS = 750;

const liveWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const livePendingBars = new Map<string, Bar>();

/** Sources that cannot fill a network gap. */
const OFFLINE_SOURCES = new Set([
  'csv-upload',
  'data-manager',
  DATA_MANAGER_SOURCE_ID,
]);

export interface ExpandCacheResult {
  bars: Bar[];
  /** Bars newly merged from the venue (approx; includes last-bar refresh). */
  added: number;
  /** True when a network expand was attempted. */
  expanded: boolean;
  /** Set when expand failed (cache still returned). */
  error?: string;
}

function sourceConfig(sourceId: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  return (configs[pluginKey('source', sourceId)] || configs[sourceId] || {}) as Record<
    string,
    unknown
  >;
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Expand failed';
}

/** Lazy catalog access — avoids expand-cache ↔ sources/catalog init cycles. */
async function loadSourceApi(): Promise<{
  getSource: (id: string) => SourcePlugin | undefined;
  sourcePageLimit: (id: string) => number;
}> {
  const mod = await import('../sources/catalog');
  return {
    getSource: mod.getSource,
    sourcePageLimit: mod.sourcePageLimit,
  };
}

/**
 * Whether this venue source can be used to close the cache→now gap.
 * Sync check for offline ids; unknown ids allowed (resolved at expand time).
 */
export function canExpandFromSource(sourceId: string): boolean {
  const id = String(sourceId || '').trim();
  if (!id || OFFLINE_SOURCES.has(id)) return false;
  if (id === 'mock-walk') return true;
  return true;
}

/**
 * Walk-back from **now** toward the cache’s newest bar and merge pages into
 * IndexedDB / memory. Returns the full series after merge.
 *
 * No-op when already near “now”, unknown source, or offline-only source.
 */
export async function expandCachedSeriesToNow(
  sourceId: string,
  symbol: string,
  interval: string,
  opts?: { signal?: AbortSignal; nowSec?: number; budgetMs?: number },
): Promise<ExpandCacheResult> {
  const srcId = String(sourceId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || '').trim();

  let bars: Bar[] = [];
  try {
    bars = await getCachedBars(srcId, sym, iv);
  } catch {
    bars = [];
  }
  if (!bars.length) {
    return { bars: [], added: 0, expanded: false };
  }

  if (!canExpandFromSource(srcId)) {
    return { bars, added: 0, expanded: false };
  }

  const { getSource, sourcePageLimit } = await loadSourceApi();
  const source = getSource(srcId);
  if (!source?.fetchHistorical) {
    return { bars, added: 0, expanded: false };
  }
  if (
    source.capabilities?.offline &&
    !source.capabilities?.needsNetwork &&
    srcId !== 'mock-walk'
  ) {
    return { bars, added: 0, expanded: false };
  }

  // Combined abort: caller signal + wall-clock budget so expand cannot hang loads
  const budgetMs =
    typeof opts?.budgetMs === 'number' && opts.budgetMs > 0
      ? opts.budgetMs
      : DEFAULT_EXPAND_BUDGET_MS;
  const ac = new AbortController();
  const onCallerAbort = () => ac.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const budgetTimer = setTimeout(() => ac.abort(), budgetMs);
  const signal = ac.signal;

  try {
    const step = intervalToSec(iv);
    const nowSec =
      typeof opts?.nowSec === 'number' && Number.isFinite(opts.nowSec)
        ? Math.floor(opts.nowSec)
        : Math.floor(Date.now() / 1000);
    const newest = bars[bars.length - 1]!.time;

    // Already covering current / prior bar — still refresh the forming candle once
    const nearNow = newest >= nowSec - step * 1.5;
    if (nearNow) {
      try {
        const pageLimit = Math.min(5, sourcePageLimit(srcId));
        const raw = await source.fetchHistorical({
          symbol: sym,
          interval: iv,
          endTime: nowSec,
          limit: pageLimit,
          signal,
          config: {
            ...sourceConfig(srcId),
            limit: pageLimit,
            fallback: false,
          },
        });
        const page = normalizeHistoricalBars(raw, { limit: pageLimit });
        if (page.length) {
          const before = bars.length;
          bars = await putCachedBars(srcId, sym, iv, page);
          return {
            bars,
            added: Math.max(0, bars.length - before),
            expanded: true,
          };
        }
      } catch (err: unknown) {
        return { bars, added: 0, expanded: false, error: errMessage(err) };
      }
      return { bars, added: 0, expanded: false };
    }

    const pageLimit = sourcePageLimit(srcId);
    let cursorEnd = nowSec;
    let pages = 0;
    let prevOldest: number | null = null;
    const beforeCount = bars.length;
    let lastError: string | undefined;

    while (pages < MAX_EXPAND_PAGES) {
      if (signal.aborted) break;

      pages += 1;
      let page: Bar[];
      try {
        const raw = await source.fetchHistorical({
          symbol: sym,
          interval: iv,
          endTime: cursorEnd,
          limit: pageLimit,
          signal,
          config: {
            ...sourceConfig(srcId),
            limit: pageLimit,
            fallback: false,
          },
        });
        page = normalizeHistoricalBars(raw, { limit: pageLimit });
      } catch (err: unknown) {
        lastError = errMessage(err);
        break;
      }

      if (!page.length) break;

      const rawOldest = page[0]!.time;
      // Keep bars that advance or refresh the series (overlap on newest is fine)
      const incoming = page.filter((b) => b.time >= newest);
      if (incoming.length) {
        bars = await putCachedBars(srcId, sym, iv, incoming);
      }

      // Overlapped into existing cache — done
      if (rawOldest <= newest + step) break;

      // Stalled cursor
      if (prevOldest != null && rawOldest >= prevOldest) break;
      if (rawOldest >= cursorEnd) break;

      prevOldest = rawOldest;
      cursorEnd = rawOldest - 1;
    }

    try {
      bars = await getCachedBars(srcId, sym, iv);
    } catch {
      /* keep last bars */
    }

    return {
      bars,
      added: Math.max(0, bars.length - beforeCount),
      expanded: pages > 0,
      error: lastError,
    };
  } finally {
    clearTimeout(budgetTimer);
    if (opts?.signal) opts.signal.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Persist a live bar into the Data Manager selection’s cache (dataset expand).
 * Fire-and-forget; safe to call on every tick (merge by time).
 * Debounced so open-bar updates do not rewrite the full series every frame.
 */
export function noteDataManagerLiveBar(bar: Bar): void {
  const clean = sanitizeBar(bar);
  if (!clean) return;
  // Only when chart source is Data Manager (or selection is active with that source)
  if (store.source !== DATA_MANAGER_SOURCE_ID && store.activePlugins?.source !== DATA_MANAGER_SOURCE_ID) {
    return;
  }
  const sel = getDataManagerSelection();
  if (!sel?.sourceId || !sel.symbol || !sel.interval) return;
  if (!canExpandFromSource(sel.sourceId) && sel.sourceId === 'csv-upload') return;

  const key = `${sel.sourceId}|${sel.symbol}|${sel.interval}`;
  livePendingBars.set(key, clean);

  // Closed bars flush promptly; open-bar ticks coalesce under the debounce window
  const delay = clean.closed ? 0 : LIVE_CACHE_DEBOUNCE_MS;
  const existing = liveWriteTimers.get(key);
  if (existing != null) {
    if (delay > 0) return; // already scheduled
    clearTimeout(existing);
    liveWriteTimers.delete(key);
  }

  const timer = setTimeout(() => {
    liveWriteTimers.delete(key);
    const pending = livePendingBars.get(key);
    livePendingBars.delete(key);
    if (!pending) return;
    void putCachedBars(sel.sourceId, sel.symbol, sel.interval, [pending]).catch(() => {
      /* cache write best-effort */
    });
  }, delay);
  liveWriteTimers.set(key, timer);
}

/** @internal test helper — flush pending live cache writes and clear timers. */
export function _flushDataManagerLiveBarForTests(): void {
  for (const t of liveWriteTimers.values()) clearTimeout(t);
  liveWriteTimers.clear();
  livePendingBars.clear();
}
