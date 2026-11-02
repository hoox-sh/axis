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
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ChartBar, ChartViewState } from './state';

export interface ChartPainter {
  apply(state: ChartViewState): void;
  dispose(): void;
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

/**
 * Mount an LWC candlestick chart on `host`. Safe to call once per webview life.
 * Falls back to a data-attribute stub when createChart throws (tests / no canvas).
 */
export function createChartPainter(host: HTMLElement): ChartPainter {
  let disposed = false;
  let chart: IChartApi | null = null;
  let series: ISeriesApi<'Candlestick'> | null = null;
  let lastSeq = -1;
  let resizeObserver: ResizeObserver | null = null;

  const placeholder = host.querySelector('.chart-host__placeholder');

  try {
    chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'var(--vscode-editor-foreground, #e0e0e0)',
      },
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.15)' },
        horzLines: { color: 'rgba(128,128,128,0.15)' },
      },
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

  return {
    apply(state: ChartViewState): void {
      if (disposed) return;
      host.setAttribute('data-axis-init', state.ready ? '1' : '0');
      if (state.theme) host.setAttribute('data-axis-theme', state.theme);
      if (state.seriesKey) host.setAttribute('data-axis-series', state.seriesKey);
      host.setAttribute('data-axis-bar-count', String(state.bars.length));
      host.setAttribute('data-axis-seq', String(state.seq));

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
        if (state.bars.length > 0) {
          chart.timeScale().fitContent();
        }
      } catch {
        // hostile / detached
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        resizeObserver?.disconnect();
      } catch {
        // ignore
      }
      resizeObserver = null;
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
