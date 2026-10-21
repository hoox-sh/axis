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
 * Background Data Source Manager — multi-page OHLCV backfill to a past date.
 *
 * Phases:
 * 1. **Backfill** — walk-back pagination (newest → older) with `endTime` + `limit`
 *    only (never `startTime`+`endTime` together — Binance-style trap).
 * 2. **Validate** — check the cached series is dense from target past date → end.
 * 3. **Gap-fill** — download missing ranges, re-validate until complete or stuck.
 *
 * All network work runs in detached async jobs (never blocks the chart path).
 * The public API never throws: invalid input is clamped or settled, venue
 * failures retry then complete as Partial with whatever bars are cached.
 *
 * @module data/data-source-manager
 */

import { createStore, produce } from 'solid-js/store';
import type { Bar } from '../store/types';
import {
  chartWindowLimit,
  HISTORY_BARS_MAX,
  loadBars,
  store,
} from '../store';
import { pluginKey } from '../plugins/types';
import type { SourcePlugin } from '../plugins/types';
import { getManager, setDataToChart } from '../chart/manager-access';
import { getSource, sourcePageLimit } from '../sources/catalog';
import {
  DATA_MANAGER_SOURCE_ID,
  getDataManagerSelection,
  resolveDataManagerBars,
} from './data-manager-source';
import { normalizeHistoricalBars } from './parse-bars';
import { exchangeForSource, normalizeLoadSymbol } from './symbol-exchange';
import {
  sliceBarsForLoad,
  type BarLoadWindow,
} from './bars-cache';
import {
  getDataset,
  putDatasetBars,
  replaceDataset,
} from './dataset-store';
import {
  intervalToSec,
  mergeGaps,
  type BarGap,
} from './bars-gaps';
import {
  repairBars,
  validateDataset,
  venueClassForSourceCaps,
  type DatasetReport,
  type VenueClass,
} from './dataset-validate';
import { isSortedUnique } from './merge-datasets';
import { providerDatasetLock } from './provider';
import { errMessage, isAbortError } from '../utils/errors';
import { BoundedSet } from '../utils/bounded-map';

export type DataSourceJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'complete'
  | 'error'
  | 'cancelled';

export type DataSourceJobPhase = 'backfill' | 'validate' | 'gapfill' | 'done';

export interface DataSourceJob {
  id: string;
  sourceId: string;
  symbol: string;
  interval: string;
  /** Inclusive target oldest bar (unix sec). */
  targetFromSec: number;
  /** Newest bound at enqueue time (unix sec). */
  targetToSec: number;
  status: DataSourceJobStatus;
  /** Current work phase (UI). */
  phase: DataSourceJobPhase;
  barsFetched: number;
  pagesFetched: number;
  oldestSec: number | null;
  newestSec: number | null;
  /** Gaps detected on last validation. */
  gapsFound: number;
  /** Gaps successfully reduced / filled this run. */
  gapsFilled: number;
  /** True when series is contiguous from targetFrom → targetTo. */
  datasetComplete: boolean;
  /** Last recoverable failure (retry note or partial-complete reason). Never a throw. */
  error: string | null;
  /** Venue page retries so far this run. */
  retries: number;
  createdAt: number;
  updatedAt: number;
  /** Paint chart when job reaches complete (if symbol still matches). */
  applyWhenComplete: boolean;
}

export interface StartBackfillOpts {
  sourceId?: string;
  symbol?: string;
  interval?: string;
  /** Inclusive oldest target (unix sec). Default: now − 90d. */
  targetFromSec?: number;
  /** Inclusive newest bound (unix sec). Default: now. */
  targetToSec?: number;
  applyWhenComplete?: boolean;
}

interface InternalJob extends DataSourceJob {
  abort: AbortController;
  /** Pause flag checked between pages. */
  paused: boolean;
  /** Venue page retries exhausted — skip further network, deliver cache. */
  venueDead: boolean;
  /** AXIS provider lock captured when the job was created. */
  market: string;
  authMode: string;
}

function jobLock(j: { market?: string; authMode?: string }): { market: string; authMode: string } {
  return providerDatasetLock({ market: j.market, authMode: j.authMode });
}

const MAX_CONCURRENT = 1;
/** Walk stops after this many venue pages. */
export const DSM_MAX_PAGES = 200;
/** Walk stops after this many bars and keeps the newest. */
export const DSM_MAX_BARS_PER_JOB = 50_000;
/** Cap retained terminal jobs so the manager UI/store cannot grow without bound. */
const MAX_RETAINED_JOBS = 40;
const PAGE_YIELD_MS = 50;
const DEFAULT_LOOKBACK_SEC = 90 * 86_400;
/** First attempt + this many retries per walk page before giving up that page. */
const MAX_PAGE_RETRIES = 4;

interface ManagerState {
  jobs: DataSourceJob[];
}

const [managerState, setManagerState] = createStore<ManagerState>({ jobs: [] });

/** Reactive job list for UI. */
export function getDataSourceJobs(): DataSourceJob[] {
  return managerState.jobs;
}

/** Solid store accessor for fine-grained UI updates. */
export { managerState as dataSourceManagerState };

const internals = new Map<string, InternalJob>();
let activeCount = 0;
const waitQueue: string[] = [];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function countBarsInWindow(bars: readonly Bar[], fromSec: number, toSec: number): number {
  let n = 0;
  for (const b of bars) {
    if (b && b.time >= fromSec && b.time <= toSec) n += 1;
  }
  return n;
}

function jobVenueClass(sourceId: string) {
  return venueClassForSourceCaps(getSource(sourceId)?.capabilities);
}

