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
 * Pure converters: pyne `plot_meta.kind` series → Lightweight Charts overlays.
 *
 * The engine returns parallel `series` arrays and a `meta.plot_meta` map with
 * `kind` (`plot` | `hline` | `bgcolor` | `fill` | `plotshape` | `plotchar` |
 * `plotarrow` | `plotbar` | `plotcandle`). This module splits and converts
 * those into line data, bgcolor histograms, fill bands (plot1↔plot2), OHLC
 * bar/candle overlays, and shape markers for {@link indicators/runner}.
 *
 * @module results/plot-visuals
 */

export type PlotKind =
  | 'plot'
  | 'hline'
  | 'bgcolor'
  | 'fill'
  | 'plotshape'
  | 'plotchar'
  | 'plotarrow'
  | 'plotbar'
  | 'plotcandle'
  | string;

export interface PlotMetaEntry {
  title?: string;
  color?: string | null;
  linewidth?: number;
  index?: number;
  kind?: PlotKind;
  style?: string | null;
  linestyle?: string | null;
  location?: string | null;
  text?: string | null;
  char?: string | null;
  price?: number | null;
  /**
   * Pine `size.*` for plotshape/plotchar (or bare token / numeric).
   * Prefer over {@link text_size} when both are present.
   */
  size?: string | number | null;
  /**
   * pyne often stores plotshape `size=` in `text_size` on plot_meta.
   * Accepted tokens match {@link size}.
   */
  text_size?: string | number | null;
  /** `fill(plot1, plot2, …)` — series title of first plot edge */
  plot1?: string | null;
  /** `fill(plot1, plot2, …)` — series title of second plot edge */
  plot2?: string | null;
  /**
   * `plotbar` / `plotcandle` — optional series titles for OHLC components when
   * the primary series is close-only or a handle (sibling packaging).
   */
  open?: string | null;
  high?: string | null;
  low?: string | null;
  close?: string | null;
}

export type SeriesMap = Record<string, unknown[] | (number | null)[]>;

export interface LineOverlaySpec {
  name: string;
  /** `value` omitted = LWC whitespace (keeps time-scale slot for multi-pane align) */
  data: { time: number; value?: number }[];
  color?: string;
  kind: 'plot' | 'hline' | string;
  /** Pine `plot.style_*` (optional; chart maps via {@link mapPlotStyleToSeriesKind}) */
  style?: string | null;
  linewidth?: number;
  linestyle?: string | null;
}

export interface BgcolorBandSpec {
  name: string;
  /** Histogram points: value=1 when colored, color per bar */
  data: { time: number; value: number; color: string }[];
  title?: string;
}

export interface ShapeMarkerSpec {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
  id?: string;
  /** LWC SeriesMarker relative size (optional; omit = library default ~1) */
  size?: number;
}

/** Pine `fill(plot1, plot2, color=…)` band for SVG overlay. */
export interface PlotFillBandSpec {
  name: string;
  /** Upper / first edge series (same length as lower; null = gap) */
  upper: (number | null)[];
  /** Lower / second edge series */
  lower: (number | null)[];
  /** Solid or per-bar colors (same length); constant color = length 1 or meta.color */
  colors: (string | null)[];
  color: string;
  plot1: string;
  plot2: string;
}

/** One LWC-ready OHLC sample from `plotbar` / `plotcandle`. */
export interface OhlcBarPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Optional per-bar color (LWC Bar/Candlestick `color`) */
  color?: string;
}

/** Chart overlay spec for Pine `plotbar` / `plotcandle`. */
export interface OhlcOverlaySpec {
  name: string;
  kind: 'plotbar' | 'plotcandle';
  data: OhlcBarPoint[];
  color?: string;
}

const DEFAULT_SHAPE_COLOR = '#939fff';
const DEFAULT_BG_COLOR = 'rgba(147, 159, 255, 0.12)';
const DEFAULT_FILL_COLOR = 'rgba(255, 82, 82, 0.2)';

export function normalizePlotKind(kind?: string | null): string {
  const k = String(kind || 'plot').toLowerCase().trim();
  return k || 'plot';
}

export function isLinePlotKind(kind?: string | null): boolean {
  const k = normalizePlotKind(kind);
  return k === 'plot' || k === 'hline' || k === '';
}

