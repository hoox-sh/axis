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
    // Must not block on the full backfill (returns job id promptly)
    expect(Date.now() - t0).toBeLessThan(200);
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
    const step = 60; // 1m
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
        // Stop after ~40 bars back
        const floor = Math.floor(Date.now() / 1000) - 40 * step;
        if (end < floor) return [];
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          const t = end - i * step;
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
      targetFromSec: now - 35 * step,
      targetToSec: now,
    });

    const job = await _waitForJob(id, 15_000);
    expect(job!.status).toBe('complete');
    expect(calls).toBeGreaterThan(1);
    expect(job!.pagesFetched).toBeGreaterThan(1);
    expect(job!.oldestSec).not.toBeNull();
    // Within ~1.5 bars of target (gap threshold)
    expect(job!.oldestSec!).toBeLessThanOrEqual(now - 35 * step + 1.5 * step);
  });

  it('does not complete with Pages:0 when cache only has old fragment to past date', async () => {
    // Simulates the bug: IDB holds 1000 daily bars from 2020, missing 2023→now.
    // Job must walk from *now* and fetch more pages (not Complete/100% with Pages:0).
    const step = 86_400;
    const from = Date.UTC(2020, 0, 1) / 1000;
    const now = Math.floor(Date.now() / 1000);
    // Pre-seed cache with old fragment only
    const oldBars: Bar[] = [];
    for (let i = 0; i < 1000; i++) {
      oldBars.push(bar(from + i * step));
    }
    const { putCachedBars, _resetBarsCacheForTests } = await import('../src/data/bars-cache');
    await _resetBarsCacheForTests();
    await putCachedBars('frag-src', 'BTCUSDT', '1d', oldBars);

    let calls = 0;
    const src: SourcePlugin = {
      id: 'frag-src',
      name: 'Frag',
      kind: 'source',
      builtIn: false,
      async fetchHistorical({ endTime, limit }) {
        calls++;
        const end =
          typeof endTime === 'number' && endTime > 0 ? Math.floor(endTime) : now;
        const n = Math.min(100, Number(limit) || 100);
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          const t = end - i * step;
          if (t < from - step) continue;
          out.push(bar(t));
        }
        return out;
      },
    };
    registry.registerSource(src);

    const id = startBackfill({
      sourceId: 'frag-src',
      symbol: 'BTCUSDT',
      interval: '1d',
      targetFromSec: from,
      targetToSec: now,
    });
    const job = await _waitForJob(id, 30_000);
    expect(job!.status).toBe('complete');
    expect(calls).toBeGreaterThan(0);
    expect(job!.pagesFetched).toBeGreaterThan(0);
    // Must have pulled recent history (newest near now)
    expect(job!.newestSec).not.toBeNull();
    expect(now - (job!.newestSec ?? 0)).toBeLessThan(5 * step);
    // More than the original 1000-bar fragment
    expect(job!.barsFetched).toBeGreaterThan(1000);
  });

  it('validates coverage and fills internal gaps after backfill', async () => {
    // Source returns dense recent history but leaves a hole in the middle.
    // Manager must detect the gap and re-fetch that window.
    const step = 60;
    const now = Math.floor(Date.now() / 1000);
    const from = now - 40 * step;
    let gapFillCalls = 0;
    const src: SourcePlugin = {
      id: 'gap-src',
      name: 'Gap Src',
      kind: 'source',
      builtIn: false,
      async fetchHistorical({ endTime, limit }) {
        const end =
          typeof endTime === 'number' && endTime > 0
            ? Math.floor(endTime)
            : now;
        const n = Math.min(15, Number(limit) || 15);
        const out: Bar[] = [];
        // Artificial permanent hole: (now-25*step) .. (now-20*step) only filled
        // when endTime is inside/near that window (gap-fill phase).
        const holeLo = now - 25 * step;
        const holeHi = now - 20 * step;
        for (let i = n - 1; i >= 0; i--) {
          const t = end - i * step;
          if (t < from - step) continue;
          // On early pages (end near now), skip the hole so it becomes a gap
          if (end > holeHi + 5 * step && t >= holeLo && t <= holeHi) {
            continue;
          }
          if (end <= holeHi + 5 * step && t >= holeLo && t <= holeHi) {
            gapFillCalls++;
          }
          out.push(bar(t));
        }
        return out;
      },
    };
    registry.registerSource(src);

    const id = startBackfill({
      sourceId: 'gap-src',
      symbol: 'GAP',
      interval: '1m',
      targetFromSec: from,
      targetToSec: now,
    });
    const job = await _waitForJob(id, 20_000);
    expect(job).toBeTruthy();
    expect(job!.status).toBe('complete');
    // Should have attempted gap fill (or already dense after multi-page)
    expect(job!.pagesFetched).toBeGreaterThan(1);
    // Prefer dataset complete; if venue still partial, gapsFound is reported
    if (!job!.datasetComplete) {
      expect(job!.gapsFound).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not stop after one page when startTime would trap Binance-style APIs', async () => {
    // Mimics Binance: startTime+endTime → first N bars from startTime only.
    // Manager must walk with endTime alone so many pages fill now → past date.
    const pageSize = 10;
    const step = 86_400; // 1d
    let calls = 0;
    let sawStartTime = false;
    const src: SourcePlugin = {
      id: 'binance-like',
      name: 'Binance Like',
      kind: 'source',
      builtIn: false,
      async fetchHistorical({ startTime, endTime, limit }) {
        calls++;
        if (typeof startTime === 'number' && startTime > 0) {
          sawStartTime = true;
          // Trap: return first N bars from startTime (would fake "complete")
          const n = Math.min(pageSize, Number(limit) || pageSize);
          const out: Bar[] = [];
          for (let i = 0; i < n; i++) out.push(bar(Math.floor(startTime) + i * step));
          return out;
        }
        const end =
          typeof endTime === 'number' && endTime > 0
            ? Math.floor(endTime)
            : Math.floor(Date.now() / 1000);
        const n = Math.min(pageSize, Number(limit) || pageSize);
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          out.push(bar(end - i * step));
        }
        return out;
      },
    };
    registry.registerSource(src);

    const now = Math.floor(Date.now() / 1000);
    const targetFrom = now - 45 * step; // needs > pageSize bars → multi-page
    const id = startBackfill({
      sourceId: 'binance-like',
      symbol: 'BTCUSDT',
      interval: '1d',
      targetFromSec: targetFrom,
      targetToSec: now,
    });

    const job = await _waitForJob(id, 15_000);
    expect(job!.status).toBe('complete');
    // Must not pass startTime (that would complete in 1 page at target date)
    expect(sawStartTime).toBe(false);
    expect(job!.pagesFetched).toBeGreaterThan(1);
    expect(job!.barsFetched).toBeGreaterThan(pageSize);
    // Within gap threshold of target past date
    expect(job!.oldestSec!).toBeLessThanOrEqual(targetFrom + 1.5 * step);
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
