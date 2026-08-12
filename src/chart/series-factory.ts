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
 * Lightweight Charts **series factory** + AXIS void palette.
 *
 * Shared by {@link PaneManager}: base chart options, main price series for
 * each {@link ChartType} (candles, hollow, bars, line, area, baseline,
 * Heikin-Ashi host), overlay line/area, histogram (bgcolor) helpers, and
 * brand colors ({@link VOID}, {@link PLOT_PALETTE}). Right price-scale width
 * is fixed so panes align. Colors resolve from the Theme Manager when
 * available, falling back to {@link VOID} defaults.
 *
 * @module chart/series-factory
 */

import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  BarSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  LineType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
} from 'lightweight-charts';
import {
  isHistogramSeriesKind,
  normalizeLineStyleToken,
  type PlotSeriesKind,
} from '../results/plot-visuals';
import type { ChartType } from './chart-type';
import {
  getThemeManager,
  resolveTokens,
  buildChartOptionsFromTokens,
  buildCandleSeriesOptions,
  buildBarSeriesOptions,
  buildLineSeriesOptions,
  buildAreaSeriesOptions,
  buildBaselineSeriesOptions,
  defaultChartThemeState,
  type ThemeTokens,
} from '../theme';

/**
 * AXIS **void** chart palette (brand tokens for Lightweight Charts).
 *
 * **Not a TradingView® or Pine API.** There is no `TV.set` / `TradingView.*`
 * surface in AXIS. Prefer this name over the legacy `TV` alias so agents do
 * not invent fictional `TV.*` chart APIs.
 */
export const VOID = {
  bg: '#0a0b10',
  panel: '#111218',
  elev: '#171821',
  grid: 'rgba(140, 130, 180, 0.07)',
  text: '#c8cad4',
  textDim: '#8b8e9c',
  up: '#5ecf8a',
  down: '#e85d4c',
  border: '#3a3d4a',
  /** hoox void pack accent oklch(0.74 0.16 277) */
  indigo: '#939fff',
  indigoSoft: 'rgba(147, 159, 255, 0.38)',
  /** @deprecated use indigo */
  flieder: '#939fff',
  /** @deprecated use indigoSoft */
  fliederSoft: 'rgba(147, 159, 255, 0.38)',
  green: '#8ef5a8',
  orange: '#e8a03a',
};

/**
 * @deprecated Use {@link VOID}. Kept as an alias only — **not** TradingView®.
 * Do not add methods or treat as a runtime API.
 */
export const TV = VOID;

/** Plot colors: void indigo, lightgreen, orange, then muted fillers */
export const PLOT_PALETTE = [
  '#939fff',
  '#8ef5a8',
  '#e8a03a',
  '#6ec8d4',
  '#a7b4ff',
  '#5ecf8a',
  '#e85d4c',
  '#8b8e9c',
];

/**
 * Fixed right price-scale width shared by every pane so plot areas share the
 * same right edge (price labels, 0–100 indicators, volume, equity).
 */
export const RIGHT_PRICE_SCALE_WIDTH = 72;

/** Current resolved theme tokens, or defaults when Theme Manager is unavailable. */
function activeTokens(): ThemeTokens {
  try {
    return getThemeManager().getTokens();
  } catch {
    return resolveTokens(defaultChartThemeState());
  }
}

/**
 * VOID-compatible palette from the active theme (for callers that need live colors).
 */
export function getActiveChartPalette() {
  return getThemeManager().getVoidLike();
}

/**
 * Format a Lightweight Charts time value for the vertical crosshair label.
 * Always includes clock time (HH:mm) so hover endpoints are not date-only.
 *
 * Accepts UTCTimestamp (seconds), millis, BusinessDay `{ year, month, day }`,
 * or `YYYY-MM-DD` strings.
 */
