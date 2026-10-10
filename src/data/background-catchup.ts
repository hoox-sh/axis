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
 * Background-tab gap catch-up — DSM auto-identifies and repairs holes left
 * while the page was hidden / throttled, so the chart always delivers correct data.
 *
 * Why this exists: browsers stop `requestAnimationFrame` and throttle
 * `setTimeout`/`setInterval` in hidden tabs. Live ticks queue up (or are
 * coalesced), WS reconnect backoffs stretch, and the chart can miss whole bar
 * slots. On return to foreground the series would show gaps until the next
 * manual Reload. This module closes that loop:
 *
 * 1. {@link detectTrailingGap} — pure check: is the chart tail stale vs now,
 *    or are there fillable gaps in the visible window?
 * 2. {@link repairChartGapsAfterBackground} — REST-expand the dataset toward
 *    now (`expandCachedSeriesToNow`), repaint store + chart without viewport
 *    reset, then hand remaining holes to the DSM backfill engine
 *    (`ensureDatasetComplete` / `startBackfill`).
 * 3. {@link startBackgroundCatchup} — installs `visibilitychange` / `focus` /
 *    `online` listeners (same pattern as `update/update-manager`) that trigger
 *    a throttled repair whenever the tab becomes visible again.
 *
 * Idempotent, throttled (min 10 s between repairs), never throws, no-ops when
 * nothing is loaded or no live session needs it. Safe to call from the live
 * multiplex and from app boot.
 *
 * @module data/background-catchup
 */

import type { Bar } from '../store/types';
import { intervalToSec } from './bars-gaps';
import { getVisibleBars, isReplayActive } from '../chart/bar-replay';
import { repairBars, validateDataset, venueClassForSourceCaps } from './dataset-validate';

export interface TrailingGap {
  /** True when the chart tail is stale or fillable holes exist. */
  stale: boolean;
  /** Newest bar time in the checked series (null when empty). */
  newestSec: number | null;
  /** First missing open time when stale (null when fresh). */
  gapFromSec: number | null;
  /** Approximate missing bars at the interval step. */
  missingBars: number;
  /** Fillable (venue should have data) holes inside the window. */
  fillableGaps: number;
}

/**
 * Pure check: does `bars` need a background catch-up repair?
 *
 * Trailing staleness (`now - newest > step * 1.5`) means whole slots were
 * missed while hidden. Internal fillable gaps (venue calendar aware) mean
 * coalesced ticks dropped intermediate bars. Either sets `stale: true`.
 */
export function detectTrailingGap(
  bars: readonly Bar[],
  interval: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  opts?: { fromSec?: number; venueClass?: '24/7' | 'sessions' },
): TrailingGap {
  const step = intervalToSec(interval);
  const list = Array.isArray(bars) ? bars : [];
  const newestSec = list.length ? list[list.length - 1]!.time : null;
  if (newestSec == null || !Number.isFinite(newestSec)) {
    return { stale: false, newestSec: null, gapFromSec: null, missingBars: 0, fillableGaps: 0 };
  }
  const now = Math.floor(nowSec);
  const trailingMissing =
    now - newestSec > step * 1.5 ? Math.max(1, Math.floor((now - newestSec) / step)) : 0;

  let fillableGaps = 0;
  try {
    const fromSec =
      typeof opts?.fromSec === 'number' && Number.isFinite(opts.fromSec)
        ? Math.floor(opts.fromSec)
        : newestSec - Math.max(0, Math.min(list.length, 5000)) * step;
    const { bars: repaired } = repairBars(list, interval);
    const report = validateDataset(repaired, fromSec, now, interval, {
      venueClass: opts?.venueClass ?? '24/7',
    });
    fillableGaps = report.fillableGaps.length;
  } catch {
    fillableGaps = 0;
  }

  const stale = trailingMissing > 0 || fillableGaps > 0;
  return {
    stale,
    newestSec,
    gapFromSec: stale ? newestSec + step : null,
    missingBars: trailingMissing,
    fillableGaps,
  };
}

/** Minimum gap between automatic repairs (ms). */
export const BACKGROUND_CATCHUP_THROTTLE_MS = 10_000;

let lastRepairAt = 0;
let repairInFlight = false;

/** @internal test helper — reset throttle + flight gate between cases. */
export function _resetBackgroundCatchupForTests(): void {
  lastRepairAt = 0;
  repairInFlight = false;
}

/** @internal test helper — force the throttle window for deterministic tests. */
export function _setBackgroundCatchupLastRepairForTests(at: number): void {
  lastRepairAt = at;
}

function shouldThrottle(now: number): boolean {
  return now - lastRepairAt < BACKGROUND_CATCHUP_THROTTLE_MS;
}

/**
 * Repair chart holes left by a backgrounded tab.
 *
 * Reads the live chart series from the store, detects trailing staleness /
 * fillable gaps, REST-expands the dataset toward now, repaints store + chart
 * (no viewport reset), and queues a DSM backfill for anything still missing.
 *
 * Returns `true` when a repair ran (or was already complete), `false` when
 * skipped (empty chart, throttled, in-flight, or nothing stale). Never throws.
 */
