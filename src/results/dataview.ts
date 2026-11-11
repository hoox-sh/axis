// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Data Window** row builder — OHLCV + plot series + user drawings +
 * attached on-chain series at a bar index / crosshair time.
 *
 * Pure helpers consumed by the Results / Data Window UI. Resolves the nearest
 * bar via {@link barIndexAtTime}, formats numbers and UTC timestamps, and
 * emits ordered {@link DataViewRow} groups
 * (`ohlcv` | `series` | `drawings` | `onchain` | `meta`).
 *
 * @module results/dataview
 */

import { barIndexAtTimeBinary } from '../chart/heavy-data';
import { PLOT_DISPLAY, plotDisplayHas } from './plot-visuals';
import {
  rejoinSeriesByTime,
  type IndicatorSeriesCache,
} from './plot-sources';

import type { Bar } from '../store/types';
import {
  FIB_LEVELS,
  resolveDrawingStyle,
  toolLabel,
  type Drawing,
  type Point,
} from '../chart/drawing-types';

/** One labeled value row in the Data Window panel. */
export interface DataViewRow {
  key: string;
  label: string;
  value: string;
  color?: string;
  /** Close vs the previous bar. Omitted when it cannot be decided. */
  tone?: 'up' | 'down' | 'flat';
  group: 'ohlcv' | 'series' | 'drawings' | 'onchain' | 'meta';
}

/** Minimal time/value point (matches on-chain {@link TimePoint}). */
export interface DataViewTimePoint {
  time: number;
  value: number;
}

/**
 * Minimal on-chain attachment shape for Data Window rows.
 * Compatible with {@link OnchainSeriesRow} / {@link OnchainSeriesAttachment}.
 */
export interface DataViewOnchainSeries {
  id: string;
  label?: string;
  provider?: string;
  providerId?: string;
  visible?: boolean;
  color?: string;
  points?: DataViewTimePoint[] | null;
  finality?: string | null;
  /** Latest scalar (e.g. last TVL USD) when already computed. */
  lastTvl?: number | null;
  instrument?: { metric?: string; symbol?: string } | null;
  loading?: boolean;
  error?: string | null;
}

function fmtNum(v: unknown, digits = 4): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v || '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(digits);
  return n.toPrecision(4);
}

/** Compact USD (TVL-style): $1.23B / $4.5M / $12.3K / $42. */
export function fmtUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '—';
  // ms vs sec
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC');
  } catch {
    return String(t);
  }
}

/** Resolve bar index from crosshair time (nearest) — O(log n) binary search. */
export function barIndexAtTime(bars: Bar[], time: number | null | undefined): number {
  return barIndexAtTimeBinary(bars, time);
}

/** One plot's Data Window metadata (from `lastRun.meta.plot_meta`). */
export interface DataViewPlotMeta {
  title?: string;
  color?: string | null;
  kind?: string;
  display?: string | number | null;
}

/**
 * Plot meta with the panel's `display.*` overrides applied.
 *
 * Pure: returns a new map and never writes into the run payload (which is a
 * read-only Solid store proxy — assigning into it is a silent no-op). The
 * chart apply path uses the same precedence: panel override → script
 * declaration → `display.all`.
 */
export function mergePlotDisplayOverrides(
  plotMeta: Record<string, DataViewPlotMeta> | null | undefined,
  plots: Record<string, { display?: number | null } | undefined> | null | undefined,
): Record<string, DataViewPlotMeta> {
  const out: Record<string, DataViewPlotMeta> = { ...(plotMeta ?? {}) };
  if (!plots) return out;
  for (const [name, plot] of Object.entries(plots)) {
    if (plot?.display == null) continue;
    out[name] = { ...(out[name] ?? {}), display: plot.display };
  }
  return out;
}

/** One applied (or editor) script contributing series to the Data Window. */
export interface DataViewScriptRef {
  id: string;
  name?: string;
  visible?: boolean;
  plots?: Record<
    string,
    { display?: number | null; color?: string; visible?: boolean } | undefined
  >;
}

/**
 * Inputs for {@link collectDataViewSeries}: every visible applied script's
 * run payload + live series cache, joined onto the current chart bar axis.
 */
