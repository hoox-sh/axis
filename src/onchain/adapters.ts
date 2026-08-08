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
 * Pure adapters: on-chain datasets ↔ chart line / bar shapes.
 *
 * @module onchain/adapters
 */

import type { Bar } from '../store/types';
import type { OnchainDataset, TimePoint } from './types';

/** Lightweight Charts line point shape. */
export interface LineDataPoint {
  time: number;
  value: number;
}

/**
 * Convert {@link TimePoint}s to sorted finite `{time, value}` for line series.
 */
export function pointsToLineData(points: TimePoint[] | null | undefined): LineDataPoint[] {
  if (!Array.isArray(points) || !points.length) return [];
  const out: LineDataPoint[] = [];
  for (const p of points) {
    if (!p) continue;
    const time = Number(p.time);
    const value = Number(p.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    out.push({ time, value });
  }
  out.sort((a, b) => a.time - b.time);
  // Deduplicate times (last write wins)
  if (out.length < 2) return out;
  const deduped: LineDataPoint[] = [];
  for (const pt of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === pt.time) {
      last.value = pt.value;
    } else {
      deduped.push(pt);
    }
  }
  return deduped;
}

/**
 * Extract scalar time series from a dataset:
 * 1. `points`
 * 2. first series in `series`
 * 3. close of `bars`
 */
export function datasetToScalarPoints(ds: OnchainDataset | null | undefined): TimePoint[] {
  if (!ds) return [];
  if (Array.isArray(ds.points) && ds.points.length) {
    return ds.points
      .filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.value))
      .slice()
      .sort((a, b) => a.time - b.time);
  }
  if (ds.series && typeof ds.series === 'object') {
    const keys = Object.keys(ds.series);
    for (const k of keys) {
      const arr = ds.series[k];
      if (Array.isArray(arr) && arr.length) {
        return arr
          .filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.value))
          .slice()
          .sort((a, b) => a.time - b.time);
      }
    }
  }
  if (Array.isArray(ds.bars) && ds.bars.length) {
    const pts: TimePoint[] = [];
    for (const b of ds.bars) {
      if (!b || !Number.isFinite(b.time) || !Number.isFinite(b.close)) continue;
      pts.push({ time: b.time, value: b.close });
    }
    return pts.sort((a, b) => a.time - b.time);
  }
  return [];
}

/**
 * Return OHLCV bars from a dataset. If `kind === 'ohlcv'` and bars exist, copy them.
 * Otherwise synthesize flat OHLC from scalar points (marks mid as open/high/low/close).
 */
export function datasetToBars(ds: OnchainDataset | null | undefined): {
  bars: Bar[];
  synthetic: boolean;
} {
  if (!ds) return { bars: [], synthetic: false };

  if (ds.kind === 'ohlcv' && Array.isArray(ds.bars) && ds.bars.length) {
    const bars: Bar[] = [];
    for (const b of ds.bars) {
      if (!b || !Number.isFinite(b.time)) continue;
      const o = Number(b.open);
      const h = Number(b.high);
      const l = Number(b.low);
      const c = Number(b.close);
      if (![o, h, l, c].every(Number.isFinite)) continue;
      bars.push({
        time: b.time,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: Number.isFinite(b.volume as number) ? (b.volume as number) : undefined,
      });
    }
    bars.sort((a, b) => a.time - b.time);
    return { bars, synthetic: !!ds.synthetic };
  }

  const points = datasetToScalarPoints(ds);
  if (!points.length) return { bars: [], synthetic: false };

  const bars: Bar[] = points.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
  }));
  return { bars, synthetic: true };
}

/**
 * Normalize a protocol name/slug: lowercase, collapse whitespace to hyphens,
 * strip non-alphanumeric (except hyphens).
 */
export function normalizeProtocolSlug(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