export function isBgcolorKind(kind?: string | null): boolean {
  return normalizePlotKind(kind) === 'bgcolor';
}

/** Pine `barcolor(series)` — per-bar candle body/wick tint (not SVG geometry). */
export function isBarcolorKind(kind?: string | null): boolean {
  return normalizePlotKind(kind) === 'barcolor';
}

export function isFillKind(kind?: string | null): boolean {
  return normalizePlotKind(kind) === 'fill';
}

export function isShapeKind(kind?: string | null): boolean {
  const k = normalizePlotKind(kind);
  return k === 'plotshape' || k === 'plotchar' || k === 'plotarrow';
}

/** Pine `plotbar` / `plotcandle` — OHLC overlays (not line styles). */
export function isOhlcPlotKind(kind?: string | null): boolean {
  const k = normalizePlotKind(kind);
  return k === 'plotbar' || k === 'plotcandle';
}

/** Split series map by plot_meta.kind (missing kind → line plot). */
export function splitSeriesByKind(
  series: SeriesMap | undefined | null,
  plotMeta: Record<string, PlotMetaEntry> | undefined | null,
): {
  lines: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  bgcolors: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  barcolors: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  shapes: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  fills: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  ohlc: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
} {
  const lines: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const bgcolors: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const barcolors: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const shapes: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const fills: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const ohlc: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  if (!series) return { lines, bgcolors, barcolors, shapes, fills, ohlc };
  const meta = plotMeta || {};

  // Sibling OHLC component series (open/high/low/close refs) stay off the line list
  const ohlcLinked = new Set<string>();
  for (const m of Object.values(meta)) {
    if (!m || !isOhlcPlotKind(m.kind)) continue;
    for (const ref of [m.open, m.high, m.low, m.close]) {
      if (ref != null && String(ref)) ohlcLinked.add(String(ref));
    }
  }

  for (const [key, arr] of Object.entries(series)) {
    if (!key || key.startsWith('__') || key.startsWith('_')) continue;
    if (!Array.isArray(arr)) continue;
    const m = meta[key] || {};
    const kind = normalizePlotKind(m.kind);
    const entry = { key, values: arr as unknown[], meta: { ...m, kind } };
    if (isBgcolorKind(kind)) bgcolors.push(entry);
    else if (isBarcolorKind(kind)) barcolors.push(entry);
    else if (isShapeKind(kind)) shapes.push(entry);
    else if (isFillKind(kind)) fills.push(entry);
    else if (isOhlcPlotKind(kind)) ohlc.push(entry);
    else if (isLinePlotKind(kind)) {
      // Skip siblings that only feed plotbar/plotcandle open/high/low/close refs
      if (ohlcLinked.has(key)) continue;
      lines.push(entry);
    }
    // unknown kinds skipped
  }
  return { lines, bgcolors, barcolors, shapes, fills, ohlc };
}

/**
 * Build per-bar candle color overrides from one or more `barcolor` series.
 * Later series win on non-null samples. Values may be color strings or na/null.
 */
export function barcolorSeriesToMap(
  times: ReadonlyArray<number>,
  barcolors: ReadonlyArray<{ values: unknown[]; meta?: PlotMetaEntry }>,
): Map<number, string> {
  const map = new Map<number, string>();
  if (!times?.length || !barcolors?.length) return map;
  for (const { values } of barcolors) {
    if (!Array.isArray(values)) continue;
    const n = Math.min(times.length, values.length);
    for (let i = 0; i < n; i++) {
      const t = times[i];
      if (t == null || !Number.isFinite(t)) continue;
      const c = coerceBarColor(values[i]);
      if (c) map.set(t, c);
    }
  }
  return map;
}

