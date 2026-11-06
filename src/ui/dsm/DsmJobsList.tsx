// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backfill job list — filter chips, text search, per-job cards, and the
 * batch actions (pause / resume / cancel all, retry failed, clear finished).
 *
 * Shared by the floatable DSM panel and the studio Data page. Jobs state is
 * the manager's own solid store, so the list updates as pages land.
 *
 * @module ui/dsm/DsmJobsList
 */

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  dataSourceManagerState,
  cancelBackfill,
  dismissJob,
  pauseBackfill,
  resumeBackfill,
  startBackfill,
  applyJobToChart,
  type DataSourceJob,
} from '../../data/data-source-manager';
import { Icons } from '../icons';
import { announce } from '../sr-announce';
import { JobCard } from './JobCard';
import {
  JOB_FILTERS,
  countJobsByFilter,
  jobMatchesFilter,
  jobMatchesQuery,
  jobTotals,
  type JobFilter,
} from './jobs';
import { bindSlashToSearch } from '../focus-search';

/** Options for embedding the jobs list: test-id prefix, batch actions, message sink. */
export interface DsmJobsListProps {
  /** Test-id prefix for the controls (panel and page coexist in the DOM). */
  testIdPrefix?: string;
  /** Show batch actions (pause / resume / cancel all, retry failed). */
  batch?: boolean;
  /** Success/info sink for hosts with their own sticky message area. */
  onNotify?: (msg: string) => void;
}

/**
 * Backfill job list with filter/search, per-job cards, and batch actions; it reads
 * the manager store directly, so rows update as pages land.
 */
