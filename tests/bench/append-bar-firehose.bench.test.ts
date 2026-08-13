/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Optional firehose bench: 500k `appendBar` ticks on ~50k history.
 *
 * Skipped unless `AXIS_BENCH=1` (not part of default CI / `bun run test`).
 * Run: `bun run test:bench` or `AXIS_BENCH=1 bun test tests/bench/`
 */

import '../setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  appendBar,
  loadBars,
  setStore,
  store,
  HISTORY_BARS_MAX,
} from '../../src/store';
import type { Bar } from '../../src/store/types';
import {
  BENCH_HISTORY_BARS,
  BENCH_TICK_COUNT,
  makeScaleBars,
  nextFirehoseBar,
} from './fixtures-scale';
import {
  FIREHOSE_SOFT_BUDGET_MS,
  formatSample,
  measureOps,
} from './metrics';

const RUN = process.env.AXIS_BENCH === '1';

describe.skipIf(!RUN)('appendBar firehose (AXIS_BENCH=1)', () => {
  beforeEach(() => {
    setStore('live', {
      active: true,
      needsRerun: false,
      lastBarTime: 0,
      streamId: 'bench-firehose',
      preferAfterLoad: false,
      rerunOn: 'every-tick',
    });
  });

  it(`handles ${BENCH_TICK_COUNT.toLocaleString()} ticks on ~${BENCH_HISTORY_BARS.toLocaleString()} history under soft budget`, () => {
    const history = makeScaleBars(BENCH_HISTORY_BARS);
    loadBars(history, 'BTCUSDT', '1m', 'bench');
    expect(store.bars.length).toBe(BENCH_HISTORY_BARS);

    const tip = store.bars[store.bars.length - 1]!;
    let cur: Bar = {
      time: tip.time,
      open: tip.open,
      high: tip.high,
      low: tip.low,
      close: tip.close,
      volume: tip.volume,
    };

    const sample = measureOps('appendBar firehose', BENCH_TICK_COUNT, () => {
      for (let i = 0; i < BENCH_TICK_COUNT; i++) {
        cur = nextFirehoseBar(cur, i);
        appendBar(cur);
      }
    });

    // Soft budget — CI/shared hosts; path-update hot path should finish far sooner.
    expect(sample.ms).toBeLessThan(FIREHOSE_SOFT_BUDGET_MS);
    expect(store.bars.length).toBeGreaterThan(0);
    expect(store.bars.length).toBeLessThanOrEqual(HISTORY_BARS_MAX);
    expect(store.bars[store.bars.length - 1]!.time).toBe(cur.time);
    expect(store.live.lastBarTime).toBe(cur.time);
    expect(store.live.needsRerun).toBe(true);

    // eslint-disable-next-line no-console
    console.log(formatSample(sample));
  });
});

// Always-visible placeholder so `bun test tests/bench/` reports a passing suite when skipped.
describe('appendBar firehose gate', () => {
  it('is skipped unless AXIS_BENCH=1', () => {
    if (RUN) {
      expect(process.env.AXIS_BENCH).toBe('1');
    } else {
      expect(process.env.AXIS_BENCH ?? '').not.toBe('1');
    }
  });
});
