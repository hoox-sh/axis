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
 * Worker-side cold history — columnar, plus the `bars-cache` IDB adapter
 * (HP PR 5, §9.1).
 *
 * The worker keeps the full series (up to `BARS_CACHE_MAX`) as columnar
 * **int64 ticks** — the same canonical form as the hot SAB — so filling the
 * page slot is a straight column copy, never a re-encode. Durable storage
 * stays the existing `bars-cache` (IndexedDB, memory-first):
 * `hydrateColdFromCache` pulls a cached series into the columnar store.
 *
 * Nothing here allocates shared memory. The cold store lives on the worker
 * heap, and only **one page** of it ever reaches the SAB (§9.2) — that is
 * why panning into history is O(HOT_CAP), not O(N).
 *
 * @module hp/memory/cold-store
 */

import type { Bar } from '../../store/types';
import { BARS_CACHE_MAX, type BarsKeyLock, getCachedBars } from '../../data/bars-cache';
import { PRICE_SCALE_DEFAULT } from '../axb1/constants';
import { ticksToPrice } from '../axb1/ticks';
import { barToTicks, BAR_FLAG_CLOSED, type HotBarTicks } from './hot-buffer';

export class ColdStore {
  readonly priceScale: number;
  readonly max: number;

  private time: number[] = [];
  private openT: bigint[] = [];
  private highT: bigint[] = [];
  private lowT: bigint[] = [];
  private closeT: bigint[] = [];
  private vol: number[] = [];
  private flags: number[] = [];

  constructor(opts: { priceScale?: number; max?: number } = {}) {
    this.priceScale = opts.priceScale ?? PRICE_SCALE_DEFAULT;
    this.max = opts.max ?? BARS_CACHE_MAX;
  }

  get length(): number {
    return this.time.length;
  }

  /** Replace the cold series from float64 bars (IDB / JSON path). */
  setBars(bars: readonly Bar[]): void {
    this.setTicks(bars.map((b) => barToTicks(b, this.priceScale)));
  }

  /**
   * Replace the cold series from canonical ticks (AXB1 ingest path).
   *
   * Sorted by time, deduped (last write wins for a repeated time — a
   * corrected history bar), newest-capped to `max`.
   */
  setTicks(bars: readonly HotBarTicks[]): void {
    const sorted = [...bars].sort((a, b) => a.time - b.time);
    const deduped: HotBarTicks[] = [];
    for (const b of sorted) {
      const last = deduped[deduped.length - 1];
      if (last && last.time === b.time) deduped[deduped.length - 1] = b;
      else deduped.push(b);
    }
    const capped = deduped.length > this.max ? deduped.slice(deduped.length - this.max) : deduped;

    const n = capped.length;
    this.time = new Array<number>(n);
    this.openT = new Array<bigint>(n);
    this.highT = new Array<bigint>(n);
    this.lowT = new Array<bigint>(n);
    this.closeT = new Array<bigint>(n);
    this.vol = new Array<number>(n);
    this.flags = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const b = capped[i];
      if (!b) continue;
      this.time[i] = b.time;
      this.openT[i] = b.openTicks;
      this.highT[i] = b.highTicks;
      this.lowT[i] = b.lowTicks;
      this.closeT[i] = b.closeTicks;
      this.vol[i] = b.volume;
      this.flags[i] = b.flags & 0xff;
    }
  }

  /** Columnar read of `[fromAbs, fromAbs + count)`, clipped; empty outside. */
  read(fromAbs: number, count: number): HotBarTicks[] {
    const { from, to } = this.clip(fromAbs, count);
    const out: HotBarTicks[] = [];
    for (let i = from; i < to; i++) {
      out.push({
        time: this.time[i] ?? 0,
        openTicks: this.openT[i] ?? 0n,
        highTicks: this.highT[i] ?? 0n,
        lowTicks: this.lowT[i] ?? 0n,
        closeTicks: this.closeT[i] ?? 0n,
        volume: this.vol[i] ?? 0,
        flags: this.flags[i] ?? BAR_FLAG_CLOSED,
      });
    }
    return out;
  }

  /** Float64 read (paint fallback / LWC) — clipped, empty outside. */
  readBars(fromAbs: number, count: number): Bar[] {
    const { from, to } = this.clip(fromAbs, count);
    const scale = this.priceScale;
    const out: Bar[] = [];
    for (let i = from; i < to; i++) {
      const flags = this.flags[i] ?? BAR_FLAG_CLOSED;
      out.push({
        time: this.time[i] ?? 0,
        open: ticksToPrice(this.openT[i] ?? 0n, scale),
        high: ticksToPrice(this.highT[i] ?? 0n, scale),
        low: ticksToPrice(this.lowT[i] ?? 0n, scale),
        close: ticksToPrice(this.closeT[i] ?? 0n, scale),
        volume: this.vol[i] ?? 0,
        closed: (flags & BAR_FLAG_CLOSED) !== 0,
      });
    }
    return out;
  }

  private clip(fromAbs: number, count: number): { from: number; to: number } {
    const from = Math.max(0, Math.trunc(fromAbs));
    const to = Math.min(this.time.length, from + Math.max(0, Math.trunc(count)));
    return { from, to: Math.max(from, to) };
  }
}

/**
 * IDB adapter: hydrate a cold store from `bars-cache`.
 *
 * `getCachedBars` is memory-first, so a warm series (active backfill /
 * recent put) returns without touching IndexedDB. Returns how many bars
 * were loaded (0 = nothing cached for that key).
 */
export async function hydrateColdFromCache(
  cold: ColdStore,
  sourceId: string,
  symbol: string,
  interval: string,
  opts?: BarsKeyLock,
): Promise<number> {
  const bars = await getCachedBars(sourceId, symbol, interval, opts);
  if (!bars.length) return 0;
  cold.setBars(bars);
  return bars.length;
}
