/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { alignApplySeries } from '../../src/indicators/apply-context';
import {
  _clearLiveTipCachesForTests,
  applyPrecomputedChart,
} from '../../src/indicators/apply-live';
import { buildOverlayPayloads } from '../../src/indicators/apply-overlays';
import type { RunResult } from '../../src/indicators/runner';
import { addIndicator, removeIndicator, store } from '../../src/store';

function tipResult(series: Record<string, (number | null)[]>, times: number[]): RunResult {
  return {
    status: 'success',
    plots: series.a ?? Object.values(series)[0] ?? [],
    series,
    events: [],
    bar_times: times,
    meta: { sessionVia: 'stream-delta', executionContext: 'tip' },
  } as RunResult;
}

function barsFromTimes(times: number[]) {
  return times.map((time, i) => ({
    time,
    open: i + 1,
    high: i + 1,
    low: i + 1,
    close: i + 1,
    volume: 1,
  }));
}

const stubManager = {
  getPane: () => ({}),
  createPane: () => null,
  setVisible: () => {},
  setLabel: () => {},
  syncTimeScales: () => {},
  syncOverlayLines: () => {},
  syncOverlayOhlc: () => {},
  syncBgcolorBands: () => {},
  setShapeMarkers: () => {},
  setTradeMarkers: () => {},
  refreshBadges: () => {},
} as never;