export interface CollectDataViewSeriesOpts {
  scripts: readonly DataViewScriptRef[];
  runResults?: Record<string, unknown> | null;
  indicatorSeries?: IndicatorSeriesCache | null;
  /** Current chart bar times (unix seconds) for time-join. */
  chartTimes: readonly number[];
  /**
   * Optional editor / focused run when no applied script owns those plots
   * (preview without Apply). Merged last so chart scripts win on key clashes.
   */
  fallbackRun?: {
    series?: Record<string, unknown> | null;
    plotMeta?: Record<string, DataViewPlotMeta> | null;
    times?: readonly number[] | null;
    plots?: Record<string, { display?: number | null } | undefined> | null;
    label?: string;
  } | null;
}

export interface CollectedDataViewSeries {
  series: Record<string, (number | null | string | boolean)[]>;
  plotMeta: Record<string, DataViewPlotMeta>;
}

function asSeriesBag(
  raw: unknown,
): Record<string, (number | null | string | boolean)[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, (number | null | string | boolean)[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    out[k] = v as (number | null | string | boolean)[];
  }
  return Object.keys(out).length ? out : null;
}

function asPlotMetaBag(raw: unknown): Record<string, DataViewPlotMeta> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, DataViewPlotMeta> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    out[k] = v as DataViewPlotMeta;
  }
  return out;
}

function runBarTimes(run: unknown): number[] | null {
  if (!run || typeof run !== 'object') return null;
  const times = (run as { bar_times?: unknown }).bar_times;
  if (!Array.isArray(times) || !times.length) return null;
  const out: number[] = [];
  for (const t of times) {
    const n = typeof t === 'number' ? t : Number(t);
    if (Number.isFinite(n)) out.push(n);
  }
  return out.length ? out : null;
}

function alignSeriesToChart(
  series: Record<string, (number | null | string | boolean)[]>,
  cachedTimes: readonly number[] | null | undefined,
  chartTimes: readonly number[],
): Record<string, (number | null | string | boolean)[]> {
  if (!cachedTimes?.length || !chartTimes.length) return series;
  const out: Record<string, (number | null | string | boolean)[]> = {};
  for (const [k, arr] of Object.entries(series)) {
    out[k] = rejoinSeriesByTime(arr, cachedTimes, chartTimes);
  }
  return out;
}

function mergeScriptSeriesInto(
  bag: CollectedDataViewSeries,
  opts: {
    scriptId: string;
    scriptName: string;
    series: Record<string, (number | null | string | boolean)[]>;
    plotMeta: Record<string, DataViewPlotMeta>;
    titles?: Record<string, string> | null;
  },
): void {
  for (const [plotKey, arr] of Object.entries(opts.series)) {
    if (plotKey.startsWith('_') || plotKey.startsWith('__')) continue;
    const meta = { ...(opts.plotMeta[plotKey] ?? {}) };
    const titled =
      (opts.titles?.[plotKey] && String(opts.titles[plotKey])) ||
      (meta.title != null ? String(meta.title) : '') ||
      plotKey;
    let key = plotKey;
    let label = titled;
    if (key in bag.series) {
      key = `${opts.scriptId}:${plotKey}`;
      label = `${opts.scriptName} · ${titled}`;
      // Disambiguate the first occupant when the second arrives.
      const prevMeta = bag.plotMeta[plotKey];
      if (prevMeta && !String(prevMeta.title || '').includes(' · ')) {
        const prevLabel = (prevMeta.title && String(prevMeta.title)) || plotKey;
        bag.plotMeta[plotKey] = {
          ...prevMeta,
          title: prevLabel,
        };
      }
    }
    bag.series[key] = arr;
    bag.plotMeta[key] = { ...meta, title: label };
  }
}

/**
 * Aggregate plot series for the Data Window from **all** visible applied
 * scripts (not only `lastRun`).
 *
 * Prefers {@link AppState.indicatorSeries} (kept fresh on live tip patches)
 * over `runResults[id].series`, then time-joins onto `chartTimes` so extended
 * / slid windows do not index-zip into the wrong bar.
 */
