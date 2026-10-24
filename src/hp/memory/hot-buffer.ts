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
 * Hot double-buffer over one SharedArrayBuffer (HP PR 4, §6.2).
 *
 * Ownership: **ingest writes, everyone else reads**. Writers fill the slot
 * that is *not* published, then flip the generation to even (§6.1 seqlock);
 * readers — calc, render, and the main thread's rAF copy-out — sample only
 * even generations and discard a torn sample instead of painting it.
 *
 * Prices are stored as **int64 ticks** (never float32). The float64 numbers
 * that reach Lightweight Charts are produced by the copy-out, where the loss
 * is display-only and the price scale already works in float64.
 *
 * The same SAB also carries a single-buffered **page slot** (§9.2, HP PR 5):
 * when the viewport pans into cold history, ingest *replaces* that section
 * with one page of cold bars — a far-left jump replaces it again, so the
 * allocation never grows past O(HOT_CAP).
 *
 * Allocation failure is not fatal: a mobile WebView that refuses the SAB
 * returns `null` and drops the tab to rung 1 for the session
 * (`axis.hp.rung = '1'`), so the next reload does not retry the OOM.
 *
 * @module hp/memory/hot-buffer
 */

import { priceToTicks, ticksToPrice } from '../axb1/ticks';
import { HOT_CAP, PRICE_SCALE_DEFAULT, TipMask } from '../axb1/constants';
import type { Bar } from '../../store/types';
import { rememberHpRung } from '../capabilities';
import { HpControlBlock, HpControlFlag } from './control-block';
import {
  computeHotLayout,
  defaultSabFactory,
  HP_SERIES_HEADER_BYTES,
  HP_TIP_BYTES,
  HP_TIP_SLOTS,
  type HotColumnId,
  type HotLayout,
  type SabFactory,
} from './layout';

/** `bar_flags` bits (§6.2). */
export const BAR_FLAG_CLOSED = 1 << 0;
export const BAR_FLAG_FORMING = 1 << 1;

/** One bar in canonical form: int64 ticks, unix seconds, explicit flags. */
export type HotBarTicks = {
  time: number;
  openTicks: bigint;
  highTicks: bigint;
  lowTicks: bigint;
  closeTicks: bigint;
  volume: number;
  flags: number;
};

/** Convert a Solid-store `Bar` (float64) into ticks for the hot buffer. */
export function barToTicks(bar: Bar, priceScale: number): HotBarTicks {
  return {
    time: bar.time,
    openTicks: priceToTicks(bar.open, priceScale),
    highTicks: priceToTicks(bar.high, priceScale),
    lowTicks: priceToTicks(bar.low, priceScale),
    closeTicks: priceToTicks(bar.close, priceScale),
    volume: bar.volume ?? 0,
    // The venue sets `closed` explicitly (`k.x`); absent means history.
    flags: bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED,
  };
}

type SlotViews = Record<HotColumnId, Int32Array | BigInt64Array | Float64Array | Uint8Array>;

/** Write one bar into a column set (a hot slot or the page slot). */
function writeColumnBar(v: SlotViews, index: number, bar: HotBarTicks): void {
  (v.time_s as Int32Array)[index] = bar.time | 0;
  (v.open_ticks as BigInt64Array)[index] = bar.openTicks;
  (v.high_ticks as BigInt64Array)[index] = bar.highTicks;
  (v.low_ticks as BigInt64Array)[index] = bar.lowTicks;
  (v.close_ticks as BigInt64Array)[index] = bar.closeTicks;
  (v.volume as Float64Array)[index] = bar.volume;
  (v.bar_flags as Uint8Array)[index] = bar.flags & 0xff;
}

/** Read one bar from a column set as float64 (`Bar`). */
function readColumnBar(v: SlotViews, index: number, priceScale: number): Bar {
  const flags = (v.bar_flags as Uint8Array)[index] ?? 0;
  return {
    time: (v.time_s as Int32Array)[index] ?? 0,
    open: ticksToPrice((v.open_ticks as BigInt64Array)[index] ?? 0n, priceScale),
    high: ticksToPrice((v.high_ticks as BigInt64Array)[index] ?? 0n, priceScale),
    low: ticksToPrice((v.low_ticks as BigInt64Array)[index] ?? 0n, priceScale),
    close: ticksToPrice((v.close_ticks as BigInt64Array)[index] ?? 0n, priceScale),
    volume: (v.volume as Float64Array)[index] ?? 0,
    closed: (flags & BAR_FLAG_CLOSED) !== 0,
  };
}

