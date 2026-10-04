// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Live multiplex** — single active chart stream wired to store + chart + indicators.
 *
 * Owns at most one `StreamPlugin.start()` lifecycle. On each bar:
 * 1. {@link appendBar} into the Solid store
 * 2. {@link PaneManager.appendBar} for the price series
 * 3. Debounced silent {@link runAndApply} for visible scripts (every tick /
 *    closed bar / time advance, per `store.live.rerunOn`)
 *
 * Telemetry plane `stream` tracks connect/open/error; green status only after
 * `onStatus({ state: 'open' })`.
 *
 * Lifecycle hardening:
 * - Session epoch ignores stale callbacks after stop / restart
 * - `stopLive` is re-entrant-safe and cancels reconnect timers via stream `stop()`
 * - Stream hard errors keep error telemetry while clearing `live.active`
 *
 * ## Public API
 *
 * - {@link startLive} / {@link stopLive} / {@link syncLiveToPreference} — Topbar, Load, Settings
 * - {@link getAvailableStreams} — catalog listing for UI
 * - Re-exports: {@link listStreams}, {@link defaultStreamForSource}, {@link StreamPlugin}
 *
 * Independent of watchlist quote mux (`data/watchlist-live`) — different product
 * (OHLCV vs ticker) and lifecycle.
 *
 * @module streams/multiplex
 */

import type { Bar } from '../store/types';
import {
  appendBar,
  setLive,
  store,
  setStore,
  setStatus,
  appendLog,
  noteTick,
  setTelemetryPlane,
  setTelemetryState,
} from '../store';
import { getManager, setDataToChart } from '../chart/manager-access';
import { isReplayActive, stopReplaySession } from '../chart/bar-replay';
import { isInteractiveRunInFlight, runAndApply } from '../indicators/runner';
import { isStudyActive } from '../optimize/guard';
import { orderIndicatorsByPlotDeps } from '../results/plot-sources';
import { detectScriptKind } from '../indicators/script-meta';
import {
  getStream,
  listStreams,
  defaultStreamForSource,
  type StreamPlugin,
} from './catalog';
import { noteDataManagerLiveBar } from '../data/expand-cache';
import { sanitizeBar } from '../data/parse-bars';
import { pluginKey } from '../plugins/types';
import { classifyTransport } from '../ui/telemetry';
import { HEAVY_BARS_THRESHOLD } from '../chart/heavy-data';
import { noteLiveBarForAlerts } from '../alerts/tick';

export type { StreamPlugin };
export { listStreams, defaultStreamForSource };

/**
 * When history is this large, live `every-tick` re-runs are treated as
 * `bar-close` so we do not re-serialize full OHLCV for the engine every open-bar tick.
 * User-selected `bar-close` is unchanged. Aligns with {@link HEAVY_BARS_THRESHOLD}.
 */
export const HEAVY_LIVE_RERUN_BARS = HEAVY_BARS_THRESHOLD;

/** Effective live re-run mode after heavy-history throttle. */
export function effectiveLiveRerunMode(
  mode: 'every-tick' | 'bar-close' | undefined,
  barCount: number,
): 'every-tick' | 'bar-close' {
  if (mode === 'bar-close') return 'bar-close';
  if (Number.isFinite(barCount) && barCount >= HEAVY_LIVE_RERUN_BARS) {
    return 'bar-close';
  }
  return 'every-tick';
}

/** How the live session ended (affects telemetry wipe). */
export type StopLiveReason = 'user' | 'error' | 'restart';

export type StopLiveOpts = {
  /** `error` keeps stream error telemetry; `restart` is silent (startLive follows). */
  reason?: StopLiveReason;
  /** When reason is `error`, optional message for status / telemetry. */
  error?: string;
};

let currentStop: (() => void) | null = null;
/** Bumped on every start/stop so late callbacks from a prior session are ignored. */
let liveEpoch = 0;
let rerunTimer: ReturnType<typeof setTimeout> | null = null;
let rerunInFlight = false;
/** Test-only: increments each time a debounced live re-run is attempted. */
let rerunAttemptCount = 0;
/**
 * Live bars waiting for paint flush.
 *
 * Queue (not a single slot): `requestAnimationFrame` never fires in a hidden
 * tab, so keeping only the newest bar would silently drop whole closed slots
 * and leave gaps in aggregation. Every sanitized tick is appended here and
 * flushed in order — at most one rAF paint per frame while visible, via a
 * `setTimeout` fallback while hidden / throttled.
 */
