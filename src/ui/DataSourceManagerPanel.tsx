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
 * Form only starts jobs; fetch work runs in {@link data-source-manager}.
 * Chart paint is opt-in per job. Opens the Dataset manager for filtered
 * browse + date-range / max-bars load.
 *
 * FloatableShell id `datasource`.
 */

import { type Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
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
  defaultPastDateInput,
  pastDateInputToSec,
} from '../data/data-source-manager';
import { DATA_MANAGER_SOURCE_ID } from '../data/data-manager-source';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { CachedDatasetsModal } from './CachedDatasetsModal';
import { announce } from './sr-announce';
import { DsmField } from './dsm/Field';
import { JobCard } from './dsm/JobCard';
import {
  JOB_FILTERS,
  countJobsByFilter,
  jobMatchesFilter,
  jobMatchesQuery,
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
  const [datasetsOpen, setDatasetsOpen] = createSignal(false);
  const [jobFilter, setJobFilter] = createSignal<JobFilter>('all');
  const [jobQuery, setJobQuery] = createSignal('');

  const sources = () => listSources().filter((s) => s.id !== DATA_MANAGER_SOURCE_ID);

  // Inherit chart venue / symbol / interval unless the user overrode them.
  createEffect(() => {
    if (otherProvider()) return;
    const src = store.source || 'binance-rest';
    if (src !== DATA_MANAGER_SOURCE_ID) setSourceId(src);
  });
  createEffect(() => {
    if (symbolDirty()) return;
    const next = String(store.symbol || 'BTCUSDT').trim().toUpperCase();
    if (next) setSymbol(next);
  });
  createEffect(() => {
    if (intervalDirty()) return;
    const next = String(store.interval || '1d').trim();
    if (next) setInterval(next);
  });

  const filterCounts = createMemo(() => countJobsByFilter(dataSourceManagerState.jobs));

  const filteredJobs = createMemo(() => {
    const f = jobFilter();
    const q = jobQuery();
    return dataSourceManagerState.jobs.filter(
      (job) => jobMatchesFilter(job, f) && jobMatchesQuery(job, q),
    );
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
    const id = startBackfill({
      sourceId: sourceId(),
      symbol: sym,
      interval: interval(),
      targetFromSec: from,
      applyWhenComplete: applyWhenComplete(),
    });
    setFormMsg(`Started background job ${id.slice(0, 12)}…`);
    announce(`Started background backfill ${sym} ${interval()}`);
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
    setDatasetsOpen(true);
  };

  return (
    <Show when={isPanelOpen('datasource')}>
      <FloatableShell
        id="datasource"
        testId="axis-datasource"
        headerEnd={
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1"
            onClick={openDatasets}
            onPointerDown={(e) => e.stopPropagation()}
            title="Dataset manager — browse cached OHLCV"
            aria-label="Open dataset manager"
          >
            <Icons.datasets />
          </button>
        }
      >
        <div class="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2 text-[12px]">
          <p class="text-muted m-0 leading-snug">
            Background OHLCV backfill to a past date. Jobs retry venue blips and
            keep whatever bars they have. Chart and live streams stay free.
          </p>

          <button
            type="button"
            class="sc-btn sc-btn-ghost w-full"
            onClick={openDatasets}
            data-testid="axis-datasource-open-datasets"
            title="Browse cached OHLCV, filter the table, load date range or max bars"
          >
            <Icons.datasets />
            <span>Browse datasets</span>
          </button>

          <CachedDatasetsModal
            open={datasetsOpen()}
            onClose={() => setDatasetsOpen(false)}
          />

          <form
            class="flex flex-col gap-2 border border-border rounded-md p-2"
            onSubmit={onStart}
            data-testid="axis-datasource-form"
          >
            <DsmField label="Symbol">
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
            </DsmField>

            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={otherProvider()}
                onChange={(e) => setOtherProvider(e.currentTarget.checked)}
                data-testid="axis-datasource-other-provider"
              />
              <span>Backfill a different source than the chart</span>
            </label>

            <DsmField label="Source / exchange">
              <select
                class="sc-input"
                value={sourceId()}
                disabled={!otherProvider()}
                onChange={(e) => setSourceId(e.currentTarget.value)}
                data-testid="axis-datasource-source"
              >
                <For each={sources()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
              </select>
            </DsmField>

            <DsmField label="Timeframe">
              <select
                class="sc-input"
                value={interval()}
                onChange={(e) => {
                  setIntervalDirty(true);
                  setInterval(e.currentTarget.value);
                }}
                data-testid="axis-datasource-interval"
              >
                <For each={[...WATCHLIST_INTERVALS]}>{(iv) => <option value={iv}>{iv}</option>}</For>
              </select>
            </DsmField>

            <DsmField label="Accumulate to (UTC date)">
              <input
                type="date"
                class="sc-input"
                value={pastDate()}
                onInput={(e) => setPastDate(e.currentTarget.value)}
                data-testid="axis-datasource-past-date"
              />
            </DsmField>

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
              <div class="text-muted text-[0.78rem]" role="status" aria-live="polite">
                {formMsg()}
              </div>
            </Show>
          </form>

          <div class="flex flex-col gap-2" data-testid="axis-datasource-jobs">
            <div class="flex items-center justify-between gap-2">
              <div class="text-muted text-[0.68rem] uppercase tracking-wide">Jobs</div>
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
              <div class="flex flex-col gap-1.5" data-testid="axis-datasource-jobs-filters">
                <input
                  type="search"
                  class="axis-search sc-input h-7"
                  placeholder="Filter jobs…"
                  value={jobQuery()}
                  onInput={(e) => setJobQuery(e.currentTarget.value)}
                  data-testid="axis-datasource-jobs-query"
                  autocomplete="off"
                  spellcheck={false}
                />
                {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
                <div class="sc-chip-row" role="group" aria-label="Job filters">
                  <For each={JOB_FILTERS}>
                    {(f) => (
                      <button
                        type="button"
                        class={`sc-chip inline-flex items-center gap-1 ${
                          jobFilter() === f.id ? 'is-active' : ''
                        }`}
                        aria-pressed={jobFilter() === f.id}
                        onClick={() => setJobFilter(f.id)}
                        data-testid={`axis-datasource-jobs-filter-${f.id}`}
                      >
                        {f.label}
                        <span class="tabular-nums text-[0.9em] opacity-70">
                          {filterCounts()[f.id]}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show
              when={dataSourceManagerState.jobs.length}
              fallback={
                <div class="axis-empty-state text-[12px] text-text-dim py-2">
                  No jobs yet. Start a backfill above.
                </div>
              }
            >
              <Show
                when={filteredJobs().length}
                fallback={
                  <div class="axis-empty-state text-[12px] text-text-dim py-2">
                    No jobs match the current filter.
                  </div>
                }
              >
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
              </Show>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