/** Read one bar from a column set as canonical int64 ticks. */
function readColumnTicks(v: SlotViews, index: number): HotBarTicks {
  const flags = (v.bar_flags as Uint8Array)[index] ?? 0;
  return {
    time: (v.time_s as Int32Array)[index] ?? 0,
    openTicks: (v.open_ticks as BigInt64Array)[index] ?? 0n,
    highTicks: (v.high_ticks as BigInt64Array)[index] ?? 0n,
    lowTicks: (v.low_ticks as BigInt64Array)[index] ?? 0n,
    closeTicks: (v.close_ticks as BigInt64Array)[index] ?? 0n,
    volume: (v.volume as Float64Array)[index] ?? 0,
    flags,
  };
}

/** Narrow one canonical tick bar to the float64 `Bar` the paint path uses. */
function ticksToBar(bar: HotBarTicks, priceScale: number): Bar {
  return {
    time: bar.time,
    open: ticksToPrice(bar.openTicks, priceScale),
    high: ticksToPrice(bar.highTicks, priceScale),
    low: ticksToPrice(bar.lowTicks, priceScale),
    close: ticksToPrice(bar.closeTicks, priceScale),
    volume: bar.volume,
    closed: (bar.flags & BAR_FLAG_CLOSED) !== 0,
  };
}

/** 64-byte forming-tip record field offsets (int32 / int64 / float64 words). */
const TIP_I32 = { TIME: 0, MASK: 1, SEQ: 12, FLAGS: 13, INDEX: 14 } as const;
const TIP_I64 = { OPEN: 1, HIGH: 2, LOW: 3, CLOSE: 4, VOLUME: 5 } as const;
/** A full tip record always carries every OHLCV field. */
const TIP_FULL_MASK =
  TipMask.OPEN | TipMask.HIGH | TipMask.LOW | TipMask.CLOSE | TipMask.VOLUME | TipMask.TIME;

/**
 * Allocate and initialise the hot SAB.
 *
 * Returns `null` (after remembering rung 1) when the runtime refuses the
 * allocation — `SharedArrayBuffer` missing, isolation off, or `RangeError`.
 */
export function allocateHotBuffer(
  cap: number = HOT_CAP,
  sabFactory: SabFactory = defaultSabFactory,
): HotBuffer | null {
  // A missing global throws `ReferenceError`, which is not a RangeError and
  // used to escape the documented "returns null" contract.
  if (sabFactory === defaultSabFactory && typeof SharedArrayBuffer !== 'function') {
    rememberHpRung(1);
    return null;
  }
  try {
    const layout = computeHotLayout(cap);
    const sab = sabFactory(layout.byteLength);
    if (!sab || sab.byteLength !== layout.byteLength) {
      // Same session clamp as an allocation throw: the selector must not keep
      // claiming a ring that was never created.
      rememberHpRung(1);
      return null;
    }
    return new HotBuffer(sab, layout);
  } catch (e) {
    if (e instanceof ReferenceError || e instanceof RangeError || e instanceof TypeError) {
      rememberHpRung(1);
      return null;
    }
    throw e;
  }
}

export class HotBuffer {
  readonly sab: SharedArrayBuffer;
  readonly layout: HotLayout;
  readonly control: HpControlBlock;
  private readonly slots: SlotViews[];
  private readonly pageViews: SlotViews;
  /** One view for the life of the buffer — `priceScale` is read per copy-out. */
  private readonly headerView: Uint8Array;
  private readonly tipI32: Int32Array;
  private readonly tipI64: BigInt64Array;
  private readonly tipF64: Float64Array;

  constructor(sab: SharedArrayBuffer, layout: HotLayout) {
    this.sab = sab;
    this.layout = layout;
    this.slots = layout.slots.map((offsets) => this.makeViews(offsets));
    this.pageViews = this.makeViews(layout.page);
    this.headerView = new Uint8Array(sab, layout.headerOffset, HP_SERIES_HEADER_BYTES);
    const tipBytes = HP_TIP_BYTES * HP_TIP_SLOTS;
    this.tipI32 = new Int32Array(sab, layout.tipOffset, tipBytes >> 2);
    this.tipI64 = new BigInt64Array(sab, layout.tipOffset, tipBytes >> 3);
    this.tipF64 = new Float64Array(sab, layout.tipOffset, tipBytes >> 3);
    this.control = new HpControlBlock(sab, layout.controlOffset);
    if (!this.control.valid) {
      // Fresh SAB: stamp the control block and a sane default price scale.
      // A buffer that already carries valid metadata keeps its header (the
      // producer owns `priceScale` from then on).
      this.control.init();
      this.priceScale = PRICE_SCALE_DEFAULT;
    }
  }

