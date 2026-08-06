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
 * All network pages, merges, and IDB writes run in detached async jobs.
 * UI handlers only enqueue / cancel; they never await the full backfill.
 * Chart paint is opt-in via {@link applyJobToChart} or `applyWhenComplete`.
 *
 * @module data/data-source-manager
 */

import { createStore, produce } from 'solid-js/store';
import type { Bar } from '../store/types';
import { clampHistoryBars, loadBars, store } from '../store';
import { pluginKey } from '../plugins/types';
import { getManager, setDataToChart } from '../chart/manager-access';
import { getSource, sourcePageLimit } from '../sources/catalog';
import { normalizeHistoricalBars } from './parse-bars';
import { getCachedBars, putCachedBars } from './bars-cache';

export type DataSourceJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'complete'
  | 'error'
  | 'cancelled';

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
  barsFetched: number;
  pagesFetched: number;
  oldestSec: number | null;
  newestSec: number | null;
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
    barsFetched,
    pagesFetched,
    oldestSec,
    newestSec,
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
    barsFetched,
    pagesFetched,
    oldestSec,
    newestSec,
    error,
    createdAt,
    updatedAt,
    applyWhenComplete,
  };
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
    barsFetched: 0,
    pagesFetched: 0,
    oldestSec: null,
    newestSec: null,
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

async function runJob(j: InternalJob): Promise<void> {
  if (j.status === 'cancelled') return;
  setJobStatus(j, 'running');

  const source = getSource(j.sourceId);
  if (!source) {
    setJobStatus(j, 'error', `Unknown source: ${j.sourceId}`);
    return;
  }

  const pageLimit = sourcePageLimit(j.sourceId);
  const configs = store.pluginsConfig || {};
  const sourceCfg =
    configs[pluginKey('source', j.sourceId)] || configs[j.sourceId] || {};

  // Seed progress from existing cache (resume-friendly)
  try {
    const cached = await getCachedBars(j.sourceId, j.symbol, j.interval);
    if (cached.length) {
      j.barsFetched = cached.length;
      j.oldestSec = cached[0]!.time;
      j.newestSec = cached[cached.length - 1]!.time;
      j.updatedAt = Date.now();
      syncJob(j);
    }
  } catch {
    /* cache optional */
  }

  // Walk back: if we already have older bars than target, done
  if (j.oldestSec != null && j.oldestSec <= j.targetFromSec) {
    setJobStatus(j, 'complete');
    if (j.applyWhenComplete) void applyJobToChart(j.id);
    return;
  }

  let cursorEnd =
    j.oldestSec != null && j.oldestSec < j.targetToSec
      ? j.oldestSec - 1
      : j.targetToSec;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      // cancelBackfill aborts the controller; status is mirrored for UI
      if (j.abort.signal.aborted) {
        setJobStatus(j, 'cancelled');
        return;
      }
      // Pause: exit runner; resumeBackfill re-queues (no dual runners)
      if (j.paused) {
        setJobStatus(j, 'paused');
        return;
      }

      if (j.barsFetched >= MAX_BARS_PER_JOB) {
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id);
        return;
      }
      if (j.oldestSec != null && j.oldestSec <= j.targetFromSec) {
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id);
        return;
      }

      let raw: unknown;
      try {
        raw = await source.fetchHistorical({
          symbol: j.symbol,
          interval: j.interval,
          startTime: j.targetFromSec,
          endTime: cursorEnd,
          limit: pageLimit,
          signal: j.abort.signal,
          config: {
            ...sourceCfg,
            limit: pageLimit,
            // Avoid synthetic fallback masking real gaps during backfill
            fallback: false,
          },
        });
      } catch (err: unknown) {
        if (isAbortError(err) || j.abort.signal.aborted) {
          setJobStatus(j, 'cancelled');
          return;
        }
        throw err;
      }

      const pageBars = normalizeHistoricalBars(raw, { limit: pageLimit });
      j.pagesFetched += 1;

      if (!pageBars.length) {
        // Venue exhausted
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id);
        return;
      }

      const merged = await putCachedBars(j.sourceId, j.symbol, j.interval, pageBars);
      j.barsFetched = merged.length;
      j.oldestSec = merged[0]!.time;
      j.newestSec = merged[merged.length - 1]!.time;
      j.updatedAt = Date.now();
      syncJob(j);

      const pageOldest = pageBars[0]!.time;
      // No progress → stop (same page repeating)
      if (pageOldest >= cursorEnd) {
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id);
        return;
      }
      cursorEnd = pageOldest - 1;

      if (pageOldest <= j.targetFromSec) {
        setJobStatus(j, 'complete');
        if (j.applyWhenComplete) void applyJobToChart(j.id);
        return;
      }

      await yieldGap();
    }

    // Hit page cap — treat as complete with partial history
    setJobStatus(j, 'complete');
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
export async function applyJobToChart(jobId: string): Promise<boolean> {
  const j = internals.get(jobId);
  const meta = j || managerState.jobs.find((x) => x.id === jobId);
  if (!meta) return false;
  return applyCachedToChart(meta.sourceId, meta.symbol, meta.interval);
}

/**
 * Paint chart from bars-cache for source/symbol/interval.
 * Uses full cache when available; clamps only if empty of extras needed.
 */
export async function applyCachedToChart(
  sourceId: string,
  symbol: string,
  interval: string,
): Promise<boolean> {
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || store.interval || '1d');
  const srcId = String(sourceId || store.source || '');

  let bars: Bar[];
  try {
    bars = await getCachedBars(srcId, sym, iv);
  } catch {
    bars = [];
  }
  if (!bars.length) return false;

  // Prefer full accumulated history; soft-clamp only if absurdly large for chart
  const chartMax = Math.max(clampHistoryBars(store.historyBars), 5000);
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
    default:
      return store.exchange;
  }
}

/** Progress 0–1 toward targetFrom (1 = reached or older). */
export function jobProgress(job: DataSourceJob): number {
  if (job.status === 'complete') return 1;
  if (job.oldestSec == null) return 0;
  const span = job.targetToSec - job.targetFromSec;
  if (span <= 0) return 1;
  const covered = job.targetToSec - job.oldestSec;
  return Math.min(1, Math.max(0, covered / span));
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
