/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * chart-type: catalog, Heikin-Ashi transform, OHLC/close data mappers.
 */

import { describe, expect, it } from 'bun:test';
import {
  CHART_TYPES,
  DEFAULT_CHART_TYPE,
  isOhlcChartType,
  lastBarDirection,
  mapBarUpdate,
  mapBarsToPriceData,
  normalizeChartType,
  toHeikinAshi,
} from '../src/chart/chart-type';
import type { Bar } from '../src/store/types';

const sample: Bar[] = [
  { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { time: 2, open: 11, high: 14, low: 10, close: 13, volume: 110 },
  { time: 3, open: 13, high: 13.5, low: 11, close: 11.5, volume: 90 },
];

describe('chart-type catalog', () => {
  it('defaults and normalizes unknown values', () => {
    expect(DEFAULT_CHART_TYPE).toBe('candles');
    expect(normalizeChartType('bars')).toBe('bars');
    expect(normalizeChartType('heikinashi')).toBe('heikinashi');
    expect(normalizeChartType('nope')).toBe('candles');
    expect(normalizeChartType(null)).toBe('candles');
    expect(CHART_TYPES.length).toBeGreaterThanOrEqual(6);
  });

  it('classifies OHLC vs single-value styles', () => {
    expect(isOhlcChartType('candles')).toBe(true);
    expect(isOhlcChartType('hollow')).toBe(true);
    expect(isOhlcChartType('bars')).toBe(true);
    expect(isOhlcChartType('heikinashi')).toBe(true);
    expect(isOhlcChartType('line')).toBe(false);
    expect(isOhlcChartType('area')).toBe(false);
    expect(isOhlcChartType('baseline')).toBe(false);
  });
});

describe('Heikin-Ashi', () => {
  it('transforms first and subsequent bars', () => {
    const ha = toHeikinAshi(sample);
    expect(ha).toHaveLength(3);
    // First: open=(O+C)/2, close=(O+H+L+C)/4
    expect(ha[0]!.open).toBe((10 + 11) / 2);
    expect(ha[0]!.close).toBe((10 + 12 + 9 + 11) / 4);
    expect(ha[0]!.high).toBeGreaterThanOrEqual(ha[0]!.open);
    expect(ha[0]!.high).toBeGreaterThanOrEqual(ha[0]!.close);
    expect(ha[0]!.low).toBeLessThanOrEqual(ha[0]!.open);
    // Second HA open from prior HA open/close
    expect(ha[1]!.open).toBe((ha[0]!.open + ha[0]!.close) / 2);
    expect(ha[2]!.time).toBe(3);
  });

  it('empty input yields empty', () => {
    expect(toHeikinAshi([])).toEqual([]);
  });
});

describe('mapBarsToPriceData', () => {
  it('maps candles/bars to OHLC', () => {
    const data = mapBarsToPriceData(sample, 'candles');
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({
      time: 1,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    });
    const bars = mapBarsToPriceData(sample, 'bars');
    expect(bars[1]).toMatchObject({ open: 11, close: 13 });
  });

  it('maps line/area to close values', () => {
    const line = mapBarsToPriceData(sample, 'line');
    expect(line).toEqual([
      { time: 1, value: 11 },
      { time: 2, value: 13 },
      { time: 3, value: 11.5 },
    ]);
    expect(mapBarsToPriceData(sample, 'area')).toEqual(line);
  });

  it('maps heikinashi to transformed OHLC', () => {
    const data = mapBarsToPriceData(sample, 'heikinashi');
    const ha = toHeikinAshi(sample);
    expect(data[1]).toEqual({
      time: 2,
      open: ha[1]!.open,
      high: ha[1]!.high,
      low: ha[1]!.low,
      close: ha[1]!.close,
    });
  });

  it('mapBarUpdate returns last point', () => {
    const last = mapBarUpdate(sample, 'line');
    expect(last).toEqual({ time: 3, value: 11.5 });
    expect(mapBarUpdate([], 'candles')).toBeNull();
  });
});

describe('lastBarDirection', () => {
  it('uses body for OHLC and prior close for line', () => {
    expect(lastBarDirection(sample, 'candles')).toBe('down'); // 11.5 < 13 open
    // last bar open 13 close 11.5 → down
    expect(lastBarDirection(sample, 'line')).toBe('down'); // 11.5 < prev 13
    const upBars: Bar[] = [
      { time: 1, open: 1, high: 2, low: 1, close: 1.5 },
      { time: 2, open: 1.5, high: 3, low: 1.5, close: 2.8 },
    ];
    expect(lastBarDirection(upBars, 'candles')).toBe('up');
    expect(lastBarDirection(upBars, 'line')).toBe('up');
  });
});
