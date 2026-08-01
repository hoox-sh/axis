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
 * Fixed-range / session **volume profile** from OHLCV bars (no tick data).
 *
 * ## Approximation (no fake precision)
 *
 * True volume-at-price needs tick or footprint data. With only OHLCV we
 * **estimate** where volume traded inside each bar:
 *
 * - **`uniform`**: bar volume is spread evenly across the price range
 *   `[low, high]` (proportional to bin overlap length).
 * - **`close`**: all of the bar’s volume is attributed to the bin that
 *   contains `close` (close-weighted; ignores path inside the bar).
 *
 * Zero-range bars (`high === low`) always put volume in the single bin that
 * covers that price. Missing / non-finite `volume` is treated as **0**.
 *
 * Value area is the classic ~70% expansion around POC (add the richer
 * adjacent side each step). On volume ties for POC, the bin nearest the
 * session mid-price wins; on equal adjacent volumes when expanding VA,
 * prefer the upper side.
 *
 * @module chart/volume-profile
 */

import { createSignal } from 'solid-js';

/** Minimal OHLCV fields required for profile math. */
export interface VpBar {
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type VolumeDistribution = 'uniform' | 'close';

export interface VolumeProfileBin {
  priceLow: number;
  priceHigh: number;
  volume: number;
}

export interface VolumeProfileResult {
  bins: VolumeProfileBin[];
  /** Mid-price of the POC bin, or `null` when empty / no volume. */
  poc: number | null;
  /** Upper edge of value area, or `null` when empty. */
  vaHigh: number | null;
  /** Lower edge of value area, or `null` when empty. */
  vaLow: number | null;
  /** Index of the POC bin in `bins` (−1 if none). */
  pocIndex: number;
  /** Sum of bin volumes. */
  totalVolume: number;
  /** Inclusive bar index range used (after clamp). */
  fromIndex: number;
  toIndex: number;
  rows: number;
  mode: VolumeDistribution;
  valueAreaPct: number;
}

export interface VolumeProfileOptions {
  /** Inclusive start index into `bars` (default 0). */
  fromIndex?: number;
  /** Inclusive end index into `bars` (default last bar). */
  toIndex?: number;
  /** Number of price bins / rows (default {@link DEFAULT_VP_ROWS}). */
  rows?: number;
  /** Volume attribution mode (default `uniform`). */
  mode?: VolumeDistribution;
  /**
   * Fraction of total volume that defines the value area (default
   * {@link DEFAULT_VALUE_AREA_PCT} = 0.7). Clamped to (0, 1].
   */
  valueAreaPct?: number;
}

/** Default histogram row count. */
export const DEFAULT_VP_ROWS = 24;
/** Classic value-area share of total volume. */
export const DEFAULT_VALUE_AREA_PCT = 0.7;

/** UI toggle — module signal so LayerPanel / overlay share state without store churn. */
const [volumeProfileEnabled, setVolumeProfileEnabled] = createSignal(false);

export { volumeProfileEnabled, setVolumeProfileEnabled };

export function toggleVolumeProfileEnabled(): boolean {
  const next = !volumeProfileEnabled();
  setVolumeProfileEnabled(next);
  return next;
}

function emptyResult(
  rows: number,
  mode: VolumeDistribution,
  valueAreaPct: number,
  fromIndex: number,
  toIndex: number,
): VolumeProfileResult {
  return {
    bins: [],
    poc: null,
    vaHigh: null,
    vaLow: null,
    pocIndex: -1,
    totalVolume: 0,
    fromIndex,
    toIndex,
    rows,
    mode,
    valueAreaPct,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * Compute fixed-range volume profile for `bars[fromIndex…toIndex]`.
 *
 * Pure function — no DOM / store. Safe for unit tests and workers.
 */
export function computeVolumeProfile(
  bars: readonly VpBar[],
  opts: VolumeProfileOptions = {},
): VolumeProfileResult {
  const rowsRaw = opts.rows ?? DEFAULT_VP_ROWS;
  const rows = Math.max(1, Math.min(512, Math.floor(Number(rowsRaw)) || DEFAULT_VP_ROWS));
  const mode: VolumeDistribution = opts.mode === 'close' ? 'close' : 'uniform';
  let valueAreaPct = opts.valueAreaPct ?? DEFAULT_VALUE_AREA_PCT;
  if (!Number.isFinite(valueAreaPct) || valueAreaPct <= 0) valueAreaPct = DEFAULT_VALUE_AREA_PCT;
  if (valueAreaPct > 1) valueAreaPct = 1;

  if (!bars.length) {
    return emptyResult(rows, mode, valueAreaPct, 0, -1);
  }

  const last = bars.length - 1;
  const fromIndex = clampInt(opts.fromIndex ?? 0, 0, last);
  const toIndex = clampInt(opts.toIndex ?? last, fromIndex, last);

  let priceMin = Infinity;
  let priceMax = -Infinity;
  let any = false;
  for (let i = fromIndex; i <= toIndex; i++) {
    const b = bars[i]!;
    const lo = Number(b.low);
    const hi = Number(b.high);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const a = Math.min(lo, hi);
    const c = Math.max(lo, hi);
    if (a < priceMin) priceMin = a;
    if (c > priceMax) priceMax = c;
    any = true;
  }

  if (!any || !Number.isFinite(priceMin) || !Number.isFinite(priceMax)) {
    return emptyResult(rows, mode, valueAreaPct, fromIndex, toIndex);
  }

  // Flat session: single-price collapse into one effective span so bins still form.
  if (priceMax <= priceMin) {
    const eps = Math.max(Math.abs(priceMin) * 1e-8, 1e-8);
    priceMin -= eps;
    priceMax += eps;
  }

  const span = priceMax - priceMin;
  const binH = span / rows;
  const volumes = new Float64Array(rows);

  for (let i = fromIndex; i <= toIndex; i++) {
    const b = bars[i]!;
    const vol = Number(b.volume);
    if (!Number.isFinite(vol) || vol <= 0) continue;

    const lo = Number(b.low);
    const hi = Number(b.high);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const barLow = Math.min(lo, hi);
    const barHigh = Math.max(lo, hi);
    const close = Number(b.close);
    const closePx = Number.isFinite(close) ? close : (barLow + barHigh) / 2;

    if (mode === 'close') {
      const idx = priceToBinIndex(closePx, priceMin, binH, rows);
      volumes[idx]! += vol;
      continue;
    }

    // uniform: distribute by overlap length within [barLow, barHigh]
    const range = barHigh - barLow;
    if (range <= 0) {
      const idx = priceToBinIndex(barLow, priceMin, binH, rows);
      volumes[idx]! += vol;
      continue;
    }

    // Bin indices that can intersect the bar
    const i0 = priceToBinIndex(barLow, priceMin, binH, rows);
    const i1 = priceToBinIndex(barHigh, priceMin, binH, rows);
    for (let bi = i0; bi <= i1; bi++) {
      const edgeLo = priceMin + bi * binH;
      const edgeHi = priceMin + (bi + 1) * binH;
      const overlap = Math.min(barHigh, edgeHi) - Math.max(barLow, edgeLo);
      if (overlap > 0) {
        volumes[bi]! += vol * (overlap / range);
      }
    }
  }

  const bins: VolumeProfileBin[] = [];
  let totalVolume = 0;
  for (let bi = 0; bi < rows; bi++) {
    const priceLow = priceMin + bi * binH;
    const priceHigh = priceMin + (bi + 1) * binH;
    const volume = volumes[bi]!;
    totalVolume += volume;
    bins.push({ priceLow, priceHigh, volume });
  }

  if (totalVolume <= 0) {
    return {
      bins,
      poc: null,
      vaHigh: null,
      vaLow: null,
      pocIndex: -1,
      totalVolume: 0,
      fromIndex,
      toIndex,
      rows,
      mode,
      valueAreaPct,
    };
  }

  // POC: max volume; ties → nearest session mid-price
  const mid = (priceMin + priceMax) / 2;
  let pocIndex = 0;
  let bestVol = -1;
  let bestDist = Infinity;
  for (let bi = 0; bi < rows; bi++) {
    const v = volumes[bi]!;
    const binMid = (bins[bi]!.priceLow + bins[bi]!.priceHigh) / 2;
    const dist = Math.abs(binMid - mid);
    if (v > bestVol || (v === bestVol && dist < bestDist)) {
      bestVol = v;
      bestDist = dist;
      pocIndex = bi;
    }
  }

  const { vaLowIdx, vaHighIdx } = expandValueArea(volumes, pocIndex, totalVolume * valueAreaPct);

  const pocBin = bins[pocIndex]!;
  return {
    bins,
    poc: (pocBin.priceLow + pocBin.priceHigh) / 2,
    vaHigh: bins[vaHighIdx]!.priceHigh,
    vaLow: bins[vaLowIdx]!.priceLow,
    pocIndex,
    totalVolume,
    fromIndex,
    toIndex,
    rows,
    mode,
    valueAreaPct,
  };
}

/** Map a price to a bin index in `[0, rows)`. */
export function priceToBinIndex(
  price: number,
  priceMin: number,
  binH: number,
  rows: number,
): number {
  if (!(binH > 0) || rows <= 1) return 0;
  // Use half-open [low, high) except the top bin which includes priceMax
  let idx = Math.floor((price - priceMin) / binH);
  if (idx < 0) idx = 0;
  if (idx >= rows) idx = rows - 1;
  return idx;
}

/**
 * Expand value area from POC until cumulative volume ≥ `target`.
 * At each step add the adjacent side with higher volume; ties prefer up.
 */
export function expandValueArea(
  volumes: ArrayLike<number>,
  pocIndex: number,
  target: number,
): { vaLowIdx: number; vaHighIdx: number } {
  const n = volumes.length;
  if (n === 0) return { vaLowIdx: 0, vaHighIdx: 0 };
  let lo = Math.max(0, Math.min(n - 1, pocIndex));
  let hi = lo;
  let acc = Number(volumes[lo]) || 0;
  const tgt = Math.max(0, target);

  while (acc < tgt && (lo > 0 || hi < n - 1)) {
    const upVol = hi < n - 1 ? Number(volumes[hi + 1]) || 0 : -1;
    const downVol = lo > 0 ? Number(volumes[lo - 1]) || 0 : -1;

    if (upVol < 0 && downVol < 0) break;
    if (downVol < 0 || (upVol >= 0 && upVol >= downVol)) {
      hi += 1;
      acc += upVol;
    } else {
      lo -= 1;
      acc += downVol;
    }
  }

  return { vaLowIdx: lo, vaHighIdx: hi };
}

/** Format a compact volume number for HUD labels. */
export function formatVpVolume(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(2);
}

/** Format a price for profile labels (adaptive decimals). */
export function formatVpPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  const a = Math.abs(p);
  if (a >= 1000) return p.toFixed(1);
  if (a >= 1) return p.toFixed(2);
  if (a >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
}
