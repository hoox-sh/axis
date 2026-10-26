/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { applyPrecomputedChart } from '../../src/indicators/apply-live';
import type { RunResult } from '../../src/indicators/runner';
import { store } from '../../src/store';

describe('applyPrecomputedChart', () => {
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
    const bars = times.map((time, i) => ({
      time,
      open: i + 1,
      high: i + 1,
      low: i + 1,
      close: i + 1,
      volume: 1,
    }));
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
    const stubManager = {
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
        { getManager: () => stubManager, noteChartSeriesHole: scanHole },
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
        { getManager: () => stubManager, noteChartSeriesHole: scanHole },
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
});
