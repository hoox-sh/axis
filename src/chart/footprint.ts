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
 * Footprint bar model + OHLCV approximation + compact delta packing (A1.3).
 *
 * Shape mirrors PYNE / Pine v6 `request.footprint` (`VolumeRow` / `Footprint`).
 * True institutional footprints need tick or exchange footprint feeds — until
 * that provider exists, {@link approximateFootprintFromOhlcv} is an honest
 * estimate (volume triangle-weighted toward the print, buy/sell split from the
 * close's position inside the bar's range), never presented as tick-accurate.
 *
 * {@link numTicksForPixelHeight} sizes rows to the candle's on-screen height so
 * cells stay inside the bar; {@link footprintPaintCells} is the pure geometry
 * the overlay renders.
 *
 * Overlay toggle: {@link footprintEnabled} (Layers panel + FootprintOverlay).
 *
 * @module chart/footprint
 */

import { createSignal } from 'solid-js';

/** UI toggle — shared by Layers panel and FootprintOverlay. */
const [footprintEnabled, setFootprintEnabled] = createSignal(false);

export { footprintEnabled, setFootprintEnabled };

export function toggleFootprintEnabled(): boolean {
  const next = !footprintEnabled();
  setFootprintEnabled(next);
  return next;
}

/** One price level inside a footprint bar (Pine v6 VolumeRow). */
export interface FootprintRow {
  upPrice: number;
  downPrice: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  isImbalance: boolean;
  isPoc: boolean;
  isVah: boolean;
  isVal: boolean;
}

/** Footprint for one candle (Pine v6 Footprint). */
export interface FootprintBar {
  time: number;
  numTicks: number;
  vaPercentage: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  totalVolume: number;
  rows: FootprintRow[];
  /** Mid of POC row, or null. */
  poc: number | null;
  /** Upper edge of value area, or null. */
  vaHigh: number | null;
  /** Lower edge of value area, or null. */
  vaLow: number | null;
  /** `approx` = OHLCV estimate; `feed` = real footprint/tick provider. */
  source: 'approx' | 'feed';
}

export interface FootprintApproxOpts {
  /** Target row count (clamped 4–256). Default 24. */
  numTicks?: number;
  /** Value-area percent (default 70). */
  vaPercentage?: number;
  /** Imbalance when |buy-sell| / max(buy,sell) ≥ this (default 0.6). */
  imbalanceRatio?: number;
}

type Ohlcv = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

/**
 * Build a footprint estimate from one OHLCV bar.
 *
 * Volume is split across `[low, high]` by a triangle weight around `close`
 * (the print), then the **buy/sell split** follows where the candle closed
 * inside its range plus a small direction nudge — a close near the high reads
 * as buying, a close near the low as selling, regardless of candle colour.
 * This is an OHLCV estimate, not tick data: `source` stays `'approx'`.
 */
