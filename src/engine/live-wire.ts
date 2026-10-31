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

import type { RunResult } from '../plugins/types';
import { store } from '../store';
import type { Bar } from '../store/types';
import { sanitizeStreamBar } from '../data/parse-bars';
import { engineDebug, engineDebugSample } from '../debug';

import { readTimeList, scriptDeltaTimeTail, Redesign2DeltaApplier } from './client-apply';
import { classifySeqGap } from './frames';
import { v1Count } from './v1/metrics';
import { commitLiveBatch, runApplyTransaction } from './v1/apply-transaction';
import { wantsWorkerTransport } from './v1/transport';
import type { SubscriptionStatus } from '../store/types';

export class StreamFallbackError extends Error {
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? `stream unavailable: ${reason}`);
    this.name = 'StreamFallbackError';
    this.reason = reason;
  }
}

export interface WireFrame {
  type: string;
  id?: string;
  sessionId?: string;
  ts?: number;
  seq?: number;
  payload?: Record<string, unknown>;
}

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
function negotiatedEncoding(): 'axb1' | undefined {
  if (wantsWorkerTransport()) return 'axb1';
  return undefined;
}

function resumeExtra(
  seq: number,
  closedUpto?: number,
): { seq: number; closed_upto?: number; encoding?: 'axb1' } {
  const encoding = negotiatedEncoding();
  return {
    seq,
    ...(closedUpto != null ? { closed_upto: closedUpto } : {}),
    ...(encoding ? { encoding } : {}),
  };
}