/** Accept color string / hex / rgba; reject na/null/numbers that are not colors. */
export function coerceBarColor(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    // 0xRRGGBB or 0xAARRGGBB integer from some engines
    if (v > 0xffffff) {
      const r = (v >> 16) & 0xff;
      const g = (v >> 8) & 0xff;
      const b = v & 0xff;
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    if (v >= 0 && v <= 0xffffff) {
      return `#${Math.floor(v).toString(16).padStart(6, '0')}`;
    }
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (
    lower === 'na' ||
    lower === 'nan' ||
    lower === 'null' ||
    lower === 'none' ||
    lower === 'undefined'
  ) {
    return null;
  }
  if (
    s.startsWith('#') ||
    lower.startsWith('rgb') ||
    lower.startsWith('hsl') ||
    lower.startsWith('color.')
  ) {
    return s;
  }
  // Named CSS-ish tokens (rare) — keep short alphanumeric
  if (/^[a-zA-Z][\w-]{0,30}$/.test(s)) return s;
  return null;
}

function asFiniteNumber(v: unknown): number | null {
  // Keep in sync with indicators/run-helpers.coercePlotSample (local to avoid cycle)
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    if (
      lower === 'na' ||
      lower === 'nan' ||
      lower === 'null' ||
      lower === 'none' ||
      lower === 'infinity' ||
      lower === '+infinity' ||
      lower === '-infinity'
    ) {
      return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBarTime(t: unknown): number | null {
  if (t == null) return null;
  const n = typeof t === 'number' ? t : Number(t);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Resolve Pine `fill` entries into upper/lower series bands for the chart.
 * Requires `meta.plot1` / `meta.plot2` series titles (from plot handles).
 */
export function resolvePlotFillBands(
  series: SeriesMap | undefined | null,
  plotMeta: Record<string, PlotMetaEntry> | undefined | null,
): PlotFillBandSpec[] {
  if (!series) return [];
  const split = splitSeriesByKind(series, plotMeta);
  const out: PlotFillBandSpec[] = [];
  for (const { key, values, meta } of split.fills) {
    const p1 = meta.plot1 ? String(meta.plot1) : '';
    const p2 = meta.plot2 ? String(meta.plot2) : '';
    if (!p1 || !p2) continue;
    const a = series[p1];
    const b = series[p2];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const n = Math.max(a.length, b.length, values.length);
    const upper: (number | null)[] = [];
    const lower: (number | null)[] = [];
    const colors: (string | null)[] = [];
    const fallback =
      (meta.color && isActiveColor(meta.color) ? meta.color.trim() : null) || DEFAULT_FILL_COLOR;
    for (let i = 0; i < n; i++) {
      upper.push(asFiniteNumber(a[i]));
      lower.push(asFiniteNumber(b[i]));
      const raw = values[i];
      if (isActiveColor(raw)) colors.push(String(raw).trim());
      else if (raw == null) colors.push(fallback);
      else colors.push(fallback);
    }
    // Need at least one pair of finite edges
    let ok = false;
    for (let i = 0; i < n; i++) {
      if (upper[i] != null && lower[i] != null) {
        ok = true;
        break;
      }
    }
    if (!ok) continue;
    out.push({
      name: key,
      upper,
      lower,
      colors,
      color: fallback,
      plot1: p1,
      plot2: p2,
    });
  }
  return out;
}

export function isTruthyPlotValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s || s === 'na' || s === 'false' || s === '0' || s === 'null') return false;
    return true;
  }
  return Boolean(v);
}

/** Non-null color string (skip na / empty). */
export function isActiveColor(v: unknown): v is string {
  if (v == null) return false;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'na' || lower === 'none' || lower === 'null') return false;
  // fully transparent
  if (/rgba?\([^)]+,\s*0\s*\)/.test(lower)) return false;
  if (/#[0-9a-f]{6}00$/i.test(s)) return false;
  return true;
}

/**
 * bgcolor series (color|null per bar) → LWC histogram underlay data.
 * Transparent / null bars are omitted (no band).
 */
export function bgcolorSeriesToHistogramData(
  times: number[] | ReadonlyArray<unknown>,
  colors: unknown[] | unknown,
  fallbackColor?: string | null,
): { time: number; value: number; color: string }[] {
  if (!Array.isArray(times) || times.length === 0) return [];
  const colorArr = Array.isArray(colors) ? colors : [];
  const n = Math.min(times.length, colorArr.length);
  // Sparse (most bars transparent) — grow from empty but cap initial capacity
  const out: { time: number; value: number; color: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = asBarTime(times[i]);
    if (t == null) continue;
    const raw = colorArr[i];
    let color: string | null = null;
    if (isActiveColor(raw)) color = raw.trim();
    else if (raw === true || (typeof raw === 'number' && raw !== 0 && Number.isFinite(raw))) {
      color = (fallbackColor && isActiveColor(fallbackColor) ? fallbackColor : DEFAULT_BG_COLOR).trim();
    }
    if (!color) continue;
    out.push({ time: t, value: 1, color });
  }
  return out;
}