function validateJobBars(
  bars: readonly Bar[],
  j: InternalJob,
  opts?: { persist?: boolean; fromSec?: number; toSec?: number },
): { repaired: Bar[]; report: DatasetReport } {
  // The dataset store repairs on **every** write (`putDatasetBars` /
  // `replaceDataset` both run the repair before persisting), so the series
  // that came back from the store is already repaired. Re-running the repair
  // copied and re-sorted the whole dataset (50k bars) on every validation
  // round — up to six times per job.
  //
  // The repair is only persisted when it was **non-destructive**: a repair
  // that dropped rows means the source series was corrupt, and overwriting
  // the dataset with the truncated copy would delete real venue bars.
  const needsRepair = !isSortedUnique(bars as Bar[]);
  const repair = needsRepair ? repairBars(bars, j.interval) : null;
  const repaired = repair ? repair.bars : (bars as Bar[]);
  const stats = repair?.stats;
  const lossy = !!stats && (stats.removed > 0 || repaired.length < bars.length);
  if (!lossy && stats?.snapped && opts?.persist !== false) {
    void replaceDataset(j.sourceId, j.symbol, j.interval, repaired, jobLock(j)).catch(() => {
      /* persist is best-effort */
    });
  }
  const report = validateDataset(
    repaired,
    opts?.fromSec ?? j.targetFromSec,
    opts?.toSec ?? j.targetToSec,
    j.interval,
    {
      venueClass: jobVenueClass(j.sourceId),
    },
  );
  return { repaired, report };
}

