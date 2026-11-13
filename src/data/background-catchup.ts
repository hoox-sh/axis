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
 * Background-tab recovery.
 *
 * ## Wake = full reload
 *
 * Browsers stop `requestAnimationFrame` and throttle timers in hidden tabs, so
 * a backgrounded chart can miss whole bar slots, miss ticks, and hold a stale
 * engine series. Patching that incrementally left the chart in states the rest
 * of the pipeline never sees. The rule is now simple: **when the tab wakes, the
 * chart is reloaded** (`requestChartReload('wake')`), which refetches, clears
 * the commit state, repaints, and reapplies scripts through the same path as a
 * manual Reload.
 *
 * Triggers: `visibilitychange` (hidden ≥ {@link WAKE_RELOAD_MIN_HIDDEN_MS}),
 * `focus` after that same hidden period, `pageshow` from the bfcache, and
 * `online` (the network came back, so the data almost certainly moved).
 *
 * ## Reconnect repair
 *
 * A socket reconnect while the tab stayed visible is **not** a wake. That path
 * keeps the cheaper targeted repair: {@link detectTrailingGap} finds the hole
 * and {@link repairChartGapsAfterBackground} expands + repaints without a
 * refetch, then hands the rest to the DSM backfill.
 *
 * @module data/background-catchup
 */

import type { Bar } from '../store/types';
import { intervalToSec } from './bars-gaps';
import { getVisibleBars, isReplayActive } from '../chart/bar-replay';
import { repairBars, validateDataset, venueClassForSourceCaps } from './dataset-validate';

/** A gap between the newest cached bar and the live edge that catch-up may repair. */
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
  // The repair can drop or re-time the last row, so the "newest" bar has to
  // be read from the **repaired** series — the raw tail may be a row that no
  // longer exists.
  let repaired: Bar[] = [];
  try {
    repaired = repairBars(list, interval).bars;
  } catch {
    repaired = list.slice();
  }
  const newestSec = repaired.length ? repaired[repaired.length - 1]!.time : null;
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
        : newestSec - Math.max(0, Math.min(repaired.length, 5000)) * step;
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
export async function repairChartGapsAfterBackground(reason: string = 'visible'): Promise<boolean> {
  if (repairInFlight) return false;
  const nowMs = Date.now();
  if (shouldThrottle(nowMs)) return false;
  // Arm the gate **before** the first await. `window.focus` and
  // `document.visibilitychange` fire together when the user tabs back into the
  // window — with the gate armed late, both handlers passed the checks and ran
  // two concurrent repairs (double network traffic, two DSM jobs).
  repairInFlight = true;
  lastRepairAt = nowMs;
  try {
    return await runBackgroundRepair(reason, nowMs);
  } finally {
    repairInFlight = false;
  }
}