let pendingLiveBars: Bar[] = [];
/** rAF handle for the queued flush; cancelled on stop. */
let liveBarRaf = 0;
/** Fallback timer when rAF is unavailable or the tab is hidden/throttled. */
let liveBarTimer: ReturnType<typeof setTimeout> | null = null;
/** Safety flush so a throttled hidden tab still advances (ms). */
const LIVE_BAR_FALLBACK_MS = 250;

/** @internal Test helper — live re-run attempts since last reset. */
export function _getRerunAttemptCountForTests(): number {
  return rerunAttemptCount;
}

/** @internal Test helper — current live session epoch. */
export function _getLiveEpochForTests(): number {
  return liveEpoch;
}

/** @internal Test helper — queued live bars awaiting flush. */
export function _getPendingLiveBarCountForTests(): number {
  return pendingLiveBars.length;
}

/** True when the page is hidden (rAF will not fire) — best-effort. */
function isPageHidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

/** Cancel queued live-bar flush (stop / test reset). */
function cancelPendingLiveBarFlush(): void {
  pendingLiveBars = [];
  if (liveBarRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(liveBarRaf);
  }
  liveBarRaf = 0;
  if (liveBarTimer) {
    clearTimeout(liveBarTimer);
    liveBarTimer = null;
  }
}

/** @internal Test helper — clear multiplex timers/gates between cases. */
export function _resetMultiplexForTests(): void {
  liveEpoch += 1;
  cancelPendingLiveBarFlush();
  if (currentStop) {
    try {
      currentStop();
    } catch {
      /* ignore */
    }
    currentStop = null;
  }
  if (rerunTimer) {
    clearTimeout(rerunTimer);
    rerunTimer = null;
  }
  rerunInFlight = false;
  rerunAttemptCount = 0;
}

/** Registered stream plugins (built-in + dynamic). */
export function getAvailableStreams(): StreamPlugin[] {
  return listStreams();
}

/**
 * Start (or restart) live updates for `symbol`/`interval` via the given stream.
 * Stops any previous stream first (including mid-reconnect). Resolves unknown
 * ids via {@link defaultStreamForSource}.
 *
 * `symbol` / `interval` default to the current store values so callers can
 * restart with a stream id only (e.g. tests, command palette).
 */
