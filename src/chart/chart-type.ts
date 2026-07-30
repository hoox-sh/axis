// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Price chart display types and OHLCV → Lightweight Charts data mappers.
 *
 * Japanese candlesticks are the default ({@link ChartType} `candles`). Other
 * styles either restyle the same OHLC series (hollow, bars), plot close only
 * (line, area, baseline), or transform OHLC first (Heikin-Ashi).
 *
 * @module chart/chart-type
 */

import type { Bar } from '../store/types';

/**
 * Supported main-pane price series styles.
 * Values are stable for persistence (`store.chartType`).
 */
export type ChartType =
  | 'candles'
  | 'hollow'
  | 'bars'
  | 'line'
  | 'area'
  | 'baseline'
  | 'heikinashi';

/** Catalog entry for UI selects. */
export type ChartTypeInfo = {
  id: ChartType;
  label: string;
  /** Short topbar label */
  short: string;
  description: string;
};

/** All chart types in UI order. */
export const CHART_TYPES: readonly ChartTypeInfo[] = [
  {
    id: 'candles',
    label: 'Candles',
    short: 'Candles',
    description: 'Japanese candlesticks (OHLC body + wicks)',
  },
  {
    id: 'hollow',
    label: 'Hollow candles',
    short: 'Hollow',
    description: 'Hollow body when close ≥ open; filled when close < open',
  },
  {
    id: 'bars',
    label: 'Bars',
    short: 'Bars',
    description: 'Classic OHLC bar chart (open tick + high-low + close tick)',
  },
  {
    id: 'heikinashi',
    label: 'Heikin Ashi',
    short: 'Heikin',
    description: 'Smoothed candlesticks from averaged OHLC (Heikin-Ashi)',
  },
  {
    id: 'line',
    label: 'Line',
    short: 'Line',
    description: 'Close price line',
  },
  {
    id: 'area',
    label: 'Area',
    short: 'Area',
    description: 'Close price with fill under the line',
  },
  {
    id: 'baseline',
    label: 'Baseline',
    short: 'Baseline',
    description: 'Close price colored above/below a base value',
  },
] as const;

const CHART_TYPE_IDS = new Set<string>(CHART_TYPES.map((t) => t.id));

/** Default chart style for new sessions. */
export const DEFAULT_CHART_TYPE: ChartType = 'candles';

/** Normalize unknown persisted values to a valid {@link ChartType}. */
export function normalizeChartType(raw: unknown): ChartType {
  if (typeof raw === 'string' && CHART_TYPE_IDS.has(raw)) return raw as ChartType;
  return DEFAULT_CHART_TYPE;
}

export function chartTypeInfo(id: ChartType): ChartTypeInfo {
  return CHART_TYPES.find((t) => t.id === id) ?? CHART_TYPES[0]!;
}

/** True when the series uses OHLC fields (vs single close value). */
export function isOhlcChartType(type: ChartType): boolean {
  return type === 'candles' || type === 'hollow' || type === 'bars' || type === 'heikinashi';
}

/**
 * Heikin-Ashi transform over raw OHLCV bars.
 *
 * - haClose = (O+H+L+C)/4
 * - haOpen = (prevHaOpen + prevHaClose)/2 (first bar: (O+C)/2)
 * - haHigh = max(H, haOpen, haClose)
 * - haLow = min(L, haOpen, haClose)
 */
export function toHeikinAshi(bars: readonly Bar[]): Bar[] {
  const out: Bar[] = [];
  let prevOpen = 0;
  let prevClose = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    out.push({
      time: b.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: b.volume,
      closed: b.closed,
    });
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

/** Source bars for painting: HA transform or identity. */
export function sourceBarsForChartType(bars: readonly Bar[], type: ChartType): Bar[] {
  if (type === 'heikinashi') return toHeikinAshi(bars);
  // Return a shallow copy only when HA; identity pass-through avoids allocs
  return bars as Bar[];
}

/** LWC OHLC datum (Candlestick / Bar). */
export type OhlcDatum = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** LWC single-value datum (Line / Area / Baseline). */
export type ValueDatum = {
  time: number;
  value: number;
};

export type PriceSeriesDatum = OhlcDatum | ValueDatum;

function toOhlcData(bars: readonly Bar[]): OhlcDatum[] {
  return bars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}

function toCloseData(bars: readonly Bar[]): ValueDatum[] {
  return bars.map((b) => ({
    time: b.time,
    value: b.close,
  }));
}

/**
 * Map store OHLCV → Lightweight Charts series data for the active chart type.
 */
export function mapBarsToPriceData(bars: readonly Bar[], type: ChartType): PriceSeriesDatum[] {
  if (!bars.length) return [];
  const src = sourceBarsForChartType(bars, type);
  if (isOhlcChartType(type)) return toOhlcData(src);
  return toCloseData(src);
}

/**
 * Map a single bar update for live ticks.
 *
 * For Heikin-Ashi, pass the full bar list (already including the updated bar)
 * so the last HA candle is recomputed correctly from prior HA open/close.
 */
export function mapBarUpdate(
  bars: readonly Bar[],
  type: ChartType,
): PriceSeriesDatum | null {
  if (!bars.length) return null;
  const data = mapBarsToPriceData(bars, type);
  return data[data.length - 1] ?? null;
}

/** Price-line tint from last painted bar (up/down vs prior close for line types). */
export function lastBarDirection(
  bars: readonly Bar[],
  type: ChartType,
): 'up' | 'down' | null {
  if (!bars.length) return null;
  const src = sourceBarsForChartType(bars, type);
  const last = src[src.length - 1]!;
  if (isOhlcChartType(type)) {
    return last.close >= last.open ? 'up' : 'down';
  }
  if (src.length < 2) return last.close >= last.open ? 'up' : 'down';
  const prev = src[src.length - 2]!;
  return last.close >= prev.close ? 'up' : 'down';
}
