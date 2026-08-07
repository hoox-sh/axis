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
 * Background Data Source Manager — multi-page OHLCV backfill to a past date.
 *
 * Phases:
 * 1. **Backfill** — walk-back pagination (newest → older) with `endTime` + `limit`
 *    only (never `startTime`+`endTime` together — Binance-style trap).
 * 2. **Validate** — check the cached series is dense from target past date → end.
 * 3. **Gap-fill** — download missing ranges, re-validate until complete or stuck.
 *
 * All network work runs in detached async jobs (never blocks the chart path).
 *
 * @module data/data-source-manager
 */

import { createStore, produce } from 'solid-js/store';
import type { Bar } from '../store/types';
import { clampHistoryBars, HISTORY_BARS_MAX, loadBars, store } from '../store';
import { pluginKey } from '../plugins/types';
import type { SourcePlugin } from '../plugins/types';
import { getManager, setDataToChart } from '../chart/manager-access';
import { getSource, sourcePageLimit } from '../sources/catalog';
import { DATA_MANAGER_SOURCE_ID } from './data-manager-source';
import { normalizeHistoricalBars } from './parse-bars';
import {
  getCachedBars,
  putCachedBars,
  sliceBarsForLoad,
  type BarLoadWindow,
} from './bars-cache';
import {
  findBarGaps,
  intervalToSec,
  validateBarCoverage,
  type BarGap,
} from './bars-gaps';

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
  error: string | null;
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
}

const MAX_CONCURRENT = 1;
const MAX_PAGES = 200;
const MAX_BARS_PER_JOB = 50_000;
/** Cap retained terminal jobs so the manager UI/store cannot grow without bound. */
const MAX_RETAINED_JOBS = 40;
const PAGE_YIELD_MS = 50;
const DEFAULT_LOOKBACK_SEC = 90 * 86_400;

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

