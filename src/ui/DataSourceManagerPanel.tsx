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
 * Data Source Manager panel — enqueue background OHLCV backfills.
 *
 * Form only starts jobs; fetch work runs in {@link data-source-manager}.
 * Chart paint is opt-in per job. Opens the Dataset manager for filtered
 * browse + date-range / max-bars load.
 *
 * The job composer folds away once jobs exist, date presets fill the target
 * date, and finished jobs can be cleared in one action. FloatableShell id
 * `datasource`.
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store, isPanelOpen } from '../store';
import { listSources, sourcePageLimit } from '../sources/catalog';
import { WATCHLIST_INTERVALS } from '../data/watchlist-tickers';
import {
  DSM_MAX_BARS_PER_JOB,
  DSM_MAX_PAGES,
  dataSourceManagerState,
  startBackfill,
  cancelBackfill,
  pauseBackfill,
  resumeBackfill,
  dismissJob,
  applyJobToChart,
  defaultPastDateInput,
  pastDateInputToSec,
} from '../data/data-source-manager';
import { DATA_MANAGER_SOURCE_ID } from '../data/data-manager-source';
import { normalizeLoadSymbol } from '../data/symbol-exchange';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { openCachedDatasets } from './datasets-open';
import { announce } from './sr-announce';
import {
  BACKFILL_PRESETS,
  dateInputDaysAgo,
  estimateBackfill,
  presetDaysForDate,
} from './dsm/estimate';
import { ScField } from './Field';
import { JobCard } from './dsm/JobCard';
import {
  JOB_FILTERS,
  countJobsByFilter,
  jobMatchesFilter,
  jobMatchesQuery,
  jobTotals,
  type JobFilter,
} from './dsm/jobs';

