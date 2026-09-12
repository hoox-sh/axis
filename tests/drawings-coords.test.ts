/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing coordinate helpers: bar period, future logical ↔ time (500 bars).
 */

import { describe, expect, it } from 'bun:test';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  DRAWING_FUTURE_BARS,
  createCoordContext,
  estimateBarPeriod,
  unixTimeToLogicalIndex,
  logicalIndexToUnixTime,
  clampTimeToFutureHorizon,
} from '../src/chart/drawings/coords';

function bars(n: number, start = 1_700_000_000, period = 3600) {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * period,
  }));
}

describe('estimateBarPeriod', () => {
  it('returns median of last deltas', () => {
    expect(estimateBarPeriod(bars(10, 0, 60))).toBe(60);
    expect(estimateBarPeriod(bars(5, 0, 3600))).toBe(3600);
  });

  it('falls back when short series', () => {
    expect(estimateBarPeriod([])).toBe(60);
    expect(estimateBarPeriod([{ time: 1 }])).toBe(60);
  });
});

describe('unixTimeToLogicalIndex / logicalIndexToUnixTime', () => {
  const b = bars(100, 1_700_000_000, 3600); // 100 hourly bars
  const lastIdx = 99;
  const lastT = b[lastIdx]!.time;

  it('maps known bar times to indices', () => {
    expect(unixTimeToLogicalIndex(b[0]!.time, b)).toBe(0);
    expect(unixTimeToLogicalIndex(b[50]!.time, b)).toBe(50);
    expect(unixTimeToLogicalIndex(lastT, b)).toBe(lastIdx);
  });

  it('extrapolates up to DRAWING_FUTURE_BARS past the end', () => {
    const t100 = lastT + 100 * 3600;
    const logical = unixTimeToLogicalIndex(t100, b);
    expect(logical).toBeCloseTo(lastIdx + 100, 5);

    const t600 = lastT + 600 * 3600; // beyond 500
    const capped = unixTimeToLogicalIndex(t600, b);
    expect(capped).toBe(lastIdx + DRAWING_FUTURE_BARS);
  });

  it('round-trips future times within horizon', () => {
    for (const extra of [1, 10, 50, 200, 500]) {
      const t = lastT + extra * 3600;
      const logical = unixTimeToLogicalIndex(t, b)!;
      const back = logicalIndexToUnixTime(logical, b)!;
      expect(back).toBeCloseTo(t, 5);
    }
  });

  it('logical past horizon clamps time', () => {
    const t = logicalIndexToUnixTime(lastIdx + 999, b)!;
    expect(t).toBe(lastT + DRAWING_FUTURE_BARS * 3600);
  });

  it('interpolates between bars', () => {
    const mid = (b[10]!.time + b[11]!.time) / 2;
    const logical = unixTimeToLogicalIndex(mid, b)!;
    expect(logical).toBeCloseTo(10.5, 5);
  });
});

describe('clampTimeToFutureHorizon', () => {
  const b = bars(10, 1000, 10);
  const last = b[9]!.time;

  it('leaves past/present alone', () => {
    expect(clampTimeToFutureHorizon(last, b)).toBe(last);
    expect(clampTimeToFutureHorizon(last - 5, b)).toBe(last - 5);
  });

  it('caps far-future times', () => {
    const far = last + 10_000;
    const max = last + 10 * DRAWING_FUTURE_BARS;
    expect(clampTimeToFutureHorizon(far, b)).toBe(max);
  });

  it('passes through non-finite / empty / corrupt-last inputs', () => {
    expect(clampTimeToFutureHorizon(NaN, b)).toBeNaN();
    expect(clampTimeToFutureHorizon(last + 100, [])).toBe(last + 100);
    expect(clampTimeToFutureHorizon(last + 100, [{ time: NaN }])).toBe(last + 100);
  });
});

describe('corrupt / degenerate bar series', () => {
  it('unixTimeToLogicalIndex skips NaN mids and rejects bad ends', () => {
    const odd = [{ time: 0 }, { time: NaN }, { time: 7200 }];
    expect(unixTimeToLogicalIndex(3600, odd)).toBe(0);
    expect(unixTimeToLogicalIndex(1, [])).toBeNull();
    expect(unixTimeToLogicalIndex(NaN, bars(3))).toBeNull();
    expect(unixTimeToLogicalIndex(1, [{ time: NaN }])).toBeNull();
  });

  it('logicalIndexToUnixTime rejects empty / NaN / corrupt ends', () => {
    expect(logicalIndexToUnixTime(1, [])).toBeNull();
    expect(logicalIndexToUnixTime(NaN, bars(3))).toBeNull();
    expect(logicalIndexToUnixTime(0.5, [{ time: 0 }, { time: NaN }])).toBeNull();
    expect(logicalIndexToUnixTime(-3, bars(10, 1000, 10))).toBe(1000 - 3 * 10);
  });

  it('logicalIndexToUnixTime interpolates mid-range', () => {
    const b = bars(100, 1_700_000_000, 3600);
    expect(logicalIndexToUnixTime(50.5, b)).toBeCloseTo(b[50]!.time + 1800, 5);
  });
});

