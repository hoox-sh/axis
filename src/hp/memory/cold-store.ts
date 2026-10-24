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
  /**
   * Absolute bar index of `time[0]`. Reads are absolute (`read(fromAbs)`),
   * so every mutation that drops the head must shift this — a silent shift
   * would paint cold bars at the wrong chart slots.
   */
  private baseAbs = 0;
  /**
   * False once the head was evicted or the tail extended past a gap: cold
   * no longer covers `[0, length)` absolutely and the page merge must not
   * fill from it. Restored only by a full-history replace.
   */
  private complete = true;

  constructor(opts: { priceScale?: number; max?: number } = {}) {
    this.priceScale = opts.priceScale ?? PRICE_SCALE_DEFAULT;
    this.max = opts.max ?? BARS_CACHE_MAX;
  }

  get length(): number {
    return this.time.length;
  }

  /** Absolute index of the oldest retained bar + retained length + absoluteness. */
  coverage(): { baseAbs: number; length: number; complete: boolean } {
    return { baseAbs: this.baseAbs, length: this.time.length, complete: this.complete };
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
    this.baseAbs = deduped.length - capped.length;
    this.complete = capped.length === deduped.length;
  }

  /**
   * Write-back of one closed bar (bar-close write-back, hp2 B1).
   *
   * Appends only when strictly newer than the tail — a forming re-tick or a
   * stale redelivery shares the tail time (or older) and must never fork
   * cold history. Returns false when ignored. Evicting the head breaks
   * absolute coverage (`complete` flips, `baseAbs` shifts); that only
   * happens past `max`, which the history cap already bounds.
   */
  appendTick(bar: HotBarTicks): boolean {
    if (!Number.isFinite(bar.time)) return false;
    const last = this.time.length ? (this.time[this.time.length - 1] ?? 0) : -Infinity;
    if (bar.time <= last) return false;
    this.time.push(Math.trunc(bar.time));
    this.openT.push(bar.openTicks);
    this.highT.push(bar.highTicks);
    this.lowT.push(bar.lowTicks);
    this.closeT.push(bar.closeTicks);
    this.vol.push(bar.volume);
    this.flags.push(bar.flags & 0xff);
    if (this.time.length > this.max) {
      this.time.shift();
      this.openT.shift();
      this.highT.shift();
      this.lowT.shift();
      this.closeT.shift();
      this.vol.shift();
      this.flags.shift();
      this.baseAbs += 1;
      this.complete = false;
    }
    return true;
  }

  /**
   * Merge a tick run into cold history by bar time (snapshot / page slices).
   *
   * Same-time bars overwrite (a corrected history bar), newer bars append,
   * older bars prepend (a snapshot deeper than cold shifts the absolute
   * base down). Unsorted input is sorted first; non-finite times are
   * dropped. Returns how many slots changed.
   */
  upsertByTime(bars: readonly HotBarTicks[]): number {
    const clean = bars.filter((b) => Number.isFinite(b.time));
    if (!clean.length) return 0;
    if (!this.time.length) {
      this.setTicks(clean);
      return clean.length;
    }
    const sorted = [...clean].sort((a, b) => a.time - b.time);
    let changed = 0;
    // Older run first: prepend, shifting the absolute base down.
    const head = this.time[0] ?? 0;
    const older = sorted.filter((b) => b.time < head);
    if (older.length) {
      const deduped: HotBarTicks[] = [];
      for (const b of older) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.time === b.time) deduped[deduped.length - 1] = b;
        else deduped.push(b);
      }
      this.time.unshift(...deduped.map((b) => Math.trunc(b.time)));
      this.openT.unshift(...deduped.map((b) => b.openTicks));
      this.highT.unshift(...deduped.map((b) => b.highTicks));
      this.lowT.unshift(...deduped.map((b) => b.lowTicks));
      this.closeT.unshift(...deduped.map((b) => b.closeTicks));
      this.vol.unshift(...deduped.map((b) => b.volume));
      this.flags.unshift(...deduped.map((b) => b.flags & 0xff));
      this.baseAbs -= deduped.length;
      changed += deduped.length;
    }
    for (const b of sorted) {
      if (b.time < head) continue;
      const idx = this.indexOfTime(b.time);
      if (idx >= 0) {
        this.openT[idx] = b.openTicks;
        this.highT[idx] = b.highTicks;
        this.lowT[idx] = b.lowTicks;
        this.closeT[idx] = b.closeTicks;
        this.vol[idx] = b.volume;
        this.flags[idx] = b.flags & 0xff;
        changed += 1;
      } else if (!this.appendTick(b)) {
        // Older than the tail but no exact slot (a hole): absolute
        // coverage no longer holds — stop trusting positions.
        this.complete = false;
      } else {
        changed += 1;
      }
    }
    return changed;
  }

  /** Columnar copy of the whole store (hydrate handoff, tests). */
  toTicks(): HotBarTicks[] {
    const out: HotBarTicks[] = [];
    for (let i = 0; i < this.time.length; i++) {
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

  /** Binary search for an exact bar time; -1 when absent. */
  private indexOfTime(time: number): number {
    let lo = 0;
    let hi = this.time.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = this.time[mid] ?? 0;
      if (t === time) return mid;
      if (t < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
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
    const want = Math.trunc(fromAbs);
    // A range starting before the retained head is not covered — clamping
    // to zero would return the wrong bars at the wrong slots.
    if (!Number.isFinite(want) || want < this.baseAbs) return { from: 0, to: 0 };
    const from = want - this.baseAbs;
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