async function runBackgroundRepair(reason: string, nowMs: number): Promise<boolean> {
  let storeMod: typeof import('../store') | null = null;
  try {
    storeMod = await import('../store');
  } catch {
    return false;
  }
  const { store, setBarsQuiet, setStatus, sliceToChartWindow } = storeMod;
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

  try {
    // Resolve the writable dataset key. Data Manager is a cache reader —
    // expand through the underlying venue selection when active.
    let expandSrc = srcId;
    let expandSym = sym;
    let expandIv = iv;
    let expandLock: { market?: string; authMode?: string } | null = null;
    if (srcId === 'data-manager') {
      try {
        const { getDataManagerSelection } = await import('./data-manager-source');
        const sel = getDataManagerSelection();
        if (sel?.sourceId && sel.symbol && sel.interval) {
          expandSrc = sel.sourceId;
          expandSym = sel.symbol;
          expandIv = sel.interval;
          expandLock = { market: sel.market, authMode: sel.authMode };
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

    // Engine-owned live mode: the engine's store owns the chart series (in the
    // stream plane the subscription's replica *is* that store). Repainting from
    // AXIS' local dataset would put the chart out of step with the engine (the
    // overlay time axis is built from `store.bars`) and would not heal the frozen
    // engine series: the next engine snapshot would simply hand back the stale
    // window. Keep the chart and push AXIS' freshest window onto the engine's
    // series instead — the next snapshot/tick paints the healed window.
    let engineOwned = false;
    try {
      const { isEngineOwnedLive } = await import('../engines/ownership');
      engineOwned = isEngineOwnedLive();
    } catch {
      /* ownership check is best-effort */
    }

    if (engineOwned) {
      try {
        const { getActiveEngineConfig } = await import('../plugins/active');
        const { noteStaleEngineSeries } = await import('../engines/series-repair');
        const { exchangeForSource } = await import('./symbol-exchange');
        const cfg = getActiveEngineConfig() || {};
        noteStaleEngineSeries({
          exchange: exchangeForSource(expandSrc),
          symbol: expandSym,
          interval: expandIv,
          engineNewest: null,
          reason: `frozen during background catch-up (${gap.missingBars} bars missing)`,
          repair: {
            endpoint: String(cfg['endpoint'] || ''),
            apiKey: String(cfg['apiKey'] || ''),
            key: {
              exchange: exchangeForSource(expandSrc),
              market: store.provider?.market || 'spot',
              symbol: expandSym,
              interval: expandIv,
            },
          },
        });
      } catch {
        /* engine series repair is best-effort */
      }
    } else {
      // Repaint the chart from the (possibly expanded) dataset so missed slots
      // appear. No viewport reset: user stays where they were.
      try {
        const { getDataset } = await import('./dataset-store');
        const { providerDatasetLock } = await import('./provider');
        const series = await getDataset(
          expandSrc,
          expandSym,
          expandIv,
          providerDatasetLock(expandLock ?? store.provider),
        );
        if (series.length) {
          const { bars: repaired } = repairBars(series, expandIv);
          if (repaired.length) {
            // The chart holds the **rolling window**, not the whole dataset —
            // a catch-up that repaints 50k bars would blow past the window
            // the engine evaluates and desync the two axes.
            const view = sliceToChartWindow(repaired);
            setBarsQuiet(view);
            try {
              const { getManager, setDataToChart } = await import('../chart/manager-access');
              const manager = getManager();
              if (manager) {
                // Bar replay paints only the scrubbed prefix; the store keeps
                // full history so catch-up never reveals future bars mid-replay.
                setDataToChart(isReplayActive() ? getVisibleBars(view) : view, {
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
    }

    // Hand remaining holes to the DSM backfill engine (validate → sliced
    // walk-back → progressive repaint). Fire-and-forget by design.
    try {
      const { ensureDatasetComplete } = await import('./dsm-orchestrator');
      void ensureDatasetComplete(expandSym, expandIv, expandSrc);
    } catch {
      /* DSM queue best-effort */
    }

    try {
      const detail = gap.missingBars > 0 ? `${gap.missingBars} bars` : `${gap.fillableGaps} gaps`;
      setStatus(
        'ready',
        engineOwned
          ? `Engine series refreshed after background (${reason}) — ${detail}`
          : `Caught up after background (${reason}) — ${detail}`,
        {
          toast: false,
          source: engineOwned ? 'engine' : 'dsm',
        },
      );
    } catch {
      /* status best-effort */
    }
    return true;
  } finally {
    /* the in-flight gate is released by the caller */
  }
}

let catchupInstalled = false;
let catchupStop: (() => void) | null = null;

/**
 * Minimum time the document must have been hidden before a wake reloads the
 * chart. Below this a `visibilitychange` is a flicker (tab switch, OS dialog)
 * and the live path still holds correct bars.
 */
export const WAKE_RELOAD_MIN_HIDDEN_MS = 1500;

/**
 * Pure wake gate: reload only when the tab was **observed** hidden for at
 * least {@link WAKE_RELOAD_MIN_HIDDEN_MS}. A plain window focus (`-1`, never
 * hidden) and a short flicker must not refetch the chart.
 */
export function shouldReloadOnWake(hiddenForMs: number): boolean {
  return Number.isFinite(hiddenForMs) && hiddenForMs >= WAKE_RELOAD_MIN_HIDDEN_MS;
}

/**
 * Install the wake listeners. A wake **reloads** the chart
 * (`requestChartReload('wake')`) instead of patching gaps.
 *
 * Idempotent — safe to call from multiplex `startLive` and app boot.
 * Returns `stop()` to detach (tests / teardown).
 */
export function startBackgroundCatchup(): () => void {
  if (catchupInstalled && catchupStop) return catchupStop;
  catchupInstalled = true;

  let hiddenAt = 0;

  const reloadOnWake = () => {
    const hiddenFor = hiddenAt > 0 ? Date.now() - hiddenAt : -1;
    hiddenAt = 0;
    if (!shouldReloadOnWake(hiddenFor)) return;
    void import('../chart/reload')
      .then((m) => m.requestChartReload('wake'))
      .catch(() => {
        /* reload is best-effort; the next trigger retries */
      });
  };

  const onVisibility = () => {
    let hidden = false;
    try {
      hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    } catch {
      /* non-DOM — treat as visible */
    }
    if (hidden) {
      hiddenAt = Date.now();
      return;
    }
    reloadOnWake();
  };
  const onFocus = () => reloadOnWake();
  const onOnline = () => {
    hiddenAt = 0;
    void import('../chart/reload').then((m) => m.requestChartReload('wake')).catch(() => {});
  };
  const onPageShow = (e: Event) => {
    // bfcache restore: the page was frozen, not hidden — always reload.
    if ((e as PageTransitionEvent).persisted) {
      hiddenAt = 0;
      void import('../chart/reload').then((m) => m.requestChartReload('wake')).catch(() => {});
    }
  };

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('online', onOnline);
      window.addEventListener('pageshow', onPageShow);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onVisibility);
    }
  } catch {
    /* non-DOM runtimes */
  }

  catchupStop = () => {
    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('pageshow', onPageShow);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibility);
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