export function startLive(
  streamId: string,
  symbol: string = store.symbol,
  interval: string = store.interval,
) {
  // Tear down prior session (cancels reconnect timers / WS) without log noise
  stopLive({ reason: 'restart' });

  const epoch = ++liveEpoch;

  // Bar replay must not run alongside live ticks — exit + restore full series
  if (isReplayActive()) {
    stopReplaySession();
    if (store.bars.length) {
      setDataToChart(store.bars, { fit: false, clearMarkers: false });
    }
  }

  // Auto-pick stream if id missing / mismatched for source
  let id = streamId || store.live.streamId;
  if (!getStream(id)) {
    id = defaultStreamForSource(store.source);
  }
  const stream = getStream(id);
  if (!stream) {
    setStatus('error', `Unknown stream: ${id}`);
    setTelemetryState('stream', 'error', { error: `Unknown stream: ${id}` });
    setStore('stream', 'status', 'error');
    setLive(false);
    return;
  }

  const sym = symbol || store.symbol || 'BTCUSDT';
  const iv = interval || store.interval || '1m';

  setStore('live', 'streamId', id);
  setStore('activePlugins', 'stream', id);
  setLive(true);
  // Honest connect state — green only after onStatus(open)
  setStore('stream', 'status', 'connecting');
  const transport = classifyTransport('stream', stream.id, stream.capabilities);
  setTelemetryPlane('stream', {
    id: stream.id,
    name: stream.name,
    transport,
    state: 'connecting',
    detail: `${sym} ${iv}`,
    error: null,
  });
  appendLog('info', `Live start · ${stream.name} · ${sym} ${iv}`, 'stream');

  /** Wall clock when this burst entered reconnect. Recover toasts only after a long outage. */
  let outageSince = 0;
  const LONG_OUTAGE_MS = 8000;

  const lastBar = store.bars.length ? store.bars[store.bars.length - 1] : null;
  let lastSeenBarTime = lastBar?.time ?? 0;

  /** True only while this startLive session is still the active epoch. */
  const isCurrent = () => liveEpoch === epoch && store.live.active;

  /**
   * Apply queued live bars to store + chart in order.
   * Trade-level streams (Coinbase ticker) can fire 10–100+/s; rAF keeps UI
   * ≤1 paint/frame while visible. Hidden tabs fall back to a timer so no
   * closed slot is ever dropped — the queue (not a single slot) guarantees
   * every bar advances aggregation, even under background throttling.
   */
  const flushPendingBar = () => {
    liveBarRaf = 0;
    if (liveBarTimer) {
      clearTimeout(liveBarTimer);
      liveBarTimer = null;
    }
    if (!isCurrent()) {
      pendingLiveBars = [];
      return;
    }
    const queue = pendingLiveBars;
    pendingLiveBars = [];
    if (!queue.length) return;
    try {
      // Coalesce same-slot updates (open-bar ticks) but keep every distinct
      // bar time so closed slots are never skipped after background gaps.
      const ordered: Bar[] = [];
      for (const b of queue) {
        const prev = ordered[ordered.length - 1];
        if (prev && prev.time === b.time) ordered[ordered.length - 1] = b;
        else ordered.push(b);
      }
      let shouldRerun = false;
      for (const bar of ordered) {
        if (!isCurrent()) break;
        appendBar(bar);
        const manager = getManager();
        if (manager) manager.appendBar(bar);
        noteTick(bar.close, bar.time, sym);
        noteLiveBarForAlerts(bar);

        // Data Manager: grow the underlying bars-cache dataset with live ticks
        noteDataManagerLiveBar(bar);

        const timeAdvanced = lastSeenBarTime > 0 && bar.time > lastSeenBarTime;
        lastSeenBarTime = Math.max(lastSeenBarTime, bar.time);
        // Heavy histories: throttle every-tick → bar-close to avoid full engine re-encode
        const mode = effectiveLiveRerunMode(
          store.live.rerunOn,
          store.bars?.length ?? 0,
        );
        if (mode === 'every-tick' || bar.closed || timeAdvanced) {
          shouldRerun = true;
        }
      }
      if (shouldRerun && isCurrent()) scheduleRerun();
    } catch {
      /* never let a single tick tear down the live session / UI */
    }
  };

  /** Schedule a queue flush: rAF while visible, timer fallback while hidden. */
  const scheduleLiveBarFlush = () => {
    if (liveBarRaf || liveBarTimer) return;
    const canRaf =
      !isPageHidden() && typeof requestAnimationFrame === 'function';
    if (canRaf) {
      liveBarRaf = requestAnimationFrame(flushPendingBar);
      // Safety net: if rAF never fires (tab hidden mid-frame), the timer
      // still advances the queue under background throttling.
      liveBarTimer = setTimeout(flushPendingBar, LIVE_BAR_FALLBACK_MS);
      return;
    }
    liveBarTimer = setTimeout(flushPendingBar, 0);
  };

  // Per-plugin config (Topbar config row → store.pluginsConfig) — e.g. ccxt-ws exchange id
  const streamCfg =
    ((store.pluginsConfig || {})[pluginKey('stream', stream.id)] as Record<string, unknown> | undefined) ||
    {};
  const stop = stream.start({
    symbol: sym,
    interval: iv,
    lastBar,
    config: streamCfg,
    onBar: (raw: Bar) => {
      if (!isCurrent()) return;
      // Drop partial / NaN OHLCV so a bad venue tick cannot poison the chart
      const bar = sanitizeBar(raw);
      if (!bar) return;
      // Queue every tick in order — a single newest-only slot would drop
      // closed bars while rAF is paused in a hidden tab.
      pendingLiveBars.push(bar);
      // Bound memory when a hidden tab queues hours of 1s ticks.
      if (pendingLiveBars.length > 5000) {
        pendingLiveBars.splice(0, pendingLiveBars.length - 5000);
      }
      scheduleLiveBarFlush();
    },
    onStatus: (s) => {
      if (liveEpoch !== epoch) return;
      try {
        if (s.state === 'open') {
          if (!store.live.active) return;
          const since = outageSince;
          outageSince = 0;
          const recovered = since > 0 && Date.now() - since >= LONG_OUTAGE_MS;
          setStore('stream', 'status', 'connected');
          setTelemetryState('stream', 'open', {
            detail: s.detail || s.url || `${sym} ${iv}`,
            error: null,
          });
          // Routine opens stay in the log. Toast only after a long outage.
          appendLog('ok', `Stream open${s.detail ? ` · ${s.detail}` : ''}`, 'stream', {
            toast: recovered,
          });
          if (recovered) {
            // WS was down for a while (backgrounded tab, network drop) — REST
            // backfill any slots the socket missed so aggregation stays dense.
            void import('../data/background-catchup')
              .then(({ repairChartGapsAfterBackground }) =>
                repairChartGapsAfterBackground('reconnect'),
              )
              .catch(() => {});
          }
        } else if (s.state === 'reconnecting') {
          if (!store.live.active) return;
          if (!outageSince) outageSince = Date.now();
          setStore('stream', 'status', 'connecting');
          setTelemetryState('stream', 'degraded', { detail: s.detail || 'reconnecting' });
          // Log only. Identical bursts collapse to one line. No toast.
          appendLog(
            'warn',
            `Stream reconnecting${s.detail ? ` · ${s.detail}` : ''}`,
            'stream',
            { toast: false },
          );
        } else if (s.state === 'closed') {
          // Exhausted reconnect while Live is still armed → Offline, not a success Live chip
          if (!store.live.active) {
            setStore('stream', 'status', 'disconnected');
            setTelemetryState('stream', 'closed');
          } else if (s.detail === 'reconnect exhausted') {
            outageSince = 0;
            setStore('stream', 'status', 'disconnected');
            setTelemetryState('stream', 'closed', { detail: s.detail });
            appendLog('error', 'Stream offline · retries exhausted', 'stream', { toast: true });
          }
        }
      } catch {
        /* status UI best-effort */
      }
    },
    onError: (e) => {
      if (liveEpoch !== epoch) return;
      try {
        const msg = e?.message || 'Stream error';
        appendLog('error', msg, 'stream');
        setStatus('error', `Live error: ${msg}`);
        // Preserve error telemetry/status while clearing live.active
        stopLive({ reason: 'error', error: msg });
      } catch {
        /* ignore */
      }
    },
  });

  // If a nested stop/restart happened during start (unlikely), drop this stop
  if (liveEpoch !== epoch) {
    try {
      stop();
    } catch {
      /* ignore */
    }
    return;
  }

  currentStop = stop;

  // Background-tab safety net: DSM auto-identifies + repairs holes left while
  // hidden (visibility / focus / online), so the chart always delivers correct
  // data even after rAF + timer throttling. Installed once, idempotent.
  try {
    void import('../data/background-catchup').then(({ startBackgroundCatchup }) => {
      try {
        startBackgroundCatchup();
      } catch {
        /* ignore */
      }
    }).catch(() => {});
  } catch {
    /* catch-up is best-effort */
  }

  // Visible chart scripts start immediately — do not wait for the first tick
  // or a manual Run. Hidden scripts stay out of the live loop.
  scheduleRerun();
}

