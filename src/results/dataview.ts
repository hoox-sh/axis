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
 * **Data Window** row builder — OHLCV + plot series + user drawings at a
 * bar index / crosshair time.
 *
 * Pure helpers consumed by the Results / Data Window UI. Resolves the nearest
 * bar via {@link barIndexAtTime}, formats numbers and UTC timestamps, and
 * emits ordered {@link DataViewRow} groups (`ohlcv` | `series` | `drawings` | `meta`).
 *
 * @module results/dataview
 */

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
  group: 'ohlcv' | 'series' | 'drawings' | 'meta';
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

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '—';
  // ms vs sec
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch {
    return String(t);
  }
}

/** Resolve bar index from crosshair time (nearest). */
export function barIndexAtTime(bars: Bar[], time: number | null | undefined): number {
  if (!bars.length || time == null || !Number.isFinite(time)) return bars.length ? bars.length - 1 : -1;
  // exact
  const exact = bars.findIndex((b) => b.time === time);
  if (exact >= 0) return exact;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const d = Math.abs(bars[i]!.time - time);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface BuildDataViewOpts {
  bars: Bar[];
  /** Crosshair / selected bar time */
  time?: number | null;
  /** Explicit index (wins over time when set) */
  barIndex?: number | null;
  symbol?: string;
  interval?: string;
  series?: Record<string, (number | null | string | boolean)[] | unknown>;
  plotMeta?: Record<string, { title?: string; color?: string | null; kind?: string }>;
  /** User drawings (trendlines, hlines, fib, …) evaluated at crosshair time */
  drawings?: Drawing[] | null;
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

  // Two-point tools
  const p1 = d.p1;
  const p2 = d.p2;
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

function inferBarPeriod(bars: Bar[], idx: number): number {
  if (bars.length < 2) return 60;
  const i = Math.max(1, Math.min(idx, bars.length - 1));
  const d = Math.abs(bars[i]!.time - bars[i - 1]!.time);
  return d > 0 && Number.isFinite(d) ? d : 60;
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
  const evalTime =
    opts.time != null && Number.isFinite(opts.time) ? Number(opts.time) : bar.time;
  const barPeriod =
    opts.barPeriod != null && Number.isFinite(opts.barPeriod) && opts.barPeriod! > 0
      ? Number(opts.barPeriod)
      : inferBarPeriod(bars, idx);

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
    { key: 'close', label: 'Close', value: fmtNum(bar.close), group: 'ohlcv' },
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

  rows.push(
    ...buildDrawingDataViewRows(opts.drawings, evalTime, { barPeriod }),
  );

  return rows;
}