function jobId(): string {
  return `dsj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Unknown error';
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function yieldGap(ms = PAGE_YIELD_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function syncJob(j: InternalJob): void {
  const pub = publicJob(j);
  setManagerState(
    'jobs',
    produce((list) => {
      const i = list.findIndex((x) => x.id === j.id);
      if (i >= 0) list[i] = pub;
      else list.unshift(pub);
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

/**
 * Enqueue a background backfill. Returns the job id **immediately**;
 * network work continues detached (not awaited by the caller).
 */
export function startBackfill(opts: StartBackfillOpts = {}): string {
  const sourceId = String(opts.sourceId || store.source || 'binance-rest');
  const symbol = String(opts.symbol || store.symbol || '').trim().toUpperCase();
  const interval = String(opts.interval || store.interval || '1d');
  const targetToSec =
    typeof opts.targetToSec === 'number' && Number.isFinite(opts.targetToSec)
      ? Math.floor(opts.targetToSec)
      : nowSec();
  const targetFromSec =
    typeof opts.targetFromSec === 'number' && Number.isFinite(opts.targetFromSec)
      ? Math.floor(opts.targetFromSec)
      : targetToSec - DEFAULT_LOOKBACK_SEC;

  if (!symbol) {
    throw new Error('Symbol required');
  }
  if (sourceId === DATA_MANAGER_SOURCE_ID) {
    throw new Error('Data Manager is a cache reader — pick an exchange source to backfill');
  }
  if (!getSource(sourceId)) {
    throw new Error(`Unknown source: ${sourceId}`);
  }
  if (targetFromSec >= targetToSec) {
    throw new Error('Past date must be before now');
  }

  const id = jobId();
  const abort = new AbortController();
  const internal: InternalJob = {
    id,
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
    applyWhenComplete: !!opts.applyWhenComplete,
    abort,
    paused: false,
  };
  internals.set(id, internal);
  syncJob(internal);
  waitQueue.push(id);
  pumpQueue();
  return id;
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
  if (!j || j.status !== 'paused') return;
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
    const cached = await getCachedBars(j.sourceId, j.symbol, j.interval);
    if (cached.length) {
      j.barsFetched = cached.length;
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
  let raw: unknown;
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
  } catch (err: unknown) {
    // Re-throw aborts / real network errors to the job runner
    throw err;
  }
  // normalizeHistoricalBars never throws — drops partial/malformed rows
  const rawPage = normalizeHistoricalBars(raw, { limit: pageLimit });
  j.pagesFetched += 1;
  if (!rawPage.length) return null;

  const rawOldest = rawPage[0]!.time;
  const pageBars = rawPage.filter(
    (b) =>
      b &&
      Number.isFinite(b.time) &&
      b.time >= windowFrom &&
      b.time <= windowTo + 86_400,
  );
  if (pageBars.length) {
    try {
      const merged = await putCachedBars(j.sourceId, j.symbol, j.interval, pageBars);
      if (merged.length) {
        j.barsFetched = merged.length;
        j.oldestSec = merged[0]!.time;
        j.newestSec = merged[merged.length - 1]!.time;
        j.updatedAt = Date.now();
        syncJob(j);
      }
    } catch (err: unknown) {
      // Cache write failure should not kill the job mid-page — keep going with page data
      console.warn('[data-source-manager] putCachedBars failed', err);
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
 */
async function walkBackRange(
  j: InternalJob,
  source: SourcePlugin,
  pageLimit: number,
  windowFrom: number,
  windowTo: number,
  startCursorEnd: number,
  maxPages: number,
): Promise<'ok' | 'cancelled' | 'paused' | 'error'> {
  let cursorEnd = startCursorEnd;
  let prevPageOldest: number | null = null;
  let pages = 0;

  while (pages < maxPages) {
    if (j.abort.signal.aborted) return 'cancelled';
    if (j.paused) return 'paused';
    if (j.barsFetched >= MAX_BARS_PER_JOB) return 'ok';

    pages += 1;
    let result: { rawOldest: number; pageBars: Bar[] } | null;
    try {
      result = await fetchWalkPage(j, source, pageLimit, cursorEnd, windowFrom, windowTo);
    } catch (err: unknown) {
      if (isAbortError(err) || j.abort.signal.aborted) return 'cancelled';
      throw err;
    }

    if (!result) return 'ok'; // venue empty

    const { rawOldest, pageBars } = result;
    if (!pageBars.length) {
      // Page entirely outside window — if raw is older than window, done for this range
      if (rawOldest < windowFrom) return 'ok';
      // otherwise try older cursor
      if (prevPageOldest != null && rawOldest >= prevPageOldest) return 'ok';
      prevPageOldest = rawOldest;
      cursorEnd = rawOldest - 1;
      await yieldGap();
      continue;
    }

    if (prevPageOldest != null && rawOldest >= prevPageOldest) return 'ok';
    if (rawOldest > cursorEnd) return 'ok';

    prevPageOldest = rawOldest;
    cursorEnd = rawOldest - 1;

    if (rawOldest <= windowFrom) return 'ok';

    // Early exit when the full window is already dense (resume of complete cache)
    try {
      const cached = await getCachedBars(j.sourceId, j.symbol, j.interval);
      const report = validateBarCoverage(cached, windowFrom, windowTo, j.interval);
      if (report.complete) return 'ok';
    } catch {
      /* ignore */
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

  const step = intervalToSec(j.interval);
  let filled = 0;

  for (const gap of gaps) {
    if (j.abort.signal.aborted) return 'cancelled';
    if (j.paused) return 'paused';

    const before = (await getCachedBars(j.sourceId, j.symbol, j.interval)).length;
    // Walk back inside the gap window (endTime only)
    const outcome = await walkBackRange(
      j,
      source,
      pageLimit,
      gap.fromSec,
      gap.toSec,
      gap.toSec,
      Math.min(MAX_PAGES, Math.ceil(gap.missingBars / Math.max(1, pageLimit)) + 4),
    );
    if (outcome !== 'ok') return outcome;

    const after = (await getCachedBars(j.sourceId, j.symbol, j.interval)).length;
    if (after > before) {
      filled += 1;
      j.gapsFilled = (j.gapsFilled || 0) + 1;
      j.updatedAt = Date.now();
      syncJob(j);
    }
    void step;
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
 */
function needsNetworkBackfill(
  cached: Bar[],
  fromSec: number,
  toSec: number,
  interval: string,
): boolean {
  if (!cached.length) return true;
  const report = validateBarCoverage(cached, fromSec, toSec, interval);
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
  if (!source) {
    setJobStatus(j, 'error', `Unknown source: ${j.sourceId}`);
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
    if (needsNetworkBackfill(cached, j.targetFromSec, j.targetToSec, j.interval)) {
      j.phase = 'backfill';
      syncJob(j);
      // Always begin at the newest bound so trailing holes get filled first.
      const walk = await walkBackRange(
        j,
        source,
        pageLimit,
        j.targetFromSec,
        j.targetToSec,
        j.targetToSec,
        MAX_PAGES,
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

      cached = await getCachedBars(j.sourceId, j.symbol, j.interval);
      const report = validateBarCoverage(
        cached,
        j.targetFromSec,
        j.targetToSec,
        j.interval,
      );
      j.gapsFound = report.gaps.length;
      j.datasetComplete = report.complete;
      j.barsFetched = report.barCount || cached.length;
      j.oldestSec = report.oldestSec;
      j.newestSec = report.newestSec;
      j.updatedAt = Date.now();
      syncJob(j);

      if (report.complete) {
        j.phase = 'done';
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id);
        return;
      }

      // No discrete gaps but still sparse — force another full walk from now
      if (!report.gaps.length) {
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
            MAX_PAGES,
          );
          if (walk === 'cancelled') {
            setJobStatus(j, 'cancelled');
            return;
          }
          if (walk === 'paused') {
            setJobStatus(j, 'paused');
            return;
          }
          continue;
        }
        break;
      }

      // Prefer largest gaps first (trailing hole is usually biggest)
      const gaps = report.gaps
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
    }

    // Final validation
    const finalCached = await getCachedBars(j.sourceId, j.symbol, j.interval);
    const finalReport = validateBarCoverage(
      finalCached,
      j.targetFromSec,
      j.targetToSec,
      j.interval,
    );
    j.gapsFound = finalReport.gaps.length;
    j.datasetComplete = finalReport.complete;
    j.barsFetched = finalReport.barCount || finalCached.length;
    j.oldestSec = finalReport.oldestSec;
    j.newestSec = finalReport.newestSec;
    j.phase = 'done';
    j.updatedAt = Date.now();

    if (finalReport.complete) {
      setJobStatus(j, 'complete');
    } else {
      const n = finalReport.gaps.length;
      const sparse =
        finalReport.expectedBars > 0 &&
        finalReport.barCount < finalReport.expectedBars * 0.85;
      setJobStatus(
        j,
        'complete',
        n > 0
          ? `Partial: ${n} gap${n === 1 ? '' : 's'} remain (venue may lack data)`
          : sparse
            ? `Partial: ${finalReport.barCount}/${finalReport.expectedBars} bars`
            : null,
      );
    }
    if (j.applyWhenComplete) void applyJobToChart(j.id);
  } catch (err: unknown) {
    if (isAbortError(err) || j.abort.signal.aborted) {
      setJobStatus(j, 'cancelled');
      return;
    }
    setJobStatus(j, 'error', errMessage(err));
  }
}

/**
 * Load cached bars for a job (or key) onto the chart.
 * Does **not** re-run the network backfill.
 */
export async function applyJobToChart(
  jobId: string,
  window?: BarLoadWindow | null,
): Promise<boolean> {
  const j = internals.get(jobId);
  const meta = j || managerState.jobs.find((x) => x.id === jobId);
  if (!meta) return false;
  return applyCachedToChart(meta.sourceId, meta.symbol, meta.interval, window);
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
): Promise<boolean> {
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || store.interval || '1d');
  const srcId = String(sourceId || store.source || '');

  // Expand dataset toward now (venue REST) before painting
  try {
    const { expandCachedSeriesToNow } = await import('./expand-cache');
    await expandCachedSeriesToNow(srcId, sym, iv);
  } catch (err) {
    console.warn('[applyCachedToChart] expand to now failed', err);
  }

  let bars: Bar[];
  try {
    bars = await getCachedBars(srcId, sym, iv);
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

  // Prefer full accumulated history; soft-clamp only if absurdly large for chart
  const chartMax = Math.max(clampHistoryBars(store.historyBars), HISTORY_BARS_MAX);
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
  return true;
}

function exchangeForSource(sourceId: string): string {
  switch (sourceId) {
    case 'binance-rest':
      return 'binance';
    case 'okx-rest':
      return 'okx';
    case 'bybit-rest':
      return 'bybit';
    case 'coinbase-rest':
      return 'coinbase';
    case 'mock-walk':
      return 'mock';
    case 'csv-upload':
      return 'upload';
    case 'data-manager':
      return 'cache';
    default:
      return store.exchange;
  }
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
