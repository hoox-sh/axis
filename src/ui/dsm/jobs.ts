// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Job list filters + status copy for the Data Source Manager panel.
 *
 * @module ui/dsm/jobs
 */

import type { DataSourceJob } from '../../data/data-source-manager';

export type JobFilter = 'all' | 'active' | 'done' | 'issues';

export const JOB_FILTERS: readonly { id: JobFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
  { id: 'issues', label: 'Issues' },
];

export type JobStatusTone = 'ok' | 'warn' | 'run' | 'muted' | 'bad';

export function isActiveJob(job: DataSourceJob): boolean {
  return job.status === 'running' || job.status === 'pending' || job.status === 'paused';
}

export function jobHasIssue(job: DataSourceJob): boolean {
  return job.status === 'error' || !!job.error;
}

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

export function jobMatchesQuery(job: DataSourceJob, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const hay = `${job.symbol} ${job.interval} ${job.sourceId} ${job.status} ${job.phase}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
}

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

export function jobStatusTone(job: DataSourceJob): JobStatusTone {
  if (job.status === 'running' || job.status === 'pending') {
    return job.error ? 'warn' : 'run';
  }
  if (job.status === 'complete') return job.datasetComplete ? 'ok' : 'warn';
  if (job.status === 'error') return 'bad';
  return 'muted';
}

export function jobStatusClass(tone: JobStatusTone): string {
  switch (tone) {
    case 'ok':
      return 'text-[var(--color-green,#5ecf8a)]';
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
