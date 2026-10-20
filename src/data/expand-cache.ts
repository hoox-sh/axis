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
import { normalizeLoadSymbol } from './symbol-exchange';
import { getDataset, putDatasetBars } from './dataset-store';
import { providerDatasetLock } from './provider';
import { mergeBars } from './bars-cache';
import { isEngineOwnedLive } from '../engines/ownership';
import { findBarGaps, intervalToSec } from './bars-gaps';
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

interface PendingLiveBar {
  bar: Bar;
  sourceId: string;
  symbol: string;
  interval: string;
  lock: { market: string; authMode: string };
}

const liveWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const livePendingBars = new Map<string, PendingLiveBar>();

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
 * Walk venue pages from now back until they overlap `seed`'s newest bar.
 *
 * In-memory only — used on interval switch so live does not append “now”
 * onto a stale cache (yesterday + gap + current).
 */
export async function fillBarsTowardNow(
  seed: readonly Bar[],
  sourceId: string,
  symbol: string,
  interval: string,
  opts?: { signal?: AbortSignal; nowSec?: number; budgetMs?: number },
): Promise<ExpandCacheResult> {
  const srcId = String(sourceId || '').trim();
  const sym = normalizeLoadSymbol(String(symbol || ''), srcId);
  const iv = String(interval || '').trim();
  let bars = Array.isArray(seed) ? seed.slice() : [];
  if (!bars.length || !canExpandFromSource(srcId)) {
    return { bars, added: 0, expanded: false };
  }

  const { getSource, sourcePageLimit } = await loadSourceApi();
  const source = getSource(srcId);
  if (!source?.fetchHistorical) {
    return { bars, added: 0, expanded: false };
  }

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
  const before = bars.length;

  try {
    const step = intervalToSec(iv);
    const nowSec =
      typeof opts?.nowSec === 'number' && Number.isFinite(opts.nowSec)
        ? Math.floor(opts.nowSec)
        : Math.floor(Date.now() / 1000);
    const newest = bars[bars.length - 1]!.time;
    const pageLimit = sourcePageLimit(srcId);
    let cursorEnd = nowSec;
    let pages = 0;
    let prevOldest: number | null = null;
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
      bars = mergeBars(bars, page);
      if (rawOldest <= newest + step) break;
      if (prevOldest != null && rawOldest >= prevOldest) break;
      if (rawOldest >= cursorEnd) break;
      prevOldest = rawOldest;
      // One step of overlap, not one second: a venue answers "the newest bar
      // with open time <= endTime", so `rawOldest - 1` is safe only for a
      // venue whose bars sit exactly on the step grid. A venue with its own
      // phase (daily bars at 08:00 UTC) would answer with a bar one second
      // before its own grid point — a one-second hole in the dataset. The
      // overlap costs one duplicated bar per page and the merge drops it.
      cursorEnd = rawOldest - step;
    }

    return {
      bars,
      added: Math.max(0, bars.length - before),
      expanded: pages > 0,
      error: lastError,
    };
  } finally {
    clearTimeout(budgetTimer);
    if (opts?.signal) opts.signal.removeEventListener('abort', onCallerAbort);
  }
}

const MAX_INTERNAL_GAPS = 8;

/**
 * Fetch venue pages for holes inside `seed` (not just cache→now).
 * One 1m hole of ~100 bars is a single REST page.
 */
