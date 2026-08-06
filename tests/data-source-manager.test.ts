// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  startBackfill,
  cancelBackfill,
  dismissJob,
  jobProgress,
  pastDateInputToSec,
  defaultPastDateInput,
  _resetDataSourceManagerForTests,
  _waitForJob,
  dataSourceManagerState,
} from '../src/data/data-source-manager';
import { _resetBarsCacheForTests, getCachedBars } from '../src/data/bars-cache';
import { registry } from '../src/plugins/registry';
import type { SourcePlugin } from '../src/plugins/types';
import type { Bar } from '../src/store/types';
import { ensureSourcesRegistered, _resetSourceRegistrationFlag } from '../src/sources/catalog';

function bar(t: number): Bar {
  return { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

describe('data-source-manager', () => {
  beforeEach(async () => {
    _resetDataSourceManagerForTests();
    await _resetBarsCacheForTests();
    _resetSourceRegistrationFlag();
    // Wipe dynamic test sources if any
    for (const id of ['page-src', 'slow-src']) {
      try {
        registry.unregisterSource(id);
      } catch {
        /* ignore */
      }
    }
    ensureSourcesRegistered();
  });

  afterEach(() => {
    _resetDataSourceManagerForTests();
  });

  it('parses past date input as UTC midnight', () => {
    expect(pastDateInputToSec('2024-01-15')).toBe(Date.UTC(2024, 0, 15) / 1000);
    expect(pastDateInputToSec('bad')).toBeNull();
    expect(defaultPastDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('startBackfill returns id immediately and completes with mock-walk', async () => {
    const t0 = Date.now();
    const id = startBackfill({
      sourceId: 'mock-walk',
      symbol: 'BTCUSDT',
      interval: '1d',
      // Small window so few pages
      targetFromSec: Math.floor(Date.now() / 1000) - 5 * 86_400,
      targetToSec: Math.floor(Date.now() / 1000),
    });
    // Must not block: id available in same tick
    expect(Date.now() - t0).toBeLessThan(50);
    expect(id).toMatch(/^dsj_/);

    const job = await _waitForJob(id, 15_000);
    expect(job).toBeTruthy();
    expect(job!.status).toBe('complete');
    expect(job!.barsFetched).toBeGreaterThan(0);
    expect(job!.pagesFetched).toBeGreaterThan(0);
    expect(jobProgress(job!)).toBe(1);

    const cached = await getCachedBars('mock-walk', 'BTCUSDT', '1d');
    expect(cached.length).toBeGreaterThan(0);
  });

  it('paginates walk-back across multiple pages', async () => {
    const pageSize = 10;
    let calls = 0;
    const src: SourcePlugin = {
      id: 'page-src',
      name: 'Page Src',
      kind: 'source',
      builtIn: false,
      async fetchHistorical({ endTime, limit }) {
        calls++;
        const end =
          typeof endTime === 'number' && endTime > 0
            ? Math.floor(endTime)
            : Math.floor(Date.now() / 1000);
        const n = Math.min(pageSize, Number(limit) || pageSize);
        // Stop after 4 pages worth (40 bars back)
        const floor = Math.floor(Date.now() / 1000) - 40;
        if (end < floor) return [];
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          const t = end - i;
          if (t < floor) continue;
          out.push(bar(t));
        }
        return out;
      },
    };
    registry.registerSource(src);

    const now = Math.floor(Date.now() / 1000);
    const id = startBackfill({
      sourceId: 'page-src',
      symbol: 'X',
      interval: '1m',
      targetFromSec: now - 35,
      targetToSec: now,
    });

    const job = await _waitForJob(id, 15_000);
    expect(job!.status).toBe('complete');
    expect(calls).toBeGreaterThan(1);
    expect(job!.pagesFetched).toBeGreaterThan(1);
    expect(job!.oldestSec).not.toBeNull();
    expect(job!.oldestSec!).toBeLessThanOrEqual(now - 35);
  });

  it('cancel stops a pending/running job', async () => {
    const src: SourcePlugin = {
      id: 'slow-src',
      name: 'Slow',
      kind: 'source',
      builtIn: false,
      async fetchHistorical({ signal }) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
        return [bar(1)];
      },
    };
    registry.registerSource(src);

    const id = startBackfill({
      sourceId: 'slow-src',
      symbol: 'Y',
      interval: '1m',
      targetFromSec: Math.floor(Date.now() / 1000) - 1000,
    });
    // Cancel almost immediately
    cancelBackfill(id);
    const job = await _waitForJob(id, 3_000);
    expect(job!.status).toBe('cancelled');
  });

  it('dismiss removes job from list', async () => {
    const id = startBackfill({
      sourceId: 'mock-walk',
      symbol: 'Z',
      interval: '1d',
      targetFromSec: Math.floor(Date.now() / 1000) - 86_400,
    });
    await _waitForJob(id, 10_000);
    dismissJob(id);
    expect(dataSourceManagerState.jobs.find((j) => j.id === id)).toBeUndefined();
  });

  it('rejects unknown source and bad date range', () => {
    expect(() =>
      startBackfill({ sourceId: 'nope', symbol: 'BTC', interval: '1d' }),
    ).toThrow(/Unknown source/);
    expect(() =>
      startBackfill({
        sourceId: 'mock-walk',
        symbol: 'BTC',
        interval: '1d',
        targetFromSec: 2000,
        targetToSec: 1000,
      }),
    ).toThrow(/Past date/);
  });
});