function stripNs(s: string): string {
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(i + 1).toLowerCase() : s.toLowerCase();
}

/**
 * LWC series kind used for a Pine `plot(..., style=plot.style_*)`.
 * `plotbar` / `plotcandle` are separate plot_meta.kinds (not style tokens).
 *
 * Distinct kinds may share an LWC series type when the library has no exact
 * match (e.g. `columns` vs `histogram` both use HistogramSeries — LWC has no
 * column-width/gap API). Kind identity still drives recreate-on-style-change
 * and presentation tweaks (point markers, line visibility).
 */
export type PlotSeriesKind =
  | 'line'
  | 'stepline'
  | 'stepline_diamond'
  | 'histogram'
  | 'columns'
  | 'area'
  | 'circles'
  | 'cross';

/** True when kind is drawn with LWC `HistogramSeries` (histogram or columns). */
export function isHistogramSeriesKind(kind?: string | null): boolean {
  return kind === 'histogram' || kind === 'columns';
}

/**
 * True when kind uses LWC line point markers (circles / cross / stepline_diamond).
 * LWC point markers are always circular; cross/diamond are approximations.
 */
export function isPointMarkerSeriesKind(kind?: string | null): boolean {
  return kind === 'circles' || kind === 'cross' || kind === 'stepline_diamond';
}

/**
 * Normalize Pine style tokens to a bare leaf:
 * `plot.style_stepline` / `style_stepline` / `stepline` → `stepline`.
 */
export function normalizePlotStyleToken(style?: string | null): string {
  let s = String(style || '')
    .toLowerCase()
    .trim();
  if (!s) return '';
  // strip namespace prefixes (plot.style_*, line.style_*, bare style_*)
  const lastDot = s.lastIndexOf('.');
  if (lastDot >= 0) s = s.slice(lastDot + 1);
  if (s.startsWith('style_')) s = s.slice('style_'.length);
  return s;
}

/**
 * Normalize Pine `plot.linestyle_*` / `hline.style_*` / bare tokens →
 * `solid` | `dashed` | `dotted` for Lightweight Charts `lineStyle`.
 *
 * Accepts: `plot.linestyle_dashed`, `linestyle_dotted`, `style_dashed`,
 * `dashed`, `hline.style_solid`, etc.
 */
export function normalizeLineStyleToken(
  linestyle?: string | null,
): 'solid' | 'dashed' | 'dotted' {
  let s = String(linestyle || '')
    .toLowerCase()
    .trim();
  if (!s) return 'solid';
  const lastDot = s.lastIndexOf('.');
  if (lastDot >= 0) s = s.slice(lastDot + 1);
  if (s.startsWith('linestyle_')) s = s.slice('linestyle_'.length);
  if (s.startsWith('style_')) s = s.slice('style_'.length);
  if (s.includes('dash')) return 'dashed';
  if (s.includes('dot')) return 'dotted';
  return 'solid';
}

/**
 * True for Pine plot styles that break the series on `na` gaps:
 * `plot.style_linebr`, `plot.style_areabr`, `plot.style_steplinebr`.
 *
 * LWC Line/Area series **filter whitespace and connect remaining points**,
 * which matches Pine `style_line` (span `na`) but not `*br`. Chart path
 * keeps whitespace slots for pane alignment and draws breaks via
 * `LineBreakPrimitive` when this is true.
 */
export function isBreakPlotStyle(style?: string | null): boolean {
  const s = normalizePlotStyleToken(style);
  return s === 'linebr' || s === 'areabr' || s === 'steplinebr';
}

/**
 * Map Pine `plot.style_*` → chart series kind.
 *
 * | Pine style | AXIS chart |
 * |------------|------------|
 * | line / linebr / (default) | line |
 * | stepline / steplinebr | stepline (LWC WithSteps) |
 * | stepline_diamond | stepline + point markers at steps |
 * | histogram | histogram (LWC Histogram, base 0) |
 * | columns | columns (LWC Histogram, base 0; no width/gap API) |
 * | area / areabr | area |
 * | circles | line + circular point markers (hairline) |
 * | cross | discrete point markers, connector hidden |
 *
 * `plotbar` / `plotcandle` are separate plot_meta.kinds — see
 * {@link isOhlcPlotKind} / {@link ohlcSeriesToBarData}.
 *
 * Break variants (`*br`) use the same series kind. Whitespace keeps time-scale
 * slots; the connector is hidden and {@link splitOverlayLineSegments} +
 * `LineBreakPrimitive` stroke each finite run (LWC would otherwise connect).
 *
 * **LWC limits:** Histogram has no column-gap/width option (columns ≈ histogram
 * bars). Point markers are always circles — cross/diamond use size + line
 * visibility / stepline combos as stand-ins (see {@link mapShapeStyle} for
 * sparse plotshape markers, where square + glyph approximates diamond/cross).
 */
