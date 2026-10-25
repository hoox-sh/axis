/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  SlotChart,
  chartLayoutMode,
  resetChartLayoutMode,
  setChartLayoutMode,
  type SlotChartApi,
  type SlotPaneApi,
} from '../../src/chart/v1/chart-host';

function fakeChart(): SlotChartApi & { removed: boolean; removedPanes: number[] } {
  const rows: Array<{ index: number; height: number }> = [{ index: 0, height: 0 }];
  const api = (row: { index: number; height: number }): SlotPaneApi => ({
    paneIndex: () => row.index,
    setHeight: (height) => {
      row.height = height;
    },
    getHTMLElement: () => null,
  });
  const chart = {
    removed: false,
    removedPanes: [] as number[],
    addPane: () => {
      const row = { index: rows.length, height: 0 };
      rows.push(row);
      return api(row);
    },
    panes: () => rows.map((row) => api(row)),
    addSeries: (_d: unknown, _o?: unknown, paneIndex?: number) => paneIndex,
    removePane: (index: number) => {
      chart.removedPanes.push(index);
      rows.splice(index, 1);
      rows.forEach((row, i) => {
        row.index = i;
      });
    },
    remove: () => {
      chart.removed = true;
    },
    priceScale: (_id: string, paneIndex?: number) => paneIndex,
    timeScale: () => scale,
  };
  const scale = { id: 'scale' };
  return chart;
}

describe('axis.chart.layout', () => {
  test('defaults to single and round-trips multi', () => {
    resetChartLayoutMode();
    expect(chartLayoutMode()).toBe('single');
    setChartLayoutMode('multi');
    expect(chartLayoutMode()).toBe('multi');
    setChartLayoutMode('single');
    expect(chartLayoutMode()).toBe('single');
  });
});

describe('SlotChart', () => {
  test('one chart, one time scale, series land on their pane', () => {
    const chart = fakeChart();
    const slot = new SlotChart(chart);
    expect(slot.bind('price')).toBe(0);
    expect(slot.bind('volume')).toBe(1);
    expect(slot.bind('rsi')).toBe(2);
    expect(slot.timeScale()).toBe(slot.timeScale());
    const price = slot.facade('price');
    const volume = slot.facade('volume');
    expect(price.addSeries('Line', {})).toBe(0);
    expect(volume.addSeries('Line', {})).toBe(1);
    expect(price.priceScale('right')).toBe(0);
    expect(volume.priceScale('right')).toBe(1);
    slot.setHeight('volume', 80);
    expect(chart.panes()[1]?.paneIndex()).toBe(1);
  });

  test('releasing a sub-pane keeps the chart and shifts later indexes', () => {
    const chart = fakeChart();
    const slot = new SlotChart(chart);
    slot.bind('price');
    slot.bind('volume');
    slot.bind('rsi');
    expect(slot.release('volume')).toBe('pane');
    expect(chart.removed).toBe(false);
    expect(chart.removedPanes).toEqual([1]);
    expect(slot.indexOf('rsi')).toBe(1);
    expect(slot.release('price')).toBe('chart');
    slot.destroy();
    expect(chart.removed).toBe(true);
  });
});