describe('applyPrecomputedChart', () => {
  beforeEach(() => {
    _clearLiveTipCachesForTests();
  });

  test('returns the result in this task (no thenable) when there is no chart', () => {
    const result: RunResult = {
      status: 'success',
      plots: [1],
      series: { a: [1] },
      events: [],
      meta: { sessionVia: 'stream-delta' },
    };
    const out = applyPrecomputedChart(
      'indicator("x")',
      undefined,
      result,
      [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
      { silent: true, liveTick: true },
    );
    expect(out && typeof (out as { then?: unknown }).then).not.toBe('function');
    expect(out.status).toBe('success');
  });

  test('an error result is not painted', () => {
    const out = applyPrecomputedChart(
      'indicator("x")',
      'ind-1',
      { status: 'error', plots: [], series: {}, events: [], meta: { error: 'boom' } },
      [],
      { silent: true, liveTick: true },
    );
    expect(out.status).toBe('error');
  });

  test('a live tick does not scan for internal series holes', () => {
    const times = [100, 160, 220];
    const bars = barsFromTimes(times);
    const result = {
      status: 'success',
      plots: [1, 2, 3],
      series: { a: [1, 2, 3] },
      events: [],
      bar_times: times,
      meta: { sessionVia: 'stream-delta' },
    } as RunResult;
    const holes: unknown[][] = [];
    const scanHole = ((...args: unknown[]) => {
      holes.push(args);
    }) as never;
    // Stub manager so align + hole gate run; later pane paint may throw.
    const noPaneManager = {
      getPane: () => null,
      createPane: () => null,
      setVisible: () => {},
      setLabel: () => {},
      syncTimeScales: () => {},
    } as never;
    try {
      applyPrecomputedChart(
        'indicator("EMA", overlay=true)',
        undefined,
        result,
        bars,
        { silent: true, liveTick: true },
        { getManager: () => noPaneManager, noteChartSeriesHole: scanHole },
      );
    } catch {
      /* paint after the hole gate is out of scope */
    }
    expect(holes.length).toBe(0);
    try {
      applyPrecomputedChart(
        'indicator("EMA", overlay=true)',
        undefined,
        { ...result, meta: { sessionVia: 'stream-full' } } as RunResult,
        bars,
        { silent: true, liveTick: false },
        { getManager: () => noPaneManager, noteChartSeriesHole: scanHole },
      );
    } catch {
      /* paint after the hole gate is out of scope */
    }
    expect(holes.length).toBe(1);
  });

  test('debug pins stay off the live path when the flag is false', () => {
    expect(store.debugPinsEnabled).toBe(false);
    const pinCalls: number[] = [];
    // No manager: returns before paint. The pins inject must not be consulted.
    const out = applyPrecomputedChart(
      'indicator("x")',
      undefined,
      {
        status: 'success',
        plots: [1],
        series: { a: [1] },
        events: [],
        meta: { sessionVia: 'stream-delta' },
      },
      [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
      { silent: true, liveTick: true },
      {
        applyDebugPins: (() => {
          pinCalls.push(1);
        }) as never,
      },
    );
    expect(out.status).toBe('success');
    expect(pinCalls.length).toBe(0);
  });

  test('a forming tip reuses the overlay cache and skips store + drawings', () => {
    const times = [100, 160, 220];
    const bars = barsFromTimes(times);
    const script = 'indicator("EMA", overlay=true)';
    const id = addIndicator('EMA', script, 'price', {});
    const alignCalls: number[] = [];
    const buildCalls: number[] = [];
    const storeCalls: number[] = [];
    const drawingCalls: number[] = [];
    const lastRunCalls: number[] = [];

    const alignSpy = ((...args: Parameters<typeof alignApplySeries>) => {
      alignCalls.push(1);
      return alignApplySeries(...args);
    }) as typeof alignApplySeries;
    const buildSpy = ((...args: Parameters<typeof buildOverlayPayloads>) => {
      buildCalls.push(1);
      return buildOverlayPayloads(...args);
    }) as typeof buildOverlayPayloads;

    try {
      // Seed a run slot so the second tip can skip setLastRun.
      const seed = tipResult({ a: [1, 2, 3] }, times);
      applyPrecomputedChart(script, id, seed, bars, { silent: true, liveTick: true }, {
        getManager: () => stubManager,
        alignApplySeries: alignSpy,
        buildOverlayPayloads: buildSpy,
        setLastRun: ((..._args: unknown[]) => {
          lastRunCalls.push(1);
          return null;
        }) as never,
        updateIndicatorStore: (() => {
          storeCalls.push(1);
          return true;
        }) as never,
        applyDrawings: (() => {
          drawingCalls.push(1);
        }) as never,
      });
      expect(alignCalls.length).toBe(1);
      expect(buildCalls.length).toBe(1);
      // Tip with indicatorId skips store + drawings (no drawings field).
      expect(storeCalls.length).toBe(0);
      expect(drawingCalls.length).toBe(0);
      expect(lastRunCalls.length).toBe(1);

      // Pretend the snapshot already parked a run so the next tip skips setLastRun.
      (store as { runResults: Record<string, unknown> }).runResults = {
        ...(store.runResults as Record<string, unknown>),
        [id]: seed,
      };

      alignCalls.length = 0;
      buildCalls.length = 0;
      storeCalls.length = 0;
      drawingCalls.length = 0;
      lastRunCalls.length = 0;

      const tip2 = tipResult({ a: [1, 2, 9] }, times);
      applyPrecomputedChart(script, id, tip2, bars, { silent: true, liveTick: true }, {
        getManager: () => stubManager,
        alignApplySeries: alignSpy,
        buildOverlayPayloads: buildSpy,
        setLastRun: ((..._args: unknown[]) => {
          lastRunCalls.push(1);
          return null;
        }) as never,
        updateIndicatorStore: (() => {
          storeCalls.push(1);
          return true;
        }) as never,
        applyDrawings: (() => {
          drawingCalls.push(1);
        }) as never,
      });

      expect(alignCalls.length).toBe(0);
      expect(buildCalls.length).toBe(0);
      expect(storeCalls.length).toBe(0);
      expect(drawingCalls.length).toBe(0);
      expect(lastRunCalls.length).toBe(0);

      delete (store.runResults as Record<string, unknown>)[id];
    } finally {
      removeIndicator(id);
    }
  });

  test('an append delta rebuilds overlays and refreshes the indicator store', () => {
    const times = [100, 160, 220];
    const bars = barsFromTimes(times);
    const script = 'indicator("EMA", overlay=true)';
    const id = addIndicator('EMA', script, 'price', {});
    const storeCalls: number[] = [];
    const buildCalls: number[] = [];
    const buildSpy = ((...args: Parameters<typeof buildOverlayPayloads>) => {
      buildCalls.push(1);
      return buildOverlayPayloads(...args);
    }) as typeof buildOverlayPayloads;

    try {
      applyPrecomputedChart(
        script,
        id,
        tipResult({ a: [1, 2, 3] }, times),
        bars,
        { silent: true, liveTick: true },
        {
          getManager: () => stubManager,
          buildOverlayPayloads: buildSpy,
          updateIndicatorStore: (() => {
            storeCalls.push(1);
            return true;
          }) as never,
        },
      );
      expect(buildCalls.length).toBe(1);
      expect(storeCalls.length).toBe(0);

      buildCalls.length = 0;
      storeCalls.length = 0;

      const append = {
        ...tipResult({ a: [1, 2, 3, 4] }, [...times, 280]),
        meta: { sessionVia: 'stream-delta', executionContext: 'append' },
      } as RunResult;
      applyPrecomputedChart(
        script,
        id,
        append,
        barsFromTimes([...times, 280]),
        { silent: true, liveTick: true },
        {
          getManager: () => stubManager,
          buildOverlayPayloads: buildSpy,
          updateIndicatorStore: (() => {
            storeCalls.push(1);
            return true;
          }) as never,
        },
      );
      expect(buildCalls.length).toBe(1);
      expect(storeCalls.length).toBe(1);
    } finally {
      removeIndicator(id);
    }
  });

  test('explicit empty drawings on a tip still reach applyDrawings', () => {
    const times = [100, 160];
    const bars = barsFromTimes(times);
    const script = 'indicator("x", overlay=true)';
    const id = addIndicator('X', script, 'price', {});
    const drawingCalls: unknown[] = [];

    try {
      applyPrecomputedChart(
        script,
        id,
        tipResult({ a: [1, 2] }, times),
        bars,
        { silent: true, liveTick: true },
        { getManager: () => stubManager },
      );

      const withEmpty = {
        ...tipResult({ a: [1, 3] }, times),
        drawings: [],
      } as RunResult;
      applyPrecomputedChart(script, id, withEmpty, bars, { silent: true, liveTick: true }, {
        getManager: () => stubManager,
        applyDrawings: ((ctx: { result: RunResult }) => {
          drawingCalls.push((ctx.result as { drawings?: unknown }).drawings);
        }) as never,
      });
      expect(drawingCalls).toEqual([[]]);
    } finally {
      removeIndicator(id);
    }
  });

  test('a lean tip hit syncs overlay lines without rebuild', () => {
    const times = [100, 160, 220];
    const bars = barsFromTimes(times);
    const script = 'indicator("EMA", overlay=true)';
    const id = addIndicator('EMA', script, 'price', {});
    const syncCalls: number[] = [];
    const alignCalls: number[] = [];
    const mgr = {
      ...stubManager,
      syncOverlayLines: () => {
        syncCalls.push(1);
      },
    } as never;

    try {
      const seed = tipResult({ a: [1, 2, 3] }, times);
      applyPrecomputedChart(script, id, seed, bars, { silent: true, liveTick: true }, {
        getManager: () => mgr,
        alignApplySeries: ((...args: Parameters<typeof alignApplySeries>) => {
          alignCalls.push(1);
          return alignApplySeries(...args);
        }) as typeof alignApplySeries,
      });
      expect(alignCalls.length).toBe(1);

      (store as { runResults: Record<string, unknown> }).runResults = {
        ...(store.runResults as Record<string, unknown>),
        [id]: seed,
      };
      alignCalls.length = 0;
      syncCalls.length = 0;

      applyPrecomputedChart(
        script,
        id,
        tipResult({ a: [1, 2, 9] }, times),
        bars,
        { silent: true, liveTick: true },
        {
          getManager: () => mgr,
          alignApplySeries: ((...args: Parameters<typeof alignApplySeries>) => {
            alignCalls.push(1);
            return alignApplySeries(...args);
          }) as typeof alignApplySeries,
        },
      );
      expect(alignCalls.length).toBe(0);
      expect(syncCalls.length).toBe(1);
      delete (store.runResults as Record<string, unknown>)[id];
    } finally {
      removeIndicator(id);
    }
  });

  test('OHLC tip patches the last candle without a full rebuild', () => {
    const times = [100, 160, 220];
    const bars = barsFromTimes(times);
    const script = 'indicator("Bars", overlay=true)';
    const id = addIndicator('Bars', script, 'price', {});
    const alignCalls: number[] = [];
    const ohlcSync: Array<{ open: number; high: number; low: number; close: number }> = [];

    const candle = [
      { open: 1, high: 2, low: 0.5, close: 1.5 },
      { open: 1.5, high: 2.5, low: 1, close: 2 },
      { open: 2, high: 3, low: 1.5, close: 2.5 },
    ];
    const seed = {
      status: 'success',
      plots: [],
      series: { candle },
      events: [],
      bar_times: times,
      meta: {
        sessionVia: 'stream-delta',
        executionContext: 'tip',
        plot_meta: { candle: { kind: 'plotcandle', title: 'candle' } },
      },
    } as RunResult;

    const mgr = {
      ...stubManager,
      syncOverlayOhlc: (
        _pane: string,
        rows: Array<{ data: Array<{ open: number; high: number; low: number; close: number }> }>,
      ) => {
        const last = rows[0]?.data[rows[0]!.data.length - 1];
        if (last) ohlcSync.push({ open: last.open, high: last.high, low: last.low, close: last.close });
      },
    } as never;

    const alignSpy = ((...args: Parameters<typeof alignApplySeries>) => {
      alignCalls.push(1);
      return alignApplySeries(...args);
    }) as typeof alignApplySeries;

    try {
      applyPrecomputedChart(script, id, seed, bars, { silent: true, liveTick: true }, {
        getManager: () => mgr,
        alignApplySeries: alignSpy,
      });
      expect(alignCalls.length).toBe(1);

      (store as { runResults: Record<string, unknown> }).runResults = {
        ...(store.runResults as Record<string, unknown>),
        [id]: seed,
      };
      alignCalls.length = 0;
      ohlcSync.length = 0;

      const tip2 = {
        ...seed,
        series: {
          candle: [candle[0], candle[1], { open: 2.5, high: 4, low: 2, close: 3.5 }],
        },
      } as RunResult;
      applyPrecomputedChart(script, id, tip2, bars, { silent: true, liveTick: true }, {
        getManager: () => mgr,
        alignApplySeries: alignSpy,
      });
      expect(alignCalls.length).toBe(0);
      expect(ohlcSync.length).toBeGreaterThanOrEqual(1);
      expect(ohlcSync[ohlcSync.length - 1]).toEqual({
        open: 2.5,
        high: 4,
        low: 2,
        close: 3.5,
      });
      delete (store.runResults as Record<string, unknown>)[id];
    } finally {
      removeIndicator(id);
    }
  });
});