function readClosedUpto(frame: WireFrame): number | null {
  const n = frame.payload?.closed_upto;
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
/**
 * After the tab is shown, fold the queued burst into one decision.
 * A hidden tab must not replay every tick it missed.
 */
export const HIDDEN_WAKE_MS = 50;
/** Per-subscription inbox. Extra forming tips are dropped; closes and snapshots stay. */
const INBOX_CAP = 32;

function historyBarsOf(meta: Record<string, unknown> | undefined): number {
  const n = Number(meta?.history_bars);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** True when subscribe beat the auth handshake — retry once, do not cool yet. */
function isAuthPendingSubscribeError(frame: WireFrame): boolean {
  if (frame.type !== 'error') return false;
  const body = (frame.payload ?? {}) as Record<string, unknown>;
  const code = String(body.code ?? (frame as { code?: unknown }).code ?? '')
    .trim()
    .toUpperCase();
  const message = String(body.message ?? (frame as { message?: unknown }).message ?? '');
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
  if (!frame || frame.type !== 'delta') return false;
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
  const series = payload.series;
  if (series && typeof series === 'object' && !Array.isArray(series)) {
    let n = 0;
    for (const value of Object.values(series as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > n) n = value.length;
    }
    if (n > 0) return n;
  }
  const plots = payload.plots;
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
  payload: Record<string, unknown>,
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
  const columns = scriptColumnCount(payload);
  const declared = Number(payload.count ?? 0);
  const count = columns && columns > 0 ? columns : declared;
  const raw = readTimeList(payload.bar_times) ?? readTimeList(payload.times);
  let times = raw && raw.length === count ? raw : null;
  // Synthesize an axis from the subscribed window so apply can time-join
  // instead of hitting staleNoAxis (engine 20k replica vs 5k chart).
  if (!times && fallbackTimes && fallbackTimes.length && count > 0) {
    if (fallbackTimes.length === count) times = [...fallbackTimes];
    else if (fallbackTimes.length > count) times = fallbackTimes.slice(-count);
  }
  return {
    plots: payload.plots as Record<string, unknown[]> | undefined,
    series: payload.series as Record<string, unknown[]> | undefined,
    count,
    ...(typeof seq === 'number' ? { seq } : {}),
    ...(times ? { bar_times: times } : {}),
  };
}

/** Same payload without a time axis, so a value delta can merge after an axis splice failed. */
function withoutTimeAxis(full: Record<string, unknown>): Record<string, unknown> {
  const { bar_times: _barTimes, times: _times, ...rest } = full;
  return rest;
}

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
  /** Inbox could not drop a tip. One snapshot until the next full. */
  private readonly inboxOverflowPending = new Set<string>();
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
    this.handlers.onStatus(subId, 'degraded', { message: 'resyncing' });
    const bars = this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
    const seq = this.appliedSeq.get(subId) ?? 0;
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, seq, this.appliedClosedUpto.get(subId)),
      );
    } catch {
      /* socket may still be coming up */
    }
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

  private encodingFor(subId: string): 'axb1' | undefined {
    if (this.jsonSubs.has(subId)) return undefined;
    return negotiatedEncoding();
  }

  private resumePayload(
    subId: string,
    seq: number,
    closedUpto?: number,
  ): { seq: number; closed_upto?: number; encoding?: 'axb1' } {
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
    const bars = this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
    const seq = this.appliedSeq.get(subId) ?? 0;
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, seq),
      );
    } catch {
      /* the socket may still be opening */
    }
  }

  /** One unknown opcode: that sub resumes in JSON. The socket is not closed. */
  private useJsonForSub(subId: string): void {
    if (!subId || this.jsonSubs.has(subId)) return;
    this.jsonSubs.add(subId);
    v1Count('jsonFallback');
    this.handlers.onStatus(subId, 'degraded', { message: 'unknown opcode — JSON' });
    const bars = this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
    const seq = this.appliedSeq.get(subId) ?? 0;
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, seq, this.appliedClosedUpto.get(subId)),
      );
    } catch {
      /* keep the socket */
    }
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
    return payload.bars != null || id.startsWith('series:');
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
   * Keep the inbox bounded for snapshot waiters. Live forming tips are
   * already applied via `routeFrame` — skip enqueueing them once the sub
   * has an applied seq and no waiter (stops `droppedTip` from counting
   * every same-slot replace). While awaiting a snapshot, at most one
   * forming tip per sub (latest wins, not counted as a drop). A `close`,
   * `full`, `error`, or non-forming delta stays. Cap overflow of those
   * resumes once; only a spliced forming tip under the cap counts as a drop.
   */
  private enqueueInbox(frame: WireFrame): void {
    const id = frame.id;
    if (!id) return;
    if (this.isDroppableTip(frame) && this.appliedSeq.has(id) && !this.inboxWaiters.has(id)) {
      return;
    }
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
      const dropAt = queue.findIndex((item) => this.isDroppableTip(item));
      if (dropAt < 0) {
        overflow = true;
        break;
      }
      queue.splice(dropAt, 1);
      v1Count('droppedTip');
    }
    this.inbox.set(id, queue);
    if (overflow) this.forceInboxSnapshot(id);
  }

  /**
   * The inbox is over the cap and every frame left is a close, a snapshot,
   * or a confirmed delta. Those stay. One resume asks for a fresh snapshot.
   */
  private forceInboxSnapshot(subId: string): void {
    if (this.inboxOverflowPending.has(subId)) return;
    this.inboxOverflowPending.add(subId);
    this.handlers.onStatus(subId, 'degraded', { message: 'inbox full — resyncing' });
    const bars = this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
    const seq = this.appliedSeq.get(subId) ?? 0;
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, seq),
      );
    } catch {
      /* the socket may still be opening */
    }
  }

  private isDroppableTip(frame: WireFrame): boolean {
    if (frame.type !== 'delta') return false;
    const payload = frame.payload as { forming?: unknown } | undefined;
    return payload?.forming === true;
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
          body.message ?? (full as { message?: unknown }).message ?? 'subscribe failed',
        );
        const errCode = String(body.code ?? (full as { code?: unknown }).code ?? '');
        this.handlers.onStatus(subId, 'error', {
          message: errCode ? `${errCode}: ${errMsg}` : errMsg,
        });
        this.fail('subscribe-error', errCode ? `${errCode}: ${errMsg}` : errMsg);
      }
      if (full.type !== 'full') {
        this.fail('no-snapshot', `expected full, got ${full.type}`);
      }
      const bars = toBars((full.payload as Record<string, unknown>)?.bars);
      if (!bars.length) this.fail('empty-snapshot', 'series snapshot held no bars');
      this.appliedSeq.set(subId, typeof full.seq === 'number' ? full.seq : 0);
      this.seriesBars.set(subId, bars);
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
    engineDebugSample(
      'wire.script.eval',
      {
        subId: input.subId,
        indicatorId: input.indicatorId ?? null,
        bars: input.bars.length,
      },
      1000,
      input.subId,
    );
    await this.ensureConnected();
    this.scriptCtx.set(input.subId, {
      script: input.script,
      indicatorId: input.indicatorId,
      bars: input.bars,
      meta: input.meta,
      ...(input.inputs ? { inputs: input.inputs } : {}),
    });
    // A changed input must re-subscribe: the engine evaluates the script with
    // the values it was subscribed with, so the cached state (and every delta
    // merged into it) would keep the old ones. Depth *growth* also re-subscribes
    // so a longer window is covered; a 1-bar shrink/flicker must not bounce the
    // sub (that left EMA/Momentum as idle/released while Bollinger stayed up).
    const sig = inputSignature(input.inputs);
    const depth = historyBarsOf(input.meta);
    const prevSig = this.scriptInputSig.get(input.subId);
    const prevDepth = this.scriptDepth.get(input.subId);
    let applier = this.appliers.get(input.subId);
    const inputsChanged = prevSig !== undefined && prevSig !== sig;
    const depthGrew = prevDepth !== undefined && depth > prevDepth;
    const identityChanged = !!applier && (inputsChanged || depthGrew);
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
      this.gapResyncAt.delete(input.subId);
      this.gapResyncAttempts.delete(input.subId);
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
          this.client.subscribe(input.subId, 'script', input.meta, {
            script: input.script,
            ...(input.inputs ? { inputs: input.inputs } : {}),
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
            body.message ?? (full as { message?: unknown }).message ?? full.type,
          );
          const errCode = String(body.code ?? (full as { code?: unknown }).code ?? '');
          throw new StreamFallbackError(
            'script-subscribe-failed',
            errCode ? `${errCode}: ${errMsg}` : errMsg,
          );
        }
        const payload = full.payload as Record<string, unknown>;
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
          meta: input.meta,
          ...(input.inputs ? { inputs: input.inputs } : {}),
        });
        const fallbackTimes = this.scriptCtx.get(input.subId)?.bars.map((b) => b.time) ?? null;
        applier.applyFull(scriptFullForApplier(payload, full.seq, fallbackTimes));
        this.appliedSeq.set(input.subId, typeof full.seq === 'number' ? full.seq : 0);
        this.handlers.onStatus(input.subId, 'live');
      } catch (e) {
        // Drop half-state so the next streamEvalScript can subscribe cleanly.
        this.release(input.subId);
        if (e instanceof StreamFallbackError) throw e;
        throw new StreamFallbackError('script-failed', e instanceof Error ? e.message : String(e));
      } finally {
        this.pendingScriptSubscribe.delete(input.subId);
      }
      const cached = applier.cached;
      if (!cached) {
        throw new StreamFallbackError('no-state', 'script snapshot produced no state');
      }
      await this.applyScriptPush(input.subId, cached, 'stream-full');
      return {
        status: 'success',
        plots: [],
        series: {},
        events: [],
        meta: {},
      };
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
    await this.applyScriptPush(input.subId, cached, 'stream-delta');
    return {
      status: 'success',
      plots: [],
      series: {},
      events: [],
      meta: {},
    };
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
        this.inboxOverflowPending.delete(frame.id);
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
        const ohlcv = payload.ohlcv as Record<string, number> | undefined;
        this.handlers.onCloseVerified(Number(payload.time ?? 0), 'unknown', ohlcv);
      }
    } catch {
      /* routing must never break the socket */
    }
  }

  private routeStatusFrame(frame: WireFrame): void {
    if (!frame.id) return;
    const payload = (frame.payload as Record<string, unknown>) ?? {};
    const code = String(payload.code ?? 'live');
    const message = payload.message as string | undefined;
    const isReleaseAck = code === 'idle' || message === 'released';
    // Own unsubscribe (gap resync / input resub / failed subscribe) — ignore
    // the ack so it cannot blank the replacement half-open subscription.
    const ignoreReleaseAck =
      isReleaseAck &&
      !frame.id.startsWith('series:') &&
      (this.holdUntilFull.has(frame.id) || this.pendingScriptSubscribe.has(frame.id));
    if (!ignoreReleaseAck) {
      this.handlers.onStatus(frame.id, code as SubscriptionStatus, {
        message,
        have: typeof payload.have === 'number' ? payload.have : undefined,
        need: typeof payload.need === 'number' ? payload.need : undefined,
      });
    }
    // Server released the sub (unsubscribe ack or idle eviction). Drop local
    // state so the next streamEvalScript re-subscribes — unless we are already
    // waiting on a fresh full / in-flight subscribe (our own unsubscribe).
    if (
      !frame.id.startsWith('series:') &&
      !this.holdUntilFull.has(frame.id) &&
      !this.pendingScriptSubscribe.has(frame.id) &&
      isReleaseAck &&
      (this.appliers.has(frame.id) || this.appliedSeq.has(frame.id) || this.scriptCtx.has(frame.id))
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
          const code = String((frame.payload as Record<string, unknown>)?.code ?? '');
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

  private lastBarTime(bars: Bar[]): number {
    if (!bars.length) return 0;
    const t = bars[bars.length - 1]?.time;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  }

  /** Re-issue resume for every live sub after the socket comes back. */
  private resumeAll(): void {
    // A transient fail must not keep rejecting ensureSeries after a healthy open.
    this.coolUntil = 0;
    for (const [subId, seq] of this.appliedSeq) {
      const bars = this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
      try {
        this.client.resumeSubscription(
          subId,
          bars.length,
          this.lastBarTime(bars),
          this.resumePayload(subId, seq),
        );
      } catch {
        /* socket may still be coming up */
      }
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
    const bars = toBars(payload.bars);
    const seq = typeof frame.seq === 'number' ? frame.seq : null;
    const prevSeq = this.appliedSeq.get(subId);
    if (frame.type === 'full') {
      const recovering = this.holdUntilFull.has(subId);
      this.holdUntilFull.delete(subId);
      // Do NOT clearGapResync on every full — that reset backoff and let a
      // gap→resync→full loop run at ~6 Hz (debug log: 228 series.full / ~40s).
      if (seq != null && prevSeq != null && seq < prevSeq) return;
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
    const seqAckFrom = typeof payload.seqAckFrom === 'number' ? payload.seqAckFrom : undefined;
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
      if (payload.bars != null || subId.startsWith('series:')) {
        this.applySeriesPush(subId, frame, payload);
      }
      return;
    }
    const wasLive = this.appliedSeq.has(subId);
    if (frame.type === 'full') {
      const seq = typeof frame.seq === 'number' ? frame.seq : null;
      const waitingFull = this.holdUntilFull.has(subId);
      // A snapshot that left before a newer delta must not paint over it —
      // unless we asked for a fresh full after a gap (seq may restart at 1).
      if (wasLive && !waitingFull && seq != null && seq < applier.lastSeq) return;
      this.holdUntilFull.delete(subId);
      this.axisResubPending.delete(subId);
      this.clearGapResync(subId);
      const fallbackTimes = this.scriptCtx.get(subId)?.bars.map((b) => b.time) ?? null;
      applier.applyFull(scriptFullForApplier(payload, frame.seq, fallbackTimes));
      if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
      this.handlers.onStatus(subId, 'live');
      // First subscribe paints from evalScript; gap recovery paints here.
      if (wasLive || waitingFull) {
        const cached = applier.cached;
        if (cached) this.applyScriptPush(subId, cached, 'stream-full');
      }
      return;
    }
    // Stale until the snapshot lands. A delta in between would paint a
    // half-applied generation.
    if (this.holdUntilFull.has(subId)) return;
    const baseIndex = Number(payload.base_index ?? -1);
    const count = Number(payload.count ?? -1);
    const tailLen = Number(payload.tail_len ?? -1);
    const explicitTimes = readTimeList(payload.times) ?? readTimeList(payload.bar_times);
    const cachedTimes = readTimeList(applier.cached?.bar_times ?? applier.cached?.times);
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
    const seqAckFrom = typeof payload.seqAckFrom === 'number' ? payload.seqAckFrom : undefined;
    const delta = {
      seq: typeof frame.seq === 'number' ? frame.seq : -1,
      base_index: baseIndex,
      count,
      tail_len: tailLen,
      plots: payload.plots as Record<string, unknown[]> | undefined,
      series: payload.series as Record<string, unknown[]> | undefined,
      forming: payload.forming === true,
      unchanged: payload.unchanged === true,
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
      const incomingSeq = typeof frame.seq === 'number' ? frame.seq : -1;
      // seqAckFrom makes a coalesced hole continuous — do not thrash resync.
      if (classifySeqGap(applier.lastSeq, incomingSeq, seqAckFrom).kind !== 'continuous') {
        this.requestFreshSnapshot(subId, 'delta gap — resubscribing');
        return;
      }
      const cached = applier.cached;
      if (cached && (cached.bar_times != null || cached.times != null)) {
        applier.applyFull(
          withoutTimeAxis(cached) as {
            plots?: Record<string, unknown[]>;
            series?: Record<string, unknown[]>;
            count: number;
            seq?: number;
          },
        );
        const { times: _drop, ...valuesOnly } = delta;
        out = applier.applyDelta(valuesOnly);
        if (out.ok && this.mergedFullLacksAxisForChart(subId, out.full)) {
          this.requestAxisResub(subId);
          return;
        }
      }
    }
    if (!out.ok) {
      this.requestAxisResub(subId, 'delta rejected — resubscribing');
      return;
    }
    // One commit for this delta. A gap or a thrown step never paints.
    const seq = typeof frame.seq === 'number' ? frame.seq : null;
    runApplyTransaction({
      seq,
      lastSeq: acceptedSeq,
      ...(seqAckFrom != null ? { seqAckFrom } : {}),
      commit: () => {
        if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
        this.handlers.onStatus(subId, 'live');
        if (!out.replayed) this.applyScriptPush(subId, out.full, 'stream-delta');
      },
      onStale: (reason) => {
        this.requestAxisResub(subId, `apply aborted — ${reason}`);
      },
    });
  }

  /**
   * True when a merged script `full` carries no bar-time axis and its window
   * disagrees with the subscribed window — painting it would index-zip stale
   * values onto the wrong bars (the runner skips it as `staleNoAxis`). The
   * caller resubscribes for a real full instead. Compared against the
   * subscription window (not the live store) so the verdict is stable while
   * the chart slides; a residual store-window drift at paint time is still
   * guarded downstream.
   */
  private mergedFullLacksAxisForChart(subId: string, full: Record<string, unknown>): boolean {
    const times = readTimeList(full.bar_times) ?? readTimeList(full.times);
    if (times?.length) return false;
    const windowLen = this.scriptCtx.get(subId)?.bars.length ?? 0;
    const count = Number((full as { count?: unknown }).count);
    let fullLen = Number.isFinite(count) && count > 0 ? count : 0;
    if (!fullLen) {
      const series = (full as { series?: unknown }).series;
      if (series && typeof series === 'object' && !Array.isArray(series)) {
        for (const arr of Object.values(series as Record<string, unknown>)) {
          if (Array.isArray(arr)) fullLen = Math.max(fullLen, arr.length);
        }
      }
    }
    if (!windowLen || !fullLen) return false;
    return fullLen !== windowLen;
  }

  /** Degraded + one resub per snapshot for an unpaintable merge (no paint). */
  private requestAxisResub(subId: string, message = 'axis mismatch — resubscribing'): void {
    this.handlers.onStatus(subId, 'degraded', { message });
    if (this.axisResubPending.has(subId)) return;
    this.axisResubPending.add(subId);
    const ctx = this.scriptCtx.get(subId);
    const bars = ctx?.bars ?? [];
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, this.appliedSeq.get(subId) ?? 0),
      );
    } catch {
      /* resume is best-effort; HUD already shows degraded */
    }
  }

  private clearGapResync(subId: string): void {
    this.gapResyncAt.delete(subId);
    this.gapResyncAttempts.delete(subId);
  }

  /**
   * Series gap recovery: resume from last applied seq (no unsubscribe storm).
   * Debug logs showed unsubscribe+subscribe fulls at ~6/s when every tip looked
   * like a gap and each full cleared the backoff counter.
   */
  private requestSeriesGapRecover(subId: string): void {
    this.holdUntilFull.add(subId);
    this.handlers.onStatus(subId, 'degraded', { message: 'delta gap — resyncing' });
    const now = Date.now();
    const attempts = this.gapResyncAttempts.get(subId) ?? 0;
    const lastAt = this.gapResyncAt.get(subId) ?? 0;
    const backoff =
      GAP_RESYNC_BACKOFF_MS[Math.min(attempts, GAP_RESYNC_BACKOFF_MS.length - 1)] ?? 10_000;
    if (attempts > 0 && now - lastAt < backoff) return;
    this.gapResyncAt.set(subId, now);
    this.gapResyncAttempts.set(subId, attempts + 1);
    const bars = this.seriesBars.get(subId) ?? [];
    const seq = this.appliedSeq.get(subId) ?? 0;
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, seq, this.appliedClosedUpto.get(subId)),
      );
    } catch {
      /* socket may still be coming up */
    }
  }

  /**
   * After a seq gap: hold deltas, ask once (with backoff) for a fresh full via
   * unsubscribe+subscribe. Resume-loop thrash left scripts degraded forever when
   * tip coalesce / UNCHANGED acks kept looking like holes.
   */
  private requestFreshSnapshot(subId: string, message: string): void {
    this.holdUntilFull.add(subId);
    this.handlers.onStatus(subId, 'degraded', { message });
    v1Count('resync');

    const now = Date.now();
    const attempts = this.gapResyncAttempts.get(subId) ?? 0;
    const lastAt = this.gapResyncAt.get(subId) ?? 0;
    const backoff =
      GAP_RESYNC_BACKOFF_MS[Math.min(attempts, GAP_RESYNC_BACKOFF_MS.length - 1)] ?? 10_000;
    if (attempts > 0 && now - lastAt < backoff) return;

    this.gapResyncAt.set(subId, now);
    this.gapResyncAttempts.set(subId, attempts + 1);

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

    const bars = this.seriesBars.get(subId) ?? [];
    try {
      this.client.resumeSubscription(
        subId,
        bars.length,
        this.lastBarTime(bars),
        this.resumePayload(subId, 0),
      );
    } catch {
      /* best-effort */
    }
  }

  /** Clear script wire state without unsubscribing (server already released). */
  private dropScriptLocal(subId: string): void {
    this.axisResubPending.delete(subId);
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
    this.axisResubPending.delete(subId);
    this.holdUntilFull.delete(subId);
    this.pendingScriptSubscribe.delete(subId);
    this.clearGapResync(subId);
    this.appliers.delete(subId);
    this.appliedSeq.delete(subId);
    this.jsonSubs.delete(subId);
    this.seriesBars.delete(subId);
    this.seriesSubMeta.delete(subId);
    this.seriesInflight.delete(subId);
    this.scriptCtx.delete(subId);
    this.scriptInputSig.delete(subId);
    this.scriptDepth.delete(subId);
    this.paintLatest.delete(subId);
    this.paintTail.delete(subId);
    this.inbox.delete(subId);
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
    this.gapResyncAt.clear();
    this.gapResyncAttempts.clear();
    this.cancelSeriesScriptKick();
    this.inbox.clear();
    this.inboxWaiters.clear();
    this.inboxOverflowPending.clear();
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
    this.gapResyncAt.clear();
    this.gapResyncAttempts.clear();
    this.cancelSeriesScriptKick();
    this.clearHidden();
    try {
      this.client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
