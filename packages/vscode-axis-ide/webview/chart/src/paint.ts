// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lightweight Charts paint for the chart webview (KD-10 P0–P1).
 * Bundled locally — CSP connect-src none; no CDN.
 */

import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ChartBar, ChartPlotLine, ChartViewState } from './state';

const PLOT_COLORS = [
  '#22d3ee',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#fb7185',
  '#60a5fa',
];

/** Layout options — TradingView attribution logo off (VSIX NOTICE already ships). */
export function chartLayoutOptions(): {
  background: { type: ColorType; color: string };
  textColor: string;
  attributionLogo: false;
} {
  return {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: 'var(--vscode-editor-foreground, #e0e0e0)',
    attributionLogo: false,
  };
}

export interface ChartPainter {
  apply(state: ChartViewState): void;
  dispose(): void;
  /** LWC chart API when paint mounted; null on stub path. */
  getChart(): IChartApi | null;
  /** Candlestick series when paint mounted; null on stub path. */
  getSeries(): ISeriesApi<'Candlestick'> | null;
  /** Subscribe to visible-range changes (overlay redraw). Returns disposer. */
  onVisibleRangeChange(cb: () => void): () => void;
}

function toCandleData(bars: ChartBar[]) {
  return bars.map((b) => ({
    time: b.time as UTCTimestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}

function applyPlotOverlays(
  chart: IChartApi,
  bag: Map<string, ISeriesApi<'Line'>>,
  bars: ChartBar[],
  plots: ChartPlotLine[],
): void {
  const keep = new Set(plots.map((p) => p.id));
  for (const [id, line] of [...bag]) {
    if (keep.has(id)) continue;
    try {
      chart.removeSeries(line);
    } catch {
      // already gone
    }
    bag.delete(id);
  }
  plots.forEach((plot, index) => {
    let line = bag.get(plot.id);
    if (!line) {
      line = chart.addSeries(LineSeries, {
        color: PLOT_COLORS[index % PLOT_COLORS.length],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: plot.id,
      });
      bag.set(plot.id, line);
    }
    const data: Array<{ time: UTCTimestamp; value: number }> = [];
    const n = Math.min(bars.length, plot.values.length);
    for (let i = 0; i < n; i++) {
      const bar = bars[i];
      const value = plot.values[i];
      if (!bar || value === null || !Number.isFinite(value)) continue;
      data.push({ time: bar.time as UTCTimestamp, value });
    }
    line.setData(data);
  });
}

/**
 * Mount an LWC candlestick chart on `host`. Safe to call once per webview life.
 * Falls back to a data-attribute stub when createChart throws (tests / no canvas).
 */
export function createChartPainter(host: HTMLElement): ChartPainter {
  let disposed = false;
  let chart: IChartApi | null = null;
  let series: ISeriesApi<'Candlestick'> | null = null;
  const plotSeries = new Map<string, ISeriesApi<'Line'>>();
  let lastSeq = -1;
  let resizeObserver: ResizeObserver | null = null;

  const placeholder = host.querySelector('.chart-host__placeholder');

  try {
    chart = createChart(host, {
      autoSize: true,
      layout: chartLayoutOptions(),
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.15)' },
        horzLines: { color: 'rgba(128,128,128,0.15)' },
      },
      leftPriceScale: { borderVisible: false, visible: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    if (placeholder) placeholder.remove();
    host.setAttribute('data-axis-paint', 'lwc');

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (disposed || !chart) return;
        try {
          chart.timeScale().fitContent();
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(host);
    }
  } catch {
    chart = null;
    series = null;
    host.setAttribute('data-axis-paint', 'stub');
  }

  const rangeListeners = new Set<() => void>();
  const onRange = (): void => {
    for (const cb of [...rangeListeners]) {
      try {
        cb();
      } catch {
        // ignore listener errors
      }
    }
  };
  if (chart) {
    try {
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    } catch {
      // stub / hostile
    }
  }

  return {
    apply(state: ChartViewState): void {
      if (disposed) return;
      host.setAttribute('data-axis-init', state.ready ? '1' : '0');
      if (state.theme) host.setAttribute('data-axis-theme', state.theme);
      if (state.seriesKey) host.setAttribute('data-axis-series', state.seriesKey);
      host.setAttribute('data-axis-bar-count', String(state.bars.length));
      host.setAttribute('data-axis-seq', String(state.seq));
      host.setAttribute('data-axis-drawing-count', String(state.drawings.length));
      host.setAttribute('data-axis-plot-count', String(state.plots.length));

      if (!series || !chart) {
        // Stub path — reducer already applied; attributes prove the round-trip.
        if (placeholder) {
          placeholder.textContent =
            state.bars.length > 0
              ? `AXIS chart · ${state.bars.length} bars`
              : 'AXIS chart host';
        }
        return;
      }
      // Always apply — empty bars must clear prior series (mock off / re-init).
      if (state.seq === lastSeq && state.bars.length > 0) return;
      lastSeq = state.seq;
      try {
        series.setData(toCandleData(state.bars));
        applyPlotOverlays(chart, plotSeries, state.bars, state.plots);
        if (state.bars.length > 0) {
          chart.timeScale().fitContent();
        }
      } catch {
        // hostile / detached
      }
    },
    getChart(): IChartApi | null {
      return disposed ? null : chart;
    },
    getSeries(): ISeriesApi<'Candlestick'> | null {
      return disposed ? null : series;
    },
    onVisibleRangeChange(cb: () => void): () => void {
      rangeListeners.add(cb);
      return () => {
        rangeListeners.delete(cb);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      rangeListeners.clear();
      try {
        chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        // ignore
      }
      try {
        resizeObserver?.disconnect();
      } catch {
        // ignore
      }
      resizeObserver = null;
      plotSeries.clear();
      try {
        chart?.remove();
      } catch {
        // ignore
      }
      chart = null;
      series = null;
    },
  };
}
