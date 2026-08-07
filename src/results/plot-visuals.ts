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
 * `plotarrow`). This module splits and converts those into line data, bgcolor
 * histograms, fill bands (plot1↔plot2), and shape markers for
 * {@link indicators/runner}.
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
  /** `fill(plot1, plot2, …)` — series title of first plot edge */
  plot1?: string | null;
  /** `fill(plot1, plot2, …)` — series title of second plot edge */
  plot2?: string | null;
}

export type SeriesMap = Record<string, unknown[] | (number | null)[]>;

export interface LineOverlaySpec {
  name: string;
  /** `value` omitted = LWC whitespace (keeps time-scale slot for multi-pane align) */
  data: { time: number; value?: number }[];
  color?: string;
  kind: 'plot' | 'hline' | string;
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

export function isFillKind(kind?: string | null): boolean {
  return normalizePlotKind(kind) === 'fill';
}

export function isShapeKind(kind?: string | null): boolean {
  const k = normalizePlotKind(kind);
  return k === 'plotshape' || k === 'plotchar' || k === 'plotarrow';
}

/** Split series map by plot_meta.kind (missing kind → line plot). */
export function splitSeriesByKind(
  series: SeriesMap | undefined | null,
  plotMeta: Record<string, PlotMetaEntry> | undefined | null,
): {
  lines: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  bgcolors: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  shapes: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
  fills: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }>;
} {
  const lines: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const bgcolors: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const shapes: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  const fills: Array<{ key: string; values: unknown[]; meta: PlotMetaEntry }> = [];
  if (!series) return { lines, bgcolors, shapes, fills };
  const meta = plotMeta || {};

  for (const [key, arr] of Object.entries(series)) {
    if (!key || key.startsWith('__') || key.startsWith('_')) continue;
    if (!Array.isArray(arr)) continue;
    const m = meta[key] || {};
    const kind = normalizePlotKind(m.kind);
    const entry = { key, values: arr as unknown[], meta: { ...m, kind } };
    if (isBgcolorKind(kind)) bgcolors.push(entry);
    else if (isShapeKind(kind)) shapes.push(entry);
    else if (isFillKind(kind)) fills.push(entry);
    else if (isLinePlotKind(kind)) lines.push(entry);
    // unknown kinds skipped (future plotbar/plotcandle/…)
  }
  return { lines, bgcolors, shapes, fills };
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

/** Map Pine shape.* style → LWC SeriesMarkerShape. */
export function mapShapeStyle(
  style?: string | null,
  kind?: string | null,
): 'arrowUp' | 'arrowDown' | 'circle' | 'square' {
  const k = normalizePlotKind(kind);
  if (k === 'plotarrow') return 'arrowUp';
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
  if (s.includes('square') || s.includes('diamond') || s.includes('flag')) return 'square';
  if (s.includes('circle') || s.includes('xcross') || s.includes('cross')) return 'circle';
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
  const shape = mapShapeStyle(meta.style, meta.kind);
  const position = mapShapeLocation(meta.location, meta.style);
  const text =
    (meta.text && String(meta.text)) ||
    (meta.char && String(meta.char)) ||
    (meta.title && String(meta.title)) ||
    '';
  const prefix = opts?.idPrefix || meta.title || 'shape';

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
    out.push({
      time: t,
      position,
      color: c,
      shape,
      text,
      id: `${prefix}_${i}`,
    });
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

  return { lines, bgcolors, shapes, fills };
}
