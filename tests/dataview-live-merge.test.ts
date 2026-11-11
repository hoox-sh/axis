/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Data Window live merge: tipCaches overlay runResults / indicatorSeries for
 * every visible script (EMA + Donchian) including forming-tip tip cells.
 */
import { describe, expect, it } from 'bun:test';
import { mergeLivePlotSeriesForDataView } from '../src/indicators/apply-live';
import { buildDataViewRows } from '../src/results/dataview';
import { makeBars } from './fixtures/bars';

const bars = makeBars(4, 1_700_000_000, 60);
const chartTimes = bars.map((b) => b.time);

describe('mergeLivePlotSeriesForDataView', () => {
  it('shows EMA and Donchian Upper/Lower/Mid together', () => {
    const collected = mergeLivePlotSeriesForDataView({
      scripts: [
        { id: 'ema', name: 'AXIS EMA', visible: true },
        { id: 'dc', name: 'AXIS Donchian Strat', visible: true },
      ],
      runResults: {
        ema: {
          status: 'success',
          series: { EMA: [1, 2, 3, 4] },
          meta: { plot_meta: { EMA: { title: 'EMA', color: '#8B9CFF' } } },
        },
        dc: {
          status: 'success',
          series: {
            Upper: [10, 11, 12, 13],
            Lower: [1, 2, 3, 4],
            Mid: [5, 6, 7, 8],
          },
          meta: {
            plot_meta: {
              Upper: { title: 'Upper', color: '#00bcd4' },
              Lower: { title: 'Lower', color: '#00bcd4' },
              Mid: { title: 'Mid', color: '#64748b' },
            },
          },
        },
      },
      tipCaches: null,
      chartTimes,
    });

    const rows = buildDataViewRows({
      bars,
      barIndex: 3,
      series: collected.series,
      plotMeta: collected.plotMeta,
    });
    const labels = rows.filter((r) => r.group === 'series').map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['EMA', 'Upper', 'Lower', 'Mid']));
  });

  it('overlays forming-tip tipCaches onto stale runResults', () => {
    const collected = mergeLivePlotSeriesForDataView({
      scripts: [{ id: 'dc', name: 'Donchian', visible: true }],
      runResults: {
        dc: {
          status: 'success',
          series: { Upper: [10, 11, 12, 13] },
          meta: { plot_meta: { Upper: { title: 'Upper' } } },
        },
      },
      tipCaches: {
        dc: {
          seriesMap: { Upper: [10, 11, 12, 99] },
          plotMeta: { Upper: { title: 'Upper' } },
          scriptName: 'Donchian',
          ohlcvTimes: [...chartTimes],
        },
      },
      chartTimes,
    });

    expect(collected.series.Upper?.[3]).toBe(99);
    const rows = buildDataViewRows({
      bars,
      barIndex: 3,
      series: collected.series,
      plotMeta: collected.plotMeta,
    });
    expect(rows.find((r) => r.label === 'Upper')?.value).toContain('99');
  });

  it('includes tip-only scripts missing from indicatorSeries', () => {
    const collected = mergeLivePlotSeriesForDataView({
      scripts: [{ id: 'ema', name: 'EMA', visible: true }],
      runResults: {
        ema: { status: 'success', series: { EMA: [1, 2, 3, 4] } },
      },
      tipCaches: {
        dc: {
          seriesMap: { Mid: [5, 6, 7, 8] },
          plotMeta: { Mid: { title: 'Mid' } },
          scriptName: 'Donchian',
          ohlcvTimes: [...chartTimes],
        },
      },
      chartTimes,
    });

    expect(collected.series.EMA?.[3]).toBe(4);
    expect(collected.series.Mid?.[3]).toBe(8);
  });

  it('patches the tip index when tipCaches only carry the last cell', () => {
    const collected = mergeLivePlotSeriesForDataView({
      scripts: [{ id: 'sma', name: 'SMA', visible: true }],
      runResults: {
        sma: {
          status: 'success',
          series: { SMA: [1, 2, 3, 4] },
          meta: { plot_meta: { SMA: { title: 'SMA' } } },
        },
      },
      tipCaches: {
        sma: {
          seriesMap: { SMA: [42] },
          plotMeta: { SMA: { title: 'SMA' } },
        },
      },
      chartTimes,
    });

    expect(collected.series.SMA).toEqual([1, 2, 3, 42]);
  });
});