export function collectDataViewSeries(opts: CollectDataViewSeriesOpts): CollectedDataViewSeries {
  const bag: CollectedDataViewSeries = { series: {}, plotMeta: {} };
  const results = opts.runResults || {};
  const cache = opts.indicatorSeries || {};
  const chartTimes = opts.chartTimes || [];

  for (const script of opts.scripts) {
    if (!script?.id || script.visible === false) continue;
    const id = script.id;
    const run = results[id];
    const cached = cache[id];
    const fromCache = asSeriesBag(cached?.series);
    const fromRun = asSeriesBag(
      run && typeof run === 'object' ? (run as { series?: unknown }).series : null,
    );
    const seriesRaw = fromCache || fromRun;
    if (!seriesRaw) continue;

    const runMeta = asPlotMetaBag(
      run && typeof run === 'object'
        ? (run as { meta?: { plot_meta?: unknown } }).meta?.plot_meta
        : null,
    );
    const titles = cached?.titles || null;
    for (const [k, title] of Object.entries(titles || {})) {
      if (!runMeta[k]) runMeta[k] = { title };
      else if (runMeta[k]!.title == null) runMeta[k] = { ...runMeta[k]!, title };
    }
    // Card colors fill gaps when stream plot_meta omitted them (Donchian).
    for (const [k, plot] of Object.entries(script.plots || {})) {
      const color = plot && typeof plot === 'object' ? (plot as { color?: string }).color : undefined;
      if (color == null) continue;
      const prev = runMeta[k];
      if (prev?.color != null) continue;
      runMeta[k] = { ...(prev ?? {}), color };
    }
    const plotMeta = mergePlotDisplayOverrides(runMeta, script.plots);
    const cachedTimes = cached?.times?.length ? cached.times : runBarTimes(run);
    const aligned = alignSeriesToChart(seriesRaw, cachedTimes, chartTimes);
    mergeScriptSeriesInto(bag, {
      scriptId: id,
      scriptName: (script.name && String(script.name).trim()) || id,
      series: aligned,
      plotMeta,
      titles,
    });
  }

  const fb = opts.fallbackRun;
  if (fb?.series) {
    const seriesRaw = asSeriesBag(fb.series);
    if (seriesRaw) {
      const plotMeta = mergePlotDisplayOverrides(fb.plotMeta, fb.plots);
      const aligned = alignSeriesToChart(seriesRaw, fb.times, chartTimes);
      // Only fill keys the applied scripts did not already provide.
      for (const [k, arr] of Object.entries(aligned)) {
        if (k in bag.series) continue;
        if (k.startsWith('_') || k.startsWith('__')) continue;
        const meta = { ...(plotMeta[k] ?? {}) };
        const label =
          (meta.title != null ? String(meta.title) : '') ||
          (fb.label ? `${fb.label} · ${k}` : k);
        bag.series[k] = arr;
        bag.plotMeta[k] = { ...meta, title: label || k };
      }
    }
  }

  return bag;
}

/**
 * Inputs for {@link buildDataViewRows}: the bars and crosshair position to read,
 * plus the series, plot meta, drawings and on-chain attachments to show.
 */
export interface BuildDataViewOpts {
  bars: Bar[];
  /** Crosshair / selected bar time */
  time?: number | null;
  /** Explicit index (wins over time when set) */
  barIndex?: number | null;
  symbol?: string;
  interval?: string;
  series?: Record<string, (number | null | string | boolean)[] | unknown>;
  plotMeta?: Record<string, DataViewPlotMeta>;
  /** User drawings (trendlines, hlines, fib, …) evaluated at crosshair time */
  drawings?: Drawing[] | null;
  /**
   * Attached on-chain series (e.g. DefiLlama TVL). Only `visible !== false`
   * rows are emitted under group `onchain`.
   */
  onchainSeries?: DataViewOnchainSeries[] | null;
  /**
   * Bar period (seconds) for “near vline” tolerance. When omitted, inferred
   * from adjacent bars around the resolved index.
   */
  barPeriod?: number | null;
}

// ── Drawing values at crosshair ─────────────────────────────────────────────

/**
 * Linear price on the infinite line through `p1`→`p2` at `time`.
 * Returns null when endpoints share the same time (vertical segment).
 */
export function linePriceAtTime(p1: Point, p2: Point, time: number): number | null {
  if (!Number.isFinite(time) || !Number.isFinite(p1.time) || !Number.isFinite(p2.time)) {
    return null;
  }
  if (!Number.isFinite(p1.price) || !Number.isFinite(p2.price)) return null;
  const dt = p2.time - p1.time;
  if (dt === 0) {
    // Vertical segment — price only defined at that time
    return time === p1.time ? p1.price : null;
  }
  const f = (time - p1.time) / dt;
  return p1.price + f * (p2.price - p1.price);
}

/** Whether `time` lies on a trend segment, ray half-line, or extended line. */
export function isTimeOnLineKind(
  kind: Drawing['kind'],
  p1: Point,
  p2: Point,
  time: number,
): boolean {
  if (!Number.isFinite(time)) return false;
  const t0 = p1.time;
  const t1 = p2.time;
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  if (kind === 'extend') return true;
  if (kind === 'ray') {
    // Ray starts at p1 and goes through p2 (and beyond)
    if (t1 === t0) return time === t0;
    if (t1 > t0) return time >= t0;
    return time <= t0;
  }
  // trend / arrow / measure / fib / rect / ellipse: between endpoints
  return time >= lo && time <= hi;
}

