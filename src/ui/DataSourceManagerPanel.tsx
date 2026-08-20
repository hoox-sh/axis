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
 * Data Source Manager panel — enqueue background OHLCV backfills.
 *
 * Form (symbol / source / interval / past date) only starts jobs; all fetch
 * work runs in {@link data-source-manager}. Chart paint is opt-in per job.
 * Opens the Dataset manager for filtered browse + date-range / max-bars load.
 *
 * FloatableShell id `datasource`.
 */

import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { listSources } from '../sources/catalog';
import { WATCHLIST_INTERVALS } from '../data/watchlist-tickers';
import {
  dataSourceManagerState,
  startBackfill,
  cancelBackfill,
  pauseBackfill,
  resumeBackfill,
  dismissJob,
  applyJobToChart,
  jobProgress,
  defaultPastDateInput,
  pastDateInputToSec,
  type DataSourceJob,
} from '../data/data-source-manager';
import { DATA_MANAGER_SOURCE_ID } from '../data/data-manager-source';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { CachedDatasetsModal } from './CachedDatasetsModal';

function fmtTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  try {
    return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(sec);
  }
}

function statusLabel(job: DataSourceJob): string {
  if (job.status === 'running' || job.status === 'pending') {
    switch (job.phase) {
      case 'backfill':
        return job.status === 'pending' ? 'Queued' : 'Backfilling';
      case 'validate':
        return 'Validating';
      case 'gapfill':
        return 'Filling gaps';
      default:
        return job.status === 'pending' ? 'Queued' : 'Running';
    }
  }
  switch (job.status) {
    case 'paused':
      return 'Paused';
    case 'complete':
      return job.datasetComplete ? 'Complete' : 'Partial';
    case 'error':
      return 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return job.status;
  }
}

type JobFilter = 'all' | 'active' | 'done' | 'error';

function jobMatchesFilter(job: DataSourceJob, filter: JobFilter): boolean {
  switch (filter) {
    case 'active':
      return (
        job.status === 'running' ||
        job.status === 'pending' ||
        job.status === 'paused'
      );
    case 'done':
      return job.status === 'complete' || job.status === 'cancelled';
    case 'error':
      return job.status === 'error';
    default:
      return true;
  }
}

