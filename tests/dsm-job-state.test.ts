/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The state machine around a backfill job and the dataset store's migration
 * path.
 *
 * - A pause that has not reached the runner yet must still be resumable.
 * - A dismissed job must not come back when its runner settles.
 * - A cancelled job must not paint the chart.
 * - A persistence-mode switch migrates the datasets that live **only** in the
 *   old sink.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  _resetDataSourceManagerForTests,
  cancelBackfill,
  dismissJob,
  getDataSourceJobs,
  pauseBackfill,
  resumeBackfill,
  startBackfill,
} from '../src/data/data-source-manager';
import {
  _resetDatasetStoreForTests,
  awaitPendingCopies,
  getDataset,
  peekDataset,
  putDatasetBars,
  setPersistenceMode,
} from '../src/data/dataset-store';
import { _resetDatasetSinksForTests } from '../src/data/dataset-sinks';
import { _resetBarsCacheForTests, putCachedBars } from '../src/data/bars-cache';
import { registry } from '../src/plugins/registry';
import type { SourcePlugin } from '../src/plugins/types';
import type { Bar } from '../src/store/types';

function bar(t: number, close = 100): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

/** A source that never answers — the job then parks in `running`. */
function stallingSource(id: string): SourcePlugin {
  return {
    id,
    name: id,
    kind: 'source',
    builtIn: false,
    async fetchHistorical() {
      // Never resolves: the job stays `running` while the test drives it.
      await new Promise(() => {});
      return [];
    },
  };
}

beforeEach(async () => {
  _resetDataSourceManagerForTests();
  _resetDatasetStoreForTests();
  _resetDatasetSinksForTests();
  await _resetBarsCacheForTests();
  for (const id of ['stall-src', 'stall-src-2']) {
    try {
      registry.unregisterSource(id);
    } catch {
      /* ignore */
    }
  }
});

describe('backfill job state machine', () => {
  it('resumes a pause that has not reached the runner yet', () => {
    registry.registerSource(stallingSource('stall-src'));
    const id = startBackfill({
      sourceId: 'stall-src',
      symbol: 'X',
      interval: '1m',
    });
    const job = getDataSourceJobs().find((j) => j.id === id);
    expect(job).toBeTruthy();

    // Pause while the job is still `running` — the runner flips the status at
    // the next page boundary, so a resume in this window used to be dropped.
    pauseBackfill(id);
    resumeBackfill(id);

    // The job is still alive and not cancelled.
    const after = getDataSourceJobs().find((j) => j.id === id);
    expect(after?.status).not.toBe('cancelled');
  });

  it('does not resurrect a dismissed job when its runner settles', () => {
    registry.registerSource(stallingSource('stall-src-2'));
    const id = startBackfill({
      sourceId: 'stall-src-2',
      symbol: 'Y',
      interval: '1m',
    });
    expect(getDataSourceJobs().some((j) => j.id === id)).toBe(true);
    dismissJob(id);
    expect(getDataSourceJobs().some((j) => j.id === id)).toBe(false);
    // A late status sync must not re-insert it.
    cancelBackfill(id);
    expect(getDataSourceJobs().some((j) => j.id === id)).toBe(false);
  });
});

describe('dataset store · persistence mode switch', () => {
  it('migrates a dataset that only the old sink holds', async () => {
    await putCachedBars('binance-rest', 'SOLO', '1h', [bar(60, 1), bar(3600, 2)]);
    // The dataset store never saw it — its mirror is cold.
    expect(peekDataset('binance-rest', 'SOLO', '1h')).toBeNull();

    setPersistenceMode('session');
    await awaitPendingCopies();

    const bars = await getDataset('binance-rest', 'SOLO', '1h');
    expect(bars.map((b) => b.time)).toEqual([60, 3600]);
  });

  it('keeps a mirrored dataset across the switch', async () => {
    await putDatasetBars('binance-rest', 'MIRROR', '1h', [bar(60, 1)]);
    setPersistenceMode('session');
    await awaitPendingCopies();
    const bars = await getDataset('binance-rest', 'MIRROR', '1h');
    expect(bars.map((b) => b.time)).toEqual([60]);
  });
});