describe('createCoordContext', () => {
  const hourly = bars(100, 1_700_000_000, 3600);
  const lastT = hourly[99]!.time;

  function stubChart(ts: Record<string, (...args: never[]) => unknown>) {
    return { timeScale: () => ts } as unknown as IChartApi;
  }
  function stubSeries(px: Record<string, (...args: never[]) => unknown>) {
    return px as unknown as ISeriesApi<'Candlestick'>;
  }
  const rect = (left: number, top: number) => ({ left, top }) as unknown as DOMRect;

  it('timeToX hits the scale directly and rejects NaN', () => {
    const ctx = createCoordContext(
      stubChart({ timeToCoordinate: () => 123 }),
      stubSeries({}),
      () => ({ width: 800, height: 600 }),
      { getBars: () => hourly },
    );
    expect(ctx.timeToX(lastT)).toBe(123);
    expect(ctx.timeToX(NaN)).toBeNull();
  });

  it('timeToX falls back to bars then logical index', () => {
    const ctx = createCoordContext(
      stubChart({
        timeToCoordinate: () => {
          throw new Error('off scale');
        },
        logicalToCoordinate: (l: unknown) => (l === 42 ? 456 : 789),
      }),
      stubSeries({}),
      () => ({ width: 800, height: 600 }),
      { getBars: () => hourly },
    );
    // lastT resolves via bars to logical 99 → stub returns 789 for non-42
    expect(ctx.timeToX(lastT)).toBe(789);
    // bar_index-style input without bars resolves via logical fallback
    const noBars = createCoordContext(
      stubChart({
        timeToCoordinate: () => {
          throw new Error('x');
        },
        logicalToCoordinate: () => 321,
      }),
      stubSeries({}),
      () => ({ width: 1, height: 1 }),
    );
    expect(noBars.timeToX(42)).toBe(321);
  });

  it('timeToX returns null when every path fails', () => {
    const ctx = createCoordContext(
      stubChart({
        timeToCoordinate: () => {
          throw new Error('x');
        },
        logicalToCoordinate: () => Infinity,
      }),
      stubSeries({}),
      () => ({ width: 1, height: 1 }),
      { getBars: () => hourly },
    );
    expect(ctx.timeToX(lastT)).toBeNull();
  });

  it('timeToX survives throwing logical lookups on each fallback', () => {
    const ctx = createCoordContext(
      stubChart({
        timeToCoordinate: () => {
          throw new Error('direct');
        },
        logicalToCoordinate: () => {
          throw new Error('logical');
        },
      }),
      stubSeries({}),
      () => ({ width: 1, height: 1 }),
      { getBars: () => hourly },
    );
    // Bars fallback throws, then logical fallback throws → null.
    expect(ctx.timeToX(lastT)).toBeNull();
  });

  it('priceToY maps, and nulls NaN / throws / Infinity', () => {
    const hit = createCoordContext(stubChart({}), stubSeries({ priceToCoordinate: () => 55 }), () => ({
      width: 1,
      height: 1,
    }));
    expect(hit.priceToY(100)).toBe(55);
    expect(hit.priceToY(NaN)).toBeNull();
    const throwing = createCoordContext(
      stubChart({}),
      stubSeries({
        priceToCoordinate: () => {
          throw new Error('off scale');
        },
      }),
      () => ({ width: 1, height: 1 }),
    );
    expect(throwing.priceToY(1)).toBeNull();
    const inf = createCoordContext(
      stubChart({}),
      stubSeries({ priceToCoordinate: () => Infinity }),
      () => ({ width: 1, height: 1 }),
    );
    expect(inf.priceToY(1)).toBeNull();
  });

  it('toXY needs both axes', () => {
    const ctx = createCoordContext(
      stubChart({ timeToCoordinate: () => 10 }),
      stubSeries({ priceToCoordinate: () => 20 }),
      () => ({ width: 1, height: 1 }),
    );
    expect(ctx.toXY({ time: lastT, price: 5 })).toEqual({ x: 10, y: 20 });
    expect(ctx.toXY({ time: NaN, price: 5 })).toBeNull();
    expect(ctx.toXY({ time: lastT, price: NaN })).toBeNull();
    const noX = createCoordContext(
      stubChart({
        timeToCoordinate: () => null,
        logicalToCoordinate: () => null,
      }),
      stubSeries({ priceToCoordinate: () => 20 }),
      () => ({ width: 1, height: 1 }),
    );
    expect(noX.toXY({ time: 1, price: 5 })).toBeNull();
  });

  it('timeToLogical round-trips, falls back to bars, then echoes', () => {
    const ctx = createCoordContext(
      stubChart({
        timeToCoordinate: () => 100,
        coordinateToLogical: () => 7,
      }),
      stubSeries({}),
      () => ({ width: 1, height: 1 }),
      { getBars: () => hourly },
    );
    expect(ctx.timeToLogical(lastT)).toBe(7);
    expect(ctx.timeToLogical(NaN)).toBeNull();
    const viaBars = createCoordContext(
      stubChart({
        timeToCoordinate: () => {
          throw new Error('x');
        },
      }),
      stubSeries({}),
      () => ({ width: 1, height: 1 }),
      { getBars: () => hourly },
    );
    expect(viaBars.timeToLogical(lastT)).toBe(99);
    const echo = createCoordContext(
      stubChart({
        timeToCoordinate: () => {
          throw new Error('x');
        },
      }),
      stubSeries({}),
      () => ({ width: 1, height: 1 }),
    );
    expect(echo.timeToLogical(12)).toBe(12);
  });

  it('clientToPoint rejects bad inputs', () => {
    const ctx = createCoordContext(
      stubChart({}),
      stubSeries({ coordinateToPrice: () => 1 }),
      () => ({ width: 1, height: 1 }),
    );
    expect(ctx.clientToPoint(NaN, 1, rect(0, 0))).toBeNull();
    expect(ctx.clientToPoint(1, 1, null as unknown as DOMRect)).toBeNull();
    expect(ctx.clientToPoint(1, 1, rect(NaN, 0))).toBeNull();
  });

  it('clientToPoint nulls when price is unresolvable', () => {
    const throwing = createCoordContext(
      stubChart({}),
      stubSeries({
        coordinateToPrice: () => {
          throw new Error('x');
        },
      }),
      () => ({ width: 1, height: 1 }),
    );
    expect(throwing.clientToPoint(5, 5, rect(0, 0))).toBeNull();
    const inf = createCoordContext(
      stubChart({}),
      stubSeries({ coordinateToPrice: () => Infinity }),
      () => ({ width: 1, height: 1 }),
    );
    expect(inf.clientToPoint(5, 5, rect(0, 0))).toBeNull();
  });

  it('clientToPoint resolves time then clamps to horizon', () => {
    const mk = (coordinateToTime: (x: number) => unknown) =>
      createCoordContext(
        stubChart({ coordinateToTime: coordinateToTime as never }),
        stubSeries({ coordinateToPrice: () => 9.5 }),
        () => ({ width: 800, height: 600 }),
        { getBars: () => hourly },
      );
    expect(mk(() => lastT).clientToPoint(10, 10, rect(0, 0))).toEqual({
      time: lastT,
      price: 9.5,
    });
    expect(
      mk(() => ({ timestamp: lastT })).clientToPoint(10, 10, rect(0, 0)),
    ).toEqual({ time: lastT, price: 9.5 });
    // Far-future time clamps to lastT + 500 bars
    expect(
      mk(() => lastT + 10_000 * 3600).clientToPoint(10, 10, rect(0, 0))!.time,
    ).toBe(lastT + DRAWING_FUTURE_BARS * 3600);
  });

  it('clientToPoint extrapolates past the last bar via logical index', () => {
    const ctx = createCoordContext(
      stubChart({
        coordinateToTime: () => null,
        coordinateToLogical: () => 104.5,
      }),
      stubSeries({ coordinateToPrice: () => 3 }),
      () => ({ width: 800, height: 600 }),
      { getBars: () => hourly },
    );
    const p = ctx.clientToPoint(900, 10, rect(0, 0))!;
    expect(p.price).toBe(3);
    expect(p.time).toBeCloseTo(lastT + 5.5 * 3600, 5);
  });

  it('clientToPoint nulls when logical extrapolation fails', () => {
    const ctx = createCoordContext(
      stubChart({
        coordinateToTime: () => null,
        coordinateToLogical: () => null,
      }),
      stubSeries({ coordinateToPrice: () => 3 }),
      () => ({ width: 1, height: 1 }),
      { getBars: () => hourly },
    );
    expect(ctx.clientToPoint(5, 5, rect(0, 0))).toBeNull();
  });

  it('clientToPoint extrapolates when coordinateToTime throws', () => {
    const ctx = createCoordContext(
      stubChart({
        coordinateToTime: () => {
          throw new Error('no time here');
        },
        coordinateToLogical: () => 99,
      }),
      stubSeries({ coordinateToPrice: () => 4 }),
      () => ({ width: 800, height: 600 }),
      { getBars: () => hourly },
    );
    expect(ctx.clientToPoint(5, 5, rect(0, 0))).toEqual({ time: lastT, price: 4 });
  });

  it('size reflects the latest getSize', () => {
    let w = 800;
    const ctx = createCoordContext(stubChart({}), stubSeries({}), () => ({
      width: w,
      height: 600,
    }));
    expect(ctx.size.width).toBe(800);
    w = 1024;
    expect(ctx.size.width).toBe(1024);
  });
});