/** Dockable / floatable Data Source Manager. */
export const DataSourceManagerPanel: Component = () => {
  const [symbol, setSymbol] = createSignal(store.symbol || 'BTCUSDT');
  const [sourceId, setSourceId] = createSignal(store.source || 'binance-rest');
  const [interval, setInterval] = createSignal(store.interval || '1d');
  const [otherProvider, setOtherProvider] = createSignal(false);
  const [pastDate, setPastDate] = createSignal(defaultPastDateInput());
  const [applyWhenComplete, setApplyWhenComplete] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [formMsg, setFormMsg] = createSignal('');
  const [applyingId, setApplyingId] = createSignal<string | null>(null);
  const [datasetsOpen, setDatasetsOpen] = createSignal(false);
  const [jobFilter, setJobFilter] = createSignal<JobFilter>('all');
  const [jobQuery, setJobQuery] = createSignal('');

  const sources = () =>
    listSources().filter((s) => s.id !== DATA_MANAGER_SOURCE_ID);

  // Inherit chart venue unless the user explicitly backfills another source.
  // Symbol / interval stay editable (same provider, different series).
  createEffect(() => {
    if (otherProvider()) return;
    const src = store.source || 'binance-rest';
    if (src !== DATA_MANAGER_SOURCE_ID) setSourceId(src);
  });

  const filteredJobs = createMemo(() => {
    const f = jobFilter();
    const q = jobQuery().trim().toLowerCase();
    return dataSourceManagerState.jobs.filter((job) => {
      if (!jobMatchesFilter(job, f)) return false;
      if (!q) return true;
      const hay = `${job.symbol} ${job.interval} ${job.sourceId} ${job.status}`.toLowerCase();
      return q.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
    });
  });

  const onStart = (e?: Event) => {
    e?.preventDefault();
    setFormError('');
    setFormMsg('');
    const from = pastDateInputToSec(pastDate());
    if (from == null) {
      setFormError('Enter a valid past date (YYYY-MM-DD).');
      return;
    }
    const sym = (symbol().trim() || store.symbol || '').toUpperCase();
    if (!sym) {
      setFormError('Symbol required.');
      return;
    }
    try {
      // Fire-and-forget — startBackfill returns immediately
      const id = startBackfill({
        sourceId: sourceId(),
        symbol: sym,
        interval: interval(),
        targetFromSec: from,
        applyWhenComplete: applyWhenComplete(),
      });
      setFormMsg(`Started background job ${id.slice(0, 12)}…`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const onApply = async (id: string) => {
    setApplyingId(id);
    setFormError('');
    try {
      const ok = await applyJobToChart(id);
      if (!ok) setFormError('No cached bars to load for this job.');
      else setFormMsg('Loaded cached bars onto chart.');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <Show when={isPanelOpen('datasource')}>
      <FloatableShell id="datasource" testId="axis-datasource">
        <div class="flex-1 overflow-y-auto min-h-0 p-2 flex flex-col gap-3 text-[0.82rem]">
          <p class="text-muted m-0 leading-snug">
            Backfill OHLCV in the <strong>background</strong> down to a past date,
            then <strong>validate</strong> the series and <strong>fill gaps</strong>.
            Chart and live streams stay free; open the{' '}
            <em>Dataset manager</em> to load a date range or max bars.
          </p>

          <button
            type="button"
            class="sc-btn sc-btn-ghost w-full"
            onClick={() => setDatasetsOpen(true)}
            data-testid="axis-datasource-open-datasets"
            title="Browse cached OHLCV, filter the table, load date range or max bars"
          >
            <Icons.layers />
            <span>Dataset manager</span>
          </button>

          <CachedDatasetsModal
            open={datasetsOpen()}
            onClose={() => setDatasetsOpen(false)}
          />

          <form
            class="flex flex-col gap-2 border border-[var(--border)] rounded p-2"
            onSubmit={onStart}
            data-testid="axis-datasource-form"
          >
            <label class="flex flex-col gap-0.5">
              <span class="text-muted text-[0.72rem] uppercase tracking-wide">Symbol</span>
              <input
                type="text"
                class="sc-input"
                value={symbol()}
                onInput={(e) => setSymbol(e.currentTarget.value.toUpperCase())}
                autocomplete="off"
                spellcheck={false}
                data-testid="axis-datasource-symbol"
              />
            </label>

            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={otherProvider()}
                onChange={(e) => setOtherProvider(e.currentTarget.checked)}
                data-testid="axis-datasource-other-provider"
              />
              <span>Backfill a different source than the chart</span>
            </label>

            <label class="flex flex-col gap-0.5">
              <span class="text-muted text-[0.72rem] uppercase tracking-wide">Source / exchange</span>
              <select
                class="sc-input"
                value={sourceId()}
                disabled={!otherProvider()}
                onChange={(e) => setSourceId(e.currentTarget.value)}
                data-testid="axis-datasource-source"
              >
                <For each={sources()}>
                  {(s) => (
                    <option value={s.id}>
                      {s.name}
                    </option>
                  )}
                </For>
              </select>
            </label>

            <label class="flex flex-col gap-0.5">
              <span class="text-muted text-[0.72rem] uppercase tracking-wide">Timeframe</span>
              <select
                class="sc-input"
                value={interval()}
                onChange={(e) => setInterval(e.currentTarget.value)}
                data-testid="axis-datasource-interval"
              >
                <For each={[...WATCHLIST_INTERVALS]}>
                  {(iv) => <option value={iv}>{iv}</option>}
                </For>
              </select>
            </label>

            <label class="flex flex-col gap-0.5">
              <span class="text-muted text-[0.72rem] uppercase tracking-wide">Accumulate to (UTC date)</span>
              <input
                type="date"
                class="sc-input"
                value={pastDate()}
                onInput={(e) => setPastDate(e.currentTarget.value)}
                data-testid="axis-datasource-past-date"
              />
            </label>

            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applyWhenComplete()}
                onChange={(e) => setApplyWhenComplete(e.currentTarget.checked)}
                data-testid="axis-datasource-apply-when-done"
              />
              <span>Apply to chart when complete</span>
            </label>

            <button
              type="submit"
              class="sc-btn sc-btn-primary w-full"
              data-testid="axis-datasource-start"
            >
              <Icons.play />
              <span>Start background backfill</span>
            </button>

            <Show when={formError()}>
              <div class="text-red text-[0.78rem]" role="alert">
                {formError()}
              </div>
            </Show>
            <Show when={formMsg() && !formError()}>
              <div class="text-muted text-[0.78rem]">{formMsg()}</div>
            </Show>
          </form>

          <div class="flex flex-col gap-2" data-testid="axis-datasource-jobs">
            <div class="flex items-center justify-between gap-2">
              <div class="text-muted text-[0.72rem] uppercase tracking-wide">Jobs</div>
              <Show when={dataSourceManagerState.jobs.length}>
                <span class="text-[0.68rem] text-muted tabular-nums">
                  {filteredJobs().length}
                  {filteredJobs().length !== dataSourceManagerState.jobs.length
                    ? ` / ${dataSourceManagerState.jobs.length}`
                    : ''}
                </span>
              </Show>
            </div>

            <Show when={dataSourceManagerState.jobs.length}>
              <div
                class="flex flex-col gap-1.5"
                data-testid="axis-datasource-jobs-filters"
              >
                <input
                  type="search"
                  class="sc-input"
                  placeholder="Filter jobs…"
                  value={jobQuery()}
                  onInput={(e) => setJobQuery(e.currentTarget.value)}
                  data-testid="axis-datasource-jobs-query"
                  autocomplete="off"
                  spellcheck={false}
                />
                <div class="flex flex-wrap gap-1">
                  <For
                    each={
                      [
                        ['all', 'All'],
                        ['active', 'Active'],
                        ['done', 'Done'],
                        ['error', 'Error'],
                      ] as const
                    }
                  >
                    {([id, label]) => (
                      <button
                        type="button"
                        class={`sc-btn sc-btn-sm ${
                          jobFilter() === id ? 'sc-btn-primary' : 'sc-btn-ghost'
                        }`}
                        onClick={() => setJobFilter(id)}
                        data-testid={`axis-datasource-jobs-filter-${id}`}
                      >
                        {label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show
              when={dataSourceManagerState.jobs.length}
              fallback={
                <div class="text-muted text-[0.78rem] py-2">No jobs yet.</div>
              }
            >
              <Show
                when={filteredJobs().length}
                fallback={
                  <div class="text-muted text-[0.78rem] py-2">
                    No jobs match the current filter.
                  </div>
                }
              >
                <For each={filteredJobs()}>
                  {(job) => {
                    const pct = () => Math.round(jobProgress(job) * 100);
                    return (
                      <div
                        class="border border-[var(--border)] rounded p-2 flex flex-col gap-1.5"
                        data-testid={`axis-datasource-job-${job.id}`}
                        data-status={job.status}
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="font-medium truncate">
                              {job.symbol} · {job.interval}
                            </div>
                            <div class="text-muted text-[0.72rem] truncate">
                              {job.sourceId} · {statusLabel(job)}
                            </div>
                          </div>
                          <span class="text-[0.72rem] text-muted shrink-0">{pct()}%</span>
                        </div>

                        <div
                          class="h-1.5 rounded bg-[var(--border)] overflow-hidden"
                          role="progressbar"
                          aria-valuenow={pct()}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            class="h-full bg-[var(--accent,var(--indigo,#6366f1))] transition-[width] duration-200"
                            style={{ width: `${pct()}%` }}
                          />
                        </div>

                        <div class="text-[0.72rem] text-muted grid grid-cols-2 gap-x-2">
                          <span>Bars: {job.barsFetched}</span>
                          <span>Pages: {job.pagesFetched}</span>
                          <span>Oldest: {fmtTime(job.oldestSec)}</span>
                          <span>Newest: {fmtTime(job.newestSec)}</span>
                          <span>Past target: {fmtTime(job.targetFromSec)}</span>
                          <span>End: {fmtTime(job.targetToSec)}</span>
                          <span>
                            Gaps:{' '}
                            {job.gapsFound > 0
                              ? `${job.gapsFound}${job.gapsFilled ? ` · filled ${job.gapsFilled}` : ''}`
                              : job.datasetComplete
                                ? 'none'
                                : '—'}
                          </span>
                          <span>
                            {job.datasetComplete
                              ? 'Coverage: full'
                              : job.status === 'complete'
                                ? 'Coverage: partial'
                                : `Phase: ${job.phase || '…'}`}
                          </span>
                        </div>

                        <Show when={job.error}>
                          <div class="text-red text-[0.72rem]">{job.error}</div>
                        </Show>

                        <div class="flex flex-wrap gap-1 mt-0.5">
                          <Show when={job.status === 'running' || job.status === 'pending'}>
                            <button
                              type="button"
                              class="sc-btn sc-btn-ghost sc-btn-sm"
                              onClick={() => pauseBackfill(job.id)}
                            >
                              Pause
                            </button>
                            <button
                              type="button"
                              class="sc-btn sc-btn-ghost sc-btn-sm"
                              onClick={() => cancelBackfill(job.id)}
                            >
                              Cancel
                            </button>
                          </Show>
                          <Show when={job.status === 'paused'}>
                            <button
                              type="button"
                              class="sc-btn sc-btn-ghost sc-btn-sm"
                              onClick={() => resumeBackfill(job.id)}
                            >
                              Resume
                            </button>
                            <button
                              type="button"
                              class="sc-btn sc-btn-ghost sc-btn-sm"
                              onClick={() => cancelBackfill(job.id)}
                            >
                              Cancel
                            </button>
                          </Show>
                          <Show when={job.status === 'complete' || job.barsFetched > 0}>
                            <button
                              type="button"
                              class="sc-btn sc-btn-ghost sc-btn-sm"
                              disabled={applyingId() === job.id}
                              onClick={() => void onApply(job.id)}
                              data-testid={`axis-datasource-apply-${job.id}`}
                              title="Load full cached series (use Dataset manager for date range / max bars)"
                            >
                              <Icons.download />
                              <span>Load to chart</span>
                            </button>
                          </Show>
                          <Show
                            when={
                              job.status === 'complete' ||
                              job.status === 'error' ||
                              job.status === 'cancelled'
                            }
                          >
                            <button
                              type="button"
                              class="sc-btn sc-btn-ghost sc-btn-sm"
                              onClick={() => dismissJob(job.id)}
                              title="Remove from list"
                            >
                              <Icons.x />
                            </button>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
