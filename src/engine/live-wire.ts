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
 * Stream live-wire (F-19): orchestrates the engine-owned subscription plane.
 *
 * - `ensureSeries` connects and subscribes the chart series **once**, then
 *   resolves with the snapshot bars (the caller paints them). Later calls
 *   return the cached snapshot; concurrent callers join the in-flight wait.
 * - `evalScript` subscribes a script on first call (awaiting its snapshot)
 *   and applies the latest merged state on later calls — deltas land
 *   asynchronously through the frame router, never via re-evaluation.
 * - Every failure (connect, subscribe, snapshot, merge) throws a
 *   `StreamFallbackError` so the caller drops to the legacy path. A 60s
 *   cooldown after a failure debounces subscribe retries without stopping
 *   the socket; throwing while already cooled down does not re-arm the timer.
 *
 * Transport + apply are injected (fakes in tests; real client/bridge in prod).
 *
 * @module engine/live-wire
 */

import { unwrap } from 'solid-js/store';
import type { RunResult } from '../plugins/types';
import { store } from '../store';
import type { Bar } from '../store/types';
import { intervalToSec } from '../data/bars-gaps';
import { sanitizeStreamBar } from '../data/parse-bars';
import { engineDebug, engineDebugSample } from '../debug';

import {
  readTimeList,
  scriptDeltaTimeTail,
  Redesign2DeltaApplier,
  type DeltaApplierFull,
} from './client-apply';
import { classifySeqGap } from './frames';
import { v1Count } from './v1/metrics';
import { commitLiveBatch, runApplyTransaction } from './v1/apply-transaction';
import { engineEncoding, wantsWorkerTransport, type EngineEncoding } from './v1/transport';
import type { SubscriptionStatus } from '../store/types';

/**
 * Raised when the live wire cannot serve a subscription, so the caller falls back to the
 * calculator plane. `reason` is the machine-readable cause carried into telemetry.
 */
export class StreamFallbackError extends Error {
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? `stream unavailable: ${reason}`);
    this.name = 'StreamFallbackError';
    this.reason = reason;
  }
}

/**
 * One `/ws/live` frame as the wire routes it: type, correlation/session ids, `seq` for gap
 * detection, and an unvalidated `payload` narrowed by the per-type guards in `frames`.
 */
export interface WireFrame {
  type: string;
  id?: string;
  sessionId?: string;
  ts?: number;
  seq?: number;
  payload?: Record<string, unknown>;
}

/**
 * Transport seam the wire drives: implemented by `Redesign2WsClient` (JSON `/ws/live`) and by
 * the Worker AXB1 client, which additionally batches frames through `onFrames`.
 */
export interface WireClient {
  connect(): Promise<void>;
  disconnect(): void;
  readonly isOpen: boolean;
  subscribe(
    id: string,
    kind: 'series' | 'script',
    meta: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): void;
  resumeSubscription(
    id: string,
    count: number,
    lastTime: number,
    extra?: Record<string, unknown>,
  ): void;
  requestRepair?(id: string, fromTime: number): void;
  unsubscribe(id: string): void;
  awaitFrame(id: string, timeoutMs?: number): Promise<WireFrame>;
  onFrame: ((frame: WireFrame) => void) | undefined;
  /** Worker batches. When set, the host delivers the whole batch here. */
  onFrames?: ((frames: WireFrame[]) => void) | undefined;
  /** Set by the wire. An unknown AXB1 opcode for one sub; the socket stays open. */
  onUnknownOpcode?: (info: { id: string; opcode: number; seq: number }) => void;
  /** Set by the wire. Outbound buffer is over the cap (`held`) or has drained. */
  onBackpressure?: (held: boolean) => void;
  addReconnectHandler(fn: () => void): () => void;
  /** Optional connection counters for diagnostics (MCP `stream.get`). */
  stats?(): { open: boolean; openedOnce: boolean; reconnectAttempts: number; stopped: boolean };
}

/**
 * Callbacks the live plane implements to receive subscription status, series snapshots/deltas,
 * and bar-close verification results.
 */
export interface WireHandlers {
  onStatus(
    subId: string,
    status: SubscriptionStatus,
    extra?: { message?: string; have?: number; need?: number },
  ): void;
  onSeriesFull(bars: Bar[]): void;
  onSeriesDelta(bars: Bar[], append: boolean): void;
  onCloseVerified(
    time: number,
    result: 'match' | 'mismatch' | 'unknown',
    ohlcv?: Record<string, number>,
  ): void;
}

/**
 * A script subscription request: the sub id, Pine source, the indicator it paints, the window
 * bars, and the resolved `input.*` values the engine must evaluate with.
 */
export interface EvalScriptInput {
  subId: string;
  script: string;
  indicatorId?: string;
  meta: Record<string, unknown>;
  bars: Bar[];
  /**
   * The script's input values (Pine `input.*`).
   *
   * The engine evaluates the subscribed script with **these** values — the
   * defaults otherwise. Without them a user's input change is a no-op on the
   * chart: the live subscription keeps the values it was created with.
   */
  inputs?: Record<string, unknown>;
}

/**
 * Concept §4.2. The main-thread JSON client must not negotiate: it only
 * `JSON.parse`s strings, so a binary reply would be dropped. Absent means JSON.
 */
function negotiatedEncoding(): EngineEncoding | undefined {
  if (wantsWorkerTransport()) return engineEncoding();
  return undefined;
}

function resumeExtra(
  seq: number,
  closedUpto?: number,
): { seq: number; closed_upto?: number; encoding?: EngineEncoding } {
  const encoding = negotiatedEncoding();
  return {
    seq,
    ...(closedUpto != null ? { closed_upto: closedUpto } : {}),
    ...(encoding ? { encoding } : {}),
  };
}

