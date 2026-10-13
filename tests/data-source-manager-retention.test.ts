/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Data Source Manager — argument validation and job retention.
 *
 * The happy-path suite never reaches these branches: a missing symbol and the
 * >40-job retention sweep only show up on misuse or a long session. Both are
 * pure decision logic over the job list, so a regression would silently drop
 * in-flight work or grow history without bound.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { store } from '../src/store';
import {
  DSM_MAX_PAGES,
  DSM_MAX_BARS_PER_JOB,
  _resetDataSourceManagerForTests,
  _waitForJob,
  dataSourceManagerState,
  getDataSourceJobs,
  startBackfill,
} from '../src/data/data-source-manager';

/** Retention sweep threshold, mirroring `MAX_RETAINED_JOBS` in the module. */
const MAX_RETAINED_JOBS = 40;

beforeEach(() => {
  _resetDataSourceManagerForTests();
  // Jobs live in the manager's own store, not the app store.
  dataSourceManagerState.jobs = [];
  store.symbol = '';
});

describe('startBackfill symbol validation', () => {
  it('settles as complete with a reason instead of queueing forever', async () => {
    const id = startBackfill({ sourceId: 'mock-walk', interval: '1m' });
    const settled = await _waitForJob(id, 2000);

    expect(settled).not.toBeNull();
    expect(settled!.status).toBe('complete');
    expect(settled!.error).toBe('Symbol required');
    expect(settled!.phase).toBe('done');
  });

  it('does not claim to have fetched anything', async () => {
    const id = startBackfill({ sourceId: 'mock-walk', interval: '1m' });
    const settled = await _waitForJob(id, 2000);
    expect(settled!.barsFetched).toBe(0);
    expect(settled!.pagesFetched).toBe(0);
    expect(settled!.datasetComplete).toBe(false);
  });

  it('labels the settled job UNKNOWN rather than an empty symbol', async () => {
    const id = startBackfill({ sourceId: 'mock-walk', interval: '1m' });
    const settled = await _waitForJob(id, 2000);
    expect(settled!.symbol).toBe('UNKNOWN');
  });

  it('keeps the job listed so the UI can show why nothing happened', async () => {
    const id = startBackfill({ sourceId: 'mock-walk', interval: '1m' });
    await _waitForJob(id, 2000);

    const listed = getDataSourceJobs().find((j) => j.id === id);
    expect(listed).toBeDefined();
    expect(listed!.error).toBe('Symbol required');
  });

  it('gives concurrent calls distinct ids', () => {
    const a = startBackfill({ sourceId: 'mock-walk', interval: '1m' });
    const b = startBackfill({ sourceId: 'mock-walk', interval: '5m' });
    expect(a).not.toBe(b);
  });
});

describe('job retention', () => {
  /** Push past the retention threshold so the next startBackfill sweeps. */
  function seedJobs(count: number): void {
    dataSourceManagerState.jobs = Array.from({ length: count }, (_, i) => ({
      id: `seed-${i}`,
      sourceId: 'mock-walk',
      symbol: 'BTCUSDT',
      interval: '1m',
      status: 'complete',
      phase: 'done',
      targetFromSec: 0,
      targetToSec: 0,
      barsFetched: 10,
      pagesFetched: 1,
      gapsFound: 0,
      gapsFilled: 0,
      datasetComplete: true,
      error: null,
      updatedAt: i,
    })) as typeof dataSourceManagerState.jobs;
  }

  it('sweeps terminal jobs once the list exceeds the cap', () => {
    seedJobs(MAX_RETAINED_JOBS + 6);
    startBackfill({ sourceId: 'mock-walk', interval: '1m' });

    // The sweep keeps at most MAX_RETAINED_JOBS, so the seeded overflow goes.
    expect(getDataSourceJobs().length).toBeLessThanOrEqual(MAX_RETAINED_JOBS + 1);
  });

  it('drops the oldest terminal jobs first, not the newest', () => {
    seedJobs(MAX_RETAINED_JOBS + 6);
    startBackfill({ sourceId: 'mock-walk', interval: '1m' });

    const ids = getDataSourceJobs().map((j) => j.id);
    // `seed-0` is the oldest by updatedAt and is the first to go.
    expect(ids).not.toContain('seed-0');
    expect(ids).not.toContain('seed-1');
  });

  it('retains the most recently updated terminal jobs', () => {
    seedJobs(MAX_RETAINED_JOBS + 6);
    startBackfill({ sourceId: 'mock-walk', interval: '1m' });

    const ids = getDataSourceJobs().map((j) => j.id);
    const newest = `seed-${MAX_RETAINED_JOBS + 5}`;
    expect(ids).toContain(newest);
  });

  it('leaves a list at the cap untouched', () => {
    // 39 seeded + 1 new job = 40 total, which is not yet over the cap.
    seedJobs(MAX_RETAINED_JOBS - 1);
    startBackfill({ sourceId: 'mock-walk', interval: '1m' });

    const ids = getDataSourceJobs().map((j) => j.id);
    expect(ids).toContain('seed-0');
    expect(ids).toContain(`seed-${MAX_RETAINED_JOBS - 2}`);
  });
});

describe('exported limits', () => {
  it('caps pages and bars so one job cannot run unbounded', () => {
    expect(DSM_MAX_PAGES).toBeGreaterThan(0);
    expect(DSM_MAX_BARS_PER_JOB).toBeGreaterThan(0);
    // A 1-minute job at the bars cap still needs far fewer pages than the cap.
    expect(DSM_MAX_PAGES).toBeLessThanOrEqual(DSM_MAX_BARS_PER_JOB);
  });
});