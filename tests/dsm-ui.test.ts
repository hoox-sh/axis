// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { fmtDuration, fmtMillis, fmtTime } from '../src/ui/dsm/format';
import {
  countJobsByFilter,
  jobMatchesFilter,
  jobMatchesQuery,
  jobStatusTone,
  statusLabel,
  type JobFilter,
} from '../src/ui/dsm/jobs';
import type { DataSourceJob } from '../src/data/data-source-manager';

function job(partial: Partial<DataSourceJob> = {}): DataSourceJob {
  return {
    id: 'dsj_x',
    sourceId: 'mock-walk',
    symbol: 'BTCUSDT',
    interval: '1d',
    targetFromSec: 1,
    targetToSec: 2,
    status: 'complete',
    phase: 'done',
    barsFetched: 10,
    pagesFetched: 1,
    oldestSec: 1,
    newestSec: 2,
    gapsFound: 0,
    gapsFilled: 0,
    datasetComplete: true,
    error: null,
    retries: 0,
    createdAt: 0,
    updatedAt: 0,
    applyWhenComplete: false,
    ...partial,
  };
}

describe('dsm format', () => {
  it('fmtTime renders UTC or an em dash', () => {
    expect(fmtTime(null)).toBe('—');
    expect(fmtTime(undefined)).toBe('—');
    expect(fmtTime(Number.NaN)).toBe('—');
    expect(fmtTime(Date.UTC(2024, 5, 1, 12, 30) / 1000)).toBe('2024-06-01 12:30');
  });

  it('fmtMillis renders UTC or an em dash', () => {
    expect(fmtMillis(null)).toBe('—');
    expect(fmtMillis(Date.UTC(2024, 0, 2, 8, 5))).toBe('2024-01-02 08:05');
  });

  it('fmtDuration buckets hours / days / months / years', () => {
    expect(fmtDuration(null, 10)).toBe('—');
    expect(fmtDuration(100, 50)).toBe('—');
    expect(fmtDuration(0, 3600)).toBe('1h');
    expect(fmtDuration(0, 10 * 86_400)).toBe('10d');
    expect(fmtDuration(0, 90 * 86_400)).toBe('3mo');
    expect(fmtDuration(0, 800 * 86_400)).toBe('2y');
  });
});

describe('dsm job filters', () => {
  const running = job({ status: 'running', phase: 'backfill', datasetComplete: false });
  const retrying = job({
    status: 'running',
    phase: 'backfill',
    error: 'Retrying (1/4): venue-down',
    datasetComplete: false,
  });
  const paused = job({ status: 'paused', datasetComplete: false });
  const done = job({ status: 'complete', datasetComplete: true });
  const partial = job({
    status: 'complete',
    datasetComplete: false,
    error: 'Partial: 2 gaps remain',
  });
  const cancelled = job({ status: 'cancelled', datasetComplete: false });

  it('statusLabel covers active, retry, complete, partial', () => {
    expect(statusLabel(running)).toBe('Backfilling');
    expect(statusLabel(job({ status: 'pending', phase: 'backfill' }))).toBe('Queued');
    expect(statusLabel(retrying)).toBe('Retrying');
    expect(statusLabel(job({ status: 'running', phase: 'validate' }))).toBe('Validating');
    expect(statusLabel(job({ status: 'running', phase: 'gapfill' }))).toBe('Filling gaps');
    expect(statusLabel(paused)).toBe('Paused');
    expect(statusLabel(done)).toBe('Complete');
    expect(statusLabel(partial)).toBe('Partial');
    expect(statusLabel(cancelled)).toBe('Cancelled');
    expect(statusLabel(job({ status: 'error', error: 'boom' }))).toBe('Error');
  });

  it('jobStatusTone maps complete / retry / running', () => {
    expect(jobStatusTone(done)).toBe('ok');
    expect(jobStatusTone(partial)).toBe('warn');
    expect(jobStatusTone(running)).toBe('run');
    expect(jobStatusTone(retrying)).toBe('warn');
    expect(jobStatusTone(cancelled)).toBe('muted');
    expect(jobStatusTone(job({ status: 'error' }))).toBe('bad');
  });

  it('jobMatchesFilter splits active / done / issues', () => {
    expect(jobMatchesFilter(running, 'active')).toBe(true);
    expect(jobMatchesFilter(paused, 'active')).toBe(true);
    expect(jobMatchesFilter(done, 'active')).toBe(false);
    expect(jobMatchesFilter(done, 'done')).toBe(true);
    expect(jobMatchesFilter(cancelled, 'done')).toBe(true);
    expect(jobMatchesFilter(partial, 'issues')).toBe(true);
    expect(jobMatchesFilter(retrying, 'issues')).toBe(true);
    expect(jobMatchesFilter(done, 'issues')).toBe(false);
    expect(jobMatchesFilter(running, 'all')).toBe(true);
  });

  it('countJobsByFilter tallies every bucket', () => {
    const counts = countJobsByFilter([running, retrying, paused, done, partial, cancelled]);
    expect(counts.all).toBe(6);
    expect(counts.active).toBe(3);
    expect(counts.done).toBe(3);
    expect(counts.issues).toBe(2);
  });

  it('jobMatchesQuery token-matches symbol / source / status', () => {
    expect(jobMatchesQuery(running, '')).toBe(true);
    expect(jobMatchesQuery(running, 'btc mock')).toBe(true);
    expect(jobMatchesQuery(running, 'eth')).toBe(false);
    expect(jobMatchesQuery(running, 'RUNNING')).toBe(true);
  });

  it('every JobFilter id is counted', () => {
    const ids: JobFilter[] = ['all', 'active', 'done', 'issues'];
    const counts = countJobsByFilter([]);
    for (const id of ids) expect(counts[id]).toBe(0);
  });
});