export async function repairChartGapsAfterBackground(
  reason: string = 'visible',
): Promise<boolean> {
  if (repairInFlight) return false;
  const nowMs = Date.now();
  if (shouldThrottle(nowMs)) return false;
  let storeMod: typeof import('../store') | null = null;
  try {
    storeMod = await import('../store');
  } catch {
    return false;
  }
  const { store, setBarsQuiet, setStatus } = storeMod;
  const bars = store.bars as Bar[];
  const sym = String(store.symbol || '').trim();
  const iv = String(store.interval || '1d');
  const srcId = String(store.source || '');
  if (!bars?.length || !sym || !srcId) return false;

  let venueClass: '24/7' | 'sessions' = '24/7';
  try {
    const { getSource } = await import('../sources/catalog');
    venueClass = venueClassForSourceCaps(getSource(srcId)?.capabilities);
  } catch {
    /* calendar check is best-effort */
  }

  const gap = detectTrailingGap(bars, iv, Math.floor(nowMs / 1000), { venueClass });
  if (!gap.stale) return false;

  repairInFlight = true;
  lastRepairAt = nowMs;
  try {
    // Resolve the writable dataset key. Data Manager is a cache reader —
    // expand through the underlying venue selection when active.
    let expandSrc = srcId;
    let expandSym = sym;
    let expandIv = iv;
    if (srcId === 'data-manager') {
      try {
        const { getDataManagerSelection } = await import('./data-manager-source');
        const sel = getDataManagerSelection();
        if (sel?.sourceId && sel.symbol && sel.interval) {
          expandSrc = sel.sourceId;
          expandSym = sel.symbol;
          expandIv = sel.interval;
        }
      } catch {
        /* fall back to store key */
      }
    }

    let expanded = false;
    try {
      const { expandCachedSeriesToNow } = await import('./expand-cache');
      const res = await expandCachedSeriesToNow(expandSrc, expandSym, expandIv);
      expanded = res.expanded || res.added > 0;
    } catch {
      /* expand is best-effort — dataset repaint below still runs */
    }

    // Repaint the chart from the (possibly expanded) dataset so missed slots
    // appear. No viewport reset: user stays where they were.
    try {
      const { getDataset } = await import('./dataset-store');
      const series = await getDataset(expandSrc, expandSym, expandIv);
      if (series.length) {
        const { bars: repaired } = repairBars(series, expandIv);
        if (repaired.length) {
          setBarsQuiet(repaired);
          try {
            const { getManager, setDataToChart } = await import('../chart/manager-access');
            const manager = getManager();
            if (manager) {
              // Bar replay paints only the scrubbed prefix; the store keeps
              // full history so catch-up never reveals future bars mid-replay.
              setDataToChart(isReplayActive() ? getVisibleBars(repaired) : repaired, {
                fit: false,
                clearScriptState: false,
                clearMarkers: false,
              });
            }
          } catch {
            /* chart repaint is best-effort */
          }
        }
      } else if (!expanded) {
        // Dataset empty and nothing expanded — store.bars is all we have;
        // still hand the window to the DSM engine below via ensureDatasetComplete.
      }
    } catch {
      /* repaint best-effort */
    }

    // Hand remaining holes to the DSM backfill engine (validate → sliced
    // walk-back → progressive repaint). Fire-and-forget by design.
    try {
      const { ensureDatasetComplete } = await import('./dsm-orchestrator');
      ensureDatasetComplete(expandSym, expandIv, expandSrc);
    } catch {
      /* DSM queue best-effort */
    }

    try {
      const detail =
        gap.missingBars > 0 ? `${gap.missingBars} bars` : `${gap.fillableGaps} gaps`;
      setStatus('ready', `Caught up after background (${reason}) — ${detail}`, {
        toast: false,
        source: 'dsm',
      });
    } catch {
      /* status best-effort */
    }
    return true;
  } finally {
    repairInFlight = false;
  }
}

let catchupInstalled = false;
let catchupStop: (() => void) | null = null;

/**
 * Install `visibilitychange` / `focus` / `online` triggers for automatic
 * background gap repair (same listener pattern as `update/update-manager`).
 * Idempotent — safe to call from multiplex `startLive` and app boot.
 * Returns `stop()` to detach (tests / teardown).
 */
export function startBackgroundCatchup(): () => void {
  if (catchupInstalled && catchupStop) return catchupStop;
  catchupInstalled = true;

  const onVisible = () => {
    try {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    } catch {
      /* non-DOM — still attempt repair */
    }
    void repairChartGapsAfterBackground('visible').catch(() => {
      /* never break the UI thread */
    });
  };
  const onFocus = () => {
    void repairChartGapsAfterBackground('focus').catch(() => {});
  };
  const onOnline = () => {
    void repairChartGapsAfterBackground('online').catch(() => {});
  };

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('online', onOnline);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onVisible);
    }
  } catch {
    /* non-DOM runtimes */
  }

  catchupStop = () => {
    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('online', onOnline);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    } catch {
      /* ignore */
    }
    catchupInstalled = false;
    catchupStop = null;
  };
  return catchupStop;
}

/** @internal test helper — detach listeners installed by {@link startBackgroundCatchup}. */
export function _resetBackgroundCatchupListenersForTests(): void {
  try {
    catchupStop?.();
  } catch {
    /* ignore */
  }
  catchupInstalled = false;
  catchupStop = null;
}