function jobId(): string {
  return `dsj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function yieldGap(ms = PAGE_YIELD_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageRetryDelayMs(attempt: number): number {
  return Math.min(4_000, 250 * 2 ** Math.max(0, attempt));
}

/** Sleep `ms` or return early when the job is aborted. */
async function yieldGapOrAbort(j: InternalJob, ms: number): Promise<boolean> {
  if (j.abort.signal.aborted) return true;
  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      j.abort.signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    j.abort.signal.addEventListener('abort', onAbort, { once: true });
  });
  return j.abort.signal.aborted;
}

function publicJob(j: InternalJob): DataSourceJob {
  const {
    id,
    sourceId,
    symbol,
    interval,
    targetFromSec,
    targetToSec,
    status,
    phase,
    barsFetched,
    pagesFetched,
    oldestSec,
    newestSec,
    gapsFound,
    gapsFilled,
    datasetComplete,
    error,
    retries,
    createdAt,
    updatedAt,
    applyWhenComplete,
  } = j;
  return {
    id,
    sourceId,
    symbol,
    interval,
    targetFromSec,
    targetToSec,
    status,
    phase,
    barsFetched,
    pagesFetched,
    oldestSec,
    newestSec,
    gapsFound,
    gapsFilled,
    datasetComplete,
    error,
    retries,
    createdAt,
    updatedAt,
    applyWhenComplete,
  };
}

function isTerminalStatus(status: DataSourceJobStatus): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

/** Drop oldest terminal jobs beyond {@link MAX_RETAINED_JOBS}. */
function pruneJobList(): void {
  const list = managerState.jobs;
  if (list.length <= MAX_RETAINED_JOBS) return;
  const terminal = list.filter((j) => isTerminalStatus(j.status));
  const active = list.filter((j) => !isTerminalStatus(j.status));
  const keepTerminal = terminal
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, Math.max(0, MAX_RETAINED_JOBS - active.length));
  const keepIds = new Set([...active, ...keepTerminal].map((j) => j.id));
  for (const j of list) {
    if (!keepIds.has(j.id) && isTerminalStatus(j.status)) {
      internals.delete(j.id);
    }
  }
  setManagerState(
    'jobs',
    list.filter((j) => keepIds.has(j.id)),
  );
}

/**
 * Jobs the user dismissed (or that were pruned).
 *
 * A detached `runJob` keeps its `InternalJob` reference after the job left
 * the list, so a late `syncJob` would re-insert it — the dismissed job
 * reappears in the DSM panel. Membership in `internals` is the authority:
 * a job that is no longer tracked is never published again.
 */
/**
 * Job ids the user dismissed.
 *
 * Capped: the set only exists so a dismissed job does not come back, and a
 * long session that starts thousands of jobs must not keep every id forever.
 */
/** Cap on remembered dismissed job ids. */
const DISMISSED_JOB_MEMO_MAX = 500;
const dismissedJobs = new BoundedSet<string>(DISMISSED_JOB_MEMO_MAX);

function syncJob(j: InternalJob): void {
  if (dismissedJobs.has(j.id)) return;
  const pub = publicJob(j);
  setManagerState(
    'jobs',
    produce((list) => {
      const i = list.findIndex((x) => x.id === j.id);
      if (i >= 0) list[i] = pub;
      else if (internals.has(j.id)) list.unshift(pub);
    }),
  );
  if (isTerminalStatus(j.status)) pruneJobList();
}

function setJobStatus(j: InternalJob, status: DataSourceJobStatus, error: string | null = null): void {
  j.status = status;
  j.error = error;
  j.updatedAt = Date.now();
  syncJob(j);
}

function makeJob(
  sourceId: string,
  symbol: string,
  interval: string,
  targetFromSec: number,
  targetToSec: number,
  applyWhenComplete: boolean,
  lock: { market: string; authMode: string },
): InternalJob {
  return {
    id: jobId(),
    sourceId,
    symbol,
    interval,
    targetFromSec,
    targetToSec,
    status: 'pending',
    phase: 'backfill',
    barsFetched: 0,
    pagesFetched: 0,
    oldestSec: null,
    newestSec: null,
    gapsFound: 0,
    gapsFilled: 0,
    datasetComplete: false,
    error: null,
    retries: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    applyWhenComplete,
    abort: new AbortController(),
    paused: false,
    venueDead: false,
    market: lock.market,
    authMode: lock.authMode,
  };
}

function enqueueJob(internal: InternalJob): string {
  internals.set(internal.id, internal);
  syncJob(internal);
  waitQueue.push(internal.id);
  pumpQueue();
  return internal.id;
}

/**
 * Enqueue a background backfill. Returns the job id **immediately** and
 * never throws — invalid input is clamped or settled as a complete job
 * that still delivers whatever is already cached.
 */
export function startBackfill(opts: StartBackfillOpts = {}): string {
  let lock = providerDatasetLock(store.provider);
  try {
    let sourceId = String(opts.sourceId || store.source || 'binance-rest');
    // DEX pool symbols (network:0x… / base58) are case-sensitive — reuse the
    // load path's normalization so backfills never corrupt the venue request.
    let symbol = normalizeLoadSymbol(
      String(opts.symbol ?? store.symbol ?? ''),
      sourceId,
    );
    let interval = String(opts.interval || store.interval || '1d');
    let targetToSec =
      typeof opts.targetToSec === 'number' && Number.isFinite(opts.targetToSec)
        ? Math.floor(opts.targetToSec)
        : nowSec();
    let targetFromSec =
      typeof opts.targetFromSec === 'number' && Number.isFinite(opts.targetFromSec)
        ? Math.floor(opts.targetFromSec)
        : targetToSec - DEFAULT_LOOKBACK_SEC;

    if (!symbol) {
      symbol = normalizeLoadSymbol(String(store.symbol || ''), sourceId);
    }

    // Data Manager is a cache reader — remap to the selected venue when known.
    if (sourceId === DATA_MANAGER_SOURCE_ID) {
      try {
        const sel = getDataManagerSelection();
        if (
          sel?.sourceId &&
          sel.sourceId !== DATA_MANAGER_SOURCE_ID &&
          getSource(sel.sourceId)
        ) {
          sourceId = sel.sourceId;
          if (!String(opts.symbol ?? '').trim()) symbol = sel.symbol || symbol;
          if (!opts.interval) interval = sel.interval || interval;
          if (sel.market || sel.authMode) {
            lock = providerDatasetLock({ market: sel.market, authMode: sel.authMode });
          }
        }
      } catch {
        /* selection lookup is best-effort */
      }
    }

    if (targetFromSec > targetToSec) {
      const swap = targetFromSec;
      targetFromSec = targetToSec;
      targetToSec = swap;
    }
    if (targetFromSec === targetToSec) {
      targetFromSec = targetToSec - DEFAULT_LOOKBACK_SEC;
    }

    if (!symbol) {
      const settled = makeJob(
        sourceId,
        'UNKNOWN',
        interval,
        targetFromSec,
        targetToSec,
        !!opts.applyWhenComplete,
        lock,
      );
      settled.phase = 'done';
      internals.set(settled.id, settled);
      setJobStatus(settled, 'complete', 'Symbol required');
      return settled.id;
    }

    for (const existing of internals.values()) {
      if (
        existing.sourceId === sourceId &&
        existing.symbol === symbol &&
        existing.interval === interval &&
        existing.market === lock.market &&
        existing.authMode === lock.authMode &&
        (existing.status === 'running' ||
          existing.status === 'pending' ||
          existing.status === 'paused')
      ) {
        if (targetFromSec < existing.targetFromSec) existing.targetFromSec = targetFromSec;
        if (targetToSec > existing.targetToSec) existing.targetToSec = targetToSec;
        existing.updatedAt = Date.now();
        syncJob(existing);
        if (existing.status === 'paused') resumeBackfill(existing.id);
        return existing.id;
      }
    }

    return enqueueJob(
      makeJob(
        sourceId,
        symbol,
        interval,
        targetFromSec,
        targetToSec,
        !!opts.applyWhenComplete,
        lock,
      ),
    );
  } catch (err: unknown) {
    const settled = makeJob(
      String(opts.sourceId || store.source || 'binance-rest'),
      normalizeLoadSymbol(
        String(opts.symbol || store.symbol || 'UNKNOWN'),
        String(opts.sourceId || store.source || 'binance-rest'),
      ) || 'UNKNOWN',
      String(opts.interval || store.interval || '1d'),
      nowSec() - DEFAULT_LOOKBACK_SEC,
      nowSec(),
      !!opts.applyWhenComplete,
      lock,
    );
    settled.phase = 'done';
    internals.set(settled.id, settled);
    setJobStatus(settled, 'complete', errMessage(err));
    return settled.id;
  }
}

/** Cancel a job (in-flight page aborts; no further pages). */
export function cancelBackfill(jobId: string): void {
  const j = internals.get(jobId);
  if (!j) return;
  if (j.status === 'complete' || j.status === 'cancelled') return;
  j.paused = false;
  j.abort.abort();
  setJobStatus(j, 'cancelled');
  // Remove from wait queue if still pending
  const qi = waitQueue.indexOf(jobId);
  if (qi >= 0) waitQueue.splice(qi, 1);
}

/**
 * Pause between pages (current page may finish). The runner exits after the
 * in-flight page; {@link resumeBackfill} re-queues a fresh runner.
 */
export function pauseBackfill(jobId: string): void {
  const j = internals.get(jobId);
  if (!j || (j.status !== 'running' && j.status !== 'pending')) return;
  j.paused = true;
  if (j.status === 'pending') {
    const qi = waitQueue.indexOf(jobId);
    if (qi >= 0) waitQueue.splice(qi, 1);
    setJobStatus(j, 'paused');
  }
  // running → runner flips status to paused at page boundary
}

/** Resume a paused job (new background runner). */
export function resumeBackfill(jobId: string): void {
  const j = internals.get(jobId);
  if (!j) return;
  // The pause request may not have reached the runner yet — the status flips
  // at the next page boundary. A resume in that window used to be dropped
  // (the status was still `running`), so the job stayed paused until the
  // user pressed resume again.
  if (j.status === 'running' && j.paused) {
    // The runner is still in flight: clear the flag and let it continue.
    // Re-queueing here would run the job twice.
    j.paused = false;
    j.updatedAt = Date.now();
    syncJob(j);
    return;
  }
  if (j.status !== 'paused') return;
  j.paused = false;
  // Fresh controller so a prior cancel edge does not stick
  if (j.abort.signal.aborted) {
    j.abort = new AbortController();
  }
  setJobStatus(j, 'pending');
  if (!waitQueue.includes(jobId)) waitQueue.push(jobId);
  pumpQueue();
}

/** Drop a finished/cancelled job from the list. */
export function dismissJob(jobId: string): void {
  const j = internals.get(jobId);
  if (j && (j.status === 'running' || j.status === 'pending' || j.status === 'paused')) {
    cancelBackfill(jobId);
  }
  // Mark it dismissed before dropping the handle: a detached runner still holds
  // the job and would otherwise re-publish it on its next `syncJob`.
  dismissedJobs.add(jobId);
  internals.delete(jobId);
  setManagerState(
    'jobs',
    produce((list) => {
      const i = list.findIndex((x) => x.id === jobId);
      if (i >= 0) list.splice(i, 1);
    }),
  );
}

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT && waitQueue.length) {
    const id = waitQueue.shift()!;
    const j = internals.get(id);
    if (!j) continue;
    if (j.status === 'cancelled' || j.status === 'complete' || j.status === 'error') continue;
    activeCount++;
    // Detached — do not return this promise to UI callers
    void runJob(j).finally(() => {
      activeCount = Math.max(0, activeCount - 1);
      pumpQueue();
    });
  }
}

async function refreshJobFromCache(j: InternalJob): Promise<Bar[]> {
  try {
    const cached = await getDataset(j.sourceId, j.symbol, j.interval, jobLock(j));
    if (cached.length) {
      j.barsFetched = countBarsInWindow(cached, j.targetFromSec, j.targetToSec);
      j.oldestSec = cached[0]!.time;
      j.newestSec = cached[cached.length - 1]!.time;
    } else {
      j.barsFetched = 0;
      j.oldestSec = null;
      j.newestSec = null;
    }
    j.updatedAt = Date.now();
    syncJob(j);
    return cached;
  } catch {
    return [];
  }
}

function sourceConfig(sourceId: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  return configs[pluginKey('source', sourceId)] || configs[sourceId] || {};
}

/** One walk-back page at endTime; merges into cache. Returns raw page oldest or null. */
async function fetchWalkPage(
  j: InternalJob,
  source: SourcePlugin,
  pageLimit: number,
  cursorEnd: number,
  windowFrom: number,
  windowTo: number,
): Promise<{ rawOldest: number; pageBars: Bar[] } | null> {
  let raw: unknown = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_PAGE_RETRIES; attempt++) {
    if (j.abort.signal.aborted) {
      throw j.abort.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    try {
      raw = await source.fetchHistorical({
        symbol: j.symbol,
        interval: j.interval,
        endTime: cursorEnd,
        limit: pageLimit,
        signal: j.abort.signal,
        config: {
          ...sourceConfig(j.sourceId),
          limit: pageLimit,
          fallback: false,
        },
      });
      lastErr = null;
      j.venueDead = false;
      if (j.error && j.error.startsWith('Retrying')) j.error = null;
      break;
    } catch (err: unknown) {
      if (isAbortError(err) || j.abort.signal.aborted) throw err;
      lastErr = err;
      j.retries += 1;
      j.error = `Retrying (${attempt + 1}/${MAX_PAGE_RETRIES}): ${errMessage(err)}`;
      j.updatedAt = Date.now();
      syncJob(j);
      if (attempt < MAX_PAGE_RETRIES) {
        const aborted = await yieldGapOrAbort(j, pageRetryDelayMs(attempt));
        if (aborted) throw new DOMException('Aborted', 'AbortError');
      }
    }
  }
  if (lastErr) {
    // Page exhausted retries — stop this walk, keep whatever we already have.
    j.venueDead = true;
    j.error = errMessage(lastErr);
    j.updatedAt = Date.now();
    syncJob(j);
    return null;
  }
  // normalizeHistoricalBars never throws — drops partial/malformed rows
  const rawPage = normalizeHistoricalBars(raw, { limit: pageLimit });
  j.pagesFetched += 1;
  if (!rawPage.length) return null;

  const rawOldest = rawPage[0]!.time;
  // One step of slack, not a hardcoded day: a day is 1440 bars of noise on a
  // 1m series and far too little on a monthly one.
  const slack = intervalToSec(j.interval);
  const pageBars = rawPage.filter(
    (b) =>
      b &&
      Number.isFinite(b.time) &&
      b.time >= windowFrom &&
      b.time <= windowTo + slack,
  );
  if (pageBars.length) {
    try {
      const merged = await putDatasetBars(j.sourceId, j.symbol, j.interval, pageBars, jobLock(j));
      if (merged.bars.length) {
        j.barsFetched = countBarsInWindow(merged.bars, j.targetFromSec, j.targetToSec);
        j.oldestSec = merged.bars[0]!.time;
        j.newestSec = merged.bars[merged.bars.length - 1]!.time;
        j.updatedAt = Date.now();
        syncJob(j);
      }
    } catch (err: unknown) {
      // Cache write failure should not kill the job mid-page — keep going with page data
      console.warn('[data-source-manager] putDatasetBars failed', err);
      if (!j.oldestSec || pageBars[0]!.time < j.oldestSec) j.oldestSec = pageBars[0]!.time;
      if (!j.newestSec || pageBars[pageBars.length - 1]!.time > j.newestSec) {
        j.newestSec = pageBars[pageBars.length - 1]!.time;
      }
      j.barsFetched = Math.max(j.barsFetched, pageBars.length);
      j.updatedAt = Date.now();
      syncJob(j);
    }
  }
  return { rawOldest, pageBars };
}

/**
 * Walk-back from cursorEnd toward windowFrom until target reached, empty, or stalled.
 * Always advances using the **raw** page oldest (not cache oldest) so we keep
 * walking even when the cache already holds a far-past fragment.
 *
 * `followJobBounds` re-reads the job's target window on every page. A second
 * `startBackfill` for the same series widens the job's window while the walk
 * is running; without this the walk kept the bounds it was launched with and
 * the widened range was never fetched by the walk itself.
 */
async function walkBackRange(
  j: InternalJob,
  source: SourcePlugin,
  pageLimit: number,
  windowFrom: number,
  windowTo: number,
  startCursorEnd: number,
  maxPages: number,
  opts?: { followJobBounds?: boolean },
): Promise<'ok' | 'cancelled' | 'paused' | 'error'> {
  let cursorEnd = startCursorEnd;
  let prevPageOldest: number | null = null;
  let pages = 0;
  const step = intervalToSec(j.interval);

  while (pages < maxPages) {
    if (j.abort.signal.aborted) return 'cancelled';
    if (j.paused) return 'paused';
    if (j.barsFetched >= DSM_MAX_BARS_PER_JOB) return 'ok';

    // A widened job window takes effect on the next page.
    const from = opts?.followJobBounds ? Math.min(windowFrom, j.targetFromSec) : windowFrom;
    const to = opts?.followJobBounds ? Math.max(windowTo, j.targetToSec) : windowTo;

    pages += 1;
    let result: { rawOldest: number; pageBars: Bar[] } | null;
    try {
      result = await fetchWalkPage(j, source, pageLimit, cursorEnd, from, to);
    } catch (err: unknown) {
      if (isAbortError(err) || j.abort.signal.aborted) return 'cancelled';
      j.retries += 1;
      j.error = errMessage(err);
      j.updatedAt = Date.now();
      syncJob(j);
      return 'ok';
    }

    if (!result) return 'ok'; // venue empty

    const { rawOldest, pageBars } = result;
    if (!pageBars.length) {
      // Page entirely outside window — if raw is older than window, done for this range
      if (rawOldest < from) return 'ok';
      // otherwise try older cursor
      if (prevPageOldest != null && rawOldest >= prevPageOldest) return 'ok';
      prevPageOldest = rawOldest;
      // One step of overlap, not one second. A venue answers "the newest bar
      // with open time <= endTime"; `rawOldest - 1` is only safe for a venue
      // whose bars sit on a grid that is exactly `step` apart from the one it
      // just returned. The overlap re-fetches a single bar per page (the
      // merge drops it) and keeps the walked series on one grid — a one
      // second hole in the dataset is a phantom gap the job then chases.
      cursorEnd = rawOldest - step;
      await yieldGap();
      continue;
    }

    if (prevPageOldest != null && rawOldest >= prevPageOldest) return 'ok';
    if (rawOldest > cursorEnd) return 'ok';

    prevPageOldest = rawOldest;
    cursorEnd = rawOldest - step;

    if (rawOldest <= from) return 'ok';

    // Early exit when the full window is already dense (resume of complete cache).
    // Re-validating the whole window every page is O(pages×n) — re-check every
    // 4th page (always the first) instead. The check never persists: it only
    // asks "is the window already dense?".
    if (pages % 4 === 1) {
      try {
        const cached = await getDataset(j.sourceId, j.symbol, j.interval, jobLock(j));
        const { report } = validateJobBars(cached, j, {
          persist: false,
          fromSec: from,
          toSec: to,
        });
        if (report.complete) return 'ok';
      } catch {
        /* ignore */
      }
    }

    await yieldGap();
  }
  return 'ok';
}

async function fillGaps(
  j: InternalJob,
  source: SourcePlugin,
  pageLimit: number,
  gaps: BarGap[],
): Promise<'ok' | 'cancelled' | 'paused' | 'error'> {
  j.phase = 'gapfill';
  j.updatedAt = Date.now();
  syncJob(j);

  for (const gap of gaps) {
    if (j.abort.signal.aborted) return 'cancelled';
    if (j.paused) return 'paused';

    // Measure against the **dataset store** the job writes to. The bars-cache
    // is a different store: in `session` persistence mode it is never written,
    // so the count never moved and `gapsFilled` stayed 0 for every filled gap.
    const before = await getDataset(j.sourceId, j.symbol, j.interval, jobLock(j)).then(
      (bars) => bars.length,
      () => 0,
    );
    // Walk back inside the gap window (endTime only)
    const outcome = await walkBackRange(
      j,
      source,
      pageLimit,
      gap.fromSec,
      gap.toSec,
      gap.toSec,
      Math.min(DSM_MAX_PAGES, Math.ceil(gap.missingBars / Math.max(1, pageLimit)) + 4),
    );
    if (outcome !== 'ok') return outcome;

    const after = await getDataset(j.sourceId, j.symbol, j.interval, jobLock(j)).then(
      (bars) => bars.length,
      () => 0,
    );
    if (after > before) {
      j.gapsFilled = (j.gapsFilled || 0) + 1;
      j.updatedAt = Date.now();
      syncJob(j);
    }
    await yieldGap();
  }
  return 'ok';
}

/**
 * True when cache still needs network work for [from, to]:
 * - empty / missing ends
 * - newest too old vs `to`
 * - oldest too new vs `from`
 * - any density gaps
 *
 * The venue calendar class matters: without it a `sessions` venue's weekend
 * closure counts as a fillable gap and the job re-walks the whole range on
 * every run even though the dataset is already complete.
 */
function needsNetworkBackfill(
  cached: Bar[],
  fromSec: number,
  toSec: number,
  interval: string,
  venueClass?: VenueClass,
): boolean {
  if (!cached.length) return true;
  // `cached` comes from the dataset store, which repairs on every write — the
  // series is already sorted, unique and sanitized. Re-running the repair
  // here copied and re-sorted the whole dataset (50k bars) on every job.
  const report = validateDataset(cached, fromSec, toSec, interval, { venueClass });
  if (!report.complete) return true;
  const step = intervalToSec(interval);
  if (report.newestSec == null || toSec - report.newestSec > step * 1.5) return true;
  if (report.oldestSec == null || report.oldestSec > fromSec + step * 1.5) return true;
  // Density: far fewer bars than expected ⇒ incomplete even if gap finder missed
  if (report.expectedBars > 0 && report.barCount < report.expectedBars * 0.85) {
    return true;
  }
  return false;
}

async function runJob(j: InternalJob): Promise<void> {
  if (j.status === 'cancelled') return;
  setJobStatus(j, 'running');
  j.phase = 'backfill';
  j.pagesFetched = 0;
  j.gapsFilled = 0;
  syncJob(j);

  const source = getSource(j.sourceId);
  if (!source || j.sourceId === DATA_MANAGER_SOURCE_ID) {
    await deliverCacheOnlyJob(j);
    return;
  }

  const pageLimit = sourcePageLimit(j.sourceId);
  const step = intervalToSec(j.interval);

  try {
    // Seed progress from existing cache (resume-friendly)
    let cached = await refreshJobFromCache(j);

    // Phase 1: ALWAYS walk from **now** (targetTo) back toward targetFrom when
    // coverage is incomplete. Never start at cache.oldest − 1 only — that skips
    // the recent side when the cache holds an old one-page fragment (e.g. 1000
    // bars from 2020 with Pages:0 / Complete bug).
    if (
      needsNetworkBackfill(
        cached,
        j.targetFromSec,
        j.targetToSec,
        j.interval,
        jobVenueClass(j.sourceId),
      )
    ) {
      j.phase = 'backfill';
      syncJob(j);
      // Always begin at the newest bound so trailing holes get filled first.
      // The walk follows the job's window: a second `startBackfill` for the
      // same series widens the range while this walk runs, and the widened
      // range has to be fetched by the walk itself.
      const walk = await walkBackRange(
        j,
        source,
        pageLimit,
        j.targetFromSec,
        j.targetToSec,
        j.targetToSec,
        DSM_MAX_PAGES,
        { followJobBounds: true },
      );
      if (walk === 'cancelled') {
        setJobStatus(j, 'cancelled');
        return;
      }
      if (walk === 'paused') {
        setJobStatus(j, 'paused');
        return;
      }
      cached = await refreshJobFromCache(j);
    }

    // Venue is gone — do not chase gaps; deliver whatever is cached.
    if (j.venueDead) {
      j.phase = 'done';
      j.datasetComplete = false;
      setJobStatus(
        j,
        'complete',
        j.error || 'Partial: venue unavailable',
      );
      if (j.applyWhenComplete && j.barsFetched > 0) void applyJobToChart(j.id, null, { onlyIfCurrent: true });
      return;
    }

    // Phase 2–3: validate coverage and fill remaining gaps
    const MAX_GAP_ROUNDS = 6;
    for (let round = 0; round < MAX_GAP_ROUNDS; round++) {
      if (j.abort.signal.aborted) {
        setJobStatus(j, 'cancelled');
        return;
      }
      if (j.paused) {
        setJobStatus(j, 'paused');
        return;
      }

      j.phase = 'validate';
      syncJob(j);

      cached = await getDataset(j.sourceId, j.symbol, j.interval, jobLock(j));
      const { report } = validateJobBars(cached, j);
      j.gapsFound = report.fillableGaps.length;
      j.datasetComplete = report.complete;
      j.barsFetched = report.barCount || countBarsInWindow(cached, j.targetFromSec, j.targetToSec);
      j.oldestSec = report.oldestSec;
      j.newestSec = report.newestSec;
      j.updatedAt = Date.now();
      syncJob(j);

      if (report.complete) {
        j.phase = 'done';
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id, null, { onlyIfCurrent: true });
        return;
      }

      // No discrete fillable gaps but still sparse — force another full walk from now
      if (!report.fillableGaps.length) {
        if (
          round < 2 &&
          (report.barCount < report.expectedBars * 0.85 ||
            report.newestSec == null ||
            j.targetToSec - (report.newestSec ?? 0) > step * 1.5)
        ) {
          const walk = await walkBackRange(
            j,
            source,
            pageLimit,
            j.targetFromSec,
            j.targetToSec,
            j.targetToSec,
            DSM_MAX_PAGES,
          );
          if (walk === 'cancelled') {
            setJobStatus(j, 'cancelled');
            return;
          }
          if (walk === 'paused') {
            setJobStatus(j, 'paused');
            return;
          }
          if (j.venueDead) break;
          continue;
        }
        break;
      }

      // Prefer largest fillable gaps first (trailing hole is usually biggest).
      // Adjacent gaps are merged first: one walk-back covers the union, so a
      // fragmented hole costs one request instead of one per fragment.
      const gaps = mergeGaps(report.fillableGaps, step)
        .slice()
        .sort((a, b) => b.missingBars - a.missingBars)
        .slice(0, 48);
      const fill = await fillGaps(j, source, pageLimit, gaps);
      if (fill === 'cancelled') {
        setJobStatus(j, 'cancelled');
        return;
      }
      if (fill === 'paused') {
        setJobStatus(j, 'paused');
        return;
      }
      if (j.venueDead) break;
    }

    // Final validation
    const finalCached = await getDataset(j.sourceId, j.symbol, j.interval, jobLock(j));
    // The user may have cancelled while the dataset was being read. Without
    // this guard the final block flips the job back to `complete` and paints a
    // chart the user just cancelled.
    if (j.abort.signal.aborted) {
      setJobStatus(j, 'cancelled');
      return;
    }
    const { report: finalReport } = validateJobBars(finalCached, j);
    j.gapsFound = finalReport.fillableGaps.length;
    j.datasetComplete = finalReport.complete;
    j.barsFetched = finalReport.barCount || countBarsInWindow(finalCached, j.targetFromSec, j.targetToSec);
    j.oldestSec = finalReport.oldestSec;
    j.newestSec = finalReport.newestSec;
    j.phase = 'done';
    j.updatedAt = Date.now();

    if (finalReport.complete) {
      setJobStatus(j, 'complete');
    } else {
      const n = finalReport.fillableGaps.length;
      const sparse =
        finalReport.expectedBars > 0 &&
        finalReport.barCount < finalReport.expectedBars * 0.85;
      const coverageNote =
        n > 0
          ? `Partial: ${n} gap${n === 1 ? '' : 's'} remain (venue may lack data)`
          : sparse
            ? `Partial: ${finalReport.barCount}/${finalReport.expectedBars} bars`
            : null;
      const note = [coverageNote, j.error].filter(Boolean).join(' · ') || null;
      setJobStatus(j, 'complete', note);
    }
    if (j.applyWhenComplete && j.barsFetched > 0) void applyJobToChart(j.id, null, { onlyIfCurrent: true });
  } catch (err: unknown) {
    if (isAbortError(err) || j.abort.signal.aborted) {
      setJobStatus(j, 'cancelled');
      return;
    }
    // Never error-out: deliver whatever is already cached.
    try {
      await refreshJobFromCache(j);
    } catch {
      /* ignore */
    }
    j.phase = 'done';
    setJobStatus(
      j,
      'complete',
      errMessage(err) || 'Partial: venue unavailable',
    );
    if (j.applyWhenComplete && j.barsFetched > 0) void applyJobToChart(j.id, null, { onlyIfCurrent: true });
  }
}

/** Cache-reader / unknown source: deliver stored bars, no network. */
async function deliverCacheOnlyJob(j: InternalJob): Promise<void> {
  // The user may have cancelled while the cache was being read — this job
  // had no abort check at all and painted a chart the user just cancelled.
  if (j.abort.signal.aborted) {
    setJobStatus(j, 'cancelled');
    return;
  }
  try {
    if (j.sourceId === DATA_MANAGER_SOURCE_ID) {
      const resolved = await resolveDataManagerBars(j.symbol, j.interval);
      if (j.abort.signal.aborted) {
        setJobStatus(j, 'cancelled');
        return;
      }
      if (resolved?.bars.length) {
        j.barsFetched = resolved.bars.length;
        j.oldestSec = resolved.bars[0]!.time;
        j.newestSec = resolved.bars[resolved.bars.length - 1]!.time;
        j.datasetComplete = true;
        j.phase = 'done';
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) {
          void applyCachedToChart(resolved.sourceId, resolved.symbol, resolved.interval, null, {
            onlyIfCurrent: true,
          });
        }
        return;
      }
    } else {
      await refreshJobFromCache(j);
    }
  } catch {
    /* cache read is best-effort */
  }
  if (j.abort.signal.aborted) {
    setJobStatus(j, 'cancelled');
    return;
  }
  j.phase = 'done';
  j.datasetComplete = j.barsFetched > 0;
  const note = getSource(j.sourceId)
    ? j.barsFetched
      ? null
      : 'No cached dataset'
    : `Unknown source: ${j.sourceId}`;
  setJobStatus(j, 'complete', note);
  if (j.applyWhenComplete && j.barsFetched > 0) void applyJobToChart(j.id, null, { onlyIfCurrent: true });
}

/**
 * Load cached bars for a job (or key) onto the chart.
 * Does **not** re-run the network backfill.
 */
export async function applyJobToChart(
  jobId: string,
  window?: BarLoadWindow | null,
  opts?: { onlyIfCurrent?: boolean },
): Promise<boolean> {
  const j = internals.get(jobId);
  const meta = j || managerState.jobs.find((x) => x.id === jobId);
  if (!meta) return false;
  return applyCachedToChart(meta.sourceId, meta.symbol, meta.interval, window, {
    ...opts,
    ...(j ? { market: j.market, authMode: j.authMode } : {}),
  });
}

/**
 * Paint chart from bars-cache for source/symbol/interval.
 *
 * Closes the gap from cache newest → now via the venue REST source (dataset
 * expands in bars-cache), then optional {@link BarLoadWindow} trims by from /
 * maxBars before the chart soft-clamp. Upper date bound is opened so the
 * expanded tail reaches the chart.
 */
export async function applyCachedToChart(
  sourceId: string,
  symbol: string,
  interval: string,
  window?: BarLoadWindow | null,
  opts?: { onlyIfCurrent?: boolean; market?: string; authMode?: string },
): Promise<boolean> {
  try {
    return await applyCachedToChartInner(sourceId, symbol, interval, window, opts);
  } catch (err) {
    console.warn('[applyCachedToChart] failed', err);
    return false;
  }
}

async function applyCachedToChartInner(
  sourceId: string,
  symbol: string,
  interval: string,
  window?: BarLoadWindow | null,
  opts?: { onlyIfCurrent?: boolean; market?: string; authMode?: string },
): Promise<boolean> {
  const srcId = String(sourceId || store.source || '');
  const sym = normalizeLoadSymbol(symbol, srcId);
  const iv = String(interval || store.interval || '1d');
  const lock =
    opts && (opts.market != null || opts.authMode != null)
      ? providerDatasetLock({ market: opts.market, authMode: opts.authMode })
      : providerDatasetLock(store.provider);

  // Background auto-apply ("apply when complete") must not paint over a newer
  // symbol/interval/source the user has since loaded. Explicit UI applies
  // (DSM panel / cached-datasets modal) bypass this guard.
  if (opts?.onlyIfCurrent) {
    const curSym = normalizeLoadSymbol(store.symbol, store.source);
    // The chart may be showing the Data Manager source while the job runs
    // against the underlying venue — compare against the *resolved* chart
    // source, otherwise the guard never passes and the chart is never painted.
    let chartSrc = store.source;
    if (chartSrc === DATA_MANAGER_SOURCE_ID) {
      try {
        const { getDataManagerSelection } = await import('./data-manager-source');
        chartSrc = getDataManagerSelection()?.sourceId || chartSrc;
      } catch {
        /* keep the raw chart source */
      }
    }
    const chartLock = providerDatasetLock(store.provider);
    if (
      sym !== curSym ||
      iv !== store.interval ||
      srcId !== chartSrc ||
      lock.market !== chartLock.market ||
      lock.authMode !== chartLock.authMode
    ) {
      return false;
    }
  }

  // Expand dataset toward now (venue REST) before painting
  try {
    const { expandCachedSeriesToNow } = await import('./expand-cache');
    await expandCachedSeriesToNow(srcId, sym, iv, lock);
  } catch (err) {
    console.warn('[applyCachedToChart] expand to now failed', err);
  }

  let bars: Bar[];
  try {
    bars = await getDataset(srcId, sym, iv, lock);
  } catch {
    bars = [];
  }
  if (!bars.length) return false;

  // Honour from + maxBars; drop toSec so newly filled bars are included
  const loadWin: BarLoadWindow | null = window
    ? {
        fromSec: window.fromSec,
        toSec: null,
        maxBars: window.maxBars,
      }
    : null;
  bars = sliceBarsForLoad(bars, loadWin);
  if (!bars.length) return false;

  // Chart shows an explicit maxBars window when the caller asked for one
  // (dataset modal / job apply); otherwise the Settings → Rolling window
  // default. The dataset keeps everything — this only bounds the paint.
  // HISTORY_BARS_MAX stays the hard safety clamp.
  const explicit =
    loadWin?.maxBars != null &&
    Number.isFinite(loadWin.maxBars) &&
    loadWin.maxBars > 0
      ? Math.floor(loadWin.maxBars)
      : null;
  const chartMax = Math.min(
    explicit ?? chartWindowLimit(),
    HISTORY_BARS_MAX,
  );
  const painted = bars.length > chartMax ? bars.slice(bars.length - chartMax) : bars;

  const exchange = exchangeForSource(srcId);
  loadBars(painted, sym, iv, exchange);
  const manager = getManager();
  if (manager) {
    try {
      setDataToChart(painted, { fit: true });
    } catch (err) {
      console.error('applyCachedToChart setDataToChart failed:', err);
    }
  }
  // Restore applied scripts after full clear+paint (same as load-symbol)
  try {
    const { reapplyChartScripts } = await import('../indicators/reapply');
    await reapplyChartScripts();
  } catch {
    /* re-run optional */
  }
  return true;
}

/**
 * Re-slice the chart to a new Rolling window.
 *
 * The dataset keeps its full depth — only the painted window changes. The
 * dataset is the source when it holds more bars than the chart (it usually
 * does); otherwise the painted window is trimmed in place.
 *
 * Used by every UI that changes the window (status bar inline edit, Settings
 * page) so the chart never keeps a window the user has already changed.
 */
export async function applyChartWindow(nextBars: number): Promise<boolean> {
  const next = Math.floor(Number(nextBars));
  if (!Number.isFinite(next) || next <= 0) return false;
  const srcId = String(store.source || '');
  const sym = String(store.symbol || '');
  const iv = String(store.interval || '1d');
  try {
    const ok = await applyCachedToChart(srcId, sym, iv, { maxBars: next });
    if (ok) return true;
  } catch {
    /* fall through to the in-place trim */
  }
  const bars = store.bars;
  if (!bars?.length) return false;
  const trimmed = bars.length > next ? bars.slice(bars.length - next) : bars;
  loadBars(trimmed, sym, iv, store.exchange);
  const manager = getManager();
  if (manager) {
    try {
      setDataToChart(trimmed, { fit: false, clearScriptState: false, clearMarkers: false });
    } catch {
      /* paint is best-effort */
    }
  }
  return true;
}

/**
 * Progress 0–1: primarily range coverage toward targetFrom; when gap-filling,
 * blend in gap reduction so the bar does not sit at 100% with holes left.
 */
export function jobProgress(job: DataSourceJob): number {
  if (job.status === 'complete' && job.datasetComplete) return 1;
  if (job.oldestSec == null) return 0;
  const span = job.targetToSec - job.targetFromSec;
  if (span <= 0) return job.datasetComplete ? 1 : 0.5;
  const rangeCover = Math.min(1, Math.max(0, (job.targetToSec - job.oldestSec) / span));
  if (job.phase === 'gapfill' || job.phase === 'validate') {
    // Soften 100% while gaps remain
    if (job.gapsFound > 0) {
      const gapPenalty = Math.min(0.25, job.gapsFound * 0.03);
      return Math.min(0.98, Math.max(0.5, rangeCover) * (1 - gapPenalty) + 0.5 * rangeCover);
    }
  }
  if (job.status === 'complete') return job.datasetComplete ? 1 : Math.min(0.99, rangeCover);
  return rangeCover;
}

/** Default past-date for the form: 90 days ago as YYYY-MM-DD. */
export function defaultPastDateInput(): string {
  const d = new Date(Date.now() - DEFAULT_LOOKBACK_SEC * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` (UTC midnight) → unix sec. */
export function pastDateInputToSec(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
  return Number.isFinite(t) ? t : null;
}

/** Parse `YYYY-MM-DD` → inclusive end of that UTC day (23:59:59). */
export function dateInputToEndSec(value: string): number | null {
  const start = pastDateInputToSec(value);
  if (start == null) return null;
  return start + 86_400 - 1;
}

/** Format unix sec → `YYYY-MM-DD` (UTC) for `<input type="date">`. */
export function secToDateInput(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '';
  try {
    return new Date(sec * 1000).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/** @internal test helper */
export function _resetDataSourceManagerForTests(): void {
  for (const j of internals.values()) {
    try {
      j.abort.abort();
    } catch {
      /* ignore */
    }
  }
  internals.clear();
  dismissedJobs.clear();
  waitQueue.length = 0;
  activeCount = 0;
  setManagerState('jobs', []);
}

/** @internal test helper — wait until job is not pending/running/paused */
export async function _waitForJob(
  id: string,
  timeoutMs = 10_000,
): Promise<DataSourceJob | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const j = managerState.jobs.find((x) => x.id === id);
    if (j && (j.status === 'complete' || j.status === 'error' || j.status === 'cancelled')) {
      return j;
    }
    await yieldGap(20);
  }
  return managerState.jobs.find((x) => x.id === id) ?? null;
}