  private makeViews(offsets: Record<HotColumnId, number>): SlotViews {
    const s = this.sab;
    const cap = this.layout.cap;
    return {
      time_s: new Int32Array(s, offsets.time_s, cap),
      open_ticks: new BigInt64Array(s, offsets.open_ticks, cap),
      high_ticks: new BigInt64Array(s, offsets.high_ticks, cap),
      low_ticks: new BigInt64Array(s, offsets.low_ticks, cap),
      close_ticks: new BigInt64Array(s, offsets.close_ticks, cap),
      volume: new Float64Array(s, offsets.volume, cap),
      bar_flags: new Uint8Array(s, offsets.bar_flags, cap),
    };
  }

  // ------------------------------------------------------------------
  // Series header (§6.2): price scale + epoch, rebuilt on symbol switch
  // ------------------------------------------------------------------

  get priceScale(): number {
    return this.headerView[0] ?? PRICE_SCALE_DEFAULT;
  }

  set priceScale(scale: number) {
    if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
      throw new RangeError(`price scale out of range: ${scale}`);
    }
    this.headerView[0] = scale;
  }

  /** Monotonic series epoch — a symbol switch bumps it, never reuses ticks. */
  get epoch(): number {
    const h = this.headerView;
    return (h[4] ?? 0) | ((h[5] ?? 0) << 8) | ((h[6] ?? 0) << 16) | ((h[7] ?? 0) << 24);
  }

  bumpEpoch(): number {
    const next = (this.epoch + 1) | 0;
    const h = this.headerView;
    h[4] = next & 0xff;
    h[5] = (next >>> 8) & 0xff;
    h[6] = (next >>> 16) & 0xff;
    h[7] = (next >>> 24) & 0xff;
    return next;
  }

  setFlag(mask: number, on: boolean): void {
    this.control.setFlags(mask, on);
  }

  get flags(): number {
    return this.control.flags;
  }

  // ------------------------------------------------------------------
  // Writer side (ingest)
  // ------------------------------------------------------------------

  /** Choose the unpublished slot and open a seqlock write. */
  beginWrite(): 0 | 1 {
    const slot: 0 | 1 = this.control.publishedSlot === 0 ? 1 : 0;
    this.control.beginWrite(slot);
    return slot;
  }

  writeBar(slot: 0 | 1, index: number, bar: HotBarTicks): void {
    if (index < 0 || index >= this.layout.cap) {
      throw new RangeError(`hot index out of range: ${index}`);
    }
    writeColumnBar(this.slots[slot], index, bar);
  }

  /** Close the write: publish the slot, make the generation even, notify. */
  commit(meta?: {
    hotCount?: number;
    hotFromIndex?: number;
    closedUpto?: number;
    seq?: number;
  }): void {
    if (meta) this.control.writeMeta(meta);
    this.control.commitWrite();
  }

  /**
   * Publish a whole window: write every bar into the unpublished slot, then
   * flip. Readers see the previous window until the flip.
   */
  publish(
    bars: readonly HotBarTicks[],
    meta?: { hotFromIndex?: number; closedUpto?: number; seq?: number },
  ): void {
    if (bars.length > this.layout.cap) {
      throw new RangeError(`hot window overflow: ${bars.length} > ${this.layout.cap}`);
    }
    const slot = this.beginWrite();
    for (let i = 0; i < bars.length; i++) this.writeBar(slot, i, bars[i] as HotBarTicks);
    this.commit({ hotCount: bars.length, ...meta });
    // A full window republish invalidates the forming-tip overlay; the writer
    // re-seeds it when the newest bar is still forming.
    this.clearTip();
  }

  /**
   * Incremental publish (HP-P01): copy the already-published prefix into the
   * unpublished slot with one typed-array `set` per column, then write only
   * the bars that changed or appeared. Used for appends and forming-tip
   * updates that also carry a new closed bar.
   *
   * `prevCount` is the number of leading bars that are still identical at the
   * same indices; it must be `0..bars.length` and the window must not have
   * slid (a slide changes the index of every bar).
   */
  publishTail(
    bars: readonly HotBarTicks[],
    meta?: { hotFromIndex?: number; closedUpto?: number; seq?: number },
    prevCount = 0,
  ): void {
    if (bars.length > this.layout.cap) {
      throw new RangeError(`hot window overflow: ${bars.length} > ${this.layout.cap}`);
    }
    const copy = Math.max(0, Math.min(Math.trunc(prevCount), bars.length));
    const slot = this.beginWrite();
    if (copy > 0) this.copyPublishedToWrite(slot, copy);
    for (let i = copy; i < bars.length; i++) this.writeBar(slot, i, bars[i] as HotBarTicks);
    this.commit({ hotCount: bars.length, ...meta });
  }

  /** Copy `count` leading bars of the published slot into `dest`. */
  private copyPublishedToWrite(dest: 0 | 1, count: number): void {
    const src = this.slots[this.control.publishedSlot];
    if (dest === this.control.publishedSlot) return;
    const dst = this.slots[dest];
    if (count > this.layout.cap) count = this.layout.cap;
    (dst.time_s as Int32Array).set((src.time_s as Int32Array).subarray(0, count));
    (dst.open_ticks as BigInt64Array).set((src.open_ticks as BigInt64Array).subarray(0, count));
    (dst.high_ticks as BigInt64Array).set((src.high_ticks as BigInt64Array).subarray(0, count));
    (dst.low_ticks as BigInt64Array).set((src.low_ticks as BigInt64Array).subarray(0, count));
    (dst.close_ticks as BigInt64Array).set((src.close_ticks as BigInt64Array).subarray(0, count));
    (dst.volume as Float64Array).set((src.volume as Float64Array).subarray(0, count));
    (dst.bar_flags as Uint8Array).set((src.bar_flags as Uint8Array).subarray(0, count));
  }

  // ------------------------------------------------------------------
  // Forming-tip slot (§6.3, HP-P01): one 64-byte record, own seqlock
  // ------------------------------------------------------------------

  /** Bumped by both the hot window and the tip, so a rAF poll repaints. */
  get paintGeneration(): number {
    return this.control.generation + this.control.tipGeneration;
  }

  get tipGeneration(): number {
    return this.control.tipGeneration;
  }

  /**
   * Publish the forming bar as one 64-byte tip record. This is the common
   * tick path: the hot window stays byte-identical, only the tip section and
   * its generation move.
   */
  writeTip(bar: HotBarTicks, index: number, seq = 0): void {
    const slot: 0 | 1 = this.control.tipSlot === 0 ? 1 : 0;
    const bi = slot * 16;
    const di = slot * 8;
    this.control.beginTipWrite();
    this.tipI32[bi + TIP_I32.TIME] = bar.time | 0;
    this.tipI32[bi + TIP_I32.MASK] = TIP_FULL_MASK;
    this.tipI64[di + TIP_I64.OPEN] = bar.openTicks;
    this.tipI64[di + TIP_I64.HIGH] = bar.highTicks;
    this.tipI64[di + TIP_I64.LOW] = bar.lowTicks;
    this.tipI64[di + TIP_I64.CLOSE] = bar.closeTicks;
    this.tipF64[di + TIP_I64.VOLUME] = bar.volume;
    this.tipI32[bi + TIP_I32.SEQ] = seq | 0;
    this.tipI32[bi + TIP_I32.FLAGS] = bar.flags & 0xff;
    this.tipI32[bi + TIP_I32.INDEX] = index | 0;
    this.control.commitTipWrite(slot, index | 0);
  }

  /** Retire the tip (no forming bar, or a full window replaced it). */
  clearTip(): void {
    if (this.control.tipIndex < 0) return;
    this.control.beginTipWrite();
    this.control.commitTipWrite(this.control.tipSlot, -1);
  }

  /**
   * Sample the published tip under its own seqlock. Returns `null` when there
   * is no tip or a write is in flight (the caller falls back to the hot slot).
   */
  sampleTip(attempts = 4): { generation: number; index: number; bar: Bar } | null {
    for (let i = 0; i < attempts; i++) {
      const g1 = this.control.tipGeneration;
      if (g1 & 1) continue;
      const index = this.control.tipIndex;
      if (index < 0) return null;
      const slot = this.control.tipSlot;
      const bi = slot * 16;
      const di = slot * 8;
      if (this.tipI32[bi + TIP_I32.INDEX] !== index) continue;
      const bar: HotBarTicks = {
        time: this.tipI32[bi + TIP_I32.TIME] ?? 0,
        openTicks: this.tipI64[di + TIP_I64.OPEN] ?? 0n,
        highTicks: this.tipI64[di + TIP_I64.HIGH] ?? 0n,
        lowTicks: this.tipI64[di + TIP_I64.LOW] ?? 0n,
        closeTicks: this.tipI64[di + TIP_I64.CLOSE] ?? 0n,
        volume: this.tipF64[di + TIP_I64.VOLUME] ?? 0,
        flags: this.tipI32[bi + TIP_I32.FLAGS] ?? 0,
      };
      const g2 = this.control.tipGeneration;
      if (g1 === g2 && (g2 & 1) === 0) {
        return { generation: g2, index, bar: ticksToBar(bar, this.priceScale) };
      }
    }
    return null;
  }

  /** Forming-tip bookkeeping for a writer that does not use {@link writeTip}. */
  publishTip(): number {
    return this.control.bumpTipGeneration();
  }

  // ------------------------------------------------------------------
  // Page slot (HP PR 5, §9.2): single-buffered cold range, replace semantics
  // ------------------------------------------------------------------

  get pageActive(): boolean {
    return (this.control.flags & HpControlFlag.PAGE_ACTIVE) !== 0;
  }

  get pageFromIndex(): number {
    return this.control.pageFromIndex;
  }

  get pageCount(): number {
    return this.control.pageCount;
  }

  writePageBar(index: number, bar: HotBarTicks): void {
    if (index < 0 || index >= this.layout.cap) {
      throw new RangeError(`page index out of range: ${index}`);
    }
    writeColumnBar(this.pageViews, index, bar);
  }

  /**
   * Replace the page slot with one cold page.
   *
   * The page is *single*-buffered: a far-left jump overwrites the previous
   * page rather than allocating a third history buffer, so the SAB stays
   * O(HOT_CAP). The write runs through the seqlock (`beginPageWrite`) but
   * never moves the hot published slot — a page replace cannot change what
   * any reader sees of the hot window, and the forming tip keeps updating.
   */
  publishPage(
    bars: readonly HotBarTicks[],
    meta: { pageFromIndex: number; active?: boolean },
  ): void {
    if (bars.length > this.layout.cap) {
      throw new RangeError(`page overflow: ${bars.length} > ${this.layout.cap}`);
    }
    this.control.beginPageWrite();
    for (let i = 0; i < bars.length; i++) this.writePageBar(i, bars[i] as HotBarTicks);
    this.control.setFlags(HpControlFlag.PAGE_ACTIVE, meta.active ?? true);
    this.control.writeMeta({ pageCount: bars.length, pageFromIndex: meta.pageFromIndex });
    this.control.commitPageWrite();
  }

  /** Viewport is back inside the hot range: retire the page (keeps no data). */
  clearPage(): void {
    this.control.beginPageWrite();
    this.control.setFlags(HpControlFlag.PAGE_ACTIVE, false);
    this.control.writeMeta({ pageCount: 0, pageFromIndex: 0 });
    this.control.commitPageWrite();
  }

  // ------------------------------------------------------------------
  // Reader side
  // ------------------------------------------------------------------

  readBar(slot: 0 | 1, index: number, priceScale: number = this.priceScale): Bar {
    return readColumnBar(this.slots[slot], index, priceScale);
  }

  /** Read ticks directly (calc worker keeps the canonical integer form). */
  readTicks(slot: 0 | 1, index: number): HotBarTicks {
    return readColumnTicks(this.slots[slot], index);
  }

  /** Read one bar of the page slot (valid inside a sampled generation only). */
  readPageBar(index: number, priceScale: number = this.priceScale): Bar {
    if (index < 0 || index >= this.layout.cap) {
      throw new RangeError(`page index out of range: ${index}`);
    }
    return readColumnBar(this.pageViews, index, priceScale);
  }

  /** Read page ticks directly (cold history in canonical integer form). */
  readPageTicks(index: number): HotBarTicks {
    if (index < 0 || index >= this.layout.cap) {
      throw new RangeError(`page index out of range: ${index}`);
    }
    return readColumnTicks(this.pageViews, index);
  }
}