export function approximateFootprintFromOhlcv(
  bar: Ohlcv,
  opts?: FootprintApproxOpts,
): FootprintBar | null {
  if (!bar || !Number.isFinite(bar.time)) return null;
  const high = Number(bar.high);
  const low = Number(bar.low);
  const open = Number(bar.open);
  const close = Number(bar.close);
  if (![high, low, open, close].every(Number.isFinite)) return null;
  if (!(high >= low)) return null;

  const vol = Number.isFinite(bar.volume) ? Math.max(0, Number(bar.volume)) : 0;
  const numTicks = clampInt(opts?.numTicks ?? 24, 4, 256);
  const vaPercentage = clampInt(opts?.vaPercentage ?? 70, 1, 100);
  const imbalanceRatio = Number.isFinite(opts?.imbalanceRatio)
    ? Math.max(0, Math.min(1, Number(opts?.imbalanceRatio)))
    : 0.6;

  const range = high - low;
  const step = range > 0 ? range / numTicks : Math.max(Math.abs(close) * 1e-6, 1e-8);
  // Where the candle closed inside its own range (0 = low, 1 = high).
  const closePos = range > 0 ? Math.min(1, Math.max(0, (close - low) / range)) : 0.5;
  const dirNudge = close >= open ? 0.06 : -0.06;
  const buyShare = Math.min(0.85, Math.max(0.15, 0.5 + (closePos - 0.5) * 0.7 + dirNudge));

  // 1) Triangle weight toward the print, normalized once over the whole bar.
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < numTicks; i++) {
    const downPrice = low + i * step;
    const upPrice = i === numTicks - 1 ? high : low + (i + 1) * step;
    const mid = (downPrice + upPrice) / 2;
    const dist = range > 0 ? Math.abs(mid - close) / range : 0;
    const weight = Math.max(0.05, 1 - dist);
    weights.push(weight);
    weightSum += weight;
  }
  const scale = weightSum > 0 ? vol / weightSum : 0;

  const rows: FootprintRow[] = [];
  for (let i = 0; i < numTicks; i++) {
    const downPrice = low + i * step;
    const upPrice = i === numTicks - 1 ? high : low + (i + 1) * step;
    const slice = (weights[i] ?? 0) * scale;
    const buyVolume = slice * buyShare;
    const sellVolume = slice * (1 - buyShare);
    const delta = buyVolume - sellVolume;
    const peak = Math.max(buyVolume, sellVolume);
    rows.push({
      upPrice,
      downPrice,
      buyVolume,
      sellVolume,
      delta,
      isImbalance: peak > 0 && Math.abs(delta) / peak >= imbalanceRatio,
      isPoc: false,
      isVah: false,
      isVal: false,
    });
  }

  // 2) POC = heaviest row; ties resolve to the row nearest the print (close).
  let pocIndex = 0;
  let pocVol = -1;
  const rowMid = (i: number): number => {
    const r = rows[i];
    return r ? (r.upPrice + r.downPrice) / 2 : close;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const total = r.buyVolume + r.sellVolume;
    if (total > pocVol + 1e-12) {
      pocVol = total;
      pocIndex = i;
    } else if (Math.abs(total - pocVol) <= 1e-12) {
      if (Math.abs(rowMid(i) - close) < Math.abs(rowMid(pocIndex) - close)) pocIndex = i;
    }
  }
  if (rows[pocIndex]) rows[pocIndex]!.isPoc = true;

  // 3) Value area ~vaPercentage around POC (classic adjacent expansion; ties
  //    prefer the upper side, matching the volume-profile implementation).
  const target = (vol * vaPercentage) / 100;
  let lo = pocIndex;
  let hi = pocIndex;
  let covered = pocVol > 0 ? pocVol : 0;
  while (covered < target && (lo > 0 || hi < rows.length - 1)) {
    const upVol = hi < rows.length - 1 ? rows[hi + 1]!.buyVolume + rows[hi + 1]!.sellVolume : -1;
    const dnVol = lo > 0 ? rows[lo - 1]!.buyVolume + rows[lo - 1]!.sellVolume : -1;
    if (upVol >= dnVol && hi < rows.length - 1) {
      hi += 1;
      covered += upVol;
    } else if (lo > 0) {
      lo -= 1;
      covered += dnVol;
    } else if (hi < rows.length - 1) {
      hi += 1;
      covered += upVol;
    } else break;
  }
  if (rows[hi]) rows[hi]!.isVah = true;
  if (rows[lo]) rows[lo]!.isVal = true;

  const buyVolume = rows.reduce((s, r) => s + r.buyVolume, 0);
  const sellVolume = rows.reduce((s, r) => s + r.sellVolume, 0);
  const pocRow = rows[pocIndex];
  const vahRow = rows[hi];
  const valRow = rows[lo];

  return {
    time: bar.time,
    numTicks,
    vaPercentage,
    buyVolume,
    sellVolume,
    delta: buyVolume - sellVolume,
    totalVolume: buyVolume + sellVolume,
    rows,
    poc: pocRow ? (pocRow.upPrice + pocRow.downPrice) / 2 : null,
    vaHigh: vahRow ? vahRow.upPrice : null,
    vaLow: valRow ? valRow.downPrice : null,
    source: 'approx',
  };
}

/**
 * Cache key for one painted footprint bar.
 *
 * The key must cover everything that changes the cells, not just geometry:
 * the buy/sell split follows where the candle closed inside its range and
 * the row volumes follow `volume`, so a forming bar whose volume grows
 * without a ≥1 px price move must still rebuild. Rounded pixel anchors keep
 * closed bars reusable across polls.
 */
export function footprintLayoutKey(
  bar: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  },
  geom: {
    numTicks: number;
    xCenter: number;
    barWidth: number;
    yHigh: number;
    yLow: number;
  },
): string {
  return [
    bar.time,
    geom.numTicks,
    Math.round(geom.xCenter),
    Math.round(geom.barWidth),
    Math.round(geom.yHigh),
    Math.round(geom.yLow),
    bar.open,
    bar.high,
    bar.low,
    bar.close,
    bar.volume ?? 0,
  ].join('|');
}