export async function fillInternalGaps(
  seed: readonly Bar[],
  sourceId: string,
  symbol: string,
  interval: string,
  opts?: { signal?: AbortSignal },
): Promise<ExpandCacheResult> {
  const srcId = String(sourceId || '').trim();
  const sym = normalizeLoadSymbol(String(symbol || ''), srcId);
  const iv = String(interval || '').trim();
  let bars = Array.isArray(seed) ? seed.slice() : [];
  if (bars.length < 2 || !canExpandFromSource(srcId)) {
    return { bars, added: 0, expanded: false };
  }
  const first = bars[0]!.time;
  const last = bars[bars.length - 1]!.time;
  const gaps = findBarGaps(bars, first, last, iv).filter((g) => g.missingBars >= 1);
  if (!gaps.length) return { bars, added: 0, expanded: false };

  const { getSource, sourcePageLimit } = await loadSourceApi();
  const source = getSource(srcId);
  if (!source?.fetchHistorical) return { bars, added: 0, expanded: false };

  const step = intervalToSec(iv);
  const pageLimit = sourcePageLimit(srcId);
  const before = bars.length;
  let pages = 0;
  for (const gap of gaps.slice(0, MAX_INTERNAL_GAPS)) {
    if (opts?.signal?.aborted) break;
    const limit = Math.min(pageLimit, gap.missingBars + 4);
    try {
      const raw = await source.fetchHistorical({
        symbol: sym,
        interval: iv,
        endTime: gap.toSec + step,
        limit,
        signal: opts?.signal,
        config: {
          ...sourceConfig(srcId),
          limit,
          fallback: false,
        },
      });
      const page = normalizeHistoricalBars(raw, { limit });
      if (page.length) {
        bars = mergeBars(bars, page);
        pages += 1;
      }
    } catch {
      /* next gap */
    }
  }
  return {
    bars,
    added: Math.max(0, bars.length - before),
    expanded: pages > 0,
  };
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
  opts?: {
    signal?: AbortSignal;
    nowSec?: number;
    budgetMs?: number;
    market?: string;
    authMode?: string;
  },
): Promise<ExpandCacheResult> {
  const srcId = String(sourceId || '').trim();
  // Dataset keys uppercase internally (barsCacheKey); the venue request must
  // keep DEX pool case (Solana base58) — same rule as the load path.
  const sym = normalizeLoadSymbol(String(symbol || ''), srcId);
  const iv = String(interval || '').trim();
  const lock = providerDatasetLock({
    market: opts?.market ?? store.provider?.market,
    authMode: opts?.authMode ?? store.provider?.authMode,
  });

  let bars: Bar[] = [];
  try {
    bars = await getDataset(srcId, sym, iv, lock);
  } catch {
    bars = [];
  }
  if (!bars.length) {
    return { bars: [], added: 0, expanded: false };
  }

  if (!canExpandFromSource(srcId)) {
    return { bars, added: 0, expanded: false };
  }

  // Engine-owned live mode: the engine's feed is the source of truth. A local
  // expand would fetch from the venue and persist into the dataset store,
  // competing with the series the engine already owns — so serve cache only.
  if (isEngineOwnedLive()) {
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
          bars = (await putDatasetBars(srcId, sym, iv, page, lock)).bars;
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
        bars = (await putDatasetBars(srcId, sym, iv, incoming, lock)).bars;
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
      bars = await getDataset(srcId, sym, iv, lock);
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
  // Engine-owned live mode: the engine's store persists the series, not us.
  if (isEngineOwnedLive()) return;
  const clean = sanitizeBar(bar);
  if (!clean) return;
  // Only when chart source is Data Manager (or selection is active with that source)
  if (store.source !== DATA_MANAGER_SOURCE_ID && store.activePlugins?.source !== DATA_MANAGER_SOURCE_ID) {
    return;
  }
  const sel = getDataManagerSelection();
  if (!sel?.sourceId || !sel.symbol || !sel.interval) return;
  if (!canExpandFromSource(sel.sourceId) && sel.sourceId === 'csv-upload') return;

  const lock = sel.market
    ? providerDatasetLock({ market: sel.market, authMode: sel.authMode })
    : providerDatasetLock(store.provider);
  const key = `${sel.sourceId}|${sel.symbol}|${sel.interval}|${lock.market}|${lock.authMode}`;
  // The lock is captured with the bar. A later selection must not retarget this tick.
  livePendingBars.set(key, {
    bar: clean,
    sourceId: sel.sourceId,
    symbol: sel.symbol,
    interval: sel.interval,
    lock,
  });

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
    void putDatasetBars(
      pending.sourceId,
      pending.symbol,
      pending.interval,
      [pending.bar],
      pending.lock,
    ).catch(() => {
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
