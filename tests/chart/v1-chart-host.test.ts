/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import '../setup';
import { describe, expect, mock, test } from 'bun:test';
import { SlotChart, type SlotChartApi, type SlotPaneApi } from '../../src/chart/v1/chart-host';

function fakeChart(): SlotChartApi & {
  addSeries: ReturnType<typeof mock>;
  remove: ReturnType<typeof mock>;
  removePane: ReturnType<typeof mock>;
} {
  const rows: Array<{ index: number; height: number; stretch: number }> = [
    { index: 0, height: 0, stretch: 1 },
  ];
  const api = (row: { index: number; height: number; stretch: number }): SlotPaneApi => ({
    paneIndex: () => row.index,
    setHeight: (height) => {
      row.height = height;
    },
    getHeight: () => row.height,
    setStretchFactor: (stretchFactor) => {
      row.stretch = stretchFactor;
    },
    getHTMLElement: () => null,
  });
  const scale = { id: 'scale' };
  const chart = {
    addPane: (_preserve?: boolean) => {
      const row = { index: rows.length, height: 0, stretch: 1 };
      rows.push(row);
      return api(row);
    },
    panes: () => rows.map((row) => api(row)),
    addSeries: mock((_d: unknown, _o?: unknown, paneIndex?: number) => paneIndex),
    removePane: mock((index: number) => {
      rows.splice(index, 1);
      rows.forEach((row, i) => {
        row.index = i;
      });
    }),
    remove: mock(() => {}),
    priceScale: (_id: string, paneIndex?: number) => paneIndex,
    timeScale: () => scale,
  };
  return chart;
}

describe('SlotChart', () => {
  test('two pane ids share one timeScale object', () => {
    const chart = fakeChart();
    const slot = new SlotChart(chart);
    slot.bind('price');
    slot.bind('volume');
    const scale = slot.timeScale();
    expect(scale).toBe(chart.timeScale());
    expect(slot.facade('price').timeScale()).toBe(scale);
    expect(slot.facade('volume').timeScale()).toBe(scale);
  });

  test('facade addSeries lands on paneIndex 0 vs 1', () => {
    const chart = fakeChart();
    const slot = new SlotChart(chart);
    slot.bind('price');
    slot.bind('volume');
    slot.facade('price').addSeries('Line' as never, {});
    slot.facade('volume').addSeries('Line' as never, {});
    expect(chart.addSeries.mock.calls.map((call) => call[2])).toEqual([0, 1]);
  });

  test('release of a non-price pane keeps the chart; price pane destroy removes it', () => {
    const chart = fakeChart();
    const slot = new SlotChart(chart);
    slot.bind('price');
    slot.bind('volume');
    slot.bind('rsi');

    expect(slot.release('volume')).toBe('pane');
    expect(chart.remove).not.toHaveBeenCalled();
    expect(chart.removePane).toHaveBeenCalledWith(1);
    expect(slot.indexOf('rsi')).toBe(1);

    expect(slot.release('price')).toBe('chart');
    expect(chart.remove).not.toHaveBeenCalled();
    slot.destroy();
    expect(chart.remove).toHaveBeenCalledTimes(1);
  });

  test('setHeight, getHeight, and setStretchFactor address the pane index', () => {
    const chart = fakeChart();
    const slot = new SlotChart(chart);
    slot.bind('price');
    slot.bind('volume');
    slot.setHeight('volume', 140);
    slot.setStretchFactor('volume', 0.3);
    expect(slot.getHeight('volume')).toBe(140);
    expect(slot.getHeight('missing')).toBe(0);
    expect(chart.panes()[1]?.getHeight()).toBe(140);
  });
});
