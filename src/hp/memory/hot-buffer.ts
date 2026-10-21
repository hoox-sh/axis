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
 * Allocation failure is not fatal: a mobile WebView that refuses the SAB
 * returns `null` and drops the tab to rung 1 for the session
 * (`axis.hp.rung = '1'`), so the next reload does not retry the OOM.
 *
 * @module hp/memory/hot-buffer
 */

import { priceToTicks, ticksToPrice } from '../axb1/ticks';
import { HOT_CAP, PRICE_SCALE_DEFAULT } from '../axb1/constants';
import type { Bar } from '../../store/types';
import { rememberHpRung } from '../capabilities';
import { HpControlBlock } from './control-block';
import {
  computeHotLayout,
  defaultSabFactory,
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
  try {
    const layout = computeHotLayout(cap);
    const sab = sabFactory(layout.byteLength);
    if (!sab || sab.byteLength !== layout.byteLength) return null;
    return new HotBuffer(sab, layout);
  } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) {
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

  constructor(sab: SharedArrayBuffer, layout: HotLayout) {
    this.sab = sab;
    this.layout = layout;
    this.control = new HpControlBlock(sab, layout.controlOffset);
    if (!this.control.valid) {
      // Fresh SAB: stamp the control block and a sane default price scale.
      // A buffer that already carries valid metadata keeps its header (the
      // producer owns `priceScale` from then on).
      this.control.init();
      this.priceScale = PRICE_SCALE_DEFAULT;
    }
    this.slots = layout.slots.map((offsets) => this.makeViews(offsets));
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

  private get header(): Uint8Array {
    const { headerOffset } = this.layout;
    return new Uint8Array(this.sab, headerOffset, 64);
  }

  get priceScale(): number {
    return this.header[0] ?? 8;
  }

  set priceScale(scale: number) {
    if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
      throw new RangeError(`price scale out of range: ${scale}`);
    }
    this.header[0] = scale;
  }

  /** Monotonic series epoch — a symbol switch bumps it, never reuses ticks. */
  get epoch(): number {
    const h = this.header;
    return (h[4] ?? 0) | ((h[5] ?? 0) << 8) | ((h[6] ?? 0) << 16) | ((h[7] ?? 0) << 24);
  }

  bumpEpoch(): number {
    const next = (this.epoch + 1) | 0;
    const h = this.header;
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
    const v = this.slots[slot];
    (v.time_s as Int32Array)[index] = bar.time | 0;
    (v.open_ticks as BigInt64Array)[index] = bar.openTicks;
    (v.high_ticks as BigInt64Array)[index] = bar.highTicks;
    (v.low_ticks as BigInt64Array)[index] = bar.lowTicks;
    (v.close_ticks as BigInt64Array)[index] = bar.closeTicks;
    (v.volume as Float64Array)[index] = bar.volume;
    (v.bar_flags as Uint8Array)[index] = bar.flags & 0xff;
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
  }

  /** Forming-tip bookkeeping (independent of the history generation). */
  publishTip(): number {
    return this.control.bumpTipGeneration();
  }

  // ------------------------------------------------------------------
  // Reader side
  // ------------------------------------------------------------------

  readBar(slot: 0 | 1, index: number, priceScale: number = this.priceScale): Bar {
    const v = this.slots[slot];
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

  /** Read ticks directly (calc worker keeps the canonical integer form). */
  readTicks(slot: 0 | 1, index: number): HotBarTicks {
    const v = this.slots[slot];
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
}
