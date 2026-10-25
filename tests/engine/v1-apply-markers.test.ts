/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import '../setup';
import { describe, expect, test } from 'bun:test';
import { MAX_CHART_MARKERS } from '../../src/chart/heavy-data';
import {
  applyPlotsAndMarkers,
  buildShapeMarkers,
  type ChartMutationContext,
} from '../../src/indicators/apply-mutations';
import type { StrategyApplyContext } from '../../src/indicators/apply-strategy';
import type { RunResult } from '../../src/indicators/runner';
import type { PlotMetaEntry } from '../../src/results/plot-visuals';

type Split = ChartMutationContext['split'];

function emptySplit(shapes: Split['shapes'] = []): Split {
  return {
    lines: [],
    bgcolors: [],
    barcolors: [],
    shapes,
    fills: [],
    ohlc: [],
  };
}

function mockManager(opts?: {
  throwShape?: boolean;
  throwTrade?: boolean;
}): {
  calls: { shape: number; trade: number; setData: number; update: number };
  shapeArgs: unknown[][];
  manager: ChartMutationContext['manager'];
} {
  const calls = { shape: 0, trade: 0, setData: 0, update: 0 };
  const shapeArgs: unknown[][] = [];
  const manager = {
    setShapeMarkers: (...args: unknown[]) => {
      calls.shape += 1;
      shapeArgs.push(args);
      if (opts?.throwShape) throw new Error('setShapeMarkers');
    },
    setTradeMarkers: () => {
      calls.trade += 1;
      if (opts?.throwTrade) throw new Error('setTradeMarkers');
    },
    hideEquityPane: () => {},
    syncOverlayLines: () => {
      calls.setData += 1;
    },
    syncOverlayOhlc: () => {},
    refreshBadges: () => {},
    syncBgcolorBands: () => {},
    applyBarColors: () => 0,
    getPane: () => undefined,
    auditTimeParity: () => [],
  };
  return { calls, shapeArgs, manager: manager as unknown as ChartMutationContext['manager'] };
}

function mutation(
  manager: ChartMutationContext['manager'],
  split: Split,
  extra?: Partial<ChartMutationContext>,
): ChartMutationContext {
  return {
    manager,
    paneId: 'price',
    overlay: true,
    overlayLines: [{ name: 'plot0', data: [{ time: 1, value: 10 }] }],
    overlayOhlc: [],
    split,
    plotMeta: {},
    seriesMap: { plot0: [10] },
    ohlcvTimes: [1],
    silent: true,
    indicatorId: 'script_a',
    forceFull: false,
    ...extra,
  };
}

function strategy(
  manager: ChartMutationContext['manager'],
  events: RunResult['events'],
  extra?: Partial<StrategyApplyContext>,
): StrategyApplyContext {
  return {
    manager,
    result: {
      status: 'success',
      plots: [],
      series: {},
      events: events ?? [],
    },
    scriptType: events?.length ? 'strategy' : 'indicator',
    silent: true,
    indicatorId: 'script_a',
    bars: [
      {
        time: 1,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1,
      },
    ],
    ...extra,
  };
}

describe('applyPlotsAndMarkers', () => {
  test('happy path paints plots and markers once', () => {
    const { calls, manager } = mockManager();
    const split = emptySplit([
      {
        key: 'sig',
        values: [true],
        meta: { kind: 'plotshape' } as PlotMetaEntry,
      },
    ]);
    const result = applyPlotsAndMarkers({
      mutation: mutation(manager, split, { ohlcvTimes: [1_700_000_000] }),
      strategy: strategy(manager, [
        {
          kind: 'entry',
          id: 'L',
          direction: 'long',
          bar_time: 1_700_000_000,
          ohlc: [10, 11, 9, 10.5],
          qty: 1,
        },
      ]),
    });
    expect(result).toEqual({ ok: true, action: 'commit' });
    expect(calls.shape).toBe(1);
    expect(calls.trade).toBe(1);
    expect(calls.setData).toBe(1);
    expect(calls.update).toBe(0);
  });

  test('setShapeMarkers throw does not call plot setData/update', () => {
    const { calls, manager } = mockManager({ throwShape: true });
    const split = emptySplit([
      {
        key: 'sig',
        values: [true],
        meta: { kind: 'plotshape' } as PlotMetaEntry,
      },
    ]);
    const result = applyPlotsAndMarkers({
      mutation: mutation(manager, split, { ohlcvTimes: [1_700_000_000] }),
      strategy: strategy(manager, []),
    });
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(calls.shape).toBe(1);
    expect(calls.setData).toBe(0);
    expect(calls.update).toBe(0);
    expect(calls.trade).toBe(0);
  });

  test('setTradeMarkers throw does not call plot setData/update', () => {
    const { calls, manager } = mockManager({ throwTrade: true });
    const result = applyPlotsAndMarkers({
      mutation: mutation(manager, emptySplit()),
      strategy: strategy(manager, [
        {
          kind: 'entry',
          id: 'L',
          direction: 'long',
          bar_time: 1,
          ohlc: [10, 11, 9, 10.5],
          qty: 1,
        },
      ]),
    });
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(calls.trade).toBe(1);
    expect(calls.setData).toBe(0);
    expect(calls.update).toBe(0);
  });

  test('liveTick still applies that bar\'s markers', () => {
    const { calls, manager } = mockManager();
    const split = emptySplit([
      {
        key: 'sig',
        values: [true],
        meta: { kind: 'plotshape' } as PlotMetaEntry,
      },
    ]);
    const result = applyPlotsAndMarkers({
      mutation: mutation(manager, split, {
        ohlcvTimes: [1_700_000_000],
        forceFull: false,
      }),
      strategy: strategy(manager, [
        {
          kind: 'entry',
          id: 'L',
          direction: 'long',
          bar_time: 1_700_000_000,
          ohlc: [10, 11, 9, 10.5],
          qty: 1,
        },
      ]),
    });
    expect(result.ok).toBe(true);
    expect(calls.shape).toBe(1);
    expect(calls.trade).toBe(1);
    expect(calls.setData).toBe(1);
  });

  test('shape markers stay capped at 2500', () => {
    const n = MAX_CHART_MARKERS + 80;
    const times = Array.from({ length: n }, (_, i) => i + 1);
    const values = times.map(() => true);
    const split = emptySplit([
      { key: 'all', values, meta: { title: 'all' } as PlotMetaEntry },
    ]);
    const markers = buildShapeMarkers({ split, ohlcvTimes: times });
    expect(markers).toHaveLength(MAX_CHART_MARKERS);
    expect(markers[0]?.time).toBe(n - MAX_CHART_MARKERS + 1);

    const { calls, shapeArgs, manager } = mockManager();
    const result = applyPlotsAndMarkers({
      mutation: mutation(manager, split, { ohlcvTimes: times, seriesMap: { all: values } }),
      strategy: strategy(manager, []),
    });
    expect(result.ok).toBe(true);
    expect(calls.shape).toBe(1);
    const painted = shapeArgs[0]?.[0];
    expect(Array.isArray(painted) ? painted.length : 0).toBe(MAX_CHART_MARKERS);
  });
});
