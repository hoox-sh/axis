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
 * Viewport paging — the cold → page copy (HP PR 5, §9.2).
 *
 * The SAB never grows to hold the series. When the viewport pans out of the
 * hot window, ingest plans **one page** of cold bars (at most `HOT_CAP`) and
 * replaces the single-buffered page slot with it:
 *
 * - request overlaps the hot window → `ack` (no copy; `release` also retires
 *   a page that is no longer needed);
 * - request is outside the hot window → `replace` with the cold slice,
 *   clipped to one page — a far-left jump *replaces*, it never appends, and
 *   "fit content" cannot pull 100k bars into shared memory;
 * - the live tip stays in the hot window / tip slot regardless (§9.2.4), so
 *   a page replace never pauses the forming bar.
 *
 * Rung 1 (no SAB at all): `copyOutPageFromCold` serves the viewport straight
 * from the worker's cold store, so panning still works without the buffer.
 *
 * @module hp/memory/page-buffer
 */

import type { Bar } from '../../store/types';
import { HOT_CAP } from '../axb1/constants';
import type { ColdStore } from './cold-store';
import type { HotBarTicks, HotBuffer } from './hot-buffer';
import { barToTicks } from './hot-buffer';

/** One page holds at most the hot capacity — a jump replaces, never grows. */
export const PAGE_CAPACITY = HOT_CAP;

export type ViewportRequest = { fromAbs: number; count: number };

export type HotRange = { fromIndex: number; count: number };

export type ViewportPagePlan =
  /** Overlaps the hot window: nothing to copy. */
  | { action: 'ack' }
  /** Overlaps the hot window and a page is up: retire the page. */
  | { action: 'release' }
  /** Outside the hot window: replace the page with this cold slice. */
  | { action: 'replace'; fromAbs: number; count: number; clipped: boolean };

/**
 * Decide what ingest must do about the page slot for a viewport request.
 *
 * Pure — the caller reads the current hot range from the control block and
 * fetches cold bars only when the plan says `replace`.
 */
export function planViewportPage(
  req: ViewportRequest,
  hot: HotRange,
  opts: { pageActive?: boolean; capacity?: number } = {},
): ViewportPagePlan {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.count)) return { action: 'ack' };
  const count = Math.trunc(req.count);
  if (count <= 0) return { action: 'ack' };

  const wantFrom = Math.trunc(req.fromAbs);
  const wantTo = wantFrom + count;
  const hotTo = hot.fromIndex + hot.count;
  if (hot.count > 0 && wantTo > hot.fromIndex && wantFrom < hotTo) {
    return opts.pageActive ? { action: 'release' } : { action: 'ack' };
  }

  const capacity = opts.capacity ?? PAGE_CAPACITY;
  const clipped = count > capacity;
  return { action: 'replace', fromAbs: wantFrom, count: Math.min(count, capacity), clipped };
}

/**
 * Ingest: copy one cold range into the page slot (a replace, per §9.2.3).
 *
 * `coldBars` is whatever the cold store returned for the planned range; it
 * is clipped to the page capacity here as a second line of defence. An empty
 * slice retires the page instead of leaving a stale one marked active.
 * Returns how many bars landed in the page.
 */
export function publishViewportPage(
  buffer: HotBuffer,
  coldBars: readonly HotBarTicks[],
  fromAbs: number,
): number {
  const cap = buffer.layout.cap;
  const page = coldBars.length > cap ? coldBars.slice(0, cap) : coldBars;
  if (!page.length) {
    buffer.clearPage();
    return 0;
  }
  buffer.publishPage(page, { pageFromIndex: fromAbs });
  return page.length;
}

/**
 * Main-thread cold page → page slot, converted with the buffer's own price
 * scale (HP PR 5 wiring, §9.2).
 *
 * The main thread owns the full chart window, but only ingest may write the
 * SAB — so the ingest worker calls this on a `page` message instead of the
 * main thread writing directly (a second writer would tear the shared
 * seqlock generation). Empty `bars` retires the page.
 */
export function publishBarPage(buffer: HotBuffer, bars: readonly Bar[], fromAbs: number): number {
  if (!bars.length) {
    buffer.clearPage();
    return 0;
  }
  const scale = buffer.priceScale;
  return publishViewportPage(
    buffer,
    bars.map((b) => barToTicks(b, scale)),
    fromAbs,
  );
}

/**
 * Rung 1 fallback (no SAB / allocation failed): serve the viewport straight
 * from the cold store — clipped float64 bars, no seqlock, no shared memory.
 */
export function copyOutPageFromCold(
  cold: ColdStore,
  req: ViewportRequest,
): { bars: Bar[]; fromAbs: number; complete: boolean } | null {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.count)) return null;
  const count = Math.trunc(req.count);
  if (count <= 0) return null;

  const wantFrom = Math.trunc(req.fromAbs);
  const wantTo = wantFrom + count;
  const from = Math.max(wantFrom, 0);
  const to = Math.min(wantTo, cold.length);
  if (to <= from) return null;
  return {
    bars: cold.readBars(from, to - from),
    fromAbs: from,
    complete: wantFrom >= 0 && wantTo <= cold.length,
  };
}

/**
 * Merge one page request from the main-thread slice and the worker's cold
 * store (hp2 B1: worker-side cold read).
 *
 * `mainBars[j]` covers absolute slot `fromAbs + j` (the caller's contract —
 * the pager shifts the base when the chart head clips). Slots the main
 * slice does not cover are filled from cold, but only when cold covers
 * them absolutely (`coverage().complete` with the slot inside
 * `[baseAbs, baseAbs + length)`); anything else truncates the page at the
 * first uncovered slot instead of inventing a bar. An empty result retires
 * the page, exactly like an empty `page` message does today.
 */
export function mergePageBars(
  cold: ColdStore | null,
  fromAbs: number,
  count: number,
  mainBars: readonly Bar[],
): { bars: Bar[]; fromAbs: number } {
  const base = Math.trunc(fromAbs);
  const want = Math.min(Math.max(0, Math.trunc(count)), PAGE_CAPACITY);
  if (!Number.isFinite(base) || want <= 0) return { bars: [], fromAbs: base };
  const cov = cold?.coverage();
  const coldUsable = !!cold && !!cov && cov.complete;
  const out: Bar[] = [];
  for (let j = 0; j < want; j++) {
    const main = j < mainBars.length ? mainBars[j] : undefined;
    if (main) {
      out.push(main);
      continue;
    }
    if (!coldUsable || !cold || !cov) break;
    const slot = base + j - cov.baseAbs;
    if (slot < 0 || slot >= cov.length) break;
    const filled = cold.readBars(base + j, 1);
    if (!filled.length) break;
    out.push(filled[0] as Bar);
  }
  return { bars: out, fromAbs: base };
}