export function mapPlotStyleToSeriesKind(style?: string | null): PlotSeriesKind {
  const s = normalizePlotStyleToken(style);
  if (!s || s === 'line' || s === 'linebr') return 'line';
  if (s === 'stepline' || s === 'steplinebr') return 'stepline';
  if (s === 'stepline_diamond') return 'stepline_diamond';
  if (s === 'histogram') return 'histogram';
  if (s === 'columns') return 'columns';
  if (s === 'area' || s === 'areabr') return 'area';
  if (s === 'circles') return 'circles';
  if (s === 'cross') return 'cross';
  return 'line';
}

/**
 * Default marker glyph for sparse plotshape styles when text/char omitted.
 * LWC has no native cross/diamond shapes — glyphs ride on square/circle marks.
 *
 * - `shape.xcross` → `✕`
 * - `shape.cross` → `+`
 * - diamond / others → null (shape alone)
 */
export function defaultShapeMarkerGlyph(style?: string | null): string | null {
  const s = stripNs(String(style || ''));
  if (!s) return null;
  if (s.includes('xcross')) return '✕';
  if (s === 'cross') return '+';
  return null;
}

/** Map Pine shape.* style → LWC SeriesMarkerShape. */
export function mapShapeStyle(
  style?: string | null,
  kind?: string | null,
  /** For plotarrow: signed series sample (negative → arrowDown). */
  sample?: unknown,
): 'arrowUp' | 'arrowDown' | 'circle' | 'square' {
  const k = normalizePlotKind(kind);
  if (k === 'plotarrow') {
    // plotarrow(series): positive/up, negative/down (Pine reference)
    if (typeof sample === 'number' && Number.isFinite(sample) && sample < 0) {
      return 'arrowDown';
    }
    return 'arrowUp';
  }
  if (k === 'plotchar') return 'circle';
  const s = stripNs(String(style || ''));
  if (
    s.includes('triangledown') ||
    s.includes('arrowdown') ||
    s === 'labeldown' ||
    s === 'arrowdown'
  ) {
    return 'arrowDown';
  }
  if (
    s.includes('triangleup') ||
    s.includes('arrowup') ||
    s === 'labelup' ||
    s === 'arrowup'
  ) {
    return 'arrowUp';
  }
  // LWC has no diamond — square is the closest axis-aligned mark
  if (s.includes('diamond')) return 'square';
  if (s.includes('square') || s.includes('flag')) return 'square';
  // cross / xcross: square (+ optional glyph via {@link defaultShapeMarkerGlyph})
  // so they stay distinct from shape.circle
  if (s.includes('xcross') || s === 'cross') return 'square';
  if (s.includes('circle')) return 'circle';
  return 'circle';
}

/** Map Pine location.* → LWC marker position. */
export function mapShapeLocation(
  location?: string | null,
  style?: string | null,
): 'aboveBar' | 'belowBar' | 'inBar' {
  const loc = stripNs(String(location || ''));
  if (loc.includes('above') || loc === 'top') return 'aboveBar';
  if (loc.includes('below') || loc === 'bottom') return 'belowBar';
  if (loc.includes('absolute') || loc === 'middle' || loc === 'inbar') return 'inBar';
  // Infer from style when location omitted
  const shape = mapShapeStyle(style);
  if (shape === 'arrowDown') return 'aboveBar';
  if (shape === 'arrowUp') return 'belowBar';
  return 'aboveBar';
}

/**
 * Map Pine `size.*` (or pyne `text_size` / bare token / numeric) → LWC SeriesMarker `size`.
 *
 * Pine point sizes (pyne base): auto, tiny=8, small=10, normal=12, large=16, huge=20.
 * LWC uses a relative scale (typically ~0.5–3); omit/undefined keeps library default.
 */