/**
 * Tear down the active stream, clear reconnect timers, and mark live inactive.
 * Safe to call when no stream is running; re-entrant-safe.
 */
export function stopLive(opts?: StopLiveOpts) {
  const reason: StopLiveReason = opts?.reason ?? 'user';
  const wasActive = store.live.active;

  // Invalidate session first so in-flight callbacks no-op
  liveEpoch += 1;
  cancelPendingLiveBarFlush();

  // Mark inactive before stop() so reconnect closed callbacks don't fight UI state
  setLive(false);

  if (reason === 'error') {
    const err = opts?.error || 'Stream error';
    setStore('stream', 'status', 'error');
    setTelemetryState('stream', 'error', { error: err });
  } else if (reason === 'user') {
    setStore('stream', 'status', 'disconnected');
    setTelemetryState('stream', 'closed', { error: null });
  }
  // reason === 'restart': startLive overwrites status/telemetry immediately after

  // Null before invoke so nested stopLive / onError re-entry is a no-op
  const stop = currentStop;
  currentStop = null;
  if (stop) {
    try {
      stop();
    } catch {
      /* ignore plugin stop errors */
    }
  }

  if (wasActive && reason === 'user') {
    appendLog('info', 'Live stopped', 'stream');
  }

  if (rerunTimer) {
    clearTimeout(rerunTimer);
    rerunTimer = null;
  }
  // Drop in-flight gate so the next startLive can schedule reruns
  // (a hung prior runAndApply must not block suite / restarts forever).
  rerunInFlight = false;
}

