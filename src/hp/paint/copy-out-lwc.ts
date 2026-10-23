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
 * Copy-out: hot SAB → `Bar[]` for Lightweight Charts (HP PR 4, §6.5;
 * page slot §9.2 from HP PR 5).
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
 * A viewport that pans out of the hot window is served by the **page slot**
 * (`copyOutPage`): one replaced page of cold bars, never the whole series.
 * `copyOutViewport` is the dispatcher the paint path calls.
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

/** One section of the SAB a copy can come from (hot window or page slot). */
type SectionRange = { from: number; count: number };

/**
 * Seqlock-verified clipped copy from one section (shared by hot and page).
 *
 * `section()` is evaluated *inside* the sampled generation, so the range and
 * the column reads always belong to the same published state; the second
 * generation load after the copy discards a sample a write invalidated.
 */
function copyClipped(
  buffer: HotBuffer,
  req: CopyOutRequest,
  section: () => SectionRange | null,
  read: (slot: 0 | 1, index: number) => Bar,
  attempts: number,
): CopyOutResult | null {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.count)) return null;
  const count = Math.trunc(req.count);
  if (count <= 0) return null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const sample = buffer.control.sample();
    if (!sample) continue; // odd generation — a write is in flight

    const range = section();
    if (!range || range.count <= 0) return null;

    const secTo = range.from + range.count;
    const wantFrom = toIndex(req.fromAbs);
    const wantTo = wantFrom + count;
    if (wantTo <= range.from || wantFrom >= secTo) return null; // no overlap

    const from = Math.max(wantFrom, range.from);
    const to = Math.min(wantTo, secTo);
    const first = from - range.from;
    const len = to - from;

    const bars: Bar[] = new Array<Bar>(len);
    for (let i = 0; i < len; i++) {
      bars[i] = read(sample.slot, first + i);
    }

    // Seqlock verify: any write that started or finished while we copied
    // changed the generation — discard the sample and try again.
    if (buffer.control.generation !== sample.generation) continue;

    return {
      bars,
      generation: sample.generation,
      fromAbs: from,
      complete: wantFrom >= range.from && wantTo <= secTo,
    };
  }
  return null;
}

/**
 * Copy the requested range out of the published hot slot.
 *
 * Returns `null` when nothing can be read safely: a write is in flight for
 * the whole retry budget, the window is empty, or the request does not
 * overlap the hot window (cold ranges come from `copyOutPage`, not here).
 */
export function copyOutBars(
  buffer: HotBuffer,
  req: CopyOutRequest,
  attempts = 8,
): CopyOutResult | null {
  return copyClipped(
    buffer,
    req,
    () => ({ from: buffer.control.hotFromIndex, count: buffer.control.hotCount }),
    (slot, index) => buffer.readBar(slot, index),
    attempts,
  );
}

/**
 * Copy the requested range out of the page slot (HP PR 5, §9.2).
 *
 * `null` when the page is inactive, empty, or does not overlap — the caller
 * keeps the previous frame (or asks ingest for a page replace).
 */
export function copyOutPage(
  buffer: HotBuffer,
  req: CopyOutRequest,
  attempts = 8,
): CopyOutResult | null {
  return copyClipped(
    buffer,
    req,
    () =>
      buffer.pageActive
        ? { from: buffer.control.pageFromIndex, count: buffer.control.pageCount }
        : null,
    (_slot, index) => buffer.readPageBar(index),
    attempts,
  );
}

/**
 * What the paint path calls for a viewport: hot first, then the page slot.
 *
 * When the viewport spans both (a very zoomed-out chart), the hot window
 * wins with `complete: false` — filling the cold gap beyond one page is the
 * downsampling / conflation task (§9.2), not a copy-out one.
 */
export function copyOutViewport(
  buffer: HotBuffer,
  req: CopyOutRequest,
  attempts = 8,
): CopyOutResult | null {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.count)) return null;
  if (Math.trunc(req.count) <= 0) return null;
  const wantFrom = toIndex(req.fromAbs);
  const wantTo = wantFrom + Math.trunc(req.count);
  const hotFrom = buffer.control.hotFromIndex;
  const hotCount = buffer.control.hotCount;
  // A hint only — the copy re-samples under the seqlock.
  const overlapsHot = hotCount > 0 && wantTo > hotFrom && wantFrom < hotFrom + hotCount;
  return overlapsHot ? copyOutBars(buffer, req, attempts) : copyOutPage(buffer, req, attempts);
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

/**
 * Map a chart-window range to the ring's absolute index space (HP PR 5
 * wiring, §9.2).
 *
 * The ring is the chart's **tail window** by identity (the ring's newest bar
 * is the chart's newest bar — callers verify that by tail time first), so
 * chart index `i` is absolute `hotFrom + hotCount − chartBars + i`. The
 * range is clipped to `[0, chartBars)`; `null` when nothing mappable remains
 * (empty window, degenerate range, or the ring holding more than the chart).
 *
 * Both the cold-page pager and the GL viewport fill use this, so the page
 * `fromAbs` and the fill's `fromAbs` can never disagree.
 */
export function chartRangeToAbsolute(
  chartBars: number,
  hotFrom: number,
  hotCount: number,
  fromBase: number,
  count: number,
): { fromAbs: number; count: number } | null {
  if (!Number.isFinite(chartBars) || !Number.isFinite(hotFrom) || !Number.isFinite(hotCount)) {
    return null;
  }
  if (!Number.isFinite(fromBase) || !Number.isFinite(count)) return null;
  if (!(chartBars > 0) || !(hotCount > 0) || chartBars < hotCount) return null;
  const n = Math.trunc(count);
  if (n <= 0) return null;
  const base = Math.trunc(fromBase);
  const from = Math.max(base, 0);
  const to = Math.min(base + n, Math.trunc(chartBars));
  if (to <= from) return null;
  return { fromAbs: hotFrom + hotCount - Math.trunc(chartBars) + from, count: to - from };
}
