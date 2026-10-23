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
 * Live bar append — the single place where a live tick reaches the chart.
 *
 * `store.appendBar` owns the **data** invariants:
 *
 * - history behind the tip is immutable (a late tick never rewrites a closed
 *   candle, and a closed tip is never reopened by a forming tick),
 * - the chart window slides its head when a new bar arrives, so the chart
 *   never grows past Settings → Rolling window.
 *
 * This module owns the **paint** invariant: `store.bars` and the Lightweight
 * Charts series must hold the same bars at all times.
 *
 * | Append result | Chart action |
 * | --- | --- |
 * | `ignored` | nothing changed (stale tick) — do not paint |
 * | `updated` | O(1) `series.update` on the forming tip |
 * | `appended` | O(1) `series.update` with the new bar |
 * | `slid` | the window head moved — full `setData` of the windowed series |
 *
 * Painting a bar the store rejected is how a stale tick used to reach the
 * library: Lightweight Charts then throws `Cannot update oldest data item`
 * during the render pass, where nothing can catch it.
 *
 * @module chart/live-append
 */

import { appendBar, sliceToChartWindow, store, type BarAppendResult } from '../store';
import { getManager, setDataToChart } from './manager-access';
import { notePaintRequest } from './paint-latency';
import type { Bar } from '../store/types';
import { intervalToSec } from '../data/bars-gaps';
import { copyOutTail } from '../hp/paint/copy-out-lwc';
import { subscribeGeneration, type SubscribeGenerationOpts } from '../hp/sync/raf-poll';
import type { HotBuffer } from '../hp/memory/hot-buffer';

/**
 * Append one live bar to the chart window and paint it.
 *
 * Safe to call on every venue tick: the store decides what actually changed.
 *
 * The verdict is returned so the caller can skip the side effects of a
 * **rejected** bar — telemetry, alert evaluation and the dataset write must
 * not run for a stale tick: the price card would show a stale price, an
 * armed alert could fire on a stale close, and the dataset would be
 * overwritten with the stale bar.
 */
export function appendLiveBar(bar: Bar): BarAppendResult {
  const result = appendBar(bar);
  if (result === 'ignored') return result;

  // Measurement only: stamp the arrival before any paint work so the rAF
  // callback (armed on the first tick of the frame) reports tick → frame.
  notePaintRequest();

  const manager = getManager();
  if (!manager) return result;

  // `series.update` can only overwrite the **last** bar in place — it never
  // adds a new time slot. So a genuinely new bar (`appended`, or a window
  // slide) must be painted as a full window replace so the new candle lands
  // at the right edge (within `rightOffset`, no auto-scroll shift). An
  // in-place forming-tick (`updated`, same time as the tip) still uses the
  // O(1) `series.update` path.
  if (result === 'slid' || result === 'appended') {
    const view = sliceToChartWindow(store.bars);
    try {
      setDataToChart(view, { fit: false, clearScriptState: false, clearMarkers: false });
    } catch {
      /* live paint is best-effort — the next flush repairs it */
    }
    return result;
  }

  try {
    manager.appendBar(bar);
  } catch {
    /* live paint is best-effort — the next flush repairs it */
  }
  return result;
}

/** How many hot-ring bars the sampler inspects per published generation. */
export const HOT_RING_PAINT_TAIL = 32;

/**
 * HP-2 paint pump: sample the hot SAB ring once per animation frame and
 * feed its published tail through {@link appendLiveBar} (§6.5 — LWC stays
 * the painter and reads a *completed* generation via copy-out; a torn
 * sample is discarded and retried inside `copyOutTail`).
 *
 * The ingest worker is the ring's single writer, so these bars reach the
 * chart without crossing `postMessage`. Only the **contiguous** tail run
 * that continues the store's last bar (same slot, or exactly one interval
 * beyond it) is appended — a ring that jumped (suspended tab, resume
 * replay) is left to the snapshot/repair path, exactly like a
 * non-contiguous wire delta. Everything the store rejects is skipped by
 * the same `appendBar` verdicts the frame path uses.
 */
export function startHotRingPaint(buffer: HotBuffer, opts?: SubscribeGenerationOpts): () => void {
  return subscribeGeneration(
    buffer.control,
    () => {
      const out = copyOutTail(buffer, HOT_RING_PAINT_TAIL);
      if (!out?.bars.length) return;
      for (const bar of contiguousTailRun(out.bars)) appendLiveBar(bar);
    },
    opts,
  );
}

/**
 * The newest-first contiguous run of `bars` that continues the store tail:
 * the last bar must land on the tail (forming update) or exactly one
 * interval beyond it (new candle), and every bar before it must step back
 * by exactly one interval. Older bars are snapshot territory, not tick
 * territory.
 */
function contiguousTailRun(bars: Bar[]): Bar[] {
  const step = intervalToSec(String(store.interval || '1m'));
  const tail = store.bars.length ? (store.bars[store.bars.length - 1]?.time ?? 0) : 0;
  const run: Bar[] = [];
  let cursor = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i];
    if (!bar) continue;
    if (!cursor) {
      if (!tail || bar.time === tail || (step > 0 && bar.time === tail + step)) {
        run.unshift(bar);
        cursor = bar.time;
      }
      continue;
    }
    if (step > 0 && bar.time === cursor - step) {
      run.unshift(bar);
      cursor = bar.time;
      continue;
    }
    break;
  }
  return run;
}
