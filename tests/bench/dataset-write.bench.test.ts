/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Optional bench: the dataset write path on a deep series.
 *
 * The DSM backfill writes one page at a time. The write used to rebuild a
 * map, re-sort the whole series and re-sanitize every bar on every page —
 * O(n log n) plus n allocations per page, on a series that reaches 50k bars.
 * The stored series is already repaired, so the page is merged in one
 * linear pass now.
 *
 * Skipped unless `AXIS_BENCH=1` (not part of default CI / `bun run test`).
 * Run: `bun run test:bench` or `AXIS_BENCH=1 bun test tests/bench/`
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import {
  isSortedUnique,
  mergeSortedSeries,
  mergeWithConflictPolicy,
} from '../../src/data/merge-datasets';
import { repairBars } from '../../src/data/dataset-validate';
import { BENCH_HISTORY_BARS, makeScaleBars } from './fixtures-scale';
import { formatSample, measureOps } from './metrics';

const RUN = process.env.AXIS_BENCH === '1';

/** Bars per venue page. */
const PAGE_BARS = 1_000;
/** Pages written in the timed run. */
const PAGES = 50;
/** Soft wall-time budget for the linear merge on a 50k series. */
const MERGE_SOFT_BUDGET_MS = 5_000;

function pageBars(from: number, count: number, step = 60): ReturnType<typeof makeScaleBars> {
  return makeScaleBars(count, from, step);
}

describe.skipIf(!RUN)('dataset write path (AXIS_BENCH=1)', () => {
  it(`merges ${PAGES} pages into a ${BENCH_HISTORY_BARS.toLocaleString()}-bar series under soft budget`, () => {
    const base = repairBars(makeScaleBars(BENCH_HISTORY_BARS), '1m').bars;
    const step = 60;
    const startTail = base[base.length - 1]!.time + step;

    // Linear merge — the current write path.
    let current = base;
    const sample = measureOps('dataset linear merge', PAGES, () => {
      for (let p = 0; p < PAGES; p++) {
        const page = repairBars(pageBars(startTail + p * PAGE_BARS * step, PAGE_BARS, step), '1m')
          .bars;
        current = isSortedUnique(current) && isSortedUnique(page)
          ? mergeSortedSeries(current, page).bars
          : repairBars(mergeWithConflictPolicy(current, page).bars, '1m').bars;
      }
    });

    expect(current.length).toBe(BENCH_HISTORY_BARS + PAGES * PAGE_BARS);
    expect(sample.ms).toBeLessThan(MERGE_SOFT_BUDGET_MS);
    // eslint-disable-next-line no-console
    console.log(formatSample(sample));
  });
});

// Always-visible placeholder so `bun test tests/bench/` reports a passing suite when skipped.
describe('dataset write path gate', () => {
  it('is skipped unless AXIS_BENCH=1', () => {
    if (RUN) {
      expect(process.env.AXIS_BENCH).toBe('1');
    } else {
      expect(process.env.AXIS_BENCH).not.toBe('1');
    }
  });
});