export function mapShapeSize(size?: string | number | null): number | undefined {
  if (size == null) return undefined;
  if (typeof size === 'number') {
    if (!Number.isFinite(size) || size <= 0) return undefined;
    return size > 4 ? size / 12 : size;
  }
  const raw = String(size).trim();
  if (!raw || /^na$/i.test(raw)) return undefined;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && raw !== '' && !/[a-z_]/i.test(raw)) {
    if (asNum <= 0) return undefined;
    return asNum > 4 ? asNum / 12 : asNum;
  }
  const token = stripNs(raw);
  switch (token) {
    case 'auto':
      return undefined;
    case 'tiny':
      return 0.6;
    case 'small':
      return 0.8;
    case 'normal':
      return 1;
    case 'large':
      return 1.4;
    case 'huge':
      return 1.8;
    default:
      return undefined;
  }
}

/**
 * Truthy condition series → LWC markers (one per active bar).
 */
export function shapeSeriesToMarkers(
  times: number[] | ReadonlyArray<unknown>,
  values: unknown[] | unknown,
  meta: PlotMetaEntry = {},
  opts?: { idPrefix?: string },
): ShapeMarkerSpec[] {
  const out: ShapeMarkerSpec[] = [];
  if (!Array.isArray(times) || times.length === 0) return out;
  const valArr = Array.isArray(values) ? values : [];
  const n = Math.min(times.length, valArr.length);
  const color =
    (meta.color && isActiveColor(meta.color) ? meta.color : null) || DEFAULT_SHAPE_COLOR;
  const kindNorm = normalizePlotKind(meta.kind);
  const text =
    (meta.text && String(meta.text)) ||
    (meta.char && String(meta.char)) ||
    (meta.title && String(meta.title)) ||
    defaultShapeMarkerGlyph(meta.style) ||
    '';
  const prefix = opts?.idPrefix || meta.title || 'shape';
  const size = mapShapeSize(meta.size ?? meta.text_size);

  for (let i = 0; i < n; i++) {
    if (!isTruthyPlotValue(valArr[i])) continue;
    const t = asBarTime(times[i]);
    if (t == null) continue;
    // Per-bar color if series value is a color string (rare)
    let c = color;
    const v = valArr[i];
    if (typeof v === 'string' && isActiveColor(v) && !/^(true|false)$/i.test(v)) {
      c = v.trim();
    }
    // plotarrow: shape + position depend on the signed sample
    const shape = mapShapeStyle(meta.style, meta.kind, v);
    let position = mapShapeLocation(meta.location, meta.style);
    if (kindNorm === 'plotarrow' && !meta.location) {
      position = shape === 'arrowDown' ? 'aboveBar' : 'belowBar';
    }
    const marker: ShapeMarkerSpec = {
      time: t,
      position,
      color: c,
      shape,
      text,
      id: `${prefix}_${i}`,
    };
    if (size != null) marker.size = size;
    out.push(marker);
  }
  return out;
}

/**
 * Build line overlay points from series + bar times.
 * Emits one point per bar time; non-finite / null / NaN / "na" / string
 * non-numerics become whitespace (`{ time }` only) so multi-pane logical
 * ranges stay aligned with OHLCV. String numerics and ms timestamps coerced.
 * Safe when `times` or `values` is empty, shorter, or non-array-like.
 *
 * Pre-sizes the output for large OHLCV windows (10k–100k bars) to avoid
 * repeated array growth during indicator apply.
 */
export function lineSeriesToOverlayData(
  times: number[] | ReadonlyArray<unknown>,
  values: unknown[] | unknown,
): { time: number; value?: number }[] {
  if (!Array.isArray(times) || times.length === 0) return [];
  const arr = Array.isArray(values) ? values : [];
  // Most bar times are finite; pre-size then trim if any skipped
  const out: { time: number; value?: number }[] = new Array(times.length);
  let n = 0;
  for (let i = 0; i < times.length; i++) {
    const time = asBarTime(times[i]);
    if (time == null) continue;
    const v = asFiniteNumber(arr[i]);
    if (v != null) out[n++] = { time, value: v };
    else out[n++] = { time };
  }
  out.length = n;
  return out;
}

