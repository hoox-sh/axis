/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Data Window aggregates every visible applied script (not only lastRun) and
 * time-joins live indicatorSeries onto the chart axis.
 */
import { describe, expect, it } from 'bun:test';
import { collectDataViewSeries, buildDataViewRows } from '../src/results/dataview';
import { makeBars } from './fixtures/bars';

const bars = makeBars(4, 1_700_000_000, 60);
const chartTimes = bars.map((b) => b.time);

describe('collectDataViewSeries', () => {
  it('merges EMA + Donchian from runResults / indicatorSeries', () => {
    const collected = collectDataViewSeries({
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
      chartTimes,
    });

    expect(Object.keys(collected.series).sort()).toEqual(['EMA', 'Lower', 'Mid', 'Upper']);
    const rows = buildDataViewRows({
      bars,
      barIndex: 3,
      series: collected.series,
      plotMeta: collected.plotMeta,
    });
    const labels = rows.filter((r) => r.group === 'series').map((r) => r.label);
    expect(labels).toContain('EMA');
    expect(labels).toContain('Upper');
    expect(labels).toContain('Lower');
    expect(labels).toContain('Mid');
    expect(rows.find((r) => r.label === 'Upper')?.value).not.toBe('—');
  });

  it('prefers indicatorSeries tip values over stale runResults', () => {
    const collected = collectDataViewSeries({
      scripts: [{ id: 'ema', name: 'AXIS EMA', visible: true }],
      runResults: {
        ema: {
          status: 'success',
          series: { EMA: [1, 2, 3] },
          bar_times: chartTimes.slice(0, 3),
          meta: { plot_meta: { EMA: { title: 'EMA' } } },
        },
      },
      indicatorSeries: {
        ema: {
          name: 'AXIS EMA',
          series: { EMA: [1, 2, 3, 99] },
          times: chartTimes,
          titles: { EMA: 'EMA' },
        },
      },
      chartTimes,
    });

    expect(collected.series.EMA?.[3]).toBe(99);
    const rows = buildDataViewRows({
      bars,
      barIndex: 3,
      series: collected.series,
      plotMeta: collected.plotMeta,
    });
    expect(rows.find((r) => r.label === 'EMA')?.value).toContain('99');
  });

  it('time-joins so bars beyond the cached axis stay null (not index-zipped)', () => {
    // Cache covers bars 0..2; chart has a 4th tip the cache has not painted yet.
    const cachedTimes = chartTimes.slice(0, 3);
    const collected = collectDataViewSeries({
      scripts: [{ id: 'dc', name: 'Donchian', visible: true }],
      indicatorSeries: {
        dc: {
          name: 'Donchian',
          series: { Upper: [10, 11, 12] },
          times: cachedTimes,
          titles: { Upper: 'Upper' },
        },
      },
      chartTimes,
    });

    expect(collected.series.Upper).toEqual([10, 11, 12, null]);
  });

  it('skips hidden scripts and fills editor fallback only for missing keys', () => {
    const collected = collectDataViewSeries({
      scripts: [
        { id: 'ema', name: 'EMA', visible: false },
        { id: 'dc', name: 'Donchian', visible: true },
      ],
      runResults: {
        ema: { status: 'success', series: { EMA: [1, 2, 3, 4] } },
        dc: { status: 'success', series: { Upper: [9, 9, 9, 9] } },
      },
      chartTimes,
      fallbackRun: {
        series: { EMA: [5, 5, 5, 5], Preview: [1, 1, 1, 1] },
        plotMeta: { Preview: { title: 'Preview' } },
        label: 'Editor',
      },
    });

    expect(collected.series.EMA).toEqual([5, 5, 5, 5]);
    expect(collected.series.Upper).toEqual([9, 9, 9, 9]);
    expect(collected.series.Preview).toEqual([1, 1, 1, 1]);
  });
});
