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
 * | `updated` | O(1) `series.update` on the forming tip, coalesced to one flush per turn |
 * | `appended` | O(1) `series.update` with the new bar, same flush; the first bar is a synchronous `setData` (`update` throws on an empty series) |
 * | `slid` | any tick already queued paints now, then a full `setData` of the windowed series (`fit` false) |
 *
 * Several `updated` / `appended` ticks in one turn share that flush
 * (`queueMicrotask`). Same-time updates collapse to the latest bar. A new
 * time is kept and applied after the prior bar in the same flush — never a
 * second `setData`. The store write stays synchronous; only the chart paint
 * waits.
 *
 * Painting a bar the store rejected is how a stale tick used to reach the
 * library: Lightweight Charts then throws `Cannot update oldest data item`
 * during the render pass, where nothing can catch it.
 *
 * @module chart/live-append
 */

import { appendBar, sliceToChartWindow, store, type BarAppendResult } from '../store';
import { getManager, setDataToChart } from './manager-access';
import { noteHpCopyOut, notePaintRequest } from './paint-latency';
import type { Bar } from '../store/types';
import { intervalToSec } from '../data/bars-gaps';
import { copyOutTail } from '../hp/paint/copy-out-lwc';
import { subscribeGeneration, type SubscribeGenerationOpts } from '../hp/sync/raf-poll';
import type { HotBuffer } from '../hp/memory/hot-buffer';

/** Chart handle this module paints through. Identity is the live manager. */
type LivePainter = { appendBar: (bar: Bar) => void };

/** Chart paint waiting for the end of this turn (`updated` / `appended` only). */
let pendingManager: LivePainter | null = null;
let pendingBars: Bar[] | null = null;
let paintScheduled = false;

function applyLivePaint(manager: LivePainter, bars: readonly Bar[]): void {
  for (const bar of bars) {
    try {
      manager.appendBar(bar);
    } catch {
      /* live paint is best-effort — the next flush repairs it */
    }
  }
}

/**
 * Queue one chart append. Same-time ticks keep the latest bar; a newer time
 * is appended so the flush does not skip a candle.
 */
function enqueueLivePaint(manager: LivePainter, bar: Bar): void {
  if (pendingManager !== manager) {
    pendingManager = manager;
    pendingBars = [bar];
  } else {
    const bars = pendingBars ?? [];
    pendingBars = bars;
    const last = bars[bars.length - 1];
    if (last && last.time === bar.time) bars[bars.length - 1] = bar;
    else bars.push(bar);
  }
  if (paintScheduled) return;
  paintScheduled = true;
  queueMicrotask(flushLivePaint);
}

function flushLivePaint(): void {
  paintScheduled = false;
  const manager = pendingManager;
  const bars = pendingBars;
  pendingManager = null;
  pendingBars = null;
  if (!manager || !bars?.length) return;
  // Torn down or swapped before the turn ended — do not paint the old chart.
  if (getManager() !== manager) return;
  applyLivePaint(manager, bars);
}

/** A slide paints the queued tick before `setData` replaces the series. */
function flushLivePaintSync(manager: LivePainter): void {
  if (pendingManager !== manager) return;
  const bars = pendingBars;
  pendingManager = null;
  pendingBars = null;
  if (!bars?.length) return;
  applyLivePaint(manager, bars);
}

/** Drop a queued paint for this chart so it cannot land after a replace. */
function cancelLivePaint(manager: LivePainter): void {
  if (pendingManager !== manager) return;
  pendingManager = null;
  pendingBars = null;
}

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
 *
 * `opts.via: 'worker'` marks engine-driven appends (ingest ring pump,
 * engine series merge/diff): only those may consume the ingest publish
 * stamp for the publish→apply stage. Venue-tick appends paint the forming
 * tip from the venue feed — pairing them with the engine's last post would
 * measure engine cadence, not dispatch latency (§14.2 causal pairing).
 */
export function appendLiveBar(bar: Bar, opts?: { via?: 'worker' }): BarAppendResult {
  const result = appendBar(bar);
  if (result === 'ignored') return result;

  // Measurement only: stamp the arrival before any paint work so the rAF
  // callback (armed on the first tick of the frame) reports tick → frame.
  notePaintRequest(undefined, opts?.via === 'worker');

  const manager = getManager();
  if (!manager) return result;

  // LWC 5.2 `series.update` appends when the point's time is newer than the
  // last bar, and throws when the series is empty or the time is older. A
  // window slide still replaces: the head moved, so `update` cannot drop it.
  // The first bar has no last bar to append onto — same replace, once.
  // `manager.appendBar` updates the candle and the volume series together.
  // Normal ticks do not call it here: one flush per turn, latest bar per time.
  if (result === 'slid' || (result === 'appended' && store.bars.length === 1)) {
    if (result === 'slid') flushLivePaintSync(manager);
    else cancelLivePaint(manager);
    const view = sliceToChartWindow(store.bars);
    try {
      setDataToChart(view, { fit: false, clearScriptState: false, clearMarkers: false });
    } catch {
      /* live paint is best-effort — the next flush repairs it */
    }
    return result;
  }

  enqueueLivePaint(manager, bar);
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
      noteHpCopyOut();
      for (const bar of contiguousTailRun(out.bars)) appendLiveBar(bar, { via: 'worker' });
    },
    // A forming tick only moves the tip seqlock; the hot generation stays
    // put, so poll the combined value or the tip would never repaint.
    { generation: () => buffer.paintGeneration, ...opts },
  );
}

/**
 * The newest-first contiguous run of `bars` that continues the store tail.
 *
 * Walk back from the newest bar while every step is exactly one interval, and
 * stop at (or just below) the store's tail. The **oldest** bar of the run
 * must then land on the tail (forming update) or exactly one interval beyond
 * it (new candle). This accepts a generation that carries several new
 * candles (a venue frame batched across a minute boundary) while still
 * rejecting a lone jumped bar (`tail + 2·step` with nothing in between).
 * Older bars are snapshot territory, not tick territory.
 */
function contiguousTailRun(bars: Bar[]): Bar[] {
  const step = intervalToSec(String(store.interval || '1m'));
  const tail = store.bars.length ? (store.bars[store.bars.length - 1]?.time ?? 0) : 0;
  if (!tail) return [];
  // Collect newest → oldest, then reverse once.
  const run: Bar[] = [];
  let cursor = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i];
    if (!bar) continue;
    if (run.length > 0 && !(step > 0 && bar.time === cursor - step)) break;
    run.push(bar);
    cursor = bar.time;
    if (bar.time <= tail) break;
  }
  run.reverse();
  const oldest = run[0];
  if (!oldest) return [];
  if (oldest.time !== tail && !(step > 0 && oldest.time === tail + step)) return [];
  return run;
}
