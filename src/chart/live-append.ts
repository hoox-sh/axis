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
 * `paintAction` in `v1/paint-action.ts` is the decision table (concept
 * §5.2 / §11). Do not re-derive the write from the verdict here.
 *
 * | Append result | Chart action |
 * | --- | --- |
 * | `ignored` | nothing changed (stale tick) — do not paint |
 * | `updated` | O(1) `series.update` on the forming tip, coalesced to one flush per turn |
 * | `appended` | O(1) `series.update` with the new bar, same flush; the first bar is a synchronous `setData` (`update` throws on an empty series) |
 * | `slid` | cancel any queued tip paint (the replace includes it), then one rAF-coalesced `setData` of the windowed series (`fit` false) |
 *
 * Several `updated` / `appended` ticks in one turn share that flush
 * (`queueMicrotask`). Same-time updates collapse to the latest bar. A new
 * time is kept and applied after the prior bar in the same flush — never a
 * second `setData`. The bar value is written immediately. Solid hears a
 * forming tip, and the quote tick, once per frame.
 *
 * A window slide still needs a full replace: LWC `update` appends a newer
 * time but cannot drop the slid head. Deferring that replace to one
 * animation frame keeps the heavy `setData` off the tick/apply path and
 * coalesces bursts. Without `requestAnimationFrame` (tests/SSR) the replace
 * runs synchronously so the series never lags the store.
 *
 * Painting a bar the store rejected is how a stale tick used to reach the
 * library: Lightweight Charts then throws `Cannot update oldest data item`
 * during the render pass, where nothing can catch it.
 *
 * @module chart/live-append
 */

import { appendBar, sliceToChartWindow, store, type BarAppendResult } from '../store';
import { chartDebug, chartDebugSample } from '../debug';
import { getManager, setDataToChart } from './manager-access';
import { notePaintRequest } from './paint-latency';
import { paintAction } from './v1/paint-action';
import type { Bar } from '../store/types';


/** Chart handle this module paints through. Identity is the live manager. */
type LivePainter = { appendBar: (bar: Bar) => void };

/** Frame scheduler for slide replaces — injectable so unit tests need no browser. */
type SlideScheduler = (cb: () => void) => void;

/** Chart paint waiting for the end of this turn (`updated` / `appended` only). */
let pendingManager: LivePainter | null = null;
let pendingBars: Bar[] | null = null;
let paintScheduled = false;

/** One pending window-slide `setData`, coalesced to a single frame. */
let slideManager: LivePainter | null = null;
let slideScheduled = false;
let slideScheduler: SlideScheduler | null = null;

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

/** Drop a queued tip paint for this chart so it cannot land after a replace. */
function cancelLivePaint(manager: LivePainter): void {
  if (pendingManager !== manager) return;
  pendingManager = null;
  pendingBars = null;
}

function defaultSlideScheduler(): SlideScheduler {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return (cb) => {
      globalThis.requestAnimationFrame(() => {
        cb();
      });
    };
  }
  // Tests / SSR: keep store and series aligned in the same turn.
  return (cb) => {
    cb();
  };
}

function runSlideReplace(): void {
  slideScheduled = false;
  const manager = slideManager;
  slideManager = null;
  if (!manager) return;
  if (getManager() !== manager) return;
  const view = sliceToChartWindow(store.bars);
  try {
    setDataToChart(view, { fit: false, clearScriptState: false, clearMarkers: false });
  } catch {
    /* live paint is best-effort — the next flush repairs it */
  }
}

/**
 * Schedule one full-window replace for a slide. Later slides in the same
 * frame reuse this callback and re-slice from the store at flush time.
 */
function scheduleSlideReplace(manager: LivePainter): void {
  slideManager = manager;
  if (slideScheduled) return;
  slideScheduled = true;
  const schedule = slideScheduler ?? defaultSlideScheduler();
  schedule(runSlideReplace);
}

/** Drop a pending slide replace so a sync first-bar `setData` wins. */
function cancelSlideReplace(manager: LivePainter): void {
  if (slideManager !== manager) return;
  slideManager = null;
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
  const action = paintAction(result, store.bars.length);
  const debugPayload = {
    verdict: result,
    paint: action,
    time: bar.time,
    close: bar.close,
    n: store.bars.length,
    via: opts?.via ?? 'venue',
  };
  if (action === 'none') {
    chartDebugSample('live.ignored', debugPayload, 2000);
    return result;
  }
  if (result === 'updated') chartDebugSample('live.append', debugPayload);
  else chartDebug('live.append', debugPayload);

  // Measurement only: stamp the arrival before any paint work so the rAF
  // callback (armed on the first tick of the frame) reports tick → frame.
  notePaintRequest(undefined, opts?.via === 'worker');

  const manager = getManager();
  if (!manager) return result;

  // LWC `series.update` appends when the point's time is newer than the last
  // bar, and throws when the series is empty or the time is older. A window
  // slide still replaces: the head moved, so `update` cannot drop it.
  // `paintAction` is the §5.2 / §11 table — do not branch on verdict here.
  // `manager.appendBar` updates the candle and the volume series together.
  // Normal ticks do not call it here: one flush per turn, latest bar per time.
  if (action === 'setData') {
    // Queued tip paints are superseded by the full replace — flushing them
    // first was a wasted `update` immediately overwritten by `setData`.
    cancelLivePaint(manager);
    if (result === 'slid') {
      scheduleSlideReplace(manager);
      return result;
    }
    // First bar: `update` throws on an empty series — replace now.
    cancelSlideReplace(manager);
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

/** Tests: swap the slide-replace frame scheduler (`null` restores default). */
export function _setSlideReplaceScheduler(next: SlideScheduler | null): void {
  slideScheduler = next;
}

/** Tests: drop any armed slide replace without painting. */
export function _resetSlideReplaceForTests(): void {
  slideManager = null;
  slideScheduled = false;
}