function drawingLabel(d: Drawing, suffix = ''): string {
  const base = toolLabel(d.kind);
  const name = (d.text || d.meta?.text || '').trim();
  const head = name ? `${base} · ${name}` : base;
  return suffix ? `${head} ${suffix}` : head;
}

/**
 * Rows for one user drawing at `time` (may be empty when not active).
 * Fib emits one row per level; most tools emit a single price row.
 */
export function rowsForDrawingAtTime(
  d: Drawing,
  time: number,
  opts?: { barPeriod?: number },
): DataViewRow[] {
  if (!d?.id || !Number.isFinite(time)) return [];
  const color = resolveDrawingStyle(d).color;
  const out: DataViewRow[] = [];

  if (d.kind === 'hline') {
    out.push({
      key: `d_${d.id}`,
      label: drawingLabel(d),
      value: fmtNum(d.price),
      color,
      group: 'drawings',
    });
    return out;
  }

  if (d.kind === 'vline') {
    const period = opts?.barPeriod && opts.barPeriod > 0 ? opts.barPeriod : 1;
    const onBar = Math.abs(time - d.time) <= period * 0.51;
    out.push({
      key: `d_${d.id}`,
      label: drawingLabel(d),
      value: onBar ? '●' : fmtTime(d.time),
      color,
      group: 'drawings',
    });
    return out;
  }

  if (d.kind === 'text') {
    const period = opts?.barPeriod && opts.barPeriod > 0 ? opts.barPeriod : 1;
    const near = Math.abs(time - d.p1.time) <= period * 0.51;
    if (!near) return out;
    out.push({
      key: `d_${d.id}`,
      label: drawingLabel(d),
      value: `${fmtNum(d.p1.price)}${d.text ? ` · ${d.text}` : ''}`,
      color,
      group: 'drawings',
    });
    return out;
  }

  // Two-point / multi-point tools
  const p1 = 'p1' in d ? d.p1 : 'points' in d ? d.points?.[0] : undefined;
  const p2 = 'p2' in d ? d.p2 : 'points' in d ? d.points?.[1] : undefined;
  if (!p1 || !p2) return out;

  if (d.kind === 'rect' || d.kind === 'ellipse') {
    if (!isTimeOnLineKind('trend', p1, p2, time)) return out;
    const hi = Math.max(p1.price, p2.price);
    const lo = Math.min(p1.price, p2.price);
    out.push({
      key: `d_${d.id}`,
      label: drawingLabel(d),
      value: `${fmtNum(hi)} / ${fmtNum(lo)}`,
      color,
      group: 'drawings',
    });
    return out;
  }

  if (d.kind === 'fib') {
    if (!isTimeOnLineKind('trend', p1, p2, time)) return out;
    const hi = Math.max(p1.price, p2.price);
    const lo = Math.min(p1.price, p2.price);
    const span = hi - lo || 1;
    // Match paint: from high when p1 >= p2
    const fromHigh = p1.price >= p2.price;
    for (const lvl of FIB_LEVELS) {
      const price = fromHigh ? p1.price - span * lvl : p1.price + span * lvl;
      out.push({
        key: `d_${d.id}_f${lvl}`,
        label: drawingLabel(d, `${(lvl * 100).toFixed(1)}%`),
        value: fmtNum(price),
        color,
        group: 'drawings',
      });
    }
    return out;
  }

  // trend / ray / extend / arrow / measure
  if (!isTimeOnLineKind(d.kind, p1, p2, time)) return out;
  const price = linePriceAtTime(p1, p2, time);
  if (price == null || !Number.isFinite(price)) return out;

  let value = fmtNum(price);
  if (d.kind === 'measure') {
    const dPrice = p2.price - p1.price;
    const period =
      opts?.barPeriod && opts.barPeriod > 0 ? opts.barPeriod : Math.abs(p2.time - p1.time) || 1;
    const barsSpan = Math.round(Math.abs(p2.time - p1.time) / period) || 0;
    value = `${fmtNum(price)} · Δ${fmtNum(dPrice)} · ${barsSpan} bars`;
  }

  out.push({
    key: `d_${d.id}`,
    label: drawingLabel(d),
    value,
    color,
    group: 'drawings',
  });
  return out;
}