function readClosedUpto(frame: WireFrame): number | null {
  const n = frame.payload?.['closed_upto'];
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

type HeldLive = { frame: WireFrame; cursor: number; broken: boolean };

const FAILURE_COOLDOWN_MS = 60_000;
/** PYNE history ensure of a painted 5m window routinely exceeds 30s. */
const SNAPSHOT_WAIT_MS = 120_000;
const LOADING_WAIT_CAP_MS = 120_000;
/** Two more asks before an AXB1 snapshot gives up and that sub uses JSON. */
const SNAPSHOT_BACKOFF_MS = [50, 200] as const;
/**
 * Subscribe can race the auth handshake (`UNAUTHORIZED` / "Authenticate first").
 * One short retry after open, then the normal fail path.
 */
const AUTH_SUBSCRIBE_RETRY_MS = 150;
/**
 * After a seq gap, prefer one fresh unsubscribe+subscribe over resume-loop thrash.
 * Backoff grows so a wedged sub cannot hammer `/ws/live` every tip.
 */
const GAP_RESYNC_BACKOFF_MS = [0, 500, 1_500, 4_000, 10_000] as const;

function gapBackoffMs(attempts: number): number {
  return GAP_RESYNC_BACKOFF_MS[Math.min(attempts, GAP_RESYNC_BACKOFF_MS.length - 1)] ?? 10_000;
}

/**
 * Consecutive axis resubs before replacing resume with a fresh subscribe.
 * Resume returns the same pooled engine session; when that session's count
 * cannot be spliced, only a new subscribe can move it.
 */
const AXIS_RESUB_ESCALATE_AFTER = 2;
/**
 * When the merged script cache tip lags the last *closed* chart bar by more
 * than this many bars, re-paint of the frozen cache looks "live" while the
 * indicator stalls. Force a fresh subscribe (backoff via
 * {@link StreamLiveWire.requestFreshSnapshot}). Forming-bar lag alone must not
 * trip this — that left a second script flickering `degraded` every tick.
 */
const SCRIPT_TIP_LAG_BARS = 5;
/**
 * After the tab is shown, fold the queued burst into one decision.
 * A hidden tab must not replay every tick it missed.
 *
 * Window in ms: ticks queued while hidden collapse into one apply instead of replaying.
 */
export const HIDDEN_WAKE_MS = 50;
/**
 * Per-subscription inbox for snapshot waiters only. Live frames are applied
 * via `routeFrame` and must not accumulate here — 32 closes used to
 * `resume` → PYNE full-snapshot at kline rate.
 */
const INBOX_CAP = 32;

function historyBarsOf(meta: Record<string, unknown> | undefined): number {
  const n = Number(meta?.['history_bars']);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Engine subscribe depth is chunked in 100-bar steps (`chartWindowEngineBars`).
 * Keep this in sync with `ROLLING_WINDOW_ENGINE_CHUNK` in `store/index.ts`.
 */
const ENGINE_DEPTH_CHUNK = 100;
/** Same band as `depthShrank`: tip noise must not bounce the subscription. */
const ENGINE_DEPTH_TIP_BAND = 8;

/**
 * True when `history_bars` only rounded up to the next 100-bar chunk because
 * the chart tip grew by a few bars (e.g. 5000 → 5001 yields depth 5100).
 *
 * Deltas already extend the engine session, so that jump must not unsubscribe
 * + full-snapshot every script. A real depth change (rolling-window bump,
 * left-edge page, explicit meta jump off the chunk grid) still resubscribes.
 */
export function isEngineDepthChunkHeadroom(
  prevDepth: number,
  nextDepth: number,
  chartBars: number,
): boolean {
  if (!(nextDepth > prevDepth)) return false;
  if (nextDepth - prevDepth > ENGINE_DEPTH_CHUNK) return false;
  if (!(chartBars > 0)) return false;
  const chunkOfChart = Math.ceil(chartBars / ENGINE_DEPTH_CHUNK) * ENGINE_DEPTH_CHUNK;
  if (nextDepth !== chunkOfChart) return false;
  if (chartBars + ENGINE_DEPTH_TIP_BAND < prevDepth) return false;
  return chartBars <= nextDepth;
}

/** True when subscribe beat the auth handshake — retry once, do not cool yet. */
function isAuthPendingSubscribeError(frame: WireFrame): boolean {
  if (frame.type !== 'error') return false;
  const body = (frame.payload ?? {}) as Record<string, unknown>;
  const code = String(body['code'] ?? (frame as { code?: unknown }).code ?? '')
    .trim()
    .toUpperCase();
  const message = String(body['message'] ?? (frame as { message?: unknown }).message ?? '');
  if (code === 'UNAUTHORIZED') return true;
  return /authenticate first/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stable signature of a script's input values.
 *
 * Only used to notice a **change** (the subscription must be re-created);
 * the values themselves travel with the subscribe frame.
 */
function inputSignature(inputs: Record<string, unknown> | undefined): string {
  if (!inputs) return '';
  try {
    return JSON.stringify(
      Object.keys(inputs)
        .sort()
        .map((k) => [k, inputs[k]]),
    );
  } catch {
    return '';
  }
}

/** Drop Solid store Proxies before subscribe / scriptCtx (Worker postMessage). */
function plainWireRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  return unwrap(value) as Record<string, unknown>;
}

function toBars(raw: unknown): Bar[] {
  if (!Array.isArray(raw)) return [];
  const out: Bar[] = [];
  for (const row of raw) {
    // A bar with a non-finite price is dropped rather than painted.
    const bar = sanitizeStreamBar(row);
    if (bar) out.push(bar);
  }
  return out;
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function';
}

function mergeTip(cur: Bar[], next: Bar[]): Bar[] {
  if (!next.length) return cur;
  const out = cur.slice();
  for (const bar of next) {
    const last = out[out.length - 1];
    if (last && last.time === bar.time) out[out.length - 1] = bar;
    else if (!last || bar.time > last.time) out.push(bar);
  }
  return out;
}

/** Last bar time on a series tip payload, if any. */
function seriesTipTime(frame: WireFrame | undefined): number | null {
  if (!frame) return null;
  const payload = (frame.payload as { bars?: unknown } | undefined) ?? {};
  const bars = toBars(payload.bars);
  const last = bars[bars.length - 1];
  return last && Number.isFinite(last.time) ? last.time : null;
}

function isFormingSeriesTip(frame: WireFrame | undefined): boolean {
  if (frame?.type !== 'delta') return false;
  const payload = frame.payload as { forming?: unknown } | undefined;
  return payload?.forming === true;
}

/**
 * How many bars the script columns actually contain.
 *
 * The frame's `count` is the history the subscribe asked for. A shared
 * session can already be longer, and every later delta is numbered from
 * that longer series. Storing the shorter count rejects those deltas, so
 * the channel stays on the load snapshot and the next candle leaves it
 * one bar off.
 */
function scriptColumnCount(payload: Record<string, unknown>): number | null {
  const series = payload['series'];
  if (series && typeof series === 'object' && !Array.isArray(series)) {
    let n = 0;
    for (const value of Object.values(series as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > n) n = value.length;
    }
    if (n > 0) return n;
  }
  const plots = payload['plots'];
  if (Array.isArray(plots) && plots.length > 0) {
    if (Array.isArray(plots[0])) {
      let n = 0;
      for (const column of plots) {
        if (Array.isArray(column) && column.length > n) n = column.length;
      }
      if (n > 0) return n;
    } else {
      return plots.length;
    }
  }
  return null;
}

/**
 * Snapshot fields the applier must keep so later deltas can splice the time axis.
 * A bar-time list that is not one stamp per plot is dropped: the next delta
 * would fail the positional splice and the script would stay on this snapshot.
 */
function scriptFullForApplier(
  payload: Record<string, unknown> | null | undefined,
  seq: unknown,
  /** Chart/subscription bar times — used when the engine omits `bar_times`. */
  fallbackTimes?: readonly number[] | null,
): {
  plots?: Record<string, unknown[]>;
  series?: Record<string, unknown[]>;
  count: number;
  seq?: number;
  bar_times?: number[];
} {
  if (payload == null) {
    throw new StreamFallbackError('script-subscribe-failed', 'empty full payload');
  }
  const columns = scriptColumnCount(payload);
  const declared = Number(payload['count'] ?? 0);
  const count = columns && columns > 0 ? columns : declared;
  const raw = readTimeList(payload['bar_times']) ?? readTimeList(payload['times']);
  let times = raw && raw.length === count ? raw : null;
  // Synthesize an axis from the subscribed window so apply can time-join
  // instead of hitting staleNoAxis (engine 20k replica vs 5k chart).
  if (!times && fallbackTimes && fallbackTimes.length && count > 0) {
    if (fallbackTimes.length === count) times = [...fallbackTimes];
    else if (fallbackTimes.length > count) times = fallbackTimes.slice(-count);
  }
  return {
    plots: payload['plots'] as Record<string, unknown[]> | undefined,
    series: payload['series'] as Record<string, unknown[]> | undefined,
    count,
    ...(typeof seq === 'number' ? { seq } : {}),
    ...(times ? { bar_times: times } : {}),
  };
}

/**
 * Fit a plot/series column to the chart window length.
 *
 * The anchored chart grows at the **tip** (stable head). A shorter cache must
 * keep values on the same bars and null the unevaluated tip — head-padding
 * shifted every overlay one bar right on the first live close (EMA/Donchian
 * looked fully displaced and then frozen). Longer engine sessions still
 * tail-trim to the newest `len` rows.
 */
export function fitColumnToChartWindow(col: unknown, len: number): unknown[] {
  if (!Array.isArray(col)) return Array.from({ length: len }, () => null);
  // Same length: keep the ref — callers that mutate tip cells copy first.
  if (col.length === len) return col as unknown[];
  if (col.length > len) return col.slice(col.length - len);
  const pad = Array.from({ length: len - col.length }, () => null);
  return (col as unknown[]).concat(pad);
}

/** True when the applier cache already matches the chart window (no column copy). */
function scriptCacheWindowAligned(
  cached: Record<string, unknown> | null | undefined,
  windowBars: readonly Bar[],
): boolean {
  if (!cached || !windowBars.length) return false;
  if (Number(cached['count']) !== windowBars.length) return false;
  const times = readTimeList(cached['bar_times'] ?? cached['times']);
  return !!times && times.length === windowBars.length;
}

/**
 * Fit plot/series columns to the chart window length and stamp `bar_times`.
 * Used when the engine session is longer/shorter than the subscribe window so
 * we can paint instead of stripping the axis (which locked later deltas into
 * "delta rejected" forever).
 */
function fitFullToChartWindow(
  full: Record<string, unknown>,
  windowBars: readonly Bar[],
): DeltaApplierFull {
  const len = windowBars.length;
  const times = windowBars.map((b) => b.time);
  // Built as a plain record so array-shaped `plots` (engine legacy) can stay;
  // the applier accepts either column form.
  const out: Record<string, unknown> = { ...full, count: len, bar_times: times };
  delete out['times'];
  const series = full['series'];
  if (series && typeof series === 'object' && !Array.isArray(series)) {
    const next: Record<string, unknown[]> = {};
    for (const [k, v] of Object.entries(series as Record<string, unknown>)) {
      next[k] = fitColumnToChartWindow(v, len);
    }
    out['series'] = next;
  }
  const plots = full['plots'];
  if (Array.isArray(plots)) {
    out['plots'] = plots.map((col) => fitColumnToChartWindow(col, len));
  } else if (plots && typeof plots === 'object') {
    const next: Record<string, unknown[]> = {};
    for (const [k, v] of Object.entries(plots as Record<string, unknown>)) {
      next[k] = fitColumnToChartWindow(v, len);
    }
    out['plots'] = next;
  }
  return out as DeltaApplierFull;
}

/**
 * Realign (or tip-overlay) an unmergeable continuous delta onto the chart window.
 * First mismatch copies columns; later tips only patch the last cell when the
 * cache is already window-sized — Donchian-style storms used to re-copy ~5k
 * rows every venue tick.
 */
function realignScriptDeltaToWindow(
  cached: Record<string, unknown>,
  windowBars: readonly Bar[],
  delta: Record<string, unknown>,
  seq?: number,
): DeltaApplierFull {
  const fitted = scriptCacheWindowAligned(cached, windowBars)
    ? ({ ...cached } as DeltaApplierFull)
    : fitFullToChartWindow(cached, windowBars);
  overlayDeltaTip(fitted, delta);
  if (typeof seq === 'number') fitted['seq'] = seq;
  return fitted;
}

/** Empty success shell for stream eval paths that paint via applyScriptPush. */
function emptyStreamResult(): RunResult {
  return { status: 'success', plots: [], series: {}, events: [], meta: {} };
}

/** Overlay tip values from a delta onto a full's series/plots (last cell). */
function overlayDeltaTip(full: Record<string, unknown>, delta: Record<string, unknown>): void {
  const patchCol = (dst: unknown, src: unknown): unknown => {
    if (!Array.isArray(dst) || !dst.length) return dst;
    if (!Array.isArray(src) || !src.length) return dst;
    const copy = dst.slice();
    copy[copy.length - 1] = src[src.length - 1];
    return copy;
  };
  const dSeries = delta['series'];
  const fSeries = full['series'];
  if (
    dSeries &&
    typeof dSeries === 'object' &&
    !Array.isArray(dSeries) &&
    fSeries &&
    typeof fSeries === 'object' &&
    !Array.isArray(fSeries)
  ) {
    const next: Record<string, unknown> = { ...(fSeries as Record<string, unknown>) };
    for (const [k, v] of Object.entries(dSeries as Record<string, unknown>)) {
      if (k in next) next[k] = patchCol(next[k], v);
    }
    full['series'] = next;
  }
  const dPlots = delta['plots'];
  const fPlots = full['plots'];
  if (Array.isArray(dPlots) && Array.isArray(fPlots)) {
    full['plots'] = fPlots.map((col, i) => patchCol(col, dPlots[i]));
  }
}

/** Chart step in seconds from store interval, else the last two bar times. */
function chartStepSec(bars: readonly Bar[]): number {
  const iv = String(store.interval || '').trim();
  if (iv) {
    const n = intervalToSec(iv);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (bars.length >= 2) {
    const a = bars[bars.length - 2]?.time;
    const b = bars[bars.length - 1]?.time;
    if (Number.isFinite(a) && Number.isFinite(b) && (b as number) > (a as number)) {
      return (b as number) - (a as number);
    }
  }
  return 60;
}

/**
 * Last closed chart bar time. The forming tip is often one step ahead of the
 * engine window; comparing against it made every live script look 1–3 bars
 * stale and thrashed tip-lag recovery into `degraded`.
 */
function chartClosedTipTime(bars: readonly Bar[]): number | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  if (!last || !Number.isFinite(last.time)) return null;
  const step = chartStepSec(bars);
  const nowSec = Math.floor(Date.now() / 1000);
  const wallSlot = step > 0 ? nowSec - (nowSec % step) : last.time;
  // Tip is the current (forming) slot — use the previous closed bar when present.
  if (bars.length >= 2 && last.time >= wallSlot) {
    const prev = bars[bars.length - 2];
    if (prev && Number.isFinite(prev.time)) return prev.time as number;
  }
  return last.time as number;
}

/**
 * How far the merged script cache tip trails the last closed chart bar
 * (seconds), or null when either axis is missing so we cannot decide.
 */
function scriptCacheTipLagSec(
  cached: Record<string, unknown> | null | undefined,
  chartBars: readonly Bar[],
): number | null {
  const times = readTimeList(cached?.['bar_times'] ?? cached?.['times']);
  if (!times?.length || !chartBars.length) return null;
  const cacheLast = times[times.length - 1];
  const chartLast = chartClosedTipTime(chartBars);
  if (!Number.isFinite(cacheLast) || chartLast == null) return null;
  return chartLast - (cacheLast as number);
}

/**
 * Orchestrates the live plane over a {@link WireClient}: subscribes series and scripts,
 * resumes after reconnect, resyncs on `seq` gaps, folds ticks while the tab is hidden, and
 * routes payloads into `apply` (full snapshot vs delta). Backpressure holds forming tips
 * instead of closing the socket.
 */
export class StreamLiveWire {
  private failures = 0;
  private coolUntil = 0;
  private lastFail: { reason: string; message: string; at: number } | null = null;
  private readonly appliers = new Map<string, Redesign2DeltaApplier>();
  private readonly appliedSeq = new Map<string, number>();
  /** Last series snapshot per sub, returned on subscribe-once. */
  private readonly seriesBars = new Map<string, Bar[]>();
  /** In-flight `ensureSeries` so concurrent ticks join one snapshot wait. */
  private readonly seriesInflight = new Map<string, Promise<Bar[]>>();
  /** Last script + bars so a push delta can apply without waiting on scheduleRerun. */
  private readonly scriptCtx = new Map<
    string,
    {
      script: string;
      indicatorId?: string;
      bars: Bar[];
      meta: Record<string, unknown>;
      inputs?: Record<string, unknown>;
    }
  >();
  /** Series subscribe meta — needed to fresh-subscribe after a seq gap. */
  private readonly seriesSubMeta = new Map<string, Record<string, unknown>>();
  /** Input signature of each script subscription (a change forces a re-subscribe). */
  private readonly scriptInputSig = new Map<string, string>();
  /** Subs with an outstanding axis-resubscribe (one resub per full snapshot). */
  private readonly axisResubPending = new Set<string>();
  /** Consecutive axis-resub attempts since the last committed delta/full. */
  private readonly axisResubAttempts = new Map<string, number>();
  /** Last axis-resub network action (ms) — gates status/resync side effects. */
  private readonly axisResubAt = new Map<string, number>();
  /** Seq gap: drop deltas until the next full. Axis repair does not use this. */
  private readonly holdUntilFull = new Set<string>();
  /**
   * Script subscribe / input-resubscribe in flight. A late unsubscribe ack
   * (`idle`/`released`) must not `dropScriptLocal` the new half-open sub —
   * that left Momentum blank after an input change while Bollinger stayed up.
   */
  private readonly pendingScriptSubscribe = new Set<string>();
  /** Last fresh gap-resync wall time per sub (unsubscribe+subscribe backoff). */
  private readonly gapResyncAt = new Map<string, number>();
  /** Fresh gap-resync attempts since the last successful full. */
  private readonly gapResyncAttempts = new Map<string, number>();
  /** Latest unpainted script payload. The in-flight apply drains this. */
  private readonly paintLatest = new Map<
    string,
    { cached: Record<string, unknown>; via: 'stream-full' | 'stream-delta'; bars: Bar[] }
  >();
  /** In-flight script paint drain. A later push waits, then paints the newest payload. */
  private readonly paintTail = new Map<string, Promise<void>>();
  /** Inbox could not drop a tip. One snapshot until recovery succeeds. */
  private readonly inboxOverflowPending = new Set<string>();
  /** Last overflow-resume wall time per sub (backoff). */
  private readonly inboxOverflowAt = new Map<string, number>();
  /** Overflow-resume attempts since the last successful recovery. */
  private readonly inboxOverflowAttempts = new Map<string, number>();
  /** `history_bars` the script subscription was created with. */
  private readonly scriptDepth = new Map<string, number>();
  /** Inbox for frames that arrive before their waiter (one TCP segment can
   * carry status+full together). Drained by `awaitFull`. */
  private readonly inbox = new Map<string, WireFrame[]>();
  /** Fan-out waiters — a second waiter must not steal the first. */
  private readonly inboxWaiters = new Map<string, Array<() => void>>();
  /** Latest unpainted tick while the tab is hidden or waking. One slot per sub. */
  private readonly heldLive = new Map<string, HeldLive>();
  /** `closed_upto` last routed for each sub. A later value means a bar closed. */
  private readonly appliedClosedUpto = new Map<string, number>();
  private pageHidden = false;
  private wakeUntil = 0;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private removeVisibility: (() => void) | null = null;
  /** Subs that must speak JSON after an unknown AXB1 opcode. */
  private readonly jsonSubs = new Set<string>();
  /**
   * Series tip landed without script frames in the same batch. Same-slot
   * forming tips stamp `apply:start`/`end` synchronously (metrics-only — no
   * microtask, so queueWait stays near zero). A new tip time still coalesces
   * one cached-script paint on a microtask so a real script frame in the same
   * turn can cancel it. Real script paints cancel a pending kick.
   */
  private seriesScriptKick = false;
  private seriesScriptKickNeedsPaint = false;
  private seriesScriptKickTipTime: number | null = null;
  private seriesKickPaintedTipTime: number | null = null;
  private seriesScriptKickScheduled = false;

  constructor(
    private readonly client: WireClient,
    private readonly handlers: WireHandlers,
    private readonly apply: (
      script: string,
      indicatorId: string | undefined,
      full: Record<string, unknown>,
      via: 'stream-full' | 'stream-delta',
      bars: Bar[],
    ) => Promise<RunResult> | RunResult,
  ) {
    this.client.addReconnectHandler(() => this.resumeAll());
    this.watchVisibility();
  }

  /**
   * The socket stays up while the tab is hidden. Ticks fold into one slot.
   * On show, a moved `closed_upto` resumes once; otherwise the latest tip
   * is applied once. Tests call this directly.
   */
  notePageVisibility(hidden: boolean): void {
    if (hidden) {
      this.pageHidden = true;
      this.wakeUntil = 0;
      if (this.wakeTimer) {
        clearTimeout(this.wakeTimer);
        this.wakeTimer = null;
      }
      return;
    }
    if (!this.pageHidden && this.wakeUntil === 0) return;
    this.pageHidden = false;
    this.wakeUntil = Date.now() + HIDDEN_WAKE_MS;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.flushHeld();
    }, HIDDEN_WAKE_MS);
  }

  private watchVisibility(): void {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const onVis = () => this.notePageVisibility(document.hidden === true);
    document.addEventListener('visibilitychange', onVis);
    this.removeVisibility = () => document.removeEventListener('visibilitychange', onVis);
  }

  private holding(): boolean {
    return this.pageHidden || Date.now() < this.wakeUntil;
  }

  private shouldHold(frame: WireFrame): boolean {
    if (!frame.id) return false;
    if (frame.type !== 'delta' && frame.type !== 'close') return false;
    return this.holding();
  }

  /** Keep the latest frame. A seq we did not see marks the run broken. */
  private holdFrame(frame: WireFrame): void {
    const id = frame.id;
    if (!id) return;
    const seq = typeof frame.seq === 'number' ? frame.seq : null;
    const prev = this.heldLive.get(id);
    const applied = this.appliedSeq.get(id);
    let cursor = prev?.cursor ?? (typeof applied === 'number' ? applied : -1);
    let broken = prev?.broken ?? false;
    if (seq == null) {
      broken = true;
    } else if (cursor < 0 || seq === cursor + 1) {
      cursor = seq;
    } else if (seq !== cursor) {
      cursor = Math.max(cursor, seq);
      broken = true;
    }
    this.heldLive.set(id, { frame, cursor, broken });
  }

  private rememberClosedUpto(frame: WireFrame): void {
    if (!frame.id) return;
    const n = readClosedUpto(frame);
    if (n == null) return;
    const prev = this.appliedClosedUpto.get(frame.id);
    if (prev == null || n > prev) this.appliedClosedUpto.set(frame.id, n);
  }

  /** One resume, or one tip. Never the backlog. */
  private flushHeld(): void {
    this.wakeUntil = 0;
    this.pageHidden = false;
    const held = [...this.heldLive.entries()];
    this.heldLive.clear();
    for (const [subId, slot] of held) {
      const next = readClosedUpto(slot.frame);
      const prev = this.appliedClosedUpto.get(subId);
      const closedMoved = next != null && prev != null && next > prev;
      if (closedMoved || slot.broken) {
        this.resumeFromHold(subId);
        continue;
      }
      const applied = this.appliedSeq.get(subId);
      const seq = typeof slot.frame.seq === 'number' ? slot.frame.seq : null;
      let frame = slot.frame;
      if (seq != null && applied != null && seq > applied + 1) {
        frame = {
          ...frame,
          payload: { ...(frame.payload ?? {}), seqAckFrom: applied },
        };
      }
      this.routeFrame(frame);
    }
  }

  private resumeFromHold(subId: string): void {
    v1Count('resync');
    this.holdUntilFull.add(subId);
    this.handlers.onStatus(subId, 'degraded', { message: 'resyncing' });
    this.tryResume(subId, { closedUpto: this.appliedClosedUpto.get(subId) });
  }

  /**
   * Best-effort resume. Bars default to series snapshot, else script window.
   * Never throws — the socket may still be opening.
   */
  private tryResume(
    subId: string,
    opts?: { bars?: readonly Bar[]; seq?: number; closedUpto?: number },
  ): void {
    const bars = opts?.bars ?? this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
    const seq = opts?.seq ?? this.appliedSeq.get(subId) ?? 0;
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, seq, opts?.closedUpto),
      );
    } catch {
      /* socket may still be coming up */
    }
  }

  /** True while a prior gap/resync attempt is still inside its backoff window. */
  private gapBackoffArmed(
    subId: string,
    atMap: Map<string, number>,
    attemptsMap: Map<string, number>,
  ): boolean {
    const attempts = attemptsMap.get(subId) ?? 0;
    if (attempts <= 0) return false;
    const lastAt = atMap.get(subId) ?? 0;
    return Date.now() - lastAt < gapBackoffMs(attempts);
  }

  /** Record a gap/resync attempt; returns the new attempt count. */
  private markGapAttempt(
    subId: string,
    atMap: Map<string, number>,
    attemptsMap: Map<string, number>,
  ): number {
    const next = (attemptsMap.get(subId) ?? 0) + 1;
    atMap.set(subId, Date.now());
    attemptsMap.set(subId, next);
    return next;
  }

  private clearHidden(): void {
    this.pageHidden = false;
    this.wakeUntil = 0;
    this.heldLive.clear();
    this.appliedClosedUpto.clear();
    this.jsonSubs.clear();
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    this.removeVisibility?.();
    this.removeVisibility = null;
  }

  get cooledDown(): boolean {
    return Date.now() < this.coolUntil;
  }

  private fail(reason: string, message?: string): never {
    // Re-arming here latched forever: live ticks called fail() every flush.
    if (this.cooledDown) {
      engineDebugSample('wire.fail', { reason: 'cooldown', message: message ?? reason });
      throw new StreamFallbackError('cooldown', message ?? 'stream in failure cooldown');
    }
    this.failures += 1;
    this.coolUntil = Date.now() + FAILURE_COOLDOWN_MS;
    this.lastFail = { reason, message: message ?? reason, at: Date.now() };
    engineDebug('wire.fail', { reason, message: message ?? reason, failures: this.failures });
    // Multiplex falls back to venue+REST; only reset()/disconnect() stop the client.
    throw new StreamFallbackError(reason, message);
  }

  async ensureConnected(): Promise<void> {
    try {
      await this.client.connect();
    } catch (e) {
      this.fail('connect', e instanceof Error ? e.message : String(e));
    }
    this.client.onFrame = (frame) => this.ingest(frame);
    this.client.onFrames = (frames) => this.ingestBatch(frames);
    this.client.onUnknownOpcode = (info) => this.useJsonForSub(info.id);
    this.client.onBackpressure = (held) => this.noteSendBackpressure(held);
  }

  /** Forming tips are already dropped. A drain resumes every live sub once. */
  private noteSendBackpressure(held: boolean): void {
    if (held) {
      for (const subId of this.appliedSeq.keys()) {
        this.handlers.onStatus(subId, 'degraded', {
          message: 'send buffer full — resyncing',
        });
      }
      return;
    }
    this.resumeAll();
  }

  private encodingFor(subId: string): EngineEncoding | undefined {
    if (this.jsonSubs.has(subId)) return undefined;
    return negotiatedEncoding();
  }

  private resumePayload(
    subId: string,
    seq: number,
    closedUpto?: number,
  ): { seq: number; closed_upto?: number; encoding?: EngineEncoding } {
    if (this.jsonSubs.has(subId)) {
      return { seq, ...(closedUpto != null ? { closed_upto: closedUpto } : {}) };
    }
    return resumeExtra(seq, closedUpto);
  }

  /**
   * Resume could not replay. Stay on the socket: one JSON resume, then a
   * stale badge and no paint. REST is not a fallback.
   */
  private noteReplayUnavailable(subId: string): void {
    const waiting =
      this.holdUntilFull.has(subId) ||
      this.axisResubPending.has(subId) ||
      this.inboxOverflowPending.has(subId);
    if (!waiting) return;
    this.holdUntilFull.add(subId);
    if (this.jsonSubs.has(subId)) {
      this.handlers.onStatus(subId, 'degraded', { message: 'replay unavailable' });
      return;
    }
    this.jsonSubs.add(subId);
    v1Count('jsonFallback');
    this.handlers.onStatus(subId, 'degraded', { message: 'replay unavailable — JSON' });
    this.tryResume(subId);
  }

  /** One unknown opcode: that sub resumes in JSON. The socket is not closed. */
  private useJsonForSub(subId: string): void {
    if (!subId || this.jsonSubs.has(subId)) return;
    this.jsonSubs.add(subId);
    v1Count('jsonFallback');
    this.handlers.onStatus(subId, 'degraded', { message: 'unknown opcode — JSON' });
    this.tryResume(subId, { closedUpto: this.appliedClosedUpto.get(subId) });
  }

  /** Every inbound frame lands in the inbox AND the router — neither path
   * can starve the other when frames arrive back-to-back. */
  private ingest(frame: WireFrame): void {
    if (this.shouldHold(frame)) {
      this.holdFrame(frame);
      return;
    }
    if (frame.id) {
      this.enqueueInbox(frame);
      this.notifyInboxWaiters(frame.id);
    }
    this.routeFrame(frame);
    // A lone series tip must still close the apply burst (see scheduleSeriesScriptKick).
    if (frame.type === 'delta' && this.isSeriesFrame(frame)) {
      this.scheduleSeriesScriptKick(frame);
    }
  }

  /**
   * One worker batch. Mixed series+script deltas commit price then plots
   * in one transaction (concept §6.1). Fulls, status, and closes still
   * route immediately so a snapshot is never held behind a tip.
   * Series-only tips close `batch:post` → `apply:start` (sync metrics for
   * same-slot; one coalesced microtask paint when the tip time advances).
   */
  ingestBatch(frames: readonly WireFrame[]): void {
    if (frames.length === 0) return;
    engineDebugSample('wire.batch', { n: frames.length });
    if (frames.length === 1) {
      this.ingest(frames[0]!);
      return;
    }
    const pendingSeries: WireFrame[] = [];
    const pendingScript: WireFrame[] = [];
    const flushDeltas = (): void => {
      if (!pendingSeries.length && !pendingScript.length) return;
      if (pendingSeries.length && pendingScript.length) {
        this.commitDeltaBatch(pendingSeries.splice(0), pendingScript.splice(0));
        return;
      }
      if (pendingSeries.length) {
        const last = pendingSeries[pendingSeries.length - 1];
        for (const frame of pendingSeries) this.routeFrame(frame);
        pendingSeries.length = 0;
        this.scheduleSeriesScriptKick(last);
      }
      for (const frame of pendingScript) this.routeFrame(frame);
      pendingScript.length = 0;
    };
    for (const frame of frames) {
      if (this.shouldHold(frame)) {
        this.holdFrame(frame);
        continue;
      }
      if (frame.id) {
        this.enqueueInbox(frame);
        this.notifyInboxWaiters(frame.id);
      }
      if (frame.type === 'delta' && (frame.sessionId || frame.id)) {
        if (this.isSeriesFrame(frame)) pendingSeries.push(frame);
        else pendingScript.push(frame);
        continue;
      }
      flushDeltas();
      this.routeFrame(frame);
    }
    flushDeltas();
  }

  private isSeriesFrame(frame: WireFrame): boolean {
    const id = frame.id ?? '';
    const payload = (frame.payload as Record<string, unknown>) ?? {};
    return payload['bars'] != null || id.startsWith('series:');
  }

  private commitDeltaBatch(series: WireFrame[], scripts: WireFrame[]): void {
    commitLiveBatch({
      lastSeq: 0,
      seq: null,
      price: () => {
        for (const frame of series) this.routeFrame(frame);
      },
      plots: () => {
        for (const frame of scripts) this.routeFrame(frame);
      },
    });
  }

  /** Test seam. Frames waiting for a snapshot waiter. */
  inboxDepth(subId: string): number {
    return this.inbox.get(subId)?.length ?? 0;
  }

  /**
   * Inbox is for snapshot waiters only. Live frames already go through
   * `routeFrame` — skip enqueue once the sub is live (closes used to fill
   * the cap of 32 and `resume` at kline rate). `appliedSeq` is also set by
   * forming deltas *before* the snapshot, so "live" here is "no waiter and
   * no in-flight subscribe". While waiting, at most one forming tip per sub
   * (latest wins). Extra closes/deltas over the cap are dropped so a long
   * history wait cannot resume. Only a spliced forming tip counts as a drop.
   *
   * Do not discard the inbox from `routeFrame`: `notifyInboxWaiters` clears
   * waiters before `awaitFull` drains, and a same-turn burst would delete
   * the snapshot the waiter still needs.
   */
  private enqueueInbox(frame: WireFrame): void {
    const id = frame.id;
    if (!id) return;
    if (!this.inboxNeeded(id)) return;
    const queue = this.inbox.get(id) ?? [];
    if (this.isDroppableTip(frame)) {
      const tipAt = queue.findIndex((item) => this.isDroppableTip(item));
      if (tipAt >= 0) {
        queue[tipAt] = frame;
        this.inbox.set(id, queue);
        return;
      }
    }
    queue.push(frame);
    let overflow = false;
    while (queue.length > INBOX_CAP) {
      const dropAt = queue.findIndex(
        (item) => this.isDroppableTip(item) || item.type === 'close' || item.type === 'delta',
      );
      if (dropAt < 0) {
        overflow = true;
        break;
      }
      const dropped = queue.splice(dropAt, 1)[0];
      if (dropped && this.isDroppableTip(dropped)) v1Count('droppedTip');
    }
    this.inbox.set(id, queue);
    if (overflow) this.forceInboxSnapshot(id);
  }

  /**
   * The inbox is over the cap and every remaining frame is a snapshot or
   * error. Waiters already expect a full — do not resume. Live overflow
   * (should be rare after skip-enqueue) resumes once, then backs off.
   */
  private forceInboxSnapshot(subId: string): void {
    if (this.inboxNeeded(subId)) return;
    if (this.gapBackoffArmed(subId, this.inboxOverflowAt, this.inboxOverflowAttempts)) return;
    this.inboxOverflowPending.add(subId);
    this.holdUntilFull.add(subId);
    this.markGapAttempt(subId, this.inboxOverflowAt, this.inboxOverflowAttempts);
    this.handlers.onStatus(subId, 'degraded', { message: 'inbox full — resyncing' });
    this.tryResume(subId);
  }

  /** Resume / overflow / axis-resub fulls may restart seq at 1. */
  private isRecoveryFull(subId: string): boolean {
    return (
      this.holdUntilFull.has(subId) ||
      this.inboxOverflowPending.has(subId) ||
      this.axisResubPending.has(subId)
    );
  }

  /** Snapshot waiters still need the inbox — even after a forming delta set `appliedSeq`. */
  private inboxNeeded(id: string): boolean {
    return (
      this.inboxWaiters.has(id) ||
      this.seriesInflight.has(id) ||
      this.pendingScriptSubscribe.has(id)
    );
  }

  /** Drop leftover waiter frames once `awaitFull` consumed the snapshot. */
  private discardLiveInbox(subId: string): void {
    if (!subId || this.inboxWaiters.has(subId)) return;
    this.inbox.delete(subId);
  }

  private isDroppableTip(frame: WireFrame): boolean {
    return isFormingSeriesTip(frame);
  }

  /** True once this series sub has a snapshot (subscribe-once). */
  isSubscribed(subId: string): boolean {
    return this.appliedSeq.has(subId);
  }

  /**
   * Subscribe the chart series; resolves with snapshot bars for paint.
   *
   * First call waits for `full`. Later calls return the cached snapshot
   * without a second `subscribe`. Concurrent callers join the in-flight wait
   * instead of stealing `inboxWaiters`.
   */
  async ensureSeries(subId: string, meta: Record<string, unknown>): Promise<Bar[]> {
    const cached = this.seriesBars.get(subId);
    if (this.appliedSeq.has(subId) && cached?.length) return cached;
    const inflight = this.seriesInflight.get(subId);
    if (inflight) return inflight;
    const work = this.subscribeSeriesOnce(subId, meta).finally(() => {
      this.seriesInflight.delete(subId);
    });
    this.seriesInflight.set(subId, work);
    return work;
  }

  private async subscribeSeriesOnce(subId: string, meta: Record<string, unknown>): Promise<Bar[]> {
    await this.ensureConnected();
    if (this.cooledDown) this.fail('cooldown', 'stream in failure cooldown');
    this.seriesSubMeta.set(subId, meta);
    this.handlers.onStatus(subId, 'connecting');
    try {
      const send = () => {
        const encoding = this.encodingFor(subId);
        this.client.subscribe(subId, 'series', meta, encoding ? { encoding } : undefined);
      };
      send();
      let full = await this.awaitSnapshot(subId, SNAPSHOT_WAIT_MS, { fatal: true, resend: send });
      if (full.type === 'error' && isAuthPendingSubscribeError(full)) {
        await sleep(AUTH_SUBSCRIBE_RETRY_MS);
        send();
        full = await this.awaitSnapshot(subId, SNAPSHOT_WAIT_MS, { fatal: true, resend: send });
      }
      if (full.type === 'error') {
        const body = (full.payload ?? {}) as Record<string, unknown>;
        const errMsg = String(
          body['message'] ?? (full as { message?: unknown }).message ?? 'subscribe failed',
        );
        const errCode = String(body['code'] ?? (full as { code?: unknown }).code ?? '');
        this.handlers.onStatus(subId, 'error', {
          message: errCode ? `${errCode}: ${errMsg}` : errMsg,
        });
        this.fail('subscribe-error', errCode ? `${errCode}: ${errMsg}` : errMsg);
      }
      if (full.type !== 'full') {
        this.fail('no-snapshot', `expected full, got ${full.type}`);
      }
      const bars = toBars((full.payload as Record<string, unknown>)?.['bars']);
      if (!bars.length) this.fail('empty-snapshot', 'series snapshot held no bars');
      this.appliedSeq.set(subId, typeof full.seq === 'number' ? full.seq : 0);
      this.seriesBars.set(subId, bars);
      this.discardLiveInbox(subId);
      this.handlers.onStatus(subId, 'live');
      engineDebug('wire.series.snapshot', {
        subId,
        n: bars.length,
        seq: typeof full.seq === 'number' ? full.seq : null,
        first: bars[0]?.time ?? null,
        last: bars[bars.length - 1]?.time ?? null,
      });
      return bars;
    } catch (e) {
      if (e instanceof StreamFallbackError) throw e;
      this.fail('series-failed', e instanceof Error ? e.message : String(e));
    }
  }

  /** Evaluate a script over the latest merged stream state (no re-run). */
  async evalScript(input: EvalScriptInput): Promise<RunResult> {
    const sig = inputSignature(input.inputs);
    const depth = historyBarsOf(input.meta);
    engineDebugSample(
      'wire.script.paint',
      {
        subId: input.subId,
        indicatorId: input.indicatorId ?? null,
        windowBars: input.bars.length,
        engineBars: depth,
        mode: this.appliers.has(input.subId) ? 'delta' : 'subscribe',
      },
      1000,
      input.subId,
    );
    await this.ensureConnected();
    // Defensive: stream-live unwraps inputValues, but callers/tests may still
    // pass store Proxies — keep scriptCtx + subscribe clone-safe for Workers.
    const plainMeta = plainWireRecord(input.meta) ?? {};
    const plainInputs = plainWireRecord(input.inputs);
    this.scriptCtx.set(input.subId, {
      script: input.script,
      indicatorId: input.indicatorId,
      bars: input.bars,
      meta: plainMeta,
      ...(plainInputs ? { inputs: plainInputs } : {}),
    });
    // A changed input must re-subscribe: the engine evaluates the script with
    // the values it was subscribed with, so the cached state (and every delta
    // merged into it) would keep the old ones. Depth *growth* also re-subscribes
    // so a longer window is covered; a 1-bar shrink/flicker must not bounce the
    // sub (that left EMA/Momentum as idle/released while Bollinger stayed up).
    const prevSig = this.scriptInputSig.get(input.subId);
    const prevDepth = this.scriptDepth.get(input.subId);
    let applier = this.appliers.get(input.subId);
    const inputsChanged = prevSig !== undefined && prevSig !== sig;
    // Chunked history_bars jumps 5000→5100 on the first tip past an exact
    // boundary. Deltas already extend the session — adopt the higher depth
    // without bouncing the sub (that was a full snapshot per script every
    // minute after a 5k load). Explicit / off-grid depth jumps still resub.
    const chunkHeadroom =
      prevDepth !== undefined && isEngineDepthChunkHeadroom(prevDepth, depth, input.bars.length);
    if (chunkHeadroom && applier) {
      this.scriptDepth.set(input.subId, depth);
    }
    const depthGrew = prevDepth !== undefined && depth > prevDepth && !chunkHeadroom;
    // A real window reset drops from the grown ceiling back to the base. A
    // 1-bar shrink is just the tip flicker and must not bounce the sub.
    const depthShrank =
      prevDepth !== undefined && depth < prevDepth && prevDepth - depth > ENGINE_DEPTH_TIP_BAND;
    const identityChanged = !!applier && (inputsChanged || depthGrew || depthShrank);
    if (identityChanged) {
      engineDebug('wire.script.resubscribe', {
        subId: input.subId,
        indicatorId: input.indicatorId ?? null,
      });
      // Arm before unsubscribe so the ack cannot wipe the replacement sub.
      this.pendingScriptSubscribe.add(input.subId);
      this.appliers.delete(input.subId);
      this.appliedSeq.delete(input.subId);
      this.scriptInputSig.delete(input.subId);
      this.scriptDepth.delete(input.subId);
      this.paintLatest.delete(input.subId);
      this.paintTail.delete(input.subId);
      this.holdUntilFull.delete(input.subId);
      this.clearGapResync(input.subId);
      this.inbox.delete(input.subId);
      applier = undefined;
      try {
        this.client.unsubscribe(input.subId);
      } catch {
        /* best-effort: the engine drops the old subscription anyway */
      }
    }
    if (!applier) {
      // A script subscribe must not cool down or fail() the series socket.
      if (this.cooledDown) {
        this.pendingScriptSubscribe.delete(input.subId);
        throw new StreamFallbackError('cooldown', 'stream in failure cooldown');
      }
      applier = new Redesign2DeltaApplier();
      this.appliers.set(input.subId, applier);
      this.scriptInputSig.set(input.subId, sig);
      this.scriptDepth.set(input.subId, depth);
      this.pendingScriptSubscribe.add(input.subId);
      this.handlers.onStatus(input.subId, 'connecting');
      try {
        const send = () => {
          const encoding = this.encodingFor(input.subId);
          this.client.subscribe(input.subId, 'script', plainMeta, {
            script: input.script,
            ...(plainInputs ? { inputs: plainInputs } : {}),
            ...(encoding ? { encoding } : {}),
          });
        };
        send();
        let full = await this.awaitSnapshot(input.subId, SNAPSHOT_WAIT_MS, {
          fatal: false,
          resend: send,
        });
        if (full.type === 'error' && isAuthPendingSubscribeError(full)) {
          await sleep(AUTH_SUBSCRIBE_RETRY_MS);
          send();
          full = await this.awaitSnapshot(input.subId, SNAPSHOT_WAIT_MS, {
            fatal: false,
            resend: send,
          });
        }
        if (full.type === 'error' || full.type !== 'full') {
          const body = (full.payload ?? {}) as Record<string, unknown>;
          const errMsg = String(
            body['message'] ?? (full as { message?: unknown }).message ?? full.type,
          );
          const errCode = String(body['code'] ?? (full as { code?: unknown }).code ?? '');
          throw new StreamFallbackError(
            'script-subscribe-failed',
            errCode ? `${errCode}: ${errMsg}` : errMsg,
          );
        }
        const payload = full.payload as Record<string, unknown> | null | undefined;
        if (payload == null) {
          throw new StreamFallbackError('script-subscribe-failed', 'empty full payload');
        }
        this.axisResubPending.delete(input.subId);
        this.holdUntilFull.delete(input.subId);
        this.clearGapResync(input.subId);
        // Re-bind in case a raced status frame cleared the maps mid-await.
        this.appliers.set(input.subId, applier);
        this.scriptInputSig.set(input.subId, sig);
        this.scriptDepth.set(input.subId, depth);
        this.scriptCtx.set(input.subId, {
          script: input.script,
          indicatorId: input.indicatorId,
          bars: input.bars,
          meta: plainMeta,
          ...(plainInputs ? { inputs: plainInputs } : {}),
        });
        const fallbackTimes = this.scriptCtx.get(input.subId)?.bars.map((b) => b.time) ?? null;
        applier.applyFull(scriptFullForApplier(payload, full.seq, fallbackTimes));
        this.appliedSeq.set(input.subId, typeof full.seq === 'number' ? full.seq : 0);
        this.discardLiveInbox(input.subId);
        this.handlers.onStatus(input.subId, 'live');
      } catch (e) {
        // Drop half-state so the next streamEvalScript can subscribe cleanly.
        this.release(input.subId);
        if (e instanceof StreamFallbackError) throw e;
        const message =
          e instanceof Error ? e.message || String(e) : String(e);
        const stack =
          e instanceof Error && typeof e.stack === 'string'
            ? e.stack.split('\n').slice(0, 4).join('\n')
            : undefined;
        engineDebug('wire.script.subscribeFailed', {
          subId: input.subId,
          indicatorId: input.indicatorId ?? null,
          message,
          ...(stack ? { stack } : {}),
        });
        throw new StreamFallbackError('script-failed', message);
      } finally {
        this.pendingScriptSubscribe.delete(input.subId);
      }
      const cached = applier.cached;
      if (!cached) {
        throw new StreamFallbackError('no-state', 'script snapshot produced no state');
      }
      await this.applyScriptPush(input.subId, cached, 'stream-full');
      return emptyStreamResult();
    }
    // Still waiting on a gap snapshot: retry fresh subscribe under backoff so a
    // wedged sub cannot sit on holdUntilFull forever between venue ticks.
    if (this.holdUntilFull.has(input.subId)) {
      this.requestFreshSnapshot(input.subId, 'delta gap — resubscribing');
    }
    const cached = applier.cached;
    if (!cached) {
      throw new StreamFallbackError('no-state', 'script has no merged state yet');
    }
    // Venue ticks keep calling evalScript with the merged cache. When the
    // engine stops advancing bar_times, that re-paint looks "live" (scriptStatus
    // stays live, wire.script.paint keeps firing) while the indicator tip freezes
    // dozens of bars behind the chart — only indicators.run recovered it. Detect
    // real closed-bar lag and ask for a soft fresh full (no degraded chip).
    const chartBars = this.barsForScript(input.bars);
    const lagSec = scriptCacheTipLagSec(cached, chartBars);
    const step = chartStepSec(chartBars);
    if (lagSec != null && step > 0 && lagSec > step * SCRIPT_TIP_LAG_BARS) {
      const times = readTimeList(cached['bar_times'] ?? cached['times']);
      engineDebug('wire.script.tipLag', {
        subId: input.subId,
        indicatorId: input.indicatorId ?? null,
        lagSec,
        stepSec: step,
        thresholdBars: SCRIPT_TIP_LAG_BARS,
        cacheLast: times?.length ? times[times.length - 1] : null,
        chartLast: chartClosedTipTime(chartBars),
      });
      this.requestFreshSnapshot(input.subId, 'script tip lag — resubscribing', { soft: true });
    }
    await this.applyScriptPush(input.subId, cached, 'stream-delta');
    return emptyStreamResult();
  }

  /** Route an inbound frame to appliers + handlers. Never throws. */
  routeFrame(frame: WireFrame): void {
    try {
      if (this.shouldHold(frame)) {
        this.holdFrame(frame);
        return;
      }
      if (frame.type === 'full' && frame.id) {
        this.heldLive.delete(frame.id);
      }
      this.rememberClosedUpto(frame);
      if (frame.type === 'status' && frame.id) {
        this.routeStatusFrame(frame);
        return;
      }
      if (frame.type === 'error' && frame.id) {
        this.noteReplayUnavailable(frame.id);
        return;
      }
      if ((frame.type === 'full' || frame.type === 'delta') && (frame.sessionId || frame.id)) {
        this.applyRemoteFrame(frame);
        return;
      }
      if (frame.type === 'close' && frame.id) {
        const payload = (frame.payload as Record<string, unknown>) ?? {};
        const ohlcv = payload['ohlcv'] as Record<string, number> | undefined;
        this.handlers.onCloseVerified(Number(payload['time'] ?? 0), 'unknown', ohlcv);
      }
    } catch {
      /* routing must never break the socket */
    }
  }

  private routeStatusFrame(frame: WireFrame): void {
    if (!frame.id) return;
    const payload = (frame.payload as Record<string, unknown>) ?? {};
    const code = String(payload['code'] ?? 'live');
    const message = payload['message'] as string | undefined;
    const isReleaseAck = code === 'idle' || message === 'released';
    const isScript = !frame.id.startsWith('series:');
    const hadLocal =
      isScript &&
      (this.appliers.has(frame.id) ||
        this.appliedSeq.has(frame.id) ||
        this.scriptCtx.has(frame.id) ||
        this.pendingScriptSubscribe.has(frame.id));
    // Own unsubscribe (gap resync / input resub / failed subscribe) — ignore
    // the ack so it cannot blank the replacement half-open subscription.
    const ignoreReleaseAck =
      isReleaseAck &&
      isScript &&
      (this.holdUntilFull.has(frame.id) || this.pendingScriptSubscribe.has(frame.id));
    // Duplicate release ack after local drop must not overwrite degraded backoff.
    const skipDuplicateRelease = isReleaseAck && isScript && !hadLocal && !ignoreReleaseAck;
    if (!ignoreReleaseAck && !skipDuplicateRelease) {
      this.handlers.onStatus(frame.id, code as SubscriptionStatus, {
        message,
        have: typeof payload['have'] === 'number' ? payload['have'] : undefined,
        need: typeof payload['need'] === 'number' ? payload['need'] : undefined,
      });
    }
    // Server released the sub (unsubscribe ack or idle eviction). Drop local
    // state so the next streamEvalScript re-subscribes — unless we are already
    // waiting on a fresh full / in-flight subscribe (our own unsubscribe).
    if (
      isScript &&
      !this.holdUntilFull.has(frame.id) &&
      !this.pendingScriptSubscribe.has(frame.id) &&
      isReleaseAck &&
      hadLocal
    ) {
      this.dropScriptLocal(frame.id);
    }
  }

  private notifyInboxWaiters(subId: string): void {
    const list = this.inboxWaiters.get(subId);
    if (!list?.length) return;
    this.inboxWaiters.delete(subId);
    for (const fn of list) fn();
  }

  private addInboxWaiter(subId: string, fn: () => void): void {
    const list = this.inboxWaiters.get(subId);
    if (list) list.push(fn);
    else this.inboxWaiters.set(subId, [fn]);
  }

  private removeInboxWaiter(subId: string, fn: () => void): void {
    const list = this.inboxWaiters.get(subId);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this.inboxWaiters.delete(subId);
  }

  /**
   * One deadline, then two backoff resends, then one JSON subscribe when
   * this socket is negotiating AXB1. The loop is bounded.
   */
  private async awaitSnapshot(
    subId: string,
    timeoutMs: number,
    opts: { fatal: boolean; resend: () => void },
  ): Promise<WireFrame> {
    let last: StreamFallbackError | null = null;
    const attempts = SNAPSHOT_BACKOFF_MS.length + 1;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, SNAPSHOT_BACKOFF_MS[i - 1]));
        try {
          opts.resend();
        } catch {
          /* the next wait still ends */
        }
      }
      try {
        return await this.awaitFull(subId, timeoutMs, { fatal: false });
      } catch (e) {
        if (!(e instanceof StreamFallbackError) || e.reason !== 'snapshot-timeout') throw e;
        last = e;
      }
    }
    if (negotiatedEncoding() && !this.jsonSubs.has(subId)) {
      this.jsonSubs.add(subId);
      v1Count('jsonFallback');
      this.handlers.onStatus(subId, 'degraded', { message: 'snapshot timeout — JSON' });
      try {
        opts.resend();
      } catch {
        /* keep the socket */
      }
      try {
        return await this.awaitFull(subId, timeoutMs, { fatal: false });
      } catch (e) {
        if (!(e instanceof StreamFallbackError) || e.reason !== 'snapshot-timeout') throw e;
        last = e;
      }
    }
    const message = last?.message ?? `no snapshot for ${subId}`;
    if (!opts.fatal) throw last ?? new StreamFallbackError('snapshot-timeout', message);
    this.fail('snapshot-timeout', message);
  }

  /**
   * Wait for the snapshot (`full` or terminal `error`), draining the inbox
   * first so back-to-back status+full delivery never loses the snapshot.
   * Preceding `status` frames route to the handlers. A `datafeed-loading`
   * status waits until {@link LOADING_WAIT_CAP_MS} from start — PYNE may
   * send one early loading frame then block on history ensure. Leftover
   * `delta` / `close` frames stay in the inbox — they are not a failed snapshot.
   *
   * `fatal: false` throws {@link StreamFallbackError} without cooling the
   * wire — a script snapshot miss must not disconnect the series socket.
   */
  private async awaitFull(
    subId: string,
    timeoutMs: number,
    opts?: { fatal?: boolean },
  ): Promise<WireFrame> {
    const started = Date.now();
    let deadline = started + timeoutMs;
    const fatal = opts?.fatal !== false;
    for (;;) {
      const queue = this.inbox.get(subId) ?? [];
      const leftover: WireFrame[] = [];
      let found: WireFrame | undefined;
      while (queue.length) {
        const frame = queue.shift();
        if (!frame) break;
        if (frame.type === 'status') {
          this.routeStatusFrame(frame);
          const code = String((frame.payload as Record<string, unknown>)?.['code'] ?? '');
          if (code === 'datafeed-loading') {
            deadline = started + LOADING_WAIT_CAP_MS;
          }
          continue;
        }
        if (frame.type === 'full' || frame.type === 'error') {
          found = frame;
          leftover.push(...queue);
          queue.length = 0;
          break;
        }
        leftover.push(frame);
      }
      this.inbox.set(subId, leftover);
      if (found) return found;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const message = `no snapshot for ${subId}`;
        if (!fatal) throw new StreamFallbackError('snapshot-timeout', message);
        this.fail('snapshot-timeout', message);
      }
      await new Promise<void>((resolve) => {
        const onFrame = () => {
          clearTimeout(timer);
          this.removeInboxWaiter(subId, onFrame);
          resolve();
        };
        const timer = setTimeout(() => {
          this.removeInboxWaiter(subId, onFrame);
          resolve();
        }, remaining);
        this.addInboxWaiter(subId, onFrame);
      });
    }
  }

  private lastBarTime(bars: readonly Bar[]): number {
    if (!bars.length) return 0;
    const t = bars[bars.length - 1]?.time;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  }

  /** Re-issue resume for every live sub after the socket comes back. */
  private resumeAll(): void {
    // A transient fail must not keep rejecting ensureSeries after a healthy open.
    this.coolUntil = 0;
    for (const [subId, seq] of this.appliedSeq) {
      // PYNE resume emits a full that may restart seq at 1 — hold until it
      // lands so the rewind gate cannot drop it (series sub frozen at 11211).
      this.holdUntilFull.add(subId);
      this.tryResume(subId, { seq });
    }
  }

  /** Ask the engine to repair a closed bar (close-mismatch / seq gap). */
  repair(subId: string, fromTime: number): void {
    try {
      this.client.requestRepair?.(subId, fromTime);
    } catch {
      /* best-effort */
    }
  }

  private applySeriesPush(subId: string, frame: WireFrame, payload: Record<string, unknown>): void {
    const bars = toBars(payload['bars']);
    const seq = typeof frame.seq === 'number' ? frame.seq : null;
    const prevSeq = this.appliedSeq.get(subId);
    if (frame.type === 'full') {
      const recovering = this.isRecoveryFull(subId);
      // Do NOT clearGapResync on every full — that reset backoff and let a
      // gap→resync→full loop run at ~6 Hz (debug log: 228 series.full / ~40s).
      // A resume full may restart seq at 1; drop only a late snapshot.
      if (seq != null && prevSeq != null && seq < prevSeq && !recovering) return;
      this.holdUntilFull.delete(subId);
      if (!bars.length) return;
      this.seriesBars.set(subId, bars);
      this.appliedSeq.set(subId, seq ?? prevSeq ?? 0);
      engineDebug('wire.series.full', {
        subId,
        n: bars.length,
        seq,
        first: bars[0]?.time ?? null,
        last: bars[bars.length - 1]?.time ?? null,
      });
      // Already live: a sliding 500-bar "full" is tip-equivalent — do not
      // re-run onSeriesFull. First snapshot or post-gap recovery still paints.
      const tip = bars[bars.length - 1]!;
      if (prevSeq != null && !recovering && Number.isFinite(tip.time)) {
        this.handlers.onSeriesDelta([tip], true);
      } else {
        this.handlers.onSeriesFull(bars);
        this.clearGapResync(subId);
      }
      this.handlers.onStatus(subId, 'live');
      return;
    }
    if (this.holdUntilFull.has(subId)) return;
    const seqAckFrom =
      typeof payload['seqAckFrom'] === 'number' ? payload['seqAckFrom'] : undefined;
    runApplyTransaction({
      seq,
      lastSeq: prevSeq ?? 0,
      ...(seqAckFrom != null ? { seqAckFrom } : {}),
      commit: () => {
        if (seq != null) this.appliedSeq.set(subId, seq);
        // A continuous delta after gap recovery resets the resync backoff.
        this.clearGapResync(subId);
        if (bars.length) {
          engineDebugSample(
            'wire.series.delta',
            {
              subId,
              n: bars.length,
              seq,
              time: bars[bars.length - 1]?.time ?? null,
              close: bars[bars.length - 1]?.close ?? null,
            },
            1000,
            subId,
          );
          this.handlers.onSeriesDelta(bars, true);
          this.seriesBars.set(subId, mergeTip(this.seriesBars.get(subId) ?? [], bars));
        }
        this.handlers.onStatus(subId, 'live');
      },
      onStale: (reason) => {
        engineDebug('wire.stale', { subId, reason, seq, lastSeq: prevSeq ?? 0 });
        if (reason !== 'gap') return;
        v1Count('seqGap');
        // Series: resume (cheap). Scripts: fresh subscribe (requestFreshSnapshot).
        this.requestSeriesGapRecover(subId);
      },
    });
  }

  private applyScriptPush(
    subId: string,
    cached: Record<string, unknown>,
    via: 'stream-full' | 'stream-delta',
  ): Promise<void> | void {
    // A real (or kick) script paint already closes the metrics burst.
    this.seriesScriptKick = false;
    this.seriesScriptKickNeedsPaint = false;
    const ctx = this.scriptCtx.get(subId);
    if (!ctx) return;
    // The subscription captured the window at subscribe time. A new candle
    // replaces that array when the chart slides, so the paint has to use the
    // window on screen or the closed %B lands on the next bar.
    const bars = this.barsForScript(ctx.bars);
    if (bars !== ctx.bars) this.scriptCtx.set(subId, { ...ctx, bars });
    this.paintLatest.set(subId, { cached, via, bars });
    return this.flushScriptPaint(subId);
  }

  /**
   * After a series-only tip, close `batch:post` → `apply:start`. Same-slot
   * forming tips stamp metrics synchronously (no microtask — that delay was
   * the ~16 ms queueWait p50). A new tip time coalesces one cached-script
   * paint on a microtask so a real script frame in the same turn can cancel
   * it; overlays can still extend before the script's own wire frame.
   */
  private scheduleSeriesScriptKick(frame?: WireFrame): void {
    this.seriesScriptKick = true;
    const tipTime = seriesTipTime(frame);
    const forming = isFormingSeriesTip(frame);
    if (tipTime != null && tipTime !== this.seriesKickPaintedTipTime) {
      this.seriesScriptKickNeedsPaint = true;
      this.seriesScriptKickTipTime = tipTime;
    } else if (tipTime == null && frame && !forming) {
      // Closed bar without a parseable tip time — still allow one paint.
      this.seriesScriptKickNeedsPaint = true;
      this.seriesScriptKickTipTime = null;
    }

    // Pending or just-armed paint kick: coalesce on a microtask.
    if (this.seriesScriptKickNeedsPaint) {
      if (this.seriesScriptKickScheduled) return;
      this.seriesScriptKickScheduled = true;
      queueMicrotask(() => {
        this.seriesScriptKickScheduled = false;
        if (!this.seriesScriptKick) return;
        this.seriesScriptKick = false;
        const needsPaint = this.seriesScriptKickNeedsPaint;
        const paintedTip = this.seriesScriptKickTipTime;
        this.seriesScriptKickNeedsPaint = false;
        this.seriesScriptKickTipTime = null;
        if (needsPaint) {
          if (paintedTip != null) this.seriesKickPaintedTipTime = paintedTip;
          if (this.kickOneCachedScriptPaint()) return;
        }
        // Light close when no eligible script (e.g. holdUntilFull).
      });
      return;
    }

    // Same-slot metrics-only: close queueWait in this task.
    this.seriesScriptKick = false;
    if (this.seriesScriptKickScheduled) return;
  }

  private cancelSeriesScriptKick(): void {
    this.seriesScriptKick = false;
    this.seriesScriptKickNeedsPaint = false;
    this.seriesScriptKickTipTime = null;
    this.seriesKickPaintedTipTime = null;
    this.seriesScriptKickScheduled = false;
  }

  /**
   * Paint one live script that has merged state (enough to close the apply
   * burst and extend overlays). Further subs wait for their own wire frames
   * so a series tip cannot flood N script reapplies per frame.
   */
  private kickOneCachedScriptPaint(): boolean {
    for (const subId of this.scriptCtx.keys()) {
      if (this.holdUntilFull.has(subId)) continue;
      const cached = this.appliers.get(subId)?.cached;
      if (!cached) continue;
      this.applyScriptPush(subId, cached, 'stream-delta');
      return true;
    }
    return false;
  }

  /** One apply at a time. Always the newest payload, never a skipped snapshot. */
  private flushScriptPaint(subId: string): Promise<void> | void {
    const existing = this.paintTail.get(subId);
    if (existing) return existing.then(() => this.flushScriptPaint(subId));
    const run = this.drainScriptPaint(subId);
    if (!isThenable(run)) return;
    this.paintTail.set(subId, run);
    void run.finally(() => {
      if (this.paintTail.get(subId) === run) this.paintTail.delete(subId);
    });
    return run;
  }

  /**
   * Drain the newest script payload. A sync `apply` (live delta) runs in this
   * task; a thenable (snapshot) is the only yield.
   */
  private drainScriptPaint(subId: string): Promise<void> | void {
    while (this.paintLatest.has(subId)) {
      const job = this.paintLatest.get(subId);
      this.paintLatest.delete(subId);
      if (!job) continue;
      const ctx = this.scriptCtx.get(subId);
      if (!ctx) continue;
      try {
        const out = this.apply(ctx.script, ctx.indicatorId, job.cached, job.via, job.bars);
        if (isThenable(out)) {
          return Promise.resolve(out).then(
            () => this.drainScriptPaint(subId),
            (err: unknown) => {
              if (job.via === 'stream-full') throw err;
              const reason = err instanceof Error ? err.message : 'paint failed';
              this.requestAxisResub(subId, `apply aborted — ${reason}`);
              return this.drainScriptPaint(subId);
            },
          );
        }
      } catch (err) {
        if (job.via === 'stream-full') throw err;
        const reason = err instanceof Error ? err.message : 'paint failed';
        this.requestAxisResub(subId, `apply aborted — ${reason}`);
      }
    }
  }

  /** Chart window when the store has one; the caller's bars in tests and before the first paint. */
  private barsForScript(fallback: readonly Bar[]): Bar[] {
    const live = store.bars;
    if (Array.isArray(live) && live.length) return live as Bar[];
    return fallback as Bar[];
  }

  /** Bar times the script can be joined to: the series feed plus the painted chart. */
  private knownBarTimes(): number[] {
    const out: number[] = [];
    for (const bars of this.seriesBars.values()) {
      for (const bar of bars) if (Number.isFinite(bar?.time)) out.push(bar.time);
    }
    const live = store.bars;
    if (Array.isArray(live)) {
      for (const bar of live) if (bar && Number.isFinite(bar.time)) out.push(bar.time);
    }
    return out;
  }

  private applyRemoteFrame(frame: WireFrame): void {
    const subId = frame.id;
    if (!subId) return;
    const payload = (frame.payload as Record<string, unknown>) ?? {};
    const applier = this.appliers.get(subId);
    if (!applier) {
      if (payload['bars'] != null || subId.startsWith('series:')) {
        this.applySeriesPush(subId, frame, payload);
      }
      return;
    }
    const wasLive = this.appliedSeq.has(subId);
    if (frame.type === 'full') {
      const seq = typeof frame.seq === 'number' ? frame.seq : null;
      const recovering = this.isRecoveryFull(subId);
      // A snapshot that left before a newer delta must not paint over it —
      // unless we asked for a fresh full after a gap (seq may restart at 1).
      if (wasLive && !recovering && seq != null && seq < applier.lastSeq) return;
      this.holdUntilFull.delete(subId);
      this.axisResubPending.delete(subId);
      // Sliding fulls must not reset gap backoff (the series 6 Hz storm).
      const sliding = wasLive && !recovering;
      if (!sliding) this.clearGapResync(subId);
      const fallbackTimes = this.scriptCtx.get(subId)?.bars.map((b) => b.time) ?? null;
      applier.applyFull(scriptFullForApplier(payload, frame.seq, fallbackTimes));
      if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
      this.handlers.onStatus(subId, 'live');
      // First subscribe paints from evalScript; gap recovery paints here.
      // Subsequent sliding fulls are tip-equivalent (same as series) so
      // apply-bridge keeps liveTick instead of a 4k-bar stream-full setData.
      if (wasLive || recovering) {
        const cached = applier.cached;
        if (cached) this.applyScriptPush(subId, cached, sliding ? 'stream-delta' : 'stream-full');
      }
      return;
    }
    // Stale until the snapshot lands. A delta in between would paint a
    // half-applied generation.
    if (this.holdUntilFull.has(subId)) return;
    const baseIndex = Number(payload['base_index'] ?? -1);
    const count = Number(payload['count'] ?? -1);
    const tailLen = Number(payload['tail_len'] ?? -1);
    const explicitTimes = readTimeList(payload['times']) ?? readTimeList(payload['bar_times']);
    const cachedTimes = readTimeList(applier.cached?.['bar_times'] ?? applier.cached?.['times']);
    const times =
      explicitTimes && explicitTimes.length === tailLen
        ? explicitTimes
        : scriptDeltaTimeTail(
            cachedTimes,
            { base_index: baseIndex, count, tail_len: tailLen },
            this.knownBarTimes(),
          );
    // The applier's cursor, not the last painted seq. A salvage can accept a
    // seq and refuse to paint it; the next delta is continuous with that
    // cursor and must still be allowed to paint.
    const acceptedSeq = applier.lastSeq;
    const hasSeq = typeof frame.seq === 'number' && Number.isFinite(frame.seq);
    const seqAckFrom =
      typeof payload['seqAckFrom'] === 'number' ? payload['seqAckFrom'] : undefined;
    const delta = {
      // Do not invent a seq: a relay that strips it would otherwise look like
      // a rewind on every frame and force a full snapshot each tick.
      ...(hasSeq ? { seq: frame.seq } : {}),
      base_index: baseIndex,
      count,
      tail_len: tailLen,
      plots: payload['plots'] as Record<string, unknown[]> | undefined,
      series: payload['series'] as Record<string, unknown[]> | undefined,
      forming: payload['forming'] === true,
      unchanged: payload['unchanged'] === true,
      ...(seqAckFrom != null ? { seqAckFrom } : {}),
      ...(times ? { times } : {}),
    };
    let out = applier.applyDelta(delta);
    // A rejected delta means the merge is unsafe. Two cases:
    // - Missed frames (seq gap after idle/throttle): force-merging would
    //   silently drop bars, and any values-only salvage would paint without
    //   an axis (tail-pinned diagonals). Resubscribe for a fresh full.
    // - Continuous seq but an axis splice the applier cannot join (cached
    //   bar_times longer than the script window, e.g. Donchian): drop the
    //   axis and merge the values — but only paint when the merge still
    //   covers the chart window. An axis-less merge over a moved window
    //   would be skipped by the apply path anyway (`staleNoAxis` keeps the
    //   last good plots), so resubscribe for a real full instead of holding
    //   a frozen pane on every tick.
    if (!out.ok && out.reason === 'needs-full') {
      // Only a real seq relationship may force a fresh subscribe. With no seq
      // the applier already validated the positional splice; a refusal there
      // is an axis/count mismatch, not missed frames, and must not loop.
      // seqAckFrom makes a coalesced hole continuous — do not thrash resync.
      if (hasSeq && classifySeqGap(applier.lastSeq, frame.seq!, seqAckFrom).kind !== 'continuous') {
        this.requestFreshSnapshot(subId, 'delta gap — resubscribing');
        return;
      }
      // Chart-window realign (Donchian etc.): engine sessions often ship a
      // longer axis than the subscribe window. The old salvage stripped
      // bar_times from the cache, so every later delta fell through to
      // "delta rejected" and stormed soft fresh-subscribe. Fit once, then
      // tip-overlay only while the cache stays window-aligned.
      const windowBars = this.scriptCtx.get(subId)?.bars;
      const cached = applier.cached;
      if (cached && windowBars?.length) {
        const fitted = realignScriptDeltaToWindow(
          cached,
          windowBars,
          delta,
          typeof frame.seq === 'number' ? frame.seq : undefined,
        );
        applier.applyFull(fitted);
        out = {
          ok: true,
          full: { ...(applier.cached ?? fitted) },
          replayed: false,
          executionContext: 'tip',
        };
      }
    }
    if (!out.ok) {
      this.requestAxisResub(subId, 'delta rejected — resubscribing');
      return;
    }
    // One commit for this delta. A gap or a thrown step never paints.
    const seq = hasSeq ? frame.seq! : null;
    runApplyTransaction({
      seq,
      // The applier already validated the seq relationship (including a
      // tolerated gap after an unsequenced frame). Re-checking against the
      // pre-apply cursor would reject a delta the splice just accepted.
      lastSeq: hasSeq ? frame.seq! - 1 : acceptedSeq,
      ...(seqAckFrom != null ? { seqAckFrom } : {}),
      commit: () => {
        if (hasSeq) this.appliedSeq.set(subId, frame.seq!);
        // A committed delta proves the axis is usable again. A recovery full
        // alone does not: the next delta is what decides, so the escalation
        // counter must survive the full that answered a resume.
        this.axisResubAttempts.delete(subId);
        this.handlers.onStatus(subId, 'live');
        if (!out.replayed) this.applyScriptPush(subId, out.full, 'stream-delta');
      },
      onStale: (reason) => {
        this.requestAxisResub(subId, `apply aborted — ${reason}`);
      },
    });
  }

  /**
   * Soft recovery for an unpaintable merge (no paint). Donchian-style scripts
   * often land with engine `bar_times` longer than the chart window; without
   * backoff every delta marked `degraded` and escalated to fresh subscribe
   * (`resync` climbing tens per minute while chips flickered).
   */
  private requestAxisResub(subId: string, message = 'axis mismatch — resubscribing'): void {
    if (this.gapBackoffArmed(subId, this.axisResubAt, this.axisResubAttempts)) return;

    const next = this.markGapAttempt(subId, this.axisResubAt, this.axisResubAttempts);
    // Soft chip — same idea as tip-lag recovery (not a hard feed failure).
    this.handlers.onStatus(subId, 'connecting', { message });

    // Resume returns the same pooled engine session. If that session keeps
    // producing a full the applier cannot splice, replace it with a fresh
    // subscribe (new session) instead of looping on 12k-point snapshots.
    if (next > AXIS_RESUB_ESCALATE_AFTER) {
      this.axisResubAttempts.delete(subId);
      this.axisResubAt.delete(subId);
      this.requestFreshSnapshot(subId, 'axis mismatch — fresh subscribe', { soft: true });
      return;
    }
    if (this.axisResubPending.has(subId)) return;
    this.axisResubPending.add(subId);
    this.tryResume(subId, { bars: this.scriptCtx.get(subId)?.bars ?? [] });
  }

  private clearGapResync(subId: string): void {
    this.gapResyncAt.delete(subId);
    this.gapResyncAttempts.delete(subId);
    this.inboxOverflowPending.delete(subId);
    this.inboxOverflowAt.delete(subId);
    this.inboxOverflowAttempts.delete(subId);
  }

  /**
   * Series gap recovery: resume from last applied seq (no unsubscribe storm).
   * Debug logs showed unsubscribe+subscribe fulls at ~6/s when every tip looked
   * like a gap and each full cleared the backoff counter.
   */
  private requestSeriesGapRecover(subId: string): void {
    this.holdUntilFull.add(subId);
    this.handlers.onStatus(subId, 'degraded', { message: 'delta gap — resyncing' });
    if (this.gapBackoffArmed(subId, this.gapResyncAt, this.gapResyncAttempts)) return;
    this.markGapAttempt(subId, this.gapResyncAt, this.gapResyncAttempts);
    this.tryResume(subId, {
      bars: this.seriesBars.get(subId) ?? [],
      closedUpto: this.appliedClosedUpto.get(subId),
    });
  }

  /**
   * After a seq gap: hold deltas, ask once (with backoff) for a fresh full via
   * unsubscribe+subscribe. Resume-loop thrash left scripts degraded forever when
   * tip coalesce / UNCHANGED acks kept looking like holes.
   *
   * `soft: true` (script tip-lag) keeps the chip on `connecting` instead of
   * `degraded`, and skips status/resync side effects while backoff is armed so
   * a second live script is not flicked degraded on every venue tick.
   */
  private requestFreshSnapshot(
    subId: string,
    message: string,
    opts?: { soft?: boolean },
  ): void {
    const soft = opts?.soft === true;
    if (this.gapBackoffArmed(subId, this.gapResyncAt, this.gapResyncAttempts)) {
      this.holdUntilFull.add(subId);
      return;
    }

    this.holdUntilFull.add(subId);
    this.handlers.onStatus(subId, soft ? 'connecting' : 'degraded', { message });
    v1Count('resync');
    this.markGapAttempt(subId, this.gapResyncAt, this.gapResyncAttempts);

    // Fresh subscribe often restarts seq at 1 — drop appliedSeq so wasLive is
    // false and the rewind gate cannot reject it. Keep the applier cache so
    // evalScript / kick paints still have a last-good frame while we wait.
    this.appliedSeq.delete(subId);

    try {
      this.client.unsubscribe(subId);
    } catch {
      /* already gone */
    }

    const ctx = this.scriptCtx.get(subId);
    if (ctx) {
      try {
        const encoding = this.encodingFor(subId);
        this.client.subscribe(subId, 'script', ctx.meta, {
          script: ctx.script,
          ...(ctx.inputs ? { inputs: ctx.inputs } : {}),
          ...(encoding ? { encoding } : {}),
        });
      } catch {
        /* socket may still be coming up */
      }
      return;
    }

    const seriesMeta = this.seriesSubMeta.get(subId);
    if (seriesMeta) {
      try {
        const encoding = this.encodingFor(subId);
        this.client.subscribe(subId, 'series', seriesMeta, encoding ? { encoding } : undefined);
      } catch {
        /* socket may still be coming up */
      }
      return;
    }

    this.tryResume(subId, { bars: this.seriesBars.get(subId) ?? [], seq: 0 });
  }

  /** Clear script wire state without unsubscribing (server already released). */
  private dropScriptLocal(subId: string): void {
    this.axisResubPending.delete(subId);
    this.axisResubAttempts.delete(subId);
    this.axisResubAt.delete(subId);
    this.holdUntilFull.delete(subId);
    this.pendingScriptSubscribe.delete(subId);
    this.clearGapResync(subId);
    this.appliers.delete(subId);
    this.appliedSeq.delete(subId);
    this.jsonSubs.delete(subId);
    this.scriptCtx.delete(subId);
    this.scriptInputSig.delete(subId);
    this.scriptDepth.delete(subId);
    this.paintLatest.delete(subId);
    this.paintTail.delete(subId);
    this.inbox.delete(subId);
  }

  release(subId: string): void {
    this.dropScriptLocal(subId);
    this.seriesBars.delete(subId);
    this.seriesSubMeta.delete(subId);
    this.seriesInflight.delete(subId);
    try {
      this.client.unsubscribe(subId);
    } catch {
      /* already gone */
    }
  }

  /**
   * Read-only diagnostic view of the wire for MCP `stream.get`: cooldown,
   * socket counters and the live subscriptions (ids + last applied seq only —
   * never frame payloads or the auth token).
   */
  snapshotState(): {
    open: boolean;
    cooledDown: boolean;
    failures: number;
    lastFail: { reason: string; message: string; at: number } | null;
    stats: ReturnType<NonNullable<WireClient['stats']>> | null;
    subs: Array<{ subId: string; kind: 'series' | 'script'; seq: number; merged: boolean }>;
  } {
    const subs = [...this.appliedSeq.entries()]
      .map(([subId, seq]) => ({
        subId,
        kind: subId.startsWith('series:') ? ('series' as const) : ('script' as const),
        seq,
        merged: this.appliers.has(subId) || this.seriesBars.has(subId),
      }))
      .sort((a, b) => a.subId.localeCompare(b.subId));
    return {
      open: this.client.isOpen,
      cooledDown: this.cooledDown,
      failures: this.failures,
      lastFail: this.lastFail,
      stats: this.client.stats?.() ?? null,
      subs,
    };
  }

  /**
   * Unsubscribe every subscription and drop the socket (MCP `stream.reset`).
   *
   * The client is terminal after `disconnect()` (`stopped = true`), so the
   * caller must also discard this wire — `streams/stream-live` rebuilds a fresh
   * one from the current engine config on the next tick, which is exactly the
   * point: a key/endpoint change or a wedged reconnect loop gets a clean start.
   * Never throws.
   */
  /** Drop every per-sub map shared by `reset` and `disconnect`. */
  private clearSubscriptionState(): void {
    this.appliers.clear();
    this.appliedSeq.clear();
    this.seriesBars.clear();
    this.seriesSubMeta.clear();
    this.seriesInflight.clear();
    this.scriptCtx.clear();
    this.scriptInputSig.clear();
    this.scriptDepth.clear();
    this.paintLatest.clear();
    this.paintTail.clear();
    this.holdUntilFull.clear();
    this.axisResubPending.clear();
    this.axisResubAttempts.clear();
    this.axisResubAt.clear();
    this.gapResyncAt.clear();
    this.gapResyncAttempts.clear();
    this.inboxOverflowPending.clear();
    this.inboxOverflowAt.clear();
    this.inboxOverflowAttempts.clear();
    this.cancelSeriesScriptKick();
  }

  reset(): { unsubscribed: number; wasOpen: boolean; cooledDown: boolean } {
    let unsubscribed = 0;
    for (const subId of this.appliedSeq.keys()) {
      try {
        this.client.unsubscribe(subId);
        unsubscribed += 1;
      } catch {
        /* socket may already be gone */
      }
    }
    const wasOpen = this.client.isOpen;
    const cooledDown = this.cooledDown;
    this.clearSubscriptionState();
    this.inbox.clear();
    this.inboxWaiters.clear();
    this.failures = 0;
    this.coolUntil = 0;
    this.clearHidden();
    try {
      this.client.disconnect();
    } catch {
      /* ignore */
    }
    return { unsubscribed, wasOpen, cooledDown };
  }

  disconnect(): void {
    this.clearSubscriptionState();
    this.clearHidden();
    try {
      this.client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