/**
 * Contiguous finite runs from overlay data. `na` / whitespace (`{ time }`
 * only) ends a segment so `plot.style_linebr` / `steplinebr` / `areabr`
 * can stroke each run separately. Isolated finite samples stay as
 * one-point segments (a tick, not a connector across the gap).
 */
export function splitOverlayLineSegments(
  data: ReadonlyArray<{ time: number; value?: number }>,
): { time: number; value: number }[][] {
  const segs: { time: number; value: number }[][] = [];
  let cur: { time: number; value: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const p = data[i]!;
    const v = p.value;
    if (v != null && Number.isFinite(v) && Number.isFinite(p.time)) {
      cur.push({ time: p.time, value: v });
    } else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/**
 * Overlay points for break-style plots (`linebr` / `areabr` / `steplinebr`).
 * Same whitespace padding as {@link lineSeriesToOverlayData} (multi-pane
 * logical range). Rendering must split via {@link splitOverlayLineSegments}
 * — LWC Line/Area connect through omitted values.
 */
export function lineSeriesToOverlayDataWithBreaks(
  times: number[] | ReadonlyArray<unknown>,
  values: unknown[] | unknown,
  _opts?: { breaks?: boolean },
): { time: number; value?: number }[] {
  return lineSeriesToOverlayData(times, values);
}

/** True when cell is a structured OHLC payload (object keys or length-4 array). */
function isStructuredOhlcCell(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v) && v.length >= 4) return true;
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return (
      o.open != null ||
      o.o != null ||
      o.high != null ||
      o.h != null ||
      o.low != null ||
      o.l != null ||
      o.close != null ||
      o.c != null
    );
  }
  return false;
}

/**
 * Parse one series cell into OHLC numbers.
 * Accepts `{open,high,low,close}` / `{o,h,l,c}`, length-4 arrays, or a
 * finite scalar (flat OHLC from close). Incomplete cells → null.
 */
export function parseOhlcCell(
  v: unknown,
): { open: number; high: number; low: number; close: number; color?: string } | null {
  if (v == null) return null;

  if (Array.isArray(v) && v.length >= 4) {
    const open = asFiniteNumber(v[0]);
    const high = asFiniteNumber(v[1]);
    const low = asFiniteNumber(v[2]);
    const close = asFiniteNumber(v[3]);
    if (open == null || high == null || low == null || close == null) return null;
    let color: string | undefined;
    if (v.length >= 5 && isActiveColor(v[4])) color = String(v[4]).trim();
    return { open, high, low, close, color };
  }

  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const open = asFiniteNumber(o.open ?? o.o ?? o.Open ?? o.O);
    const high = asFiniteNumber(o.high ?? o.h ?? o.High ?? o.H);
    const low = asFiniteNumber(o.low ?? o.l ?? o.Low ?? o.L);
    const close = asFiniteNumber(o.close ?? o.c ?? o.Close ?? o.C);
    if (open != null && high != null && low != null && close != null) {
      let color: string | undefined;
      if (isActiveColor(o.color)) color = String(o.color).trim();
      return { open, high, low, close, color };
    }
    // Close-only object → flat OHLC
    if (close != null && open == null && high == null && low == null) {
      return { open: close, high: close, low: close, close };
    }
    return null;
  }

  const close = asFiniteNumber(v);
  if (close != null) return { open: close, high: close, low: close, close };
  return null;
}

function siblingAt(
  seriesMap: SeriesMap | null | undefined,
  key: string | null | undefined,
  i: number,
): number | null {
  if (!key || !seriesMap) return null;
  const arr = seriesMap[String(key)];
  if (!Array.isArray(arr)) return null;
  return asFiniteNumber(arr[i]);
}

/**
 * Convert `plotbar` / `plotcandle` series cells + bar times → LWC bar data.
 *
 * Payload acceptance (first match wins per bar):
 * 1. Per-bar objects `{open,high,low,close}` / `{o,h,l,c}` or length-4 arrays
 * 2. Meta-linked sibling series titles (`meta.open` / `high` / `low` / `close`)
 * 3. Close-only scalar → flat OHLC (o=h=l=c)
 *
 * Incomplete bars are omitted (no LWC whitespace for OHLC series).
 */
