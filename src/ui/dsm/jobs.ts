// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Job list filters + status copy for the Data Source Manager panel.
 *
 * @module ui/dsm/jobs
 */

import type { DataSourceJob } from '../../data/data-source-manager';
import { expectedBarsInSpan } from '../../data/bars-gaps';
import { fmtDuration } from './format';

/** Filter buckets for the jobs list; `issues` means error status or a recorded error. */
export type JobFilter = 'all' | 'active' | 'done' | 'issues';

/** Filter chips in display order, shared by the jobs list and its counts. */
export const JOB_FILTERS: readonly { id: JobFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
  { id: 'issues', label: 'Issues' },
];

/** Color tone for a job status chip; maps to a text class via {@link jobStatusClass}. */
export type JobStatusTone = 'ok' | 'warn' | 'run' | 'muted' | 'bad';

/**
 * Whether the job still counts as in flight (running, pending, or paused).
 *
 * @param job - Data source job snapshot.
 * @returns `true` for the active filters and header counters.
 */
export function isActiveJob(job: DataSourceJob): boolean {
  return job.status === 'running' || job.status === 'pending' || job.status === 'paused';
}

/**
 * Whether the job needs operator attention: an `error` status or any recorded
 * error message (which can also appear on retrying jobs).
 *
 * @param job - Data source job snapshot.
 * @returns `true` when the job belongs in the `issues` filter.
 */
export function jobHasIssue(job: DataSourceJob): boolean {
  return job.status === 'error' || !!job.error;
}

/**
 * Apply one filter bucket. `done` covers both complete and cancelled jobs;
 * `all` always matches.
 *
 * @param job - Data source job snapshot.
 * @param filter - Active filter bucket.
 * @returns `true` when the job should be listed.
 */
export function jobMatchesFilter(job: DataSourceJob, filter: JobFilter): boolean {
  switch (filter) {
    case 'active':
      return isActiveJob(job);
    case 'done':
      return job.status === 'complete' || job.status === 'cancelled';
    case 'issues':
      return jobHasIssue(job);
    default:
      return true;
  }
}

/**
 * Badge counts per filter bucket in one pass, so the chips and the list cannot
 * disagree about a job's classification.
 *
 * @param jobs - All jobs, unfiltered.
 * @returns Count for each {@link JobFilter}; `all` is the input length.
 */
export function countJobsByFilter(jobs: readonly DataSourceJob[]): Record<JobFilter, number> {
  const counts: Record<JobFilter, number> = {
    all: jobs.length,
    active: 0,
    done: 0,
    issues: 0,
  };
  for (const job of jobs) {
    if (isActiveJob(job)) counts.active += 1;
    if (job.status === 'complete' || job.status === 'cancelled') counts.done += 1;
    if (jobHasIssue(job)) counts.issues += 1;
  }
  return counts;
}

/**
 * Whitespace-separated AND search over symbol, interval, source, status, and
 * phase. An empty query matches everything.
 *
 * @param job - Data source job snapshot.
 * @param raw - Raw search text from the filter input.
 * @returns `true` when every token appears in the searchable fields.
 */
export function jobMatchesQuery(job: DataSourceJob, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const hay =
    `${job.symbol} ${job.interval} ${job.sourceId} ${job.status} ${job.phase}`.toLowerCase();
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

/**
 * Human status word for a job, refining raw status with phase and error state
 * (e.g. `Queued (retry)`, `Filling gaps`, `Partial`). Complete-but-not-dense
 * jobs read as `Partial` rather than `Complete`.
 *
 * @param job - Data source job snapshot.
 * @returns Display label for the status chip.
 */
export function statusLabel(job: DataSourceJob): string {
  if (job.status === 'running' || job.status === 'pending') {
    if (job.error) {
      return job.status === 'pending' ? 'Queued (retry)' : 'Retrying';
    }
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

/**
 * Tone for the status chip: retrying jobs warn, complete-but-partial jobs warn,
 * hard errors are bad, and terminal non-error states stay muted.
 *
 * @param job - Data source job snapshot.
 * @returns Tone consumed by {@link jobStatusClass}.
 */
export function jobStatusTone(job: DataSourceJob): JobStatusTone {
  if (job.status === 'running' || job.status === 'pending') {
    return job.error ? 'warn' : 'run';
  }
  if (job.status === 'complete') return job.datasetComplete ? 'ok' : 'warn';
  if (job.status === 'error') return 'bad';
  return 'muted';
}

/** Fetched vs dense expected bars, window length, and page count. */
export function jobQuantityLine(job: DataSourceJob): string {
  const expected = expectedBarsInSpan(job.targetFromSec, job.targetToSec, job.interval);
  const got = job.barsFetched.toLocaleString();
  const nearFull =
    job.datasetComplete && expected > 0 && job.barsFetched >= Math.floor(expected * 0.98);
  const bars =
    expected > 0 && !nearFull ? `${got} / ~${expected.toLocaleString()} bars` : `${got} bars`;
  const pages = `${job.pagesFetched} page${job.pagesFetched === 1 ? '' : 's'}`;
  const span = fmtDuration(job.targetFromSec, job.targetToSec);
  return span === '—' ? `${bars} · ${pages}` : `${bars} · ${span} · ${pages}`;
}

/** Retries, gaps, and coverage. Empty while a clean job is still running. */
export function jobHealthLine(job: DataSourceJob): string {
  const parts: string[] = [];
  const retries = job.retries ?? 0;
  if (retries > 0) parts.push(`${retries} ${retries === 1 ? 'retry' : 'retries'}`);
  if (job.gapsFound > 0) {
    const gaps = `${job.gapsFound} gap${job.gapsFound === 1 ? '' : 's'}`;
    parts.push(job.gapsFilled ? `${gaps}, filled ${job.gapsFilled}` : gaps);
  } else if (job.datasetComplete) {
    parts.push('full coverage');
  } else if (job.status === 'complete') {
    parts.push('partial coverage');
  }
  return parts.join(' · ');
}

/**
 * Text class for a status tone, shared so chips, rows, and the header agree.
 *
 * @param tone - Tone from {@link jobStatusTone}.
 * @returns Tailwind text-color class name.
 */
export function jobStatusClass(tone: JobStatusTone): string {
  switch (tone) {
    case 'ok':
      return 'text-green';
    case 'warn':
      return 'text-amber-400';
    case 'run':
      return 'text-accent';
    case 'bad':
      return 'text-red';
    default:
      return 'text-muted';
  }
}

/** Aggregate counters for the panel header (all jobs, not the filtered view). */
export function jobTotals(jobs: readonly DataSourceJob[]): {
  bars: number;
  pages: number;
  active: number;
  done: number;
  issues: number;
} {
  let bars = 0;
  let pages = 0;
  let active = 0;
  let done = 0;
  let issues = 0;
  for (const job of jobs) {
    bars += job.barsFetched || 0;
    pages += job.pagesFetched || 0;
    if (isActiveJob(job)) active += 1;
    if (job.status === 'complete' || job.status === 'cancelled') done += 1;
    if (jobHasIssue(job)) issues += 1;
  }
  return { bars, pages, active, done, issues };
}