/** Dockable / floatable Data Source Manager. */
export const DataSourceManagerPanel: Component = () => {
  const [symbol, setSymbol] = createSignal(store.symbol || 'BTCUSDT');
  const [symbolDirty, setSymbolDirty] = createSignal(false);
  const [sourceId, setSourceId] = createSignal(store.source || 'binance-rest');
  const [interval, setInterval] = createSignal(store.interval || '1d');
  const [intervalDirty, setIntervalDirty] = createSignal(false);
  const [otherProvider, setOtherProvider] = createSignal(false);
  const [pastDate, setPastDate] = createSignal(defaultPastDateInput());
  const [applyWhenComplete, setApplyWhenComplete] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [formMsg, setFormMsg] = createSignal('');
  const [applyingId, setApplyingId] = createSignal<string | null>(null);
  const [jobFilter, setJobFilter] = createSignal<JobFilter>('all');
  const [jobQuery, setJobQuery] = createSignal('');
  const [formOpen, setFormOpen] = createSignal(dataSourceManagerState.jobs.length === 0);
  let searchInput: HTMLInputElement | undefined;

  const sources = () => listSources().filter((s) => s.id !== DATA_MANAGER_SOURCE_ID);

  // Inherit chart venue / symbol / interval unless the user overrode them.
  createEffect(() => {
    if (otherProvider()) return;
    const src = store.source || 'binance-rest';
    if (src !== DATA_MANAGER_SOURCE_ID) setSourceId(src);
  });
  createEffect(() => {
    if (symbolDirty()) return;
    const next = String(store.symbol || 'BTCUSDT')
      .trim()
      .toUpperCase();
    if (next) setSymbol(next);
  });
  createEffect(() => {
    if (intervalDirty()) return;
    const next = String(store.interval || '1d').trim();
    if (next) setInterval(next);
  });

  onMount(() => {
    // `/` focuses the job search while the panel is mounted.
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchInput?.focus();
    };
    window.addEventListener('keydown', onSlash);
    onCleanup(() => window.removeEventListener('keydown', onSlash));
  });

  const estimate = createMemo(() =>
    estimateBackfill({
      fromSec: pastDateInputToSec(pastDate()),
      nowSec: Math.floor(Date.now() / 1000),
      interval: interval(),
      pageLimit: sourcePageLimit(sourceId()),
      maxBars: DSM_MAX_BARS_PER_JOB,
      maxPages: DSM_MAX_PAGES,
    }),
  );

  const filterCounts = createMemo(() => countJobsByFilter(dataSourceManagerState.jobs));
  const totals = createMemo(() => jobTotals(dataSourceManagerState.jobs));
  const finishedCount = createMemo(
    () =>
      dataSourceManagerState.jobs.filter(
        (j) => j.status === 'complete' || j.status === 'error' || j.status === 'cancelled',
      ).length,
  );

  const filteredJobs = createMemo(() => {
    const f = jobFilter();
    const q = jobQuery();
    return dataSourceManagerState.jobs.filter(
      (job) => jobMatchesFilter(job, f) && jobMatchesQuery(job, q),
    );
  });

  const activePreset = createMemo(() => {
    const days = presetDaysForDate(pastDate());
    if (days == null) return null;
    return BACKFILL_PRESETS.find((p) => p.days === days)?.id ?? null;
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
    if (from > Math.floor(Date.now() / 1000)) {
      setFormError('Pick a UTC date in the past.');
      return;
    }
    // `normalizeLoadSymbol` keeps the case for DEX pool symbols (base58 /
    // `network:0x…`); uppercasing here destroyed the pool address before the
    // request was even built.
    const sym = normalizeLoadSymbol(symbol().trim() || store.symbol || '', sourceId());
    if (!sym) {
      setFormError('Symbol required.');
      return;
    }
    const id = startBackfill({
      sourceId: sourceId(),
      symbol: sym,
      interval: interval(),
      targetFromSec: from,
      applyWhenComplete: applyWhenComplete(),
    });
    setFormMsg(`Started background job ${id.slice(0, 12)}…`);
    announce(`Started background backfill ${sym} ${interval()}`);
    setFormOpen(false);
  };

  const onApply = async (id: string) => {
    setApplyingId(id);
    setFormError('');
    try {
      const ok = await applyJobToChart(id);
      if (!ok) {
        setFormError('No cached bars to load for this job.');
      } else {
        setFormMsg('Loaded cached bars onto chart.');
        announce('Loaded cached bars onto chart');
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  };

  const openDatasets = (e?: Event) => {
    e?.stopPropagation();
    openCachedDatasets();
  };

  /** Reset the form to the chart's venue / symbol / interval. */
  const useChartSettings = () => {
    setOtherProvider(false);
    setSymbolDirty(false);
    setIntervalDirty(false);
    setSymbol(String(store.symbol || 'BTCUSDT').toUpperCase());
    setInterval(store.interval || '1d');
    const src = store.source || 'binance-rest';
    if (src !== DATA_MANAGER_SOURCE_ID) setSourceId(src);
    announce('Using chart settings');
  };

  const applyPreset = (days: number) => {
    setPastDate(dateInputDaysAgo(days));
  };

  const clearFinished = () => {
    const done = dataSourceManagerState.jobs.filter(
      (j) => j.status === 'complete' || j.status === 'error' || j.status === 'cancelled',
    );
    if (!done.length) return;
    for (const job of done) dismissJob(job.id);
    setFormMsg(`Cleared ${done.length} finished job${done.length === 1 ? '' : 's'}.`);
    announce('Cleared finished backfill jobs');
  };

  const resetJobFilters = () => {
    setJobFilter('all');
    setJobQuery('');
    searchInput?.focus();
  };

  return (
    <Show when={isPanelOpen('datasource')}>
      <FloatableShell
        id="datasource"
        testId="axis-datasource"
        headerEnd={
          <button
            type="button"
            class="ax-dsm-icon"
            onClick={openDatasets}
            onPointerDown={(e) => e.stopPropagation()}
            title="Dataset manager — browse cached OHLCV"
            aria-label="Open dataset manager"
          >
            <Icons.datasets size={12} />
          </button>
        }
      >
        <div class="ax-dsm">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div class="ax-dsm-head">
            <div class="ax-dsm-head-row">
              <span class="ax-dsm-kicker">Backfill</span>
              <span class="ax-dsm-summary" data-testid="axis-datasource-summary">
                <Show when={totals().active > 0}>
                  <span class="is-active">{totals().active} active</span>
                </Show>
                <span>{totals().done} done</span>
                <Show when={totals().issues > 0}>
                  <span class="is-issue">{totals().issues} issues</span>
                </Show>
              </span>
              <span class="ax-dsm-spacer" />
              <button
                type="button"
                class="ax-dsm-new"
                classList={{ 'is-on': formOpen() }}
                title={formOpen() ? 'Close the new-job form' : 'Start a new backfill job'}
                aria-expanded={formOpen()}
                data-testid="axis-datasource-new"
                onClick={() => {
                  if (!formOpen()) {
                    setFormMsg('');
                    setFormError('');
                  }
                  setFormOpen((v) => !v);
                }}
              >
                <Icons.plus size={11} /> New job
              </button>
            </div>
            <div class="ax-dsm-stats">
              <span title="Bars fetched across all jobs">
                {totals().bars.toLocaleString()} bar{totals().bars === 1 ? '' : 's'}
              </span>
              <span title="Venue pages fetched across all jobs">
                {totals().pages.toLocaleString()} page{totals().pages === 1 ? '' : 's'}
              </span>
              <span class="ax-dsm-source" title="Chart source">
                {store.source || '—'}
              </span>
            </div>
            <button
              type="button"
              class="ax-dsm-browse"
              onClick={openDatasets}
              data-testid="axis-datasource-open-datasets"
              title="Browse cached OHLCV, filter the table, load date range or max bars"
            >
              <Icons.datasets size={11} />
              <span>Browse datasets</span>
              <Icons.arrowRight size={10} class="ax-dsm-browse-arrow" />
            </button>
          </div>

          {/* ── Composer ───────────────────────────────────────────── */}
          <Show when={formOpen()}>
            <form class="ax-dsm-form" onSubmit={onStart} data-testid="axis-datasource-form">
              <div class="ax-dsm-form-head">
                <span class="ax-dsm-form-title">New job</span>
                <span class="ax-dsm-form-sub">
                  {symbol()} · {interval()} · {sourceId()}
                </span>
                <span class="ax-dsm-spacer" />
                <button
                  type="button"
                  class="ax-dsm-icon"
                  title="Close form"
                  aria-label="Close new-job form"
                  onClick={() => setFormOpen(false)}
                >
                  <Icons.x size={11} />
                </button>
              </div>

              <div class="ax-dsm-with-action">
                <ScField label="Symbol" class="flex-1">
                  <input
                    type="text"
                    class="sc-input"
                    value={symbol()}
                    onInput={(e) => {
                      setSymbolDirty(true);
                      setSymbol(e.currentTarget.value.toUpperCase());
                    }}
                    autocomplete="off"
                    spellcheck={false}
                    data-testid="axis-datasource-symbol"
                  />
                </ScField>
                <button
                  type="button"
                  class="ax-dsm-mini"
                  title="Use the chart symbol, source, and interval"
                  data-testid="axis-datasource-use-chart"
                  onClick={useChartSettings}
                >
                  <Icons.refresh size={10} /> Chart
                </button>
              </div>

              <label class="ax-dsm-check">
                <input
                  type="checkbox"
                  checked={otherProvider()}
                  onChange={(e) => setOtherProvider(e.currentTarget.checked)}
                  data-testid="axis-datasource-other-provider"
                />
                <span>Backfill a different source than the chart</span>
              </label>

              <ScField label="Source / exchange">
                <select
                  class="sc-input"
                  value={sourceId()}
                  disabled={!otherProvider()}
                  onChange={(e) => setSourceId(e.currentTarget.value)}
                  data-testid="axis-datasource-source"
                >
                  <For each={sources()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
                </select>
              </ScField>

              <div class="ax-dsm-grid-2">
                <ScField label="Timeframe">
                  <select
                    class="sc-input"
                    value={interval()}
                    onChange={(e) => {
                      setIntervalDirty(true);
                      setInterval(e.currentTarget.value);
                    }}
                    data-testid="axis-datasource-interval"
                  >
                    <For each={[...WATCHLIST_INTERVALS]}>
                      {(iv) => <option value={iv}>{iv}</option>}
                    </For>
                  </select>
                </ScField>
                <ScField label="Accumulate to (UTC)">
                  <input
                    type="date"
                    class="sc-input"
                    value={pastDate()}
                    onInput={(e) => setPastDate(e.currentTarget.value)}
                    data-testid="axis-datasource-past-date"
                  />
                </ScField>
              </div>

              {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
              <div class="ax-dsm-presets" role="group" aria-label="Backfill presets">
                <For each={BACKFILL_PRESETS}>
                  {(p) => (
                    <button
                      type="button"
                      class="ax-dsm-chip"
                      classList={{ 'is-active': activePreset() === p.id }}
                      aria-pressed={activePreset() === p.id}
                      title={`Accumulate to ${dateInputDaysAgo(p.days)} UTC`}
                      data-testid={`axis-datasource-preset-${p.id}`}
                      onClick={() => applyPreset(p.days)}
                    >
                      {p.label}
                    </button>
                  )}
                </For>
              </div>

              <div
                class="ax-dsm-estimate"
                classList={{ 'is-capped': estimate().capped }}
                data-testid="axis-datasource-estimate"
                aria-live="polite"
              >
                <div class="ax-dsm-stat" title="Clock time from that UTC date through now">
                  <span class="ax-dsm-stat-label">Span</span>
                  <span class="ax-dsm-stat-value">{estimate().spanLabel}</span>
                </div>
                <div
                  class="ax-dsm-stat"
                  title={`Dense ${interval()} bars from that date through now, including the current bar`}
                >
                  <span class="ax-dsm-stat-label">Bars</span>
                  <span class="ax-dsm-stat-value">{estimate().barsLabel}</span>
                </div>
                <div
                  class="ax-dsm-stat"
                  title={`Venue requests at ${estimate().pageLimit.toLocaleString()} bars each`}
                >
                  <span class="ax-dsm-stat-label">Pages</span>
                  <span class="ax-dsm-stat-value">{estimate().pagesLabel}</span>
                </div>
              </div>
              <Show when={estimate().note}>
                <p class="ax-dsm-note" data-testid="axis-datasource-estimate-note">
                  {estimate().note}
                </p>
              </Show>

              <label class="ax-dsm-check">
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
                class="sc-btn sc-btn-primary ax-dsm-start"
                data-testid="axis-datasource-start"
              >
                <Icons.play size={12} />
                <span>Start background backfill</span>
              </button>

              <Show when={formError()}>
                <div class="ax-dsm-error" role="alert">
                  {formError()}
                </div>
              </Show>
              <Show when={formMsg() && !formError()}>
                <div class="ax-dsm-msg" role="status" aria-live="polite">
                  {formMsg()}
                </div>
              </Show>
            </form>
          </Show>

          <Show when={!formOpen() && (formError() || formMsg())}>
            <div
              class="ax-dsm-msg"
              classList={{ 'is-error': Boolean(formError()) }}
              role={formError() ? 'alert' : 'status'}
              aria-live="polite"
            >
              {formError() || formMsg()}
            </div>
          </Show>

          {/* ── Jobs ───────────────────────────────────────────────── */}
          <div class="ax-dsm-jobs" data-testid="axis-datasource-jobs">
            <div class="ax-dsm-jobs-head">
              <span class="ax-dsm-jobs-title">Jobs</span>
              <span class="ax-dsm-count" data-testid="axis-datasource-count">
                {filteredJobs().length}
                {filteredJobs().length !== dataSourceManagerState.jobs.length
                  ? ` / ${dataSourceManagerState.jobs.length}`
                  : ''}
              </span>
              <span class="ax-dsm-spacer" />
              <Show when={finishedCount() > 0}>
                <button
                  type="button"
                  class="ax-dsm-mini"
                  title="Remove completed, errored, and cancelled jobs"
                  data-testid="axis-datasource-clear-finished"
                  onClick={clearFinished}
                >
                  <Icons.eraser size={10} /> Clear {finishedCount()}
                </button>
              </Show>
            </div>

            <Show when={dataSourceManagerState.jobs.length}>
              <div class="ax-dsm-jobs-filters" data-testid="axis-datasource-jobs-filters">
                <div class="ax-dsm-search">
                  <Icons.search size={12} />
                  <input
                    ref={searchInput}
                    type="search"
                    class="ax-dsm-search-input"
                    placeholder="Filter jobs…"
                    aria-label="Filter jobs"
                    value={jobQuery()}
                    onInput={(e) => setJobQuery(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && (jobQuery() || jobFilter() !== 'all')) {
                        e.preventDefault();
                        resetJobFilters();
                      }
                    }}
                    data-testid="axis-datasource-jobs-query"
                    autocomplete="off"
                    spellcheck={false}
                  />
                  <Show when={jobQuery()} fallback={<kbd class="ax-dsm-kbd">/</kbd>}>
                    <button
                      type="button"
                      class="ax-dsm-search-clear"
                      title="Clear job filter"
                      aria-label="Clear job filter"
                      onClick={resetJobFilters}
                    >
                      <Icons.x size={10} />
                    </button>
                  </Show>
                </div>
                {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
                <div class="ax-dsm-chips" role="group" aria-label="Job filters">
                  <For each={JOB_FILTERS}>
                    {(f) => (
                      <button
                        type="button"
                        class="ax-dsm-chip"
                        classList={{ 'is-active': jobFilter() === f.id }}
                        aria-pressed={jobFilter() === f.id}
                        onClick={() => setJobFilter(f.id)}
                        data-testid={`axis-datasource-jobs-filter-${f.id}`}
                      >
                        {f.label}
                        <span class="ax-dsm-chip-count">{filterCounts()[f.id]}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show
              when={dataSourceManagerState.jobs.length}
              fallback={
                <div class="ax-dsm-empty" data-testid="axis-datasource-empty">
                  <span class="ax-dsm-empty-icon">
                    <Icons.database size={18} />
                  </span>
                  <p class="ax-dsm-empty-title">No jobs yet</p>
                  <p class="ax-dsm-empty-sub">
                    Start a backfill above to cache deeper history without blocking the chart.
                  </p>
                </div>
              }
            >
              <Show
                when={filteredJobs().length}
                fallback={
                  <div class="ax-dsm-empty" data-testid="axis-datasource-no-match">
                    <p class="ax-dsm-empty-title">No jobs match</p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost ax-dsm-empty-btn"
                      onClick={resetJobFilters}
                    >
                      Reset filters
                    </button>
                  </div>
                }
              >
                <div class="ax-dsm-job-list">
                  <For each={filteredJobs()}>
                    {(job) => (
                      <JobCard
                        job={job}
                        applying={applyingId() === job.id}
                        onPause={() => pauseBackfill(job.id)}
                        onResume={() => resumeBackfill(job.id)}
                        onCancel={() => cancelBackfill(job.id)}
                        onApply={() => void onApply(job.id)}
                        onDismiss={() => dismissJob(job.id)}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
