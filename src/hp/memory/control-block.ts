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
 * Control block — the seqlock words of the hot double-buffer (HP PR 4, §6.1).
 *
 * 256 bytes viewed as `Int32Array` (64 words) plus a `BigInt64Array` overlay
 * at byte 64 for the 64-bit epoch. Byte 72 is the dedicated `Atomics.notify`
 * word (`HP_NOTIFY_INDEX = 18`).
 *
 * Generation protocol (lock-free, single writer = ingest):
 *
 * ```
 * writer:  generation → odd        // start
 *          write into write_slot
 *          published_slot = write_slot
 *          generation → even       // complete
 *          Atomics.notify(HP_NOTIFY_INDEX)
 * reader:  sample only when generation is even on both sides of the read
 * ```
 *
 * Readers **never** wait — a torn sample is discarded and the previous frame
 * stays on screen. `Atomics.wait` is worker-only (§8) and lives in
 * `hp/sync/atomics`, not here.
 *
 * @module hp/memory/control-block
 */

import { HPC1_MAGIC } from '../axb1/constants';
import { HP_CONTROL_BYTES } from './layout';

export const HP_CONTROL_VERSION = 1;

/** i32 index of the `Atomics.notify` word (byte 72). */
export const HP_NOTIFY_INDEX = 18;

/** i32 index of the seqlock generation word (byte 8). */
export const HP_GEN_INDEX = 2;

/** i32 word indices inside the control section. */
const W = {
  MAGIC: 0,
  VERSION: 1,
  GENERATION: 2,
  PUBLISHED_SLOT: 3,
  WRITE_SLOT: 4,
  HOT_COUNT: 5,
  HOT_FROM_INDEX: 6,
  CLOSED_UPTO: 7,
  SEQ: 8,
  FLAGS: 9,
  TIP_GENERATION: 10,
  PLOT_GENERATION: 11,
  VISUAL_GENERATION: 12,
  VIEWPORT_REQ_FROM: 13,
  VIEWPORT_REQ_TO: 14,
  VIEWPORT_REQ_GEN: 15,
  PAGE_FROM_INDEX: 16,
  PAGE_COUNT: 17,
} as const;

/** Word index inside the `BigInt64Array` overlay that starts at byte 64. */
const I64 = { EPOCH_MS: 0 } as const;

/** `flags` bits (§6.1). `PAGE_ACTIVE` is used by viewport paging (HP PR 5). */
export const HpControlFlag = {
  FORMING: 1 << 0,
  ISOLATED: 1 << 1,
  OVERFLOW: 1 << 2,
  PAGE_ACTIVE: 1 << 3,
} as const;

export type HpControlSnapshot = {
  generation: number;
  publishedSlot: 0 | 1;
  hotCount: number;
  hotFromIndex: number;
  closedUpto: number;
  seq: number;
  flags: number;
};

/**
 * View over the 256-byte control section.
 *
 * All control words go through `Atomics` so the ordering of the seqlock holds
 * across workers; the column data itself stays plain (non-atomic) typed-array
 * writes, which is what the generation double-check protects.
 */
export class HpControlBlock {
  readonly i32: Int32Array;
  readonly i64: BigInt64Array;

  constructor(source: SharedArrayBuffer | ArrayBuffer, byteOffset = 0) {
    const total = source.byteLength;
    if (byteOffset < 0 || byteOffset + HP_CONTROL_BYTES > total) {
      throw new RangeError(
        `control block out of range: ${byteOffset} + ${HP_CONTROL_BYTES} > ${total}`,
      );
    }
    if (byteOffset % 4 !== 0) throw new RangeError(`control block misaligned: ${byteOffset}`);
    this.i32 = new Int32Array(source, byteOffset, HP_CONTROL_BYTES / 4);
    // Byte 64 is 8-byte aligned whenever byteOffset is 4-byte aligned? No —
    // require the natural alignment instead of silently building a misaligned
    // BigInt64Array (browsers throw RangeError, other runtimes do not).
    if ((byteOffset + 64) % 8 !== 0) throw new RangeError('control block epoch misaligned');
    this.i64 = new BigInt64Array(source, byteOffset + 64, 2);
  }