/** All drawing rows active at `time` (stable order: store order). */
export function buildDrawingDataViewRows(
  drawings: Drawing[] | null | undefined,
  time: number,
  opts?: { barPeriod?: number },
): DataViewRow[] {
  if (!drawings?.length || !Number.isFinite(time)) return [];
  const rows: DataViewRow[] = [];
  for (const d of drawings) {
    rows.push(...rowsForDrawingAtTime(d, time, opts));
  }
  return rows;
}

// ── On-chain series values ──────────────────────────────────────────────────

/**
 * Value of a scalar on-chain series at `time` (unix seconds).
 * Linear interpolation between surrounding points; nearest endpoint outside
 * the span; exact hit when times match.
 */
export function onchainValueAtTime(
  points: DataViewTimePoint[] | null | undefined,
  time: number,
): number | null {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(time)) return null;
  // Filter + sort (attachments are usually sorted; tolerate unsorted)
  const pts: DataViewTimePoint[] = [];
  for (const p of points) {
    if (!p) continue;
    const t = Number(p.time);
    const v = Number(p.value);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    pts.push({ time: t, value: v });
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a.time - b.time);

  if (time <= pts[0]!.time) return pts[0]!.value;
  if (time >= pts[pts.length - 1]!.time) return pts[pts.length - 1]!.value;

  // Binary search for right neighbor
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  if (a.time === time) return a.value;
  if (b.time === time) return b.value;
  const dt = b.time - a.time;
  if (dt === 0) return a.value;
  const f = (time - a.time) / dt;
  return a.value + f * (b.value - a.value);
}

function isTvlMetric(s: DataViewOnchainSeries): boolean {
  const m = (s.instrument?.metric || '').toLowerCase();
  if (m === 'tvl') return true;
  // DefiLlama TVL attachments are the primary product path
  const label = (s.label || s.instrument?.symbol || '').toLowerCase();
  return /\btvl\b/.test(label);
}