/**
 * Honour Settings “Enable live stream” (`live.preferAfterLoad`).
 * Starts the paired WebSocket when bars are loaded; stops live when off.
 */
export function syncLiveToPreference(): void {
  if (!store.live.preferAfterLoad) {
    if (store.live.active) stopLive();
    return;
  }
  if (!store.bars.length || store.live.active) return;
  const streamId = store.live.streamId || defaultStreamForSource(store.source);
  startLive(streamId, store.symbol, store.interval);
}

/** Visible applied sources that belong in the live re-run loop (not library()). */
function isLiveRerunScript(s: { visible?: boolean; code?: string }): boolean {
  return !!(s.visible && s.code?.trim() && detectScriptKind(s.code) !== 'library');
}

/**
 * Debounced re-run of all visible indicators after live bars.
 * Silent: no Results drawer spam; updates chart overlays only.
 *
 * Does **not** cancel an in-flight interactive Run (MTF / request.security).
 * Those set `live.needsRerun` and flush after the interactive epoch ends.
 */
function scheduleRerun() {
  if (!store.bars?.length) return;
  if (!store.scripts.some(isLiveRerunScript)) return;
  // Interactive Run owns the engine — mark dirty and wait (do not beginRunEpoch)
  if (isInteractiveRunInFlight() || isStudyActive()) {
    if (!store.live.needsRerun) setStore('live', 'needsRerun', true);
    return;
  }
  // Timer already armed or cycle in flight: remember bars advanced, don't drop work
  if (rerunTimer || rerunInFlight) {
    if (!store.live.needsRerun) setStore('live', 'needsRerun', true);
    return;
  }
  const epochAtSchedule = liveEpoch;
  // Adaptive debounce: heavier histories need longer quiet windows
  const barN = store.bars?.length ?? 0;
  const debounceMs = barN >= 10_000 ? 900 : barN >= 2_500 ? 600 : 400;
  rerunTimer = setTimeout(async () => {
    rerunTimer = null;
    if (liveEpoch !== epochAtSchedule || !store.live.active) return;
    if (rerunInFlight) {
      if (!store.live.needsRerun) setStore('live', 'needsRerun', true);
      return;
    }
    // Interactive may have started during the debounce window
    if (isInteractiveRunInFlight() || isStudyActive()) {
      if (!store.live.needsRerun) setStore('live', 'needsRerun', true);
      return;
    }
    rerunInFlight = true;
    rerunAttemptCount += 1;
    setStore('live', 'needsRerun', false);
    try {
      // Producers of plot sources before consumers (cross-indicator input.source)
      const ordered = orderIndicatorsByPlotDeps(
        store.scripts.filter(isLiveRerunScript),
      );
      for (const ind of ordered) {
        if (liveEpoch !== epochAtSchedule || !store.live.active) break;
        if (isInteractiveRunInFlight() || isStudyActive()) {
          if (!store.live.needsRerun) setStore('live', 'needsRerun', true);
          break;
        }
        await runAndApply(ind.code, ind.id, {
          silent: true,
          openResults: false,
          inputs: ind.inputValues,
          strategyProps: ind.strategyProps,
          liveTick: true,
        });
      }
    } finally {
      rerunInFlight = false;
      // If more ticks arrived or interactive deferred us, schedule again
      if (
        store.live.active &&
        store.live.needsRerun &&
        !isInteractiveRunInFlight() &&
        !isStudyActive()
      ) {
        scheduleRerun();
      }
    }
  }, debounceMs);
}

/**
 * Public entry for deferred live re-runs after an interactive Run finishes.
 * Safe to call when live is inactive (no-op).
 */
export function scheduleLiveRerun(): void {
  if (!store.live?.active) return;
  scheduleRerun();
}