/** Float32 layout per row: down, up, buy, sell (4 floats). Flags in a parallel Uint8. */
const FLOATS_PER_ROW = 4;

/**
 * Pack footprint rows into a compact binary payload for delta transport tests.
 * Does not JSON-stringify row objects on the hot path.
 */
export function packFootprintRows(rows: readonly FootprintRow[]): {
  floats: Float32Array;
  flags: Uint8Array;
} {
  const floats = new Float32Array(rows.length * FLOATS_PER_ROW);
  const flags = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const o = i * FLOATS_PER_ROW;
    floats[o] = r.downPrice;
    floats[o + 1] = r.upPrice;
    floats[o + 2] = r.buyVolume;
    floats[o + 3] = r.sellVolume;
    flags[i] = (r.isImbalance ? 1 : 0) | (r.isPoc ? 2 : 0) | (r.isVah ? 4 : 0) | (r.isVal ? 8 : 0);
  }
  return { floats, flags };
}

/** Inverse of {@link packFootprintRows}. */
export function unpackFootprintRows(floats: Float32Array, flags: Uint8Array): FootprintRow[] {
  const n = Math.min(flags.length, Math.floor(floats.length / FLOATS_PER_ROW));
  const rows: FootprintRow[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * FLOATS_PER_ROW;
    const buy = floats[o + 2] ?? 0;
    const sell = floats[o + 3] ?? 0;
    const f = flags[i] ?? 0;
    rows.push({
      downPrice: floats[o] ?? 0,
      upPrice: floats[o + 1] ?? 0,
      buyVolume: buy,
      sellVolume: sell,
      delta: buy - sell,
      isImbalance: (f & 1) !== 0,
      isPoc: (f & 2) !== 0,
      isVah: (f & 4) !== 0,
      isVal: (f & 8) !== 0,
    });
  }
  return rows;
}

/**
 * Row count that fits a candle's on-screen pixel height.
 *
 * Painting a fixed 16 rows into a 6 px body forces every cell to a 1 px
 * minimum, so the footprint spills past the candle and over its neighbours.
 * One row per ~2 px keeps rows legible and inside the bar; the caller clamps
 * the result to its own budget (`opts.max`).
 */
export function numTicksForPixelHeight(
  pixelHeight: number,
  opts?: { min?: number; max?: number; pxPerRow?: number },
): number {
  const min = clampInt(opts?.min ?? 3, 1, 256);
  const max = Math.max(min, clampInt(opts?.max ?? 24, 1, 256));
  const pxPerRow = Number.isFinite(opts?.pxPerRow) ? Math.max(1, Number(opts?.pxPerRow)) : 2;
  if (!Number.isFinite(pixelHeight) || pixelHeight <= 0) return min;
  return clampInt(Math.round(pixelHeight / pxPerRow), min, max);
}

/**
 * Layout hints for a canvas painter (x = bar slot, y = price → pixel via caller).
 * Pure geometry — no DOM.
 *
 * `gap` leaves a hairline between adjacent price rows: without it a footprint
 * whose cells share a hue (buy cells over a green candle) reads as one solid
 * block instead of distinguishable rows.
 */
export function footprintPaintCells(
  fp: FootprintBar,
  opts: {
    barLeft: number;
    barWidth: number;
    priceToY: (price: number) => number;
    /** Vertical gap between rows in px (default 0.6, clamped 0–2). */
    gap?: number;
  },
): Array<{
  x: number;
  y: number;
  w: number;
  h: number;
  buy: number;
  sell: number;
  poc: boolean;
}> {
  const cells: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    buy: number;
    sell: number;
    poc: boolean;
  }> = [];
  const midX = opts.barLeft + opts.barWidth / 2;
  const half = Math.max(1, opts.barWidth / 2 - 1);
  const gap = Number.isFinite(opts.gap) ? Math.max(0, Math.min(2, Number(opts.gap))) : 0.6;
  for (const row of fp.rows) {
    const yTop = opts.priceToY(row.upPrice);
    const yBot = opts.priceToY(row.downPrice);
    const top = Math.min(yTop, yBot);
    const rawH = Math.abs(yBot - yTop);
    cells.push({
      x: midX - half,
      y: top + gap / 2,
      w: half * 2,
      h: Math.max(1, rawH - gap),
      buy: row.buyVolume,
      sell: row.sellVolume,
      poc: row.isPoc,
    });
  }
  return cells;
}
