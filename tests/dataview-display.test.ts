/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Data Window `display.*` overrides: the panel wins over the script, and the
 * merge is a copy (the run payload is a read-only store proxy).
 */
import { describe, expect, it } from 'bun:test';
import {
  buildDataViewRows,
  mergePlotDisplayOverrides,
  type DataViewPlotMeta,
} from '../src/results/dataview';
import { PLOT_DISPLAY } from '../src/results/plot-visuals';
import { makeBars } from './fixtures/bars';

const bars = makeBars(3, 1_700_000_000, 60);
const time = bars[2]!.time;

function rowsWith(plotMeta: Record<string, DataViewPlotMeta>) {
  return buildDataViewRows({
    bars,
    time,
    symbol: 'BTCUSDT',
    interval: '1m',
    series: { a: [1, 2, 3] },
    plotMeta,
  });
}

describe('Data Window plot display overrides', () => {
  it('shows a declared display.all plot', () => {
    const rows = rowsWith({ a: { title: 'A', display: PLOT_DISPLAY.all } });
    expect(rows.some((r) => r.key === 's_a')).toBe(true);
  });

  it('drops the row when the panel override clears data_window', () => {
    const merged = mergePlotDisplayOverrides(
      { a: { title: 'A', display: PLOT_DISPLAY.all } },
      { a: { display: PLOT_DISPLAY.pane } },
    );
    expect(rowsWith(merged).some((r) => r.key === 's_a')).toBe(false);
  });

  it('keeps the row when the panel override includes data_window', () => {
    const merged = mergePlotDisplayOverrides(
      { a: { title: 'A', display: PLOT_DISPLAY.pane } },
      { a: { display: PLOT_DISPLAY.pane | PLOT_DISPLAY.data_window } },
    );
    expect(rowsWith(merged).some((r) => r.key === 's_a')).toBe(true);
  });

  it('returns a copy and never mutates the declared meta', () => {
    const declared: Record<string, DataViewPlotMeta> = {
      a: { title: 'A', display: PLOT_DISPLAY.all },
    };
    mergePlotDisplayOverrides(declared, { a: { display: PLOT_DISPLAY.pane } });
    expect(declared.a?.display).toBe(PLOT_DISPLAY.all);
  });
});
