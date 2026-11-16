/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Dev-only "Mock Walk 10s" venue.
 *
 * Loads the deterministic 5000-bar synthetic 10s series via `loadBars`
 * (symbol `MOCK-WALK`), enters bar replay at bar 4000 (cursor 3999), and lets
 * the user walk forward 50/100/250/500/1000 bars at a time from the replay
 * strip. Every replay step re-applies the visible indicators against the
 * *visible prefix* (like the live path, but with a forced full re-run) so
 * indicator repaint behavior is observable against a known-good reference.
 *
 * The `MockWalkPanel` (src/ui/MockWalkPanel.tsx) shows reference TA values
 * computed independently in TS from {@link ./ta-reference} for the same
 * prefix. Never wired up in production builds — the entry point is a
 * debug-gated topbar button (`isAxisDebug()`).
 *
 * @module dev/mock-walk
 */

import { createSignal } from 'solid-js';
import type { Bar } from '../store/types';
import { loadBars, store } from '../store';
import { barPlane } from '../stores/bars';
import { getVisibleBars, startReplaySession } from '../chart/bar-replay';
import { setDataToChart } from '../chart/manager-access';
import { stopLive } from '../streams/multiplex';
import { mockWalkBars } from './mock-walk-bars';
import { setMockWalkVenueActive } from './venue-active';
import { donchian, ema, rma, rsi, sma } from './ta-reference';

/**
 * Reactive venue flag. `true` from the moment {@link startMockWalk10s} is
 * called until {@link stopMockWalk} resets it. The panel and replay strip
 * gate their mock-walk affordances on this signal.
 */
export const [mockWalkActive, setMockWalkActive] = createSignal(false);

/** Non-reactive read of {@link mockWalkActive} for imperative call sites. */
export function isMockWalkActive(): boolean {
  return mockWalkActive();
}

/**
 * Leave the mock-walk venue (panel + walk buttons hide). Does NOT exit bar
 * replay — the replay strip's Exit button remains the way out, and the chart
 * keeps whatever it is showing.
 */
export function stopMockWalk(): void {
  setMockWalkVenueActive(false);
  setMockWalkActive(false);
}

/**
 * Leave the mock-walk venue entirely: drop the fence and reload whatever the
 * user was looking at before the venue was entered (BTCUSDT by default).
 * The replay Exit button calls this; a venue entered mid-replay stays usable.
 */
export function exitMockWalkVenue(): void {
  if (!isMockWalkActive()) return;
  const prev = venueSelection;
  venueSelection = null;
  stopMockWalk();
  const target = prev ?? { symbol: 'BTCUSDT', interval: '1m', source: 'binance-rest' };
  void import('../data/load-symbol').then((m) => {
    void m.loadSymbolData(target.symbol, target.interval, target.source);
  });
}

/**
 * Enter the mock-walk venue: stop live streaming, load the 5000-bar synthetic
 * series, enter replay at bar 4000 and paint only the visible prefix.
 *
 * Replay is started before `loadBars` so the `chartDataGen` bump inside the
 * load already paints the prefix; the explicit paint afterwards makes that
 * deterministic regardless of host paint timing.
 */
let venueSelection: { symbol: string; interval: string; source: string } | null = null;

export function startMockWalk10s(): boolean {
  if (store.live.active) stopLive();
  // Fence every live-data ingress before the venue takes over the chart,
  // so a late boot load / live delta cannot scribble foreign bars onto the
  // mock series. Remember where the user was so the Exit path can return.
  setMockWalkVenueActive(true);
  venueSelection = {
    symbol: String(store.symbol || ''),
    interval: String(store.interval || ''),
    source: String(store.source || ''),
  };
  const bars = mockWalkBars();
  // Flag first so anything reacting to the replay start / gen bump sees the
  // venue as active.
  setMockWalkActive(true);
  startReplaySession(bars.length, { cursorIndex: bars.length - 1001 });
  loadBars(bars, 'MOCK-WALK', '10s', 'mock');
  const full = barPlane.bars as Bar[];
  if (full.length) {
    setDataToChart(getVisibleBars(full), { fit: false, clearMarkers: false });
  }
  return true;
}

let reapplyTimer: ReturnType<typeof setTimeout> | undefined;
let pendingResolvers: Array<() => void> = [];

/**
 * Debounced (120 ms) forced re-apply of the visible scripts against the
 * current replay prefix. No-op unless the mock-walk venue is active.
 *
 * Full re-run (`force: true`, `bars:` override) — the whole point is to
 * observe repaint behavior, so the batch fast path is bypassed downstream in
 * `reapplyChartScripts`. Errors are logged, never thrown into the UI.
 */
export async function reapplyVisibleScripts(): Promise<void> {
  if (!isMockWalkActive()) return;
  if (reapplyTimer !== undefined) clearTimeout(reapplyTimer);
  const done = new Promise<void>((resolve) => {
    pendingResolvers.push(resolve);
  });
  reapplyTimer = setTimeout(() => {
    reapplyTimer = undefined;
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    if (!isMockWalkActive()) {
      for (const resolve of resolvers) resolve();
      return;
    }
    void (async () => {
      try {
        const vis = getVisibleBars(barPlane.bars as Bar[]);
        const { reapplyChartScripts } = await import('../indicators/reapply');
        await reapplyChartScripts({ force: true, bars: vis });
      } catch (err) {
        console.warn('[axis] mock-walk indicator re-apply failed:', err);
      } finally {
        for (const resolve of resolvers) resolve();
      }
    })();
  }, 120);
  return done;
}

export interface MockWalkReference {
  close: number | null;
  sma20: number | null;
  ema20: number | null;
  rma14: number | null;
  rsi14: number | null;
  donchUpper: number | null;
  donchMid: number | null;
  donchLower: number | null;
}

const NULL_REFERENCE: MockWalkReference = {
  close: null,
  sma20: null,
  ema20: null,
  rma14: null,
  rsi14: null,
  donchUpper: null,
  donchMid: null,
  donchLower: null,
};

function finiteOrNull(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Reference TA stats for the LAST bar of the given (visible-prefix) bars,
 * computed independently of the engine from the ta-reference implementations.
 * Cells that are not defined yet (warm-up) come back as `null`.
 */
export function getMockWalkReference(visibleBars: readonly Bar[]): MockWalkReference {
  const n = visibleBars.length;
  if (n === 0) return { ...NULL_REFERENCE };
  const closes = new Array<number>(n);
  const highs = new Array<number>(n);
  const lows = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const b = visibleBars[i];
    closes[i] = b?.close ?? Number.NaN;
    highs[i] = b?.high ?? Number.NaN;
    lows[i] = b?.low ?? Number.NaN;
  }
  const last = n - 1;
  const sma20 = sma(closes, 20);
  const ema20 = ema(closes, 20);
  const rma14 = rma(closes, 14);
  const rsi14 = rsi(closes, 14);
  const dc = donchian(highs, lows, 20);
  return {
    close: finiteOrNull(closes[last]),
    sma20: finiteOrNull(sma20[last]),
    ema20: finiteOrNull(ema20[last]),
    rma14: finiteOrNull(rma14[last]),
    rsi14: finiteOrNull(rsi14[last]),
    donchUpper: finiteOrNull(dc.upper[last]),
    donchMid: finiteOrNull(dc.middle[last]),
    donchLower: finiteOrNull(dc.lower[last]),
  };
}