export function ohlcSeriesToBarData(
  times: number[] | ReadonlyArray<unknown>,
  values: unknown[] | unknown,
  seriesMap?: SeriesMap | null,
  meta?: PlotMetaEntry | null,
): OhlcBarPoint[] {
  if (!Array.isArray(times) || times.length === 0) return [];
  const arr = Array.isArray(values) ? values : [];
  const n = times.length;
  const out: OhlcBarPoint[] = [];
  const hasSiblings = !!(
    meta &&
    (meta.open || meta.high || meta.low || meta.close) &&
    seriesMap
  );

  for (let i = 0; i < n; i++) {
    const time = asBarTime(times[i]);
    if (time == null) continue;
    const cell = arr[i];
    let ohlc: { open: number; high: number; low: number; close: number; color?: string } | null =
      null;

    if (isStructuredOhlcCell(cell)) {
      ohlc = parseOhlcCell(cell);
    } else if (hasSiblings) {
      const open = siblingAt(seriesMap, meta!.open, i);
      const high = siblingAt(seriesMap, meta!.high, i);
      const low = siblingAt(seriesMap, meta!.low, i);
      const close =
        siblingAt(seriesMap, meta!.close, i) ?? asFiniteNumber(cell);
      if (open != null && high != null && low != null && close != null) {
        ohlc = { open, high, low, close };
      }
    }

    if (!ohlc) {
      // Close-only scalar fallback (or full parse for bare numbers)
      ohlc = parseOhlcCell(cell);
    }
    if (!ohlc) continue;

    const point: OhlcBarPoint = {
      time,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close: ohlc.close,
    };
    if (ohlc.color) point.color = ohlc.color;
    out.push(point);
  }
  return out;
}

/**
 * Pure apply helper: convert result series + plot_meta + times into chart payloads.
 */
export function buildPlotVisuals(
  series: SeriesMap | undefined | null,
  plotMeta: Record<string, PlotMetaEntry> | undefined | null,
  times: number[],
  palette: string[] = ['#939fff', '#8ef5a8', '#e8a03a'],
): {
  lines: LineOverlaySpec[];
  bgcolors: BgcolorBandSpec[];
  shapes: ShapeMarkerSpec[];
  fills: PlotFillBandSpec[];
  ohlc: OhlcOverlaySpec[];
} {
  const split = splitSeriesByKind(series, plotMeta);
  const lines: LineOverlaySpec[] = [];
  let colorIdx = 0;
  for (const { key, values, meta } of split.lines) {
    const data = lineSeriesToOverlayData(times, values);
    // Skip series with no real samples (pure whitespace / empty)
    if (!data.some((d) => d.value != null && Number.isFinite(d.value))) continue;
    const color =
      (meta.color && isActiveColor(meta.color) ? meta.color : null) ||
      palette[colorIdx % palette.length];
    colorIdx += 1;
    lines.push({
      name: key,
      data,
      color,
      kind: normalizePlotKind(meta.kind),
      style: meta.style ?? null,
      linewidth: meta.linewidth,
      linestyle: meta.linestyle ?? null,
    });
  }

  const bgcolors: BgcolorBandSpec[] = [];
  for (const { key, values, meta } of split.bgcolors) {
    const data = bgcolorSeriesToHistogramData(times, values, meta.color);
    if (!data.length) continue;
    bgcolors.push({ name: key, data, title: meta.title || key });
  }

  const shapes: ShapeMarkerSpec[] = [];
  for (const { key, values, meta } of split.shapes) {
    shapes.push(
      ...shapeSeriesToMarkers(times, values, meta, { idPrefix: key }),
    );
  }
  // Stable sort for LWC
  shapes.sort((a, b) => a.time - b.time || (a.id || '').localeCompare(b.id || ''));

  const fills = resolvePlotFillBands(series, plotMeta);

  const ohlc: OhlcOverlaySpec[] = [];
  for (const { key, values, meta } of split.ohlc) {
    const data = ohlcSeriesToBarData(times, values, series, meta);
    if (!data.length) continue;
    const color =
      (meta.color && isActiveColor(meta.color) ? meta.color : null) ||
      palette[colorIdx % palette.length];
    colorIdx += 1;
    const kind: 'plotbar' | 'plotcandle' =
      normalizePlotKind(meta.kind) === 'plotcandle' ? 'plotcandle' : 'plotbar';
    ohlc.push({ name: key, kind, data, color });
  }

  return { lines, bgcolors, shapes, fills, ohlc };
}
