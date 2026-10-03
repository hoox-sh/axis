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
/**
 * Incremental HA state so live ticks are O(1), not O(n) full transforms
 * on 10k+ histories.
 *
 * Each `PaneManager` owns a holder (`{ cache }`) so multi-chart slots do not
 * thrash a shared singleton. The module-global `haCache` remains only as the
 * legacy default for callers that do not pass a holder (unit tests).
 */
export type HaCache = {
  /** Time of the last painted HA bar. */
  lastTime: number;
  lastOpen: number;
  lastClose: number;
  /** HA open/close of the bar before last (for same-bar updates). */
  prevOpen: number;
  prevClose: number;
};

/** Per-chart holder for incremental HA state (one per PaneManager). */
export type HaCacheHolder = { cache: HaCache | null };

/** Create an empty per-chart HA holder. */
export function createHaCacheHolder(): HaCacheHolder {
  return { cache: null };
}

let haCache: HaCache | null = null;

/** Drop HA live cache (full history replace / chart-type switch). */
export function resetHeikinAshiCache(): void {
  haCache = null;
}

/** Drop a per-chart holder (full history replace / chart-type switch). */
export function resetHaCacheHolder(holder: HaCacheHolder | null | undefined): void {
  if (holder) holder.cache = null;
}

function haCandleFrom(
  b: Bar,
  prevHaOpen: number,
  prevHaClose: number,
  isFirst: boolean,
): { open: number; high: number; low: number; close: number } {
  const haClose = (b.open + b.high + b.low + b.close) / 4;
  const haOpen = isFirst ? (b.open + b.close) / 2 : (prevHaOpen + prevHaClose) / 2;
  return {
    open: haOpen,
    high: Math.max(b.high, haOpen, haClose),
    low: Math.min(b.low, haOpen, haClose),
    close: haClose,
  };
}

export function toHeikinAshi(bars: readonly Bar[]): Bar[] {
  return toHeikinAshiInto(bars, undefined);
}

/**
 * HA transform that seeds `holder.cache` when provided, else the legacy
 * module-global cache. Drops non-finite rows first so one NaN candle cannot
 * poison every later HA open (parity with `toOhlcData` poison-row drops).
 */
export function toHeikinAshiInto(
  bars: readonly Bar[],
  holder?: HaCacheHolder | null,
): Bar[] {
  const clean: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (isFinitePriceBar(b)) clean.push(b);
  }
  const n = clean.length;
  const out: Bar[] = new Array(n);
  let prevOpen = 0;
  let prevClose = 0;
  for (let i = 0; i < n; i++) {
    const b = clean[i]!;
    const ha = haCandleFrom(b, prevOpen, prevClose, i === 0);
    out[i] = {
      time: b.time,
      open: ha.open,
      high: ha.high,
      low: ha.low,
      close: ha.close,
      volume: b.volume,
      closed: b.closed,
    };
    prevOpen = ha.open;
    prevClose = ha.close;
  }
  // Seed live cache from full paint
  let next: HaCache | null = null;
  if (n >= 1) {
    const last = out[n - 1]!;
    const prev = n >= 2 ? out[n - 2]! : last;
    next = {
      lastTime: last.time,
      lastOpen: last.open,
      lastClose: last.close,
      prevOpen: n >= 2 ? prev.open : last.open,
      prevClose: n >= 2 ? prev.close : last.close,
    };
  }
  if (holder) holder.cache = next;
  else haCache = next;
  return out;
}

/** Source bars for painting: HA transform or identity. */
export function sourceBarsForChartType(
  bars: readonly Bar[],
  type: ChartType,
  holder?: HaCacheHolder | null,
): Bar[] {
  if (type === 'heikinashi') return toHeikinAshiInto(bars, holder ?? undefined);
  // Identity pass-through avoids allocs for candles/line/…
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

/** True when a bar is safe for LWC candlestick / line `setData`. */
function isFinitePriceBar(b: Bar): boolean {
  return (
    Number.isFinite(b.time) &&
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close)
  );
}

