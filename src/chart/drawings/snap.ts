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
 * Magnet / snap-to-OHLC for AXIS interactive drawings.
 * Snaps a raw chart point to the nearest bar's OHLC (and optional HL2) levels.
 */

export type MagnetMode = 'off' | 'weak' | 'strong';

export interface BarLike {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type SnapTarget = 'open' | 'high' | 'low' | 'close' | 'hl2';

export interface SnapOptions {
  mode: MagnetMode;
  /** Pixel tolerance for weak mode (default 10). */
  pixelTol: number;
  targets?: SnapTarget[];
}

const DEFAULT_TARGETS: readonly SnapTarget[] = ['open', 'high', 'low', 'close'];
const DEFAULT_PIXEL_TOL = 10;

function targetPrice(bar: BarLike, target: SnapTarget): number {
  switch (target) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'close':
      return bar.close;
    case 'hl2':
      return (bar.high + bar.low) / 2;
  }
}

/** Nearest bar index by absolute time distance (bars assumed sorted ascending by time). */
export function findNearestBarIndex(bars: readonly BarLike[], time: number): number {
  const n = bars.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid]!.time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  // hi = last bar with time < target; lo = first bar with time > target
  if (hi < 0) return 0;
  if (lo >= n) return n - 1;
  const dHi = time - bars[hi]!.time;
  const dLo = bars[lo]!.time - time;
  return dHi <= dLo ? hi : lo;
}

export function snapToBars(opts: {
  bars: readonly BarLike[];
  raw: { time: number; price: number };
  rawXY: { x: number; y: number };
  priceToY: (price: number) => number | null;
  timeToX?: (time: number) => number | null;
  mode: MagnetMode;
  pixelTol?: number;
  targets?: SnapTarget[];
}): { time: number; price: number } {
  const { bars, raw, rawXY, priceToY, mode } = opts;

  if (mode === 'off' || bars.length === 0) {
    return { time: raw.time, price: raw.price };
  }

  const pixelTol = opts.pixelTol ?? DEFAULT_PIXEL_TOL;
  const targets = opts.targets?.length ? opts.targets : DEFAULT_TARGETS;
  const nearestIdx = findNearestBarIndex(bars, raw.time);
  if (nearestIdx < 0) {
    return { time: raw.time, price: raw.price };
  }

  // strong: nearest bar only; weak: nearest ± 1 neighbor
  const lo = mode === 'weak' ? Math.max(0, nearestIdx - 1) : nearestIdx;
  const hi = mode === 'weak' ? Math.min(bars.length - 1, nearestIdx + 1) : nearestIdx;

  let bestTime = bars[nearestIdx]!.time;
  let bestPrice = raw.price;
  let bestDist = Number.POSITIVE_INFINITY;
  let found = false;

  for (let i = lo; i <= hi; i++) {
    const bar = bars[i]!;
    for (const t of targets) {
      const p = targetPrice(bar, t);
      const y = priceToY(p);
      if (y == null || !Number.isFinite(y)) continue;
      const dist = Math.abs(y - rawXY.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestPrice = p;
        bestTime = bar.time;
        found = true;
      }
    }
  }

  if (!found) {
    return { time: raw.time, price: raw.price };
  }

  if (mode === 'weak' && bestDist > pixelTol) {
    return { time: raw.time, price: raw.price };
  }

  // strong always snaps; weak snaps when within pixelTol
  return { time: bestTime, price: bestPrice };
}