function lastOnchainValue(s: DataViewOnchainSeries): number | null {
  if (s.lastTvl != null && Number.isFinite(s.lastTvl)) return Number(s.lastTvl);
  const pts = s.points;
  if (!Array.isArray(pts) || !pts.length) return null;
  for (let i = pts.length - 1; i >= 0; i--) {
    const v = Number(pts[i]?.value);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function formatOnchainValue(s: DataViewOnchainSeries, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return isTvlMetric(s) ? fmtUsdCompact(v) : fmtNum(v);
}

/**
 * Rows for visible attached on-chain series.
 * Per series: value (at crosshair when possible), provider, last, points, finality.
 */
export function buildOnchainDataViewRows(
  series: DataViewOnchainSeries[] | null | undefined,
  time?: number | null,
): DataViewRow[] {
  if (!series?.length) return [];
  const evalTime = time != null && Number.isFinite(time) ? Number(time) : null;
  const rows: DataViewRow[] = [];

  for (const s of series) {
    if (!s?.id) continue;
    if (s.visible === false) continue;

    const label = (s.label || s.instrument?.symbol || s.id).trim() || s.id;
    const provider = (s.provider || s.providerId || '—').trim() || '—';
    const pts = Array.isArray(s.points) ? s.points : [];
    const pointCount = pts.length;
    const last = lastOnchainValue(s);
    const at = evalTime != null ? onchainValueAtTime(pts, evalTime) : null;
    const display = at != null ? at : last;
    const color = s.color || undefined;
    const finality = (s.finality && String(s.finality)) || 'unknown';

    let valueStr = formatOnchainValue(s, display);
    if (s.loading) valueStr = `${valueStr} · loading…`;
    else if (s.error) valueStr = `${valueStr} · error`;

    rows.push({
      key: `oc_${s.id}`,
      label,
      value: valueStr,
      color,
      group: 'onchain',
    });
    rows.push({
      key: `oc_${s.id}_provider`,
      label: `${label} · Provider`,
      value: provider,
      group: 'onchain',
    });
    // Always expose last so crosshair-at value is not confused with series tip
    rows.push({
      key: `oc_${s.id}_last`,
      label: `${label} · Last`,
      value: formatOnchainValue(s, last),
      group: 'onchain',
    });
    rows.push({
      key: `oc_${s.id}_points`,
      label: `${label} · Points`,
      value: String(pointCount),
      group: 'onchain',
    });
    rows.push({
      key: `oc_${s.id}_finality`,
      label: `${label} · Finality`,
      value: finality,
      group: 'onchain',
    });
  }

  return rows;
}

function inferBarPeriod(bars: Bar[], idx: number): number {
  if (bars.length < 2) return 60;
  const i = Math.max(1, Math.min(idx, bars.length - 1));
  const d = Math.abs(bars[i]!.time - bars[i - 1]!.time);
  return d > 0 && Number.isFinite(d) ? d : 60;
}

/** Up, down, or flat versus the previous close. Absent without a finite pair. */
function closeTone(bars: Bar[], idx: number, close: number): DataViewRow['tone'] {
  if (idx <= 0) return undefined;
  const prevClose = bars[idx - 1]?.close;
  if (typeof prevClose !== 'number') return undefined;
  if (!Number.isFinite(prevClose) || !Number.isFinite(close)) return undefined;
  if (close > prevClose) return 'up';
  if (close < prevClose) return 'down';
  return 'flat';
}

/**
 * Build ordered Data Window rows for the given bar.
 */
export function buildDataViewRows(opts: BuildDataViewOpts): DataViewRow[] {
  const bars = opts.bars || [];
  if (!bars.length) {
    return [{ key: 'empty', label: 'Bar', value: 'No data', group: 'meta' }];
  }

  let idx =
    opts.barIndex != null && Number.isFinite(opts.barIndex)
      ? Math.trunc(Number(opts.barIndex))
      : barIndexAtTime(bars, opts.time);
  if (idx < 0) idx = 0;
  if (idx >= bars.length) idx = bars.length - 1;
  const bar = bars[idx]!;
  // Prefer explicit crosshair time (may be future / off exact bar) for drawings
  const evalTime = opts.time != null && Number.isFinite(opts.time) ? Number(opts.time) : bar.time;
  const barPeriod =
    opts.barPeriod != null && Number.isFinite(opts.barPeriod) && opts.barPeriod! > 0
      ? Number(opts.barPeriod)
      : inferBarPeriod(bars, idx);

  const tone = closeTone(bars, idx, bar.close);
  const rows: DataViewRow[] = [
    {
      key: 'symbol',
      label: 'Symbol',
      value: opts.symbol || '—',
      group: 'meta',
    },
    {
      key: 'interval',
      label: 'Interval',
      value: opts.interval || '—',
      group: 'meta',
    },
    {
      key: 'time',
      label: 'Time',
      value: fmtTime(bar.time),
      group: 'meta',
    },
    {
      key: 'index',
      label: 'Bar #',
      value: String(idx),
      group: 'meta',
    },
    { key: 'open', label: 'Open', value: fmtNum(bar.open), group: 'ohlcv' },
    { key: 'high', label: 'High', value: fmtNum(bar.high), group: 'ohlcv' },
    { key: 'low', label: 'Low', value: fmtNum(bar.low), group: 'ohlcv' },
    {
      key: 'close',
      label: 'Close',
      value: fmtNum(bar.close),
      group: 'ohlcv',
      ...(tone ? { tone } : {}),
    },
    {
      key: 'volume',
      label: 'Volume',
      value: bar.volume != null ? fmtNum(bar.volume, 2) : '—',
      group: 'ohlcv',
    },
  ];

  const series = opts.series || {};
  const meta = opts.plotMeta || {};
  const keys = Object.keys(series).filter((k) => !k.startsWith('_') && !k.startsWith('__'));
  keys.sort((a, b) => {
    const ia = meta[a]?.kind === 'bgcolor' ? 1 : 0;
    const ib = meta[b]?.kind === 'bgcolor' ? 1 : 0;
    return ia - ib || a.localeCompare(b);
  });

  for (const k of keys) {
    const arr = series[k];
    if (!Array.isArray(arr)) continue;
    const raw = arr[idx];
    const m = meta[k];
    if (!plotDisplayHas(m?.display, PLOT_DISPLAY.data_window)) continue;
    const kind = m?.kind ? String(m.kind) : 'plot';
    let value: string;
    if (kind === 'bgcolor') {
      value = raw == null || raw === '' ? '—' : String(raw);
    } else if (typeof raw === 'boolean') {
      value = raw ? 'true' : 'false';
    } else {
      value = fmtNum(raw);
    }
    rows.push({
      key: `s_${k}`,
      label: (m?.title && String(m.title)) || k,
      value,
      color: m?.color ? String(m.color) : undefined,
      group: 'series',
    });
  }

  rows.push(...buildDrawingDataViewRows(opts.drawings, evalTime, { barPeriod }));

  rows.push(...buildOnchainDataViewRows(opts.onchainSeries, evalTime));

  return rows;
}
