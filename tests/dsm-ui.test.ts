// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { fmtBarsAsSpan, fmtDuration, fmtMillis, fmtTime, loadWindowSpanLabel } from '../src/ui/dsm/format';
import { estimateBackfill } from '../src/ui/dsm/estimate';
import {
  countJobsByFilter,
  jobHealthLine,
  jobMatchesFilter,
  jobMatchesQuery,
  jobQuantityLine,
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

  it('fmtDuration keeps exact days through a quarter, then months and years', () => {
    expect(fmtDuration(null, 10)).toBe('—');
    expect(fmtDuration(100, 50)).toBe('—');
    expect(fmtDuration(0, 0)).toBe('0s');
    expect(fmtDuration(0, 45 * 60)).toBe('45m');
    expect(fmtDuration(0, 3600)).toBe('1h');
    expect(fmtDuration(0, 90 * 60)).toBe('1h 30m');
    expect(fmtDuration(0, 36 * 3600)).toBe('1d 12h');
    expect(fmtDuration(0, 10 * 86_400)).toBe('10d');
    expect(fmtDuration(0, 10 * 86_400 + 6 * 3600)).toBe('10d 6h');
    expect(fmtDuration(0, 90 * 86_400)).toBe('90d');
    expect(fmtDuration(0, 120 * 86_400)).toBe('4mo');
    expect(fmtDuration(0, 800 * 86_400)).toBe('2y 2mo');
  });

  it('fmtBarsAsSpan and load windows follow the timeframe', () => {
    expect(fmtBarsAsSpan(0, '1m')).toBe('—');
    expect(fmtBarsAsSpan(1000, '1m')).toBe('16h 40m');
    expect(fmtBarsAsSpan(50_000, '1m')).toBe('34d');
    expect(
      loadWindowSpanLabel({
        count: 1000,
        interval: '1m',
        maxBars: 1000,
        fromSec: 0,
        toSec: 90 * 86_400,
      }),
    ).toBe('~16h 40m');
    expect(
      loadWindowSpanLabel({
        count: 91,
        interval: '1d',
        maxBars: null,
        fromSec: 0,
        toSec: 90 * 86_400,
      }),
    ).toBe('90d');
    expect(
      loadWindowSpanLabel({
        count: 0,
        interval: '1d',
        maxBars: null,
        fromSec: 0,
        toSec: 90 * 86_400,
      }),
    ).toBe('—');
  });
});

describe('backfill estimate', () => {
  const day = 86_400;

  it('counts dense bars and pages for a 90-day daily window', () => {
    const est = estimateBackfill({
      fromSec: 0,
      nowSec: 90 * day,
      interval: '1d',
      pageLimit: 1000,
    });
    expect(est.valid).toBe(true);
    expect(est.spanLabel).toBe('90d');
    expect(est.bars).toBe(91);
    expect(est.barsLabel).toBe('~91');
    expect(est.pages).toBe(1);
    expect(est.capped).toBe(false);
    expect(est.note).toBe('');
  });

  it('names the 50,000-bar job cap on a 1m lookback', () => {
    const est = estimateBackfill({
      fromSec: 0,
      nowSec: 90 * day,
      interval: '1m',
      pageLimit: 1000,
      maxBars: 50_000,
      maxPages: 200,
    });
    expect(est.bars).toBe(129_601);
    expect(est.pages).toBe(130);
    expect(est.jobBars).toBe(50_000);
    expect(est.jobPages).toBe(50);
    expect(est.capped).toBe(true);
    expect(est.note).toBe('One job keeps the newest 50,000 bars (~34d of 1m).');
  });

  it('stops a job on the page budget when that binds first', () => {
    const est = estimateBackfill({
      fromSec: 0,
      nowSec: 10 * day,
      interval: '1m',
      pageLimit: 10,
      maxBars: 50_000,
      maxPages: 20,
    });
    expect(est.bars).toBe(10 * day / 60 + 1);
    expect(est.capped).toBe(true);
    expect(est.jobPages).toBe(20);
    expect(est.jobBars).toBe(200);
    expect(est.note).toContain('20 pages');
    expect(est.note).toContain('200 bars');
  });

  it('rejects a missing or future date', () => {
    expect(estimateBackfill({ fromSec: null, nowSec: 10, interval: '1d', pageLimit: 1000 }).barsLabel).toBe('—');
    const future = estimateBackfill({
      fromSec: 5_000,
      nowSec: 1_000,
      interval: '1h',
      pageLimit: 1000,
    });
    expect(future.future).toBe(true);
    expect(future.valid).toBe(false);
    expect(future.spanLabel).toBe('—');
    expect(future.note).toContain('past');
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

  it('jobQuantityLine pairs fetched bars with the dense target and the window', () => {
    const partial = job({
      interval: '1d',
      targetFromSec: 0,
      targetToSec: 10 * 86_400,
      barsFetched: 4,
      pagesFetched: 1,
      datasetComplete: false,
      status: 'running',
    });
    expect(jobQuantityLine(partial)).toBe('4 / ~11 bars · 10d · 1 page');
    expect(jobHealthLine(partial)).toBe('');

    const done = job({
      interval: '1d',
      targetFromSec: 0,
      targetToSec: 10 * 86_400,
      barsFetched: 11,
      pagesFetched: 2,
      datasetComplete: true,
    });
    expect(jobQuantityLine(done)).toBe('11 bars · 10d · 2 pages');
    expect(jobHealthLine(done)).toBe('full coverage');

    const gappy = job({
      status: 'complete',
      datasetComplete: false,
      gapsFound: 2,
      gapsFilled: 1,
      retries: 1,
    });
    expect(jobHealthLine(gappy)).toBe('1 retry · 2 gaps, filled 1');
  });

  it('every JobFilter id is counted', () => {
    const ids: JobFilter[] = ['all', 'active', 'done', 'issues'];
    const counts = countJobsByFilter([]);
    for (const id of ids) expect(counts[id]).toBe(0);
  });
});