  /** Stamp magic + version. Called once by the allocator. */
  init(): void {
    Atomics.store(this.i32, W.MAGIC, HPC1_MAGIC);
    Atomics.store(this.i32, W.VERSION, HP_CONTROL_VERSION);
    Atomics.store(this.i32, W.GENERATION, 0);
    Atomics.store(this.i32, W.PUBLISHED_SLOT, 0);
    Atomics.store(this.i32, W.WRITE_SLOT, 1);
    Atomics.store(this.i32, W.HOT_COUNT, 0);
    Atomics.store(this.i32, W.HOT_FROM_INDEX, 0);
    Atomics.store(this.i32, W.PAGE_FROM_INDEX, 0);
    Atomics.store(this.i32, W.PAGE_COUNT, 0);
    Atomics.store(this.i32, W.CLOSED_UPTO, -1);
    Atomics.store(this.i32, W.SEQ, 0);
    Atomics.store(this.i32, W.FLAGS, 0);
  }

  get magic(): number {
    return Atomics.load(this.i32, W.MAGIC) >>> 0;
  }

  get version(): number {
    return Atomics.load(this.i32, W.VERSION);
  }

  /** False when the SAB was allocated but never initialised (or is stale). */
  get valid(): boolean {
    return this.magic === HPC1_MAGIC && this.version === HP_CONTROL_VERSION;
  }

  get generation(): number {
    return Atomics.load(this.i32, W.GENERATION);
  }

  get publishedSlot(): 0 | 1 {
    return (Atomics.load(this.i32, W.PUBLISHED_SLOT) & 1) as 0 | 1;
  }

  get writeSlot(): 0 | 1 {
    return (Atomics.load(this.i32, W.WRITE_SLOT) & 1) as 0 | 1;
  }

  get hotCount(): number {
    return Atomics.load(this.i32, W.HOT_COUNT);
  }

  get hotFromIndex(): number {
    return Atomics.load(this.i32, W.HOT_FROM_INDEX);
  }

  /** Absolute base index of the page slot's first bar (§9.2). */
  get pageFromIndex(): number {
    return Atomics.load(this.i32, W.PAGE_FROM_INDEX);
  }

  /** Bars currently valid in the page slot. `0` = page empty. */
  get pageCount(): number {
    return Atomics.load(this.i32, W.PAGE_COUNT);
  }

  get closedUpto(): number {
    return Atomics.load(this.i32, W.CLOSED_UPTO);
  }

  get seq(): number {
    return Atomics.load(this.i32, W.SEQ);
  }

  get flags(): number {
    return Atomics.load(this.i32, W.FLAGS);
  }

  get tipGeneration(): number {
    return Atomics.load(this.i32, W.TIP_GENERATION);
  }

  get plotGeneration(): number {
    return Atomics.load(this.i32, W.PLOT_GENERATION);
  }

  get visualGeneration(): number {
    return Atomics.load(this.i32, W.VISUAL_GENERATION);
  }

  get epochMs(): bigint {
    return Atomics.load(this.i64, I64.EPOCH_MS);
  }

  /** Main → ingest viewport request (absolute bar indices, `to` exclusive). */
  get viewportRequest(): { from: number; to: number; gen: number } {
    return {
      from: Atomics.load(this.i32, W.VIEWPORT_REQ_FROM),
      to: Atomics.load(this.i32, W.VIEWPORT_REQ_TO),
      gen: Atomics.load(this.i32, W.VIEWPORT_REQ_GEN),
    };
  }

  setViewportRequest(from: number, to: number): number {
    Atomics.store(this.i32, W.VIEWPORT_REQ_FROM, from | 0);
    Atomics.store(this.i32, W.VIEWPORT_REQ_TO, to | 0);
    // Bump last: ingest reacts to a *changed* generation.
    return Atomics.add(this.i32, W.VIEWPORT_REQ_GEN, 1) + 1;
  }

