/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Minimal lightweight-charts mock for series-factory / PaneManager tests.
 *
 * {@link makeFakeChart} returns an in-memory chart with series, price lines,
 * and timeScale stubs. {@link installLightweightChartsMock} uses `mock.module`
 * so `import('lightweight-charts')` resolves without the real library
 * (Bun unit tests have no canvas).
 */

import { mock } from 'bun:test';

export type FakePriceLine = {
  applyOptions: (o: unknown) => void;
  options: () => Record<string, unknown>;
  _opts: Record<string, unknown>;
};

export type FakeSeries = {
  setData: (d: unknown) => void;
  applyOptions: (o: unknown) => void;
  priceScale: () => { applyOptions: (o: unknown) => void };
  setMarkers?: (m: unknown) => void;
  createPriceLine: (opts: Record<string, unknown>) => FakePriceLine;
  removePriceLine: (line: FakePriceLine) => void;
  priceLines: () => FakePriceLine[];
  _priceLines: FakePriceLine[];
  seriesOrder: () => number;
  setSeriesOrder: (n: number) => void;
  _order: number;
};

export type FakeChart = {
  addSeries: (type: unknown, opts?: unknown, paneIndex?: number) => FakeSeries;
  applyOptions: (o: unknown) => void;
  remove: () => void;
  priceScale: (id: string) => { applyOptions: (o: unknown) => void };
  timeScale: () => {
    fitContent: () => void;
    subscribeVisibleLogicalRangeChange: (cb: (r: unknown) => void) => void;
    unsubscribeVisibleLogicalRangeChange: (cb: (r: unknown) => void) => void;
    getVisibleLogicalRange: () => { from: number; to: number } | null;
    setVisibleLogicalRange: (r: unknown) => void;
    setVisibleRange: (r: unknown) => void;
    timeToCoordinate: (t: unknown) => number | null;
    coordinateToLogical: (c: number) => number | null;
  };
  subscribeCrosshairMove: (cb: (p: unknown) => void) => void;
  _series: FakeSeries[];
};

export function makeFakeChart(): FakeChart {
  const series: FakeSeries[] = [];
  const makeSeries = (): FakeSeries => {
    const priceLines: FakePriceLine[] = [];
    const s: FakeSeries = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      _priceLines: priceLines,
      _order: series.length,
      seriesOrder: () => s._order,
      setSeriesOrder: (n: number) => {
        s._order = n;
      },
      createPriceLine: (opts) => {
        const pl: FakePriceLine = {
          _opts: { ...opts },
          applyOptions: (o) => {
            Object.assign(pl._opts, o as object);
          },
          options: () => pl._opts,
        };
        priceLines.push(pl);
        return pl;
      },
      removePriceLine: (line) => {
        const i = priceLines.indexOf(line);
        if (i >= 0) priceLines.splice(i, 1);
      },
      priceLines: () => priceLines.slice(),
    };
    series.push(s);
    return s;
  };
  let rangeCb: ((r: unknown) => void) | null = null;
  return {
    _series: series,
    addSeries: () => makeSeries(),
    applyOptions: () => {},
    remove: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    timeScale: () => ({
      fitContent: () => {},
      subscribeVisibleLogicalRangeChange: (cb) => {
        rangeCb = cb;
      },
      unsubscribeVisibleLogicalRangeChange: () => {
        rangeCb = null;
      },
      getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
      setVisibleLogicalRange: () => {},
      setVisibleRange: () => {},
      timeToCoordinate: () => 10,
      coordinateToLogical: () => 5,
    }),
    subscribeCrosshairMove: () => {},
  };
}

export function installLightweightChartsMock() {
  const charts: FakeChart[] = [];
  mock.module('lightweight-charts', () => ({
    createChart: () => {
      const c = makeFakeChart();
      charts.push(c);
      return c;
    },
    createSeriesMarkers: (_series: unknown, markers: unknown) => ({
      setMarkers: () => {},
      markers: () => markers,
    }),
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    CandlestickSeries: 'CandlestickSeries',
    HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries',
  }));
  return charts;
}
