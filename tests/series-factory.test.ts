/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * series-factory: plot styles → LWC series options (mocked charts).
 * Guards palette tokens, line/hist/area mapping, null-safe data.
 */

import './setup';
import { mock, describe, expect, it, beforeAll } from 'bun:test';
import { installLightweightChartsMock, makeFakeChart } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

// Dynamic import after mock
const {
  VOID,
  PLOT_PALETTE,
  createBaseChart,
  createCandleSeries,
  createHollowCandleSeries,
  createBarSeries,
  createPriceLineSeries,
  createPriceAreaSeries,
  createPriceBaselineSeries,
  createPriceSeries,
  createVolumeSeries,
  createLineSeries,
  createAreaSeries,
  formatCrosshairDateTime,
  deepMergeChartOptions,
} = await import('../src/chart/series-factory');

describe('series-factory', () => {
  it('exports brand tokens and palette', () => {
    expect(VOID.bg).toMatch(/^#/);
    expect(PLOT_PALETTE.length).toBeGreaterThan(3);
  });

  it('formatCrosshairDateTime includes date and HH:mm', () => {
    // 2026-08-10 14:35:00 UTC
    const ts = Math.floor(Date.UTC(2026, 7, 10, 14, 35, 0) / 1000);
    const label = formatCrosshairDateTime(ts);
    expect(label).toContain('10');
    expect(label).toContain('Aug');
    expect(label).toMatch(/14:35/);
  });

  it('deepMergeChartOptions skips undefined so timeVisible is preserved', () => {
    const base = {
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#111' },
    };
    const merged = deepMergeChartOptions(base, {
      timeScale: undefined as unknown as Record<string, unknown>,
      handleScroll: { vertTouchDrag: true },
    });
    expect((merged.timeScale as { timeVisible: boolean }).timeVisible).toBe(true);
    expect(merged.handleScroll).toEqual({ vertTouchDrag: true });
  });

  it('createBaseChart returns chart api', () => {
    const el = document.createElement('div') as unknown as HTMLElement;
    const chart = createBaseChart(el);
    expect(chart).toBeDefined();
    expect(typeof chart.addSeries).toBe('function');
  });

  it('createCandleSeries / volume / line / area attach series', () => {
    const chart = makeFakeChart() as never;
    const candle = createCandleSeries(chart);
    const vol = createVolumeSeries(chart, 1);
    const line = createLineSeries(chart, 'rsi', '#f00');
    const area = createAreaSeries(chart, 'eq');
    expect(candle).toBeDefined();
    expect(vol).toBeDefined();
    expect(line).toBeDefined();
    expect(area).toBeDefined();
  });

  it('createPriceSeries covers all chart types', () => {
    const chart = makeFakeChart() as never;
    for (const type of [
      'candles',
      'hollow',
      'bars',
      'line',
      'area',
      'baseline',
      'heikinashi',
    ] as const) {
      expect(createPriceSeries(chart, type)).toBeDefined();
    }
    expect(createHollowCandleSeries(chart)).toBeDefined();
    expect(createBarSeries(chart)).toBeDefined();
    expect(createPriceLineSeries(chart)).toBeDefined();
    expect(createPriceAreaSeries(chart)).toBeDefined();
    expect(createPriceBaselineSeries(chart, undefined, 100)).toBeDefined();
  });

  it('createLineSeries accepts custom lineWidth', () => {
    const chart = makeFakeChart();
    const calls: unknown[] = [];
    const orig = chart.addSeries.bind(chart);
    chart.addSeries = ((type: unknown, opts?: unknown, paneIndex?: number) => {
      calls.push(opts);
      return orig(type, opts, paneIndex);
    }) as typeof chart.addSeries;
    createLineSeries(chart as never, 'wide', '#0f0', undefined, 4);
    expect(calls.length).toBe(1);
    expect((calls[0] as { lineWidth: number }).lineWidth).toBe(4);
  });
});