function toOhlcData(bars: readonly Bar[]): OhlcDatum[] {
  const out: OhlcDatum[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    // Drop poisoned rows so one NaN candle cannot blank the whole series
    if (!isFinitePriceBar(b)) continue;
    out.push({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    });
  }
  return out;
}

function toCloseData(bars: readonly Bar[]): ValueDatum[] {
  const out: ValueDatum[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (!isFinitePriceBar(b)) continue;
    out.push({ time: b.time, value: b.close });
  }
  return out;
}

/**
 * Map store OHLCV → Lightweight Charts series data for the active chart type.
 * Pre-sized loops avoid `.map` intermediate GC on 10k+ bars.
 * Pass a per-chart `holder` so Heikin-Ashi seeds that chart's live cache
 * instead of the legacy global (multi-chart safe).
 */
export function mapBarsToPriceData(
  bars: readonly Bar[],
  type: ChartType,
  holder?: HaCacheHolder | null,
): PriceSeriesDatum[] {
  if (!bars.length) {
    if (holder) holder.cache = null;
    return [];
  }
  if (type === 'heikinashi') {
    return toOhlcData(toHeikinAshiInto(bars, holder ?? undefined));
  }
  if (isOhlcChartType(type)) return toOhlcData(bars);
  return toCloseData(bars);
}

/**
 * Map a single bar update for live ticks — O(1) for candles/line and HA.
 *
 * For Heikin-Ashi, uses the holder cache (or legacy global when omitted)
 * seeded by the last full {@link mapBarsToPriceData} / {@link toHeikinAshi}
 * pass. Returns null for non-finite bars so NaN candles never reach LWC.
 */
export function mapBarUpdate(
  bars: readonly Bar[],
  type: ChartType,
  holder?: HaCacheHolder | null,
): PriceSeriesDatum | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1]!;
  if (!isFinitePriceBar(last)) return null;

  if (type === 'heikinashi') {
    return mapHeikinAshiUpdate(bars, last, holder ?? undefined);
  }

  if (isOhlcChartType(type)) {
    return {
      time: last.time,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
    };
  }
  return { time: last.time, value: last.close };
}

function mapHeikinAshiUpdate(
  bars: readonly Bar[],
  last: Bar,
  holder?: HaCacheHolder | null,
): OhlcDatum | null {
  const getCache = (): HaCache | null => (holder ? holder.cache : haCache);
  const setCache = (c: HaCache | null): void => {
    if (holder) holder.cache = c;
    else haCache = c;
  };
  const cache = getCache();
  // Cold cache or history gap → full recompute once (seeds cache)
  if (!cache || bars.length === 1) {
    const all = toHeikinAshiInto(bars, holder ?? undefined);
    const h = all[all.length - 1];
    if (!h) return null;
    return { time: h.time, open: h.open, high: h.high, low: h.low, close: h.close };
  }

  if (last.time === cache.lastTime) {
    // Same bar tick: recompute last HA from cached previous HA open/close
    const ha = haCandleFrom(last, cache.prevOpen, cache.prevClose, bars.length === 1);
    setCache({
      ...cache,
      lastOpen: ha.open,
      lastClose: ha.close,
    });
    return { time: last.time, open: ha.open, high: ha.high, low: ha.low, close: ha.close };
  }

  if (last.time > cache.lastTime) {
    // New bar: previous last becomes prev
    const ha = haCandleFrom(last, cache.lastOpen, cache.lastClose, false);
    setCache({
      lastTime: last.time,
      lastOpen: ha.open,
      lastClose: ha.close,
      prevOpen: cache.lastOpen,
      prevClose: cache.lastClose,
    });
    return { time: last.time, open: ha.open, high: ha.high, low: ha.low, close: ha.close };
  }

  // Time went backwards (history rewrite) — full recompute
  const all = toHeikinAshiInto(bars, holder ?? undefined);
  const h = all[all.length - 1];
  if (!h) return null;
  return { time: h.time, open: h.open, high: h.high, low: h.low, close: h.close };
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
