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
 * Hot-window memory layout (HP PR 4) — one SharedArrayBuffer, sectioned.
 *
 * Layout (every section starts on a 256-byte boundary so `BigInt64Array`
 * views are always 8-byte aligned):
 *
 * ```
 * 0     control block   256 B   HpControlBlock (seqlock words)
 * 256   series header    64 B → 256   price_scale, value kind, epoch
 * 512   tip slot       128 B → 256   2 × 64 B forming-tip records
 * 768   slot 0 columns  …          time / OHLC ticks / volume / flags
 * …     slot 1 columns  …          the other half of the double buffer
 * …     page columns    …          PageSlot[HOT_CAP] — viewport paging (§9.2)
 * ```
 *
 * Only the **hot window** is double-buffered (`HOT_CAP`, default 5_120 bars).
 * The **page slot** is a *single*-buffered section of the same capacity: when
 * the viewport pans into cold history, ingest *replaces* its contents with one
 * page of cold bars (a far-left jump replaces again — the SAB never grows).
 * Cold history itself stays in the worker + IndexedDB, never in this
 * allocation — that is why the byte length is O(HOT_CAP) and not O(N).
 *
 * @module hp/memory/layout
 */

import { HOT_CAP } from '../axb1/constants';

export { HOT_CAP };

/** Control block size (§6.1): 64 × 4-byte words. */
export const HP_CONTROL_BYTES = 256;

/** Series header in front of the columns (price scale, epoch). */
export const HP_SERIES_HEADER_BYTES = 64;

/** One forming-tip record (§6.3). Two are kept for double-buffering. */
export const HP_TIP_BYTES = 64;
export const HP_TIP_SLOTS = 2;

/** Hot series double-buffer: published slot + write slot. */
export const HP_HOT_SLOTS = 2;

/** Section padding — keeps every column start 256-byte (and 8-byte) aligned. */
export const HP_SECTION_ALIGN = 256;

export type HotColumnId =
  'time_s' | 'open_ticks' | 'high_ticks' | 'low_ticks' | 'close_ticks' | 'volume' | 'bar_flags';

/** Bytes per element, per column (§6.2). */
export const HOT_COLUMN_BYTES: Readonly<Record<HotColumnId, number>> = {
  time_s: 4,
  open_ticks: 8,
  high_ticks: 8,
  low_ticks: 8,
  close_ticks: 8,
  volume: 8,
  bar_flags: 1,
};

/** Column order inside a slot (also the section order in the SAB). */
export const HOT_COLUMNS: readonly HotColumnId[] = [
  'time_s',
  'open_ticks',
  'high_ticks',
  'low_ticks',
  'close_ticks',
  'volume',
  'bar_flags',
];

/** Byte offsets of every column for one hot slot, relative to the SAB start. */
export type HotSlotLayout = Readonly<Record<HotColumnId, number>>;

export interface HotLayout {
  /** Exact `SharedArrayBuffer.byteLength` to allocate. */
  byteLength: number;
  controlOffset: number;
  headerOffset: number;
  tipOffset: number;
  /** Bars per column (`HOT_CAP` unless a test narrows it). */
  cap: number;
  /** `[0]` is written first and published by moving to `[1]`. */
  slots: readonly HotSlotLayout[];
  /** PageSlot: single-buffered cold page (§9.2), same columns as one hot slot. */
  page: HotSlotLayout;
}

/** Round up to the next section boundary. */
export function alignUp(value: number, align: number = HP_SECTION_ALIGN): number {
  return Math.ceil(value / align) * align;
}

/**
 * Compute every offset for `cap` bars per slot.
 *
 * Pure — tests assert the byte budget against this instead of magic numbers.
 */
export function computeHotLayout(cap: number = HOT_CAP): HotLayout {
  if (!Number.isInteger(cap) || cap <= 0 || cap > 1_000_000) {
    throw new RangeError(`hot cap out of range: ${cap}`);
  }
  const controlOffset = 0;
  const headerOffset = alignUp(HP_CONTROL_BYTES);
  const tipOffset = headerOffset + alignUp(HP_SERIES_HEADER_BYTES);
  let cursor = tipOffset + alignUp(HP_TIP_BYTES * HP_TIP_SLOTS);

  const slots: HotSlotLayout[] = [];
  for (let s = 0; s < HP_HOT_SLOTS; s++) {
    const built = buildColumns(cursor, cap);
    slots.push(built.layout);
    cursor = built.next;
  }

  const page = buildColumns(cursor, cap);

  return {
    byteLength: alignUp(page.next),
    controlOffset,
    headerOffset,
    tipOffset,
    cap,
    slots,
    page: page.layout,
  };
}

/** One column set (a hot slot or the page slot): aligned offsets + next cursor. */
function buildColumns(start: number, cap: number): { layout: HotSlotLayout; next: number } {
  let cursor = start;
  const layout: Record<HotColumnId, number> = {
    time_s: 0,
    open_ticks: 0,
    high_ticks: 0,
    low_ticks: 0,
    close_ticks: 0,
    volume: 0,
    bar_flags: 0,
  };
  for (const col of HOT_COLUMNS) {
    cursor = alignUp(cursor);
    layout[col] = cursor;
    cursor += HOT_COLUMN_BYTES[col] * cap;
  }
  return { layout, next: cursor };
}

/** Injectable allocator so a test can simulate a mobile SAB `RangeError`. */
export type SabFactory = (byteLength: number) => SharedArrayBuffer;

export function defaultSabFactory(byteLength: number): SharedArrayBuffer {
  return new SharedArrayBuffer(byteLength);
}
