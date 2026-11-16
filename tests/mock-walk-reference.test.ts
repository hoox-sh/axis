/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Reference-vector tests for the deterministic 10s mock walk and the
 * pyne-equivalent `ta.*` reference implementations in `tests/fixtures`.
 *
 * The load-bearing property is prefix consistency: evaluating a series on a
 * truncated prefix must produce bit-identical values (and identical NaN
 * positions) for every index before the cut. That is what guarantees live
 * re-runs on growing bars can be compared against full-history references.
 */

import { describe, expect, it } from 'bun:test';

import {
  MOCK_WALK_BARS,
  MOCK_WALK_COUNT,
  MOCK_WALK_START_TIME,
  MOCK_WALK_STEP_SEC,
  mockWalkBars,
} from './fixtures/mock-walk-10s';
import { donchian, ema, highest, lowest, rma, rsi, sma } from './fixtures/ta-reference';

const CLOSES = MOCK_WALK_BARS.map((b) => b.close);
const HIGHS = MOCK_WALK_BARS.map((b) => b.high);
const LOWS = MOCK_WALK_BARS.map((b) => b.low);

/** Assert exact equality (incl. NaN positions) over the first `upto` cells. */
function expectSeriesMatch(a: number[], b: number[], upto: number): void {
  expect(a.length).toBeGreaterThanOrEqual(upto);
  expect(b.length).toBeGreaterThanOrEqual(upto);
  for (let i = 0; i < upto; i++) {
    const aNaN = Number.isNaN(a[i]);
    const bNaN = Number.isNaN(b[i]);
    expect(bNaN).toBe(aNaN);
    if (!aNaN) expect(b[i]).toBe(a[i]);
  }
}

describe('mockWalkBars determinism', () => {
  it('produces identical bars for the same seed', () => {
    const a = mockWalkBars(500, 1337);
    const b = mockWalkBars(500, 1337);
    expect(a).toEqual(b);
  });

  it('produces different closes for a different seed', () => {
    const a = mockWalkBars(500, 1337).map((b) => b.close);
    const b = mockWalkBars(500, 1338).map((b) => b.close);
    expect(a).not.toEqual(b);
  });

  it('defaults to the full fixture size and seed', () => {
    expect(mockWalkBars().length).toBe(MOCK_WALK_COUNT);
    expect(mockWalkBars()).toEqual([...MOCK_WALK_BARS]);
  });
});

describe('MOCK_WALK_BARS invariants', () => {
  it('has the expected length and 10s-spaced, strictly increasing times', () => {
    expect(MOCK_WALK_BARS).toHaveLength(MOCK_WALK_COUNT);
    for (let i = 0; i < MOCK_WALK_BARS.length; i++) {
      expect(MOCK_WALK_BARS[i].time).toBe(MOCK_WALK_START_TIME + i * MOCK_WALK_STEP_SEC);
      if (i > 0) {
        expect(MOCK_WALK_BARS[i].time - MOCK_WALK_BARS[i - 1].time).toBe(MOCK_WALK_STEP_SEC);
      }
    }
  });

  it('keeps OHLCV finite and internally consistent', () => {
    for (const bar of MOCK_WALK_BARS) {
      expect(Number.isFinite(bar.time)).toBe(true);
      expect(Number.isFinite(bar.open)).toBe(true);
      expect(Number.isFinite(bar.high)).toBe(true);
      expect(Number.isFinite(bar.low)).toBe(true);
      expect(Number.isFinite(bar.close)).toBe(true);
      expect(Number.isFinite(bar.volume)).toBe(true);
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.close).toBeGreaterThan(0);
      expect(bar.volume).toBeGreaterThan(0);
    }
  });

  it('exposes a frozen array', () => {
    expect(Object.isFrozen(MOCK_WALK_BARS)).toBe(true);
  });
});

describe('ta-reference sanity', () => {
  it('sma/ema/rma of a constant series equal the constant after warm-up', () => {
    const flat = new Array<number>(64).fill(42);
    const s = sma(flat, 14);
    for (let i = 0; i < 13; i++) expect(Number.isNaN(s[i])).toBe(true);
    for (let i = 13; i < flat.length; i++) expect(s[i]).toBe(42);

    const e = ema(flat, 14);
    for (let i = 0; i < 13; i++) expect(Number.isNaN(e[i])).toBe(true);
    for (let i = 13; i < flat.length; i++) expect(e[i]).toBeCloseTo(42, 10);

    const r = rma(flat, 14);
    for (let i = 0; i < 13; i++) expect(Number.isNaN(r[i])).toBe(true);
    for (let i = 13; i < flat.length; i++) expect(r[i]).toBeCloseTo(42, 10);
  });

  it('donchian bands satisfy upper >= middle >= lower wherever defined', () => {
    const { upper, middle, lower } = donchian(HIGHS, LOWS, 20);
    let checked = 0;
    for (let i = 0; i < HIGHS.length; i++) {
      const u = upper[i];
      const m = middle[i];
      const l = lower[i];
      if (Number.isNaN(u) || Number.isNaN(l)) {
        expect(Number.isNaN(m)).toBe(true);
        continue;
      }
      expect(u).toBeGreaterThanOrEqual(m);
      expect(m).toBeGreaterThanOrEqual(l);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('rsi stays within [0, 100] wherever defined', () => {
    const values = rsi(CLOSES, 14);
    let checked = 0;
    for (const v of values) {
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      checked += 1;
    }
    expect(checked).toBe(MOCK_WALK_COUNT - 14);
  });

  it('highest/lowest bracket the window and skip nothing on finite input', () => {
    const hi = highest(HIGHS, 20);
    const lo = lowest(LOWS, 20);
    for (let i = 19; i < HIGHS.length; i++) {
      expect(hi[i]).toBeGreaterThanOrEqual(lo[i]);
      expect(hi[i]).toBe(Math.max(...HIGHS.slice(i - 19, i + 1)));
      expect(lo[i]).toBe(Math.min(...LOWS.slice(i - 19, i + 1)));
    }
    for (let i = 0; i < 19; i++) {
      expect(Number.isNaN(hi[i])).toBe(true);
      expect(Number.isNaN(lo[i])).toBe(true);
    }
  });
});

describe('prefix consistency (full history vs truncated prefix)', () => {
  const cutPoints = [50, 500, 3999, 4999] as const;

  for (const cut of cutPoints) {
    it(`cut=${cut}: sma/ema/rma/rsi/donchian match exactly before the cut`, () => {
      const closesFull = CLOSES;
      const highsFull = HIGHS;
      const lowsFull = LOWS;
      const closesP = closesFull.slice(0, cut);
      const highsP = highsFull.slice(0, cut);
      const lowsP = lowsFull.slice(0, cut);

      expectSeriesMatch(sma(closesFull, 14), sma(closesP, 14), cut);
      expectSeriesMatch(ema(closesFull, 14), ema(closesP, 14), cut);
      expectSeriesMatch(rma(closesFull, 14), rma(closesP, 14), cut);
      expectSeriesMatch(rsi(closesFull, 14), rsi(closesP, 14), cut);

      const dFull = donchian(highsFull, lowsFull, 20);
      const dPref = donchian(highsP, lowsP, 20);
      expectSeriesMatch(dFull.upper, dPref.upper, cut);
      expectSeriesMatch(dFull.lower, dPref.lower, cut);
      expectSeriesMatch(dFull.middle, dPref.middle, cut);
    });
  }
});
