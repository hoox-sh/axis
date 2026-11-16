/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Headless regression harness for the mock-walk venue.
 *
 * Proves that the seal boundary in `src/chart/commit-store.ts` keeps
 * already-committed history immutable while the bar window grows from
 * 4000 → 5000 bars. If a future change lets a re-apply rewrite sealed
 * values, the prefix-stability assertions below fail loudly.
 *
 * The mock-walk venue (`src/dev/mock-walk-bars.ts`, re-exported via
 * `tests/fixtures/mock-walk-10s.ts`) was added to reproduce the live
 * repaint bug without a chart, a store, or the network. This suite is
 * intentionally engine-free: no chart, no store, no runner, no I/O —
 * only the commit-once store and the fixture reference TA.
 *
 * Deterministic end to end: the bars are a seeded synthetic walk and the
 * reference TA is pure, so the same prefix always yields the same series.
 * No randomness anywhere.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

import { MOCK_WALK_BARS } from './fixtures/mock-walk-10s';
import { donchian, ema, rma, rsi, sma } from './fixtures/ta-reference';
import {
  _resetCommitStoreForTests,
  commitSeriesMap,
  sealedWriteCount,
} from '../src/chart/commit-store';
import type { Bar } from '../src/store/types';

const OWNER = 'mockwalk.test';
const WALK_START = 4000;
const WALK_END = 5000;
const WALK_STEP = 50;

const BARS = MOCK_WALK_BARS;

/** k values walked by the suite: 4000, 4050, …, 5000 (inclusive). */
function walkKs(): number[] {
  const ks: number[] = [];
  for (let k = WALK_START; k <= WALK_END; k += WALK_STEP) ks.push(k);
  // Defensive: keep the final endpoint exact if WALK_STEP ever overshoots.
  if (ks.length === 0 || ks[ks.length - 1] !== WALK_END) ks.push(WALK_END);
  return ks;
}
const WALK_KS = walkKs();

/** Reference series for a bar prefix — the exact values a re-apply would produce. */
interface MockWalkSeries {
  close: number[];
  sma20: number[];
  ema20: number[];
  rma14: number[];
  rsi14: number[];
  dc20u: number[];
  dc20m: number[];
  dc20l: number[];
}

function seriesFor(prefix: Bar[]): MockWalkSeries {
  const closes = prefix.map((b) => b.close);
  const dc = donchian(
    prefix.map((b) => b.high),
    prefix.map((b) => b.low),
    20,
  );
  return {
    close: closes,
    sma20: sma(closes, 20),
    ema20: ema(closes, 20),
    rma14: rma(closes, 14),
    rsi14: rsi(closes, 14),
    dc20u: dc.upper,
    dc20m: dc.middle,
    dc20l: dc.lower,
  };
}

/** Commit one prefix through the commit-once store, as the apply path would. */
function commitStep(k: number): {
  src: MockWalkSeries;
  committed: Record<string, (number | null)[]>;
} {
  const prefix = BARS.slice(0, k);
  const times = prefix.map((b) => b.time);
  const src = seriesFor(prefix);
  const committed = commitSeriesMap(OWNER, src as never, times) as Record<
    string,
    (number | null)[]
  >;
  return { src, committed };
}

describe('mock-walk repaint / seal regression', () => {
  beforeEach(() => {
    _resetCommitStoreForTests();
  });

  it('keeps sealed history immutable as the window grows 4000 → 5000 bars', () => {
    let prev: Record<string, (number | null)[]> | null = null;
    let prevLen = 0;
    for (const k of WALK_KS) {
      const { committed } = commitStep(k);
      if (prev !== null) {
        for (const key of Object.keys(committed)) {
          const col = committed[key];
          const prevCol = prev[key];
          expect(col).toBeDefined();
          expect(prevCol).toBeDefined();
          if (!col || !prevCol) continue;
          for (let i = 0; i < prevLen; i++) {
            // Sealed cells must never move — NaN warm-up cells compare equal
            // under bun's toEqual.
            expect(col[i]).toEqual(prevCol[i]);
          }
        }
      }
      prev = committed;
      prevLen = k;
    }
    expect(prevLen).toBe(WALK_END);
  });

  it('never needs to overwrite a sealed scalar during the walk', () => {
    for (const k of WALK_KS) commitStep(k);
    // NOTE: this asserts the guard counter stays flat. It relies on the
    // commit-store treating a NaN → NaN "rewrite" as a no-op; see the
    // completion report for the exact comparison in commit-store.ts.
    expect(sealedWriteCount()).toBe(0);
  });

  it('final full walk: every committed column spans 5000 bars and rsi14 NaN count matches the reference', () => {
    const { src, committed } = commitStep(WALK_END);
    expect(BARS.length).toBe(WALK_END);
    for (const key of Object.keys(committed)) {
      expect(committed[key]?.length).toBe(WALK_END);
    }
    const refNaN = src.rsi14.filter(Number.isNaN).length;
    const committedRsi = committed['rsi14'] ?? [];
    const gotNaN = committedRsi.filter((v) => v == null || Number.isNaN(v as number)).length;
    expect(gotNaN).toBe(refNaN);
  });
});
