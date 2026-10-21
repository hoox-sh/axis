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
 * Copy-out: hot SAB → `Bar[]` for Lightweight Charts (HP PR 4, §6.5).
 *
 * LWC is not OffscreenCanvas-capable (and HP-0…HP-2 keep it as the painter),
 * so the main thread samples the published generation once per frame and
 * copies **only the visible range** out of the shared window. The copy is
 * verified by a second generation load: if a write landed mid-copy the whole
 * attempt is discarded and retried, and after `attempts` failures the caller
 * gets `null` and simply keeps the previous frame — no torn candle.
 *
 * Float64 is produced here (`ticks / 10^scale`), which is where price loss is
 * acceptable: LWC and the price scale already work in float64. The shared
 * buffer keeps int64 ticks.
 *
 * @module hp/paint/copy-out-lwc
 */

import type { Bar } from '../../store/types';
import type { HotBuffer } from '../memory/hot-buffer';

export type CopyOutRequest = {
  /** Absolute series index of the first wanted bar (0 = oldest known bar). */
  fromAbs: number;
  /** How many bars the viewport wants. */
  count: number;
};

export type CopyOutResult = {
  bars: Bar[];
  /** Generation the bars were read from (even). */
  generation: number;
  /** Absolute index of `bars[0]` — the intersection actually covered. */
  fromAbs: number;
  /** True when the whole requested range was inside the hot window. */
  complete: boolean;
};

/** Truncate a finite absolute index to an integer bar position. */
function toIndex(value: number): number {
  return Math.trunc(value);
}

/**
 * Copy the requested range out of the published hot slot.
 *
 * Returns `null` when nothing can be read safely: a write is in flight for
 * the whole retry budget, the window is empty, or the request does not
 * overlap the hot window (cold data is paged in by HP PR 5, not read here).
 */
export function copyOutBars(
  buffer: HotBuffer,
  req: CopyOutRequest,
  attempts = 8,
): CopyOutResult | null {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.count)) return null;
  const count = Math.trunc(req.count);
  if (count <= 0) return null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const sample = buffer.control.sample();
    if (!sample) continue; // odd generation — a write is in flight

    const hotFrom = buffer.control.hotFromIndex;
    const hotCount = buffer.control.hotCount;
    if (hotCount <= 0) return null;

    const hotTo = hotFrom + hotCount;
    const wantFrom = toIndex(req.fromAbs);
    const wantTo = wantFrom + count;
    if (wantTo <= hotFrom || wantFrom >= hotTo) return null; // no overlap

    const from = Math.max(wantFrom, hotFrom);
    const to = Math.min(wantTo, hotTo);
    const first = from - hotFrom;
    const len = to - from;

    const bars: Bar[] = new Array<Bar>(len);
    for (let i = 0; i < len; i++) {
      bars[i] = buffer.readBar(sample.slot, first + i);
    }

    // Seqlock verify: any write that started or finished while we copied
    // changed the generation — discard the sample and try again.
    if (buffer.control.generation !== sample.generation) continue;

    return {
      bars,
      generation: sample.generation,
      fromAbs: from,
      complete: wantFrom >= hotFrom && wantTo <= hotTo,
    };
  }
  return null;
}

/**
 * Newest-first slice helper for the paint path: copy the last `count` bars of
 * the hot window (what a freshly opened chart paints).
 */
export function copyOutTail(buffer: HotBuffer, count: number, attempts = 8): CopyOutResult | null {
  const hotFrom = buffer.control.hotFromIndex;
  const hotCount = buffer.control.hotCount;
  if (hotCount <= 0) return null;
  const n = Math.min(count, hotCount);
  return copyOutBars(buffer, { fromAbs: hotFrom + hotCount - n, count: n }, attempts);
}