export const DsmJobsList: Component<DsmJobsListProps> = (props): JSX.Element => {
  const tid = (suffix: string) => `${props.testIdPrefix ?? 'axis-datasource'}-${suffix}`;

  const [applyingId, setApplyingId] = createSignal<string | null>(null);
  const [jobFilter, setJobFilter] = createSignal<JobFilter>('all');
  const [jobQuery, setJobQuery] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [error, setError] = createSignal('');

  const notify = (m: string) => {
    setError('');
    if (props.onNotify) props.onNotify(m);
    else setMsg(m);
  };

  let searchInput: HTMLInputElement | undefined;

  // `/` focuses the job search while this list is mounted.
  onMount(() => {
    onCleanup(bindSlashToSearch(() => searchInput));
  });

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

  const activeJobs = (): DataSourceJob[] =>
    dataSourceManagerState.jobs.filter((j) => j.status === 'running' || j.status === 'pending');
  const pausedJobs = (): DataSourceJob[] =>
    dataSourceManagerState.jobs.filter((j) => j.status === 'paused');

  const onApply = async (id: string) => {
    setApplyingId(id);
    setError('');
    try {
      const ok = await applyJobToChart(id);
      if (!ok) {
        setError('No cached bars to load for this job.');
      } else {
        notify('Loaded cached bars onto chart.');
        announce('Loaded cached bars onto chart');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  };

  const clearFinished = () => {
    const done = dataSourceManagerState.jobs.filter(
      (j) => j.status === 'complete' || j.status === 'error' || j.status === 'cancelled',
    );
    if (!done.length) return;
    for (const job of done) dismissJob(job.id);
    notify(`Cleared ${done.length} finished job${done.length === 1 ? '' : 's'}.`);
    announce('Cleared finished backfill jobs');
  };

  const pauseAll = () => {
    const list = activeJobs();
    for (const job of list) pauseBackfill(job.id);
    notify(
      list.length
        ? `Paused ${list.length} job${list.length === 1 ? '' : 's'}.`
        : 'No running jobs.',
    );
  };

  const resumeAll = () => {
    const list = pausedJobs();
    for (const job of list) resumeBackfill(job.id);
    notify(
      list.length
        ? `Resumed ${list.length} job${list.length === 1 ? '' : 's'}.`
        : 'No paused jobs.',
    );
  };

  const cancelAll = () => {
    const list = activeJobs();
    for (const job of list) cancelBackfill(job.id);
    notify(
      list.length
        ? `Cancelled ${list.length} job${list.length === 1 ? '' : 's'}.`
        : 'No running jobs.',
    );
  };

  /**
   * Re-enqueue failed jobs with their original window, then drop the dead
   * cards. The manager has no in-place retry; a fresh job is the retry.
   */
  const retryFailed = () => {
    const failed = dataSourceManagerState.jobs.filter(
      (j) => j.status === 'error' || (j.status === 'complete' && !j.datasetComplete),
    );
    if (!failed.length) {
      notify('No failed or partial jobs to retry.');
      return;
    }
    for (const job of failed) {
      startBackfill({
        sourceId: job.sourceId,
        symbol: job.symbol,
        interval: job.interval,
        targetFromSec: job.targetFromSec,
        targetToSec: job.targetToSec,
        applyWhenComplete: job.applyWhenComplete,
      });
      dismissJob(job.id);
    }
    notify(`Retrying ${failed.length} job${failed.length === 1 ? '' : 's'}.`);
    announce('Retrying failed backfill jobs');
  };

  const resetJobFilters = () => {
    setJobFilter('all');
    setJobQuery('');
    searchInput?.focus();
  };

  return (
    <div class="ax-dsm-jobs" data-testid={tid('jobs')}>
      <div class="ax-dsm-jobs-head">
        <span class="ax-dsm-jobs-title">Jobs</span>
        <span class="ax-dsm-count" data-testid={tid('count')}>
          {filteredJobs().length}
          {filteredJobs().length !== dataSourceManagerState.jobs.length
            ? ` / ${dataSourceManagerState.jobs.length}`
            : ''}
        </span>
        <span class="ax-dsm-spacer" />
        <Show
          when={props.batch}
          fallback={
            <Show when={finishedCount() > 0}>
              <button
                type="button"
                class="ax-dsm-mini"
                title="Remove completed, errored, and cancelled jobs"
                data-testid={tid('clear-finished')}
                onClick={clearFinished}
              >
                <Icons.eraser size={10} /> Clear {finishedCount()}
              </button>
            </Show>
          }
        >
          <div class="ax-dsm-jobs-batch">
            <Show when={activeJobs().length > 0}>
              <button
                type="button"
                class="ax-dsm-mini"
                title="Pause every running / queued job"
                data-testid={tid('pause-all')}
                onClick={pauseAll}
              >
                <Icons.play size={10} /> Pause all
              </button>
            </Show>
            <Show when={pausedJobs().length > 0}>
              <button
                type="button"
                class="ax-dsm-mini is-accent"
                title="Resume every paused job"
                data-testid={tid('resume-all')}
                onClick={resumeAll}
              >
                <Icons.play size={10} /> Resume all
              </button>
            </Show>
            <Show when={activeJobs().length > 0 || pausedJobs().length > 0}>
              <button
                type="button"
                class="ax-dsm-mini is-danger"
                title="Cancel every running / queued / paused job"
                data-testid={tid('cancel-all')}
                onClick={cancelAll}
              >
                <Icons.x size={10} /> Cancel all
              </button>
            </Show>
            <Show when={totals().issues > 0}>
              <button
                type="button"
                class="ax-dsm-mini"
                title="Re-enqueue errored and partial jobs with their original window"
                data-testid={tid('retry-failed')}
                onClick={retryFailed}
              >
                <Icons.refresh size={10} /> Retry {totals().issues}
              </button>
            </Show>
            <Show when={finishedCount() > 0}>
              <button
                type="button"
                class="ax-dsm-mini"
                title="Remove completed, errored, and cancelled jobs"
                data-testid={tid('clear-finished')}
                onClick={clearFinished}
              >
                <Icons.eraser size={10} /> Clear {finishedCount()}
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={dataSourceManagerState.jobs.length}>
        <div class="ax-dsm-jobs-filters" data-testid={tid('jobs-filters')}>
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
              data-testid={tid('jobs-query')}
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
                  data-testid={tid(`jobs-filter-${f.id}`)}
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
          <div class="ax-dsm-empty" data-testid={tid('empty')}>
            <span class="ax-dsm-empty-icon">
              <Icons.database size={18} />
            </span>
            <p class="ax-dsm-empty-title">No jobs yet</p>
            <p class="ax-dsm-empty-sub">
              Start a backfill to cache deeper history without blocking the chart.
            </p>
          </div>
        }
      >
        <Show
          when={filteredJobs().length}
          fallback={
            <div class="ax-dsm-empty" data-testid={tid('no-match')}>
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

      <Show when={error()}>
        <div class="ax-dsm-msg is-error" role="alert" data-testid={tid('jobs-error')}>
          {error()}
        </div>
      </Show>
      <Show when={msg() && !error()}>
        <div class="ax-dsm-msg" role="status" aria-live="polite" data-testid={tid('jobs-msg')}>
          {msg()}
        </div>
      </Show>
    </div>
  );
};