  writeMeta(meta: {
    hotCount?: number;
    hotFromIndex?: number;
    pageFromIndex?: number;
    pageCount?: number;
    closedUpto?: number;
    seq?: number;
  }): void {
    if (meta.hotCount !== undefined) Atomics.store(this.i32, W.HOT_COUNT, meta.hotCount | 0);
    if (meta.hotFromIndex !== undefined)
      Atomics.store(this.i32, W.HOT_FROM_INDEX, meta.hotFromIndex | 0);
    if (meta.pageFromIndex !== undefined)
      Atomics.store(this.i32, W.PAGE_FROM_INDEX, meta.pageFromIndex | 0);
    if (meta.pageCount !== undefined) Atomics.store(this.i32, W.PAGE_COUNT, meta.pageCount | 0);
    if (meta.closedUpto !== undefined) Atomics.store(this.i32, W.CLOSED_UPTO, meta.closedUpto | 0);
    if (meta.seq !== undefined) Atomics.store(this.i32, W.SEQ, meta.seq | 0);
  }

  setFlags(mask: number, on: boolean): void {
    const next = on ? this.flags | mask : this.flags & ~mask;
    Atomics.store(this.i32, W.FLAGS, next);
  }

  setEpochMs(ms: number | bigint): void {
    Atomics.store(this.i64, I64.EPOCH_MS, BigInt(ms));
  }

  /** Odd generation = a write is in flight; readers must discard. */
  beginWrite(slot: 0 | 1): void {
    Atomics.store(this.i32, W.WRITE_SLOT, slot);
    const g = Atomics.load(this.i32, W.GENERATION);
    if ((g & 1) === 0) Atomics.store(this.i32, W.GENERATION, g + 1);
  }

  /** Publish the slot, close the generation (even), and wake workers. */
  commitWrite(): void {
    const slot = Atomics.load(this.i32, W.WRITE_SLOT) & 1;
    Atomics.store(this.i32, W.PUBLISHED_SLOT, slot);
    Atomics.add(this.i32, W.GENERATION, 1);
    Atomics.notify(this.i32, HP_NOTIFY_INDEX, 3);
  }

  /**
   * Open a **page-only** seqlock transaction (§9.2).
   *
   * Same odd/even protocol as `beginWrite`, but it deliberately does *not*
   * touch `WRITE_SLOT`: a viewport page replace writes into the single page
   * section and must leave the published hot slot exactly as it was.
   */
  beginPageWrite(): void {
    const g = Atomics.load(this.i32, W.GENERATION);
    if ((g & 1) === 0) Atomics.store(this.i32, W.GENERATION, g + 1);
  }

  /** Close a page-only transaction (even generation) and wake workers. */
  commitPageWrite(): void {
    Atomics.add(this.i32, W.GENERATION, 1);
    Atomics.notify(this.i32, HP_NOTIFY_INDEX, 3);
  }

  /**
   * Seqlock read: `null` while a write is in flight or if the sample tore.
   * Busy-retries a bounded number of times — it never blocks.
   */
  sample(attempts = 8): { generation: number; slot: 0 | 1 } | null {
    for (let i = 0; i < attempts; i++) {
      const g1 = Atomics.load(this.i32, W.GENERATION);
      if (g1 & 1) continue;
      const slot = (Atomics.load(this.i32, W.PUBLISHED_SLOT) & 1) as 0 | 1;
      const g2 = Atomics.load(this.i32, W.GENERATION);
      if (g1 === g2 && (g2 & 1) === 0) return { generation: g2, slot };
    }
    return null;
  }

  bumpPlotGeneration(): number {
    return Atomics.add(this.i32, W.PLOT_GENERATION, 1) + 1;
  }

  bumpTipGeneration(): number {
    return Atomics.add(this.i32, W.TIP_GENERATION, 1) + 1;
  }

  bumpVisualGeneration(): number {
    return Atomics.add(this.i32, W.VISUAL_GENERATION, 1) + 1;
  }

  /** Wake workers parked on the notify word (`Atomics.wait` is worker-only). */
  notifyWaiters(count = 3): number {
    return Atomics.notify(this.i32, HP_NOTIFY_INDEX, count);
  }

  snapshot(): HpControlSnapshot {
    return {
      generation: this.generation,
      publishedSlot: this.publishedSlot,
      hotCount: this.hotCount,
      hotFromIndex: this.hotFromIndex,
      closedUpto: this.closedUpto,
      seq: this.seq,
      flags: this.flags,
    };
  }
}