export function formatCrosshairDateTime(time: unknown): string {
  const d = resolveChartTimeToDate(time);
  if (!d || Number.isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTH_SHORT[d.getUTCMonth()] ?? '';
  const yy = String(d.getUTCFullYear()).slice(-2);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  // Match LWC DateTimeFormatter spacing: date + multi-space + time
  return `${dd} ${mon} '${yy}  ${hh}:${mm}`;
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Normalize LWC time variants to a Date (UTC wall clock for labels). */
export function resolveChartTimeToDate(time: unknown): Date | null {
  if (time == null) return null;
  if (typeof time === 'number' && Number.isFinite(time)) {
    // Heuristic: ms vs seconds (LWC uses UTCTimestamp in seconds)
    const ms = time > 1e12 ? time : time * 1000;
    return new Date(ms);
  }
  if (typeof time === 'string') {
    // Business-day string "YYYY-MM-DD" or ISO
    const t = Date.parse(time.includes('T') ? time : `${time}T00:00:00Z`);
    if (Number.isFinite(t)) return new Date(t);
    return null;
  }
  if (typeof time === 'object') {
    const o = time as { year?: number; month?: number; day?: number; timestamp?: number };
    if (typeof o.timestamp === 'number' && Number.isFinite(o.timestamp)) {
      const ms = o.timestamp > 1e12 ? o.timestamp : o.timestamp * 1000;
      return new Date(ms);
    }
    if (
      typeof o.year === 'number' &&
      typeof o.month === 'number' &&
      typeof o.day === 'number'
    ) {
      return new Date(Date.UTC(o.year, o.month - 1, o.day));
    }
  }
  return null;
}

/**
 * Shallow-object deep merge; arrays and non-plain values replace.
 * **Skips `undefined` source values** so callers can pass optional keys
 * (`timeScale: isSecondary ? … : undefined`) without wiping base options
 * like `timeVisible: true` (crosshair date+time labels).
 */
export function deepMergeChartOptions(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      out[key] = deepMergeChartOptions(
        prev as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** @deprecated Prefer {@link deepMergeChartOptions} — same behavior. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  return deepMergeChartOptions(target, source);
}

/**
 * Create a themed LWC chart in `container` (void bg, crosshair, aligned
 * right scale width). Optional `options` deep-merged last so callers can override.
 */
export function createBaseChart(container: HTMLElement, options?: Record<string, unknown>): IChartApi {
  const tokens = activeTokens();
  let themeOpts: Record<string, unknown> = {};
  try {
    themeOpts = buildChartOptionsFromTokens(tokens) as Record<string, unknown>;
  } catch {
    themeOpts = {};
  }

  const base: Record<string, unknown> = {
    layout: {
      background: { type: ColorType.Solid, color: VOID.bg },
      textColor: VOID.textDim,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: VOID.grid },
      horzLines: { color: VOID.grid },
    },
    rightPriceScale: {
      borderColor: VOID.border,
      borderVisible: true,
      textColor: VOID.textDim,
      entireTextOnly: false,
      minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
      scaleMargins: { top: 0.06, bottom: 0.06 },
    },
    leftPriceScale: {
      visible: false,
      borderColor: VOID.border,
    },
    timeScale: {
      borderColor: VOID.border,
      borderVisible: true,
      // Date + HH:mm on axis ticks and vertical crosshair endpoint labels
      timeVisible: true,
      secondsVisible: false,
      ticksVisible: true,
      // Empty right margin so trendlines / drawings can start past the last bar.
      // Drawing layer may grow this up to DRAWING_FUTURE_BARS (500) while placing.
      rightOffset: 20,
      // Never auto-scroll when a live bar is appended / updated
      shiftVisibleRangeOnNewBar: false,
      allowShiftVisibleRangeOnWhitespaceReplacement: false,
      rightBarStaysOnScroll: true,
      // Merge sub-pixel bars when zoomed out — critical for 10k+ candle histories.
      // Precompute is toggled on after heavy setData (see manager-access).
      enableConflation: true,
      conflationThresholdFactor: 1,
      precomputeConflationOnInit: false,
      precomputeConflationPriority: 'background',
    },
    // Crosshair time label uses this when set; fallback is LWC DateTimeFormatter
    // (date + time when timeScale.timeVisible is true).
    localization: {
      // Prefer compact date+time so the bottom crosshair pill always includes clock time
      // for intraday bars (e.g. "10 Aug 26  14:35"), not date-only.
      timeFormatter: (time: unknown) => formatCrosshairDateTime(time),
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: VOID.indigoSoft,
        width: 1 as LineWidth,
        style: 2,
        labelBackgroundColor: VOID.elev,
      },
      horzLine: {
        color: VOID.indigoSoft,
        width: 1 as LineWidth,
        style: 2,
        labelBackgroundColor: VOID.elev,
      },
    },
    handleScroll: { vertTouchDrag: true },
  };

  const merged = deepMerge(deepMerge(base, themeOpts), options ?? {});
  return createChart(container, merged);
}

function priceSeriesCommon(tokens: ThemeTokens) {
  return {
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineColor: String(tokens['crosshair.color'] ?? VOID.indigoSoft),
    priceLineWidth: 1 as LineWidth,
    priceLineStyle: 2,
  };
}

function alignRightScale(chart: IChartApi) {
  try {
    const tokens = activeTokens();
    chart.priceScale('right').applyOptions({
      borderColor: String(tokens['scale.border'] ?? VOID.border),
      textColor: String(tokens['scale.text'] ?? VOID.textDim),
      minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
    });
  } catch {
    /* disposed chart / missing scale */
  }
}

/** Japanese candlestick series with void up/down colors and aligned right scale. */
export function createCandleSeries(chart: IChartApi, paneIndex?: number): ISeriesApi<'Candlestick'> {
  const tokens = activeTokens();
  const opts = {
    ...priceSeriesCommon(tokens),
    ...buildCandleSeriesOptions(tokens, { chartType: 'candles' }),
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(CandlestickSeries, opts, paneIndex)
    : chart.addSeries(CandlestickSeries, opts);
  alignRightScale(chart);
  return series;
}

/**
 * Hollow candlesticks: rising bars use a transparent body (outline only);
 * falling bars stay filled. Same OHLC data as solid candles.
 */
export function createHollowCandleSeries(
  chart: IChartApi,
  paneIndex?: number,
): ISeriesApi<'Candlestick'> {
  const tokens = activeTokens();
  const opts = {
    ...priceSeriesCommon(tokens),
    ...buildCandleSeriesOptions(tokens, { chartType: 'hollow' }),
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(CandlestickSeries, opts, paneIndex)
    : chart.addSeries(CandlestickSeries, opts);
  alignRightScale(chart);
  return series;
}

/** Classic OHLC bar series (open/high/low/close ticks). */
export function createBarSeries(chart: IChartApi, paneIndex?: number): ISeriesApi<'Bar'> {
  const tokens = activeTokens();
  const opts = {
    ...priceSeriesCommon(tokens),
    ...buildBarSeriesOptions(tokens),
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(BarSeries, opts, paneIndex)
    : chart.addSeries(BarSeries, opts);
  alignRightScale(chart);
  return series;
}

/** Close-price line used as the main price series (not an overlay plot). */
export function createPriceLineSeries(chart: IChartApi, paneIndex?: number): ISeriesApi<'Line'> {
  const tokens = activeTokens();
  const opts = {
    ...priceSeriesCommon(tokens),
    ...buildLineSeriesOptions(tokens),
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(LineSeries, opts, paneIndex)
    : chart.addSeries(LineSeries, opts);
  alignRightScale(chart);
  return series;
}

/** Close-price area used as the main price series. */
export function createPriceAreaSeries(chart: IChartApi, paneIndex?: number): ISeriesApi<'Area'> {
  const tokens = activeTokens();
  const opts = {
    ...priceSeriesCommon(tokens),
    ...buildAreaSeriesOptions(tokens),
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(AreaSeries, opts, paneIndex)
    : chart.addSeries(AreaSeries, opts);
  alignRightScale(chart);
  return series;
}

/**
 * Baseline series (close vs base price). Callers may later `applyOptions`
 * with a better base (e.g. first bar close); default base is 0 until data lands.
 */
export function createPriceBaselineSeries(
  chart: IChartApi,
  paneIndex?: number,
  basePrice = 0,
): ISeriesApi<'Baseline'> {
  const tokens = activeTokens();
  const opts = {
    ...priceSeriesCommon(tokens),
    ...buildBaselineSeriesOptions(tokens),
    baseValue: { type: 'price' as const, price: basePrice },
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(BaselineSeries, opts, paneIndex)
    : chart.addSeries(BaselineSeries, opts);
  alignRightScale(chart);
  return series;
}

/**
 * Create the main price series for a {@link ChartType}.
 * Series stay under the `candle` key in PaneManager for marker/overlay hosts.
 */
export function createPriceSeries(
  chart: IChartApi,
  type: ChartType,
  paneIndex?: number,
): ISeriesApi<any> {
  switch (type) {
    case 'hollow':
      return createHollowCandleSeries(chart, paneIndex);
    case 'bars':
      return createBarSeries(chart, paneIndex);
    case 'line':
      return createPriceLineSeries(chart, paneIndex);
    case 'area':
      return createPriceAreaSeries(chart, paneIndex);
    case 'baseline':
      return createPriceBaselineSeries(chart, paneIndex);
    case 'heikinashi':
      return createCandleSeries(chart, paneIndex);
    case 'candles':
    default:
      return createCandleSeries(chart, paneIndex);
  }
}

/** Volume histogram on the main right scale (aligned pane edges). */
export function createVolumeSeries(chart: IChartApi, paneIndex?: number): ISeriesApi<'Histogram'> {
  const tokens = activeTokens();
  // Use the main right scale (same width as price pane) so chart edges align
  const opts = {
    priceFormat: { type: 'volume' as const },
    priceScaleId: 'right',
    lastValueVisible: true,
    priceLineVisible: false,
  };
  const series = paneIndex !== undefined
    ? chart.addSeries(HistogramSeries, opts, paneIndex)
    : chart.addSeries(HistogramSeries, opts);
  try {
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.12, bottom: 0.02 },
      borderVisible: true,
      borderColor: String(tokens['scale.border'] ?? VOID.border),
      textColor: String(tokens['scale.text'] ?? VOID.textDim),
      minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
    });
  } catch {
    /* disposed chart */
  }
  return series;
}

/**
 * Full-height histogram underlay for Pine bgcolor (separate scale, drawn behind candles).
 * Data points use value=1 + per-bar color; null colors are omitted by the caller.
 */
export function createBgcolorSeries(chart: IChartApi, paneIndex?: number): ISeriesApi<'Histogram'> {
  const opts = {
    priceScaleId: 'bgcolor',
    lastValueVisible: false,
    priceLineVisible: false,
    base: 0,
    priceFormat: { type: 'custom' as const, minMove: 1, formatter: () => '' },
  };
  const series =
    paneIndex !== undefined
      ? chart.addSeries(HistogramSeries, opts, paneIndex)
      : chart.addSeries(HistogramSeries, opts);
  try {
    chart.priceScale('bgcolor').applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: { top: 0, bottom: 0 },
    });
  } catch {
    /* ignore */
  }
  // Paint behind candle / overlay series when API is available (LWC v5)
  try {
    (series as ISeriesApi<'Histogram'> & { setSeriesOrder?: (n: number) => void }).setSeriesOrder?.(0);
  } catch {
    /* ignore */
  }
  return series;
}

/** Hex `#rrggbb` / `#rgb` → `rgba(r,g,b,a)` for area fills; fall back to indigo soft. */
function colorWithAlpha(color: string, alpha: number): string {
  const s = (color || '').trim();
  const m6 = s.match(/^#([0-9a-f]{6})$/i);
  if (m6) {
    const n = parseInt(m6[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m3 = s.match(/^#([0-9a-f]{3})$/i);
  if (m3) {
    const h = m3[1]!;
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^rgba?\(/i.test(s)) return s;
  return `rgba(147, 159, 255, ${alpha})`;
}

/** Plot / overlay line series with crosshair marker. */
export function createLineSeries(
  chart: IChartApi,
  name: string,
  color: string,
  paneIndex?: number,
  lineWidth: number = 2,
): ISeriesApi<'Line'> {
  const tokens = activeTokens();
  const bg = String(tokens['chart.bg_color'] ?? VOID.bg);
  const lw = Math.max(1, Math.min(4, Math.round(lineWidth || 2))) as LineWidth;
  const opts = {
    color,
    lineWidth: lw,
    priceLineVisible: false,
    lastValueVisible: true,
    title: name,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: color,
  };
  return paneIndex !== undefined
    ? chart.addSeries(LineSeries, opts, paneIndex)
    : chart.addSeries(LineSeries, opts);
}

/** Map Pine `plot.linestyle_*` string → LWC {@link LineStyle}. */
function pineLineStyleToLwc(linestyle?: string | null): LineStyle {
  const t = normalizeLineStyleToken(linestyle);
  if (t === 'dashed') return LineStyle.Dashed;
  if (t === 'dotted') return LineStyle.Dotted;
  return LineStyle.Solid;
}

/**
 * Pine plot overlay series for a {@link PlotSeriesKind}.
 * - line / stepline / stepline_diamond / circles / cross → Line
 * - histogram / columns → Histogram (both base 0; LWC has no column-width API)
 * - area → Area
 *
 * Optional `linestyle` (`plot.linestyle_dashed` / `dotted` / `solid`) sets
 * LWC `lineStyle` on Line / Area / stepline / marker hairlines.
 * Histogram / columns ignore linestyle.
 *
 * **Presentation notes (LWC limits):**
 * - `columns` vs `histogram`: same bar geometry; kind kept distinct for
 *   recreate-on-style-change and docs. Both use `base: 0`.
 * - `cross`: connector hidden (`lineVisible: false`) + larger point markers
 *   (LWC point markers are always circles — no native + glyph on Line).
 * - `stepline_diamond`: WithSteps + point markers at vertices (diamond ≈ circle).
 */
export function createPlotOverlaySeries(
  chart: IChartApi,
  name: string,
  color: string,
  seriesKind: PlotSeriesKind = 'line',
  lineWidth: number = 2,
  paneIndex?: number,
  linestyle?: string | null,
): ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | ISeriesApi<'Area'> {
  const lw = Math.max(1, Math.min(4, Math.round(lineWidth || 2))) as LineWidth;
  const lwcStyle = pineLineStyleToLwc(linestyle);
  if (isHistogramSeriesKind(seriesKind)) {
    // LWC HistogramStyleOptions = { color, base } only — no gap/width.
    // columns and histogram share geometry; base 0 matches Pine zero-origin bars.
    const opts = {
      color,
      priceLineVisible: false,
      lastValueVisible: true,
      title: name,
      base: 0,
    };
    return paneIndex !== undefined
      ? chart.addSeries(HistogramSeries, opts, paneIndex)
      : chart.addSeries(HistogramSeries, opts);
  }
  if (seriesKind === 'area') {
    const series = createAreaSeries(chart, name, color, paneIndex, lw);
    try {
      series.applyOptions({ lineStyle: lwcStyle });
    } catch {
      /* ignore */
    }
    return series;
  }
  const series = createLineSeries(chart, name, color, paneIndex, lw);
  try {
    if (seriesKind === 'stepline') {
      series.applyOptions({ lineType: LineType.WithSteps, lineStyle: lwcStyle });
    } else if (seriesKind === 'stepline_diamond') {
      // Step line with vertex markers (LWC circles stand in for diamonds)
      series.applyOptions({
        lineType: LineType.WithSteps,
        lineStyle: lwcStyle,
        pointMarkersVisible: true,
        pointMarkersRadius: Math.max(3, lw + 1),
        crosshairMarkerBackgroundColor: color,
      });
    } else if (seriesKind === 'circles') {
      series.applyOptions({
        pointMarkersVisible: true,
        pointMarkersRadius: Math.max(2, lw + 1),
        // Keep a hairline so times still connect; markers carry the style
        lineWidth: 1 as LineWidth,
        color: colorWithAlpha(color, 0.35),
        crosshairMarkerBackgroundColor: color,
        lineStyle: lwcStyle,
      });
    } else if (seriesKind === 'cross') {
      // Discrete cross-like marks: hide connector; larger circular markers.
      // (LWC Line point markers are circles only — distinct from circles style
      // by no hairline + bigger radius.)
      series.applyOptions({
        pointMarkersVisible: true,
        pointMarkersRadius: Math.max(3, lw + 2),
        lineVisible: false,
        lineWidth: 1 as LineWidth,
        color,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: Math.max(4, lw + 2),
        crosshairMarkerBackgroundColor: color,
        crosshairMarkerBorderColor: color,
        lineStyle: lwcStyle,
      });
    } else {
      series.applyOptions({ lineStyle: lwcStyle });
    }
  } catch {
    /* disposed / mock */
  }
  return series;
}

/**
 * Pine `plotbar` overlay — OHLC bar series (not the main price bars).
 * Single `color` tints both up/down; omit for VOID up/down.
 */
export function createPlotBarOverlaySeries(
  chart: IChartApi,
  name: string,
  color?: string,
  paneIndex?: number,
): ISeriesApi<'Bar'> {
  const up = color || VOID.up;
  const down = color || VOID.down;
  const opts = {
    upColor: up,
    downColor: down,
    openVisible: true,
    thinBars: true,
    priceLineVisible: false,
    lastValueVisible: true,
    title: name,
  };
  return paneIndex !== undefined
    ? chart.addSeries(BarSeries, opts, paneIndex)
    : chart.addSeries(BarSeries, opts);
}

/**
 * Pine `plotcandle` overlay — candlestick series (not the main price candles).
 * Single `color` tints body/border/wick for both directions; omit for VOID up/down.
 */
export function createPlotCandleOverlaySeries(
  chart: IChartApi,
  name: string,
  color?: string,
  paneIndex?: number,
): ISeriesApi<'Candlestick'> {
  const up = color || VOID.up;
  const down = color || VOID.down;
  const opts = {
    upColor: up,
    downColor: down,
    borderVisible: true,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
    priceLineVisible: false,
    lastValueVisible: true,
    title: name,
  };
  return paneIndex !== undefined
    ? chart.addSeries(CandlestickSeries, opts, paneIndex)
    : chart.addSeries(CandlestickSeries, opts);
}

/** Equity curve / plot.style_area — tinted fill from line color */
export function createAreaSeries(
  chart: IChartApi,
  name: string,
  color = VOID.indigo,
  paneIndex?: number,
  lineWidth: number = 2,
): ISeriesApi<'Area'> {
  const tokens = activeTokens();
  const bg = String(tokens['chart.bg_color'] ?? VOID.bg);
  const lw = Math.max(1, Math.min(4, Math.round(lineWidth || 2))) as LineWidth;
  const opts = {
    lineColor: color,
    topColor: colorWithAlpha(color, 0.28),
    bottomColor: colorWithAlpha(color, 0.02),
    lineWidth: lw,
    priceLineVisible: false,
    lastValueVisible: true,
    title: name,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: color,
  };
  return paneIndex !== undefined
    ? chart.addSeries(AreaSeries, opts, paneIndex)
    : chart.addSeries(AreaSeries, opts);
}
