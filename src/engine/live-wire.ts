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
import { isHpEnabled } from '../hp/feature-flag';
import { readTimeList, scriptDeltaTimeTail, Redesign2DeltaApplier } from './client-apply';
import { classifySeqGap } from './frames';
import { v1Count } from './v1/metrics';
import { runApplyTransaction } from './v1/apply-transaction';
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
  if (wantsWorkerTransport() || isHpEnabled()) return 'axb1';
  return undefined;
}

function resumeExtra(seq: number): { seq: number; encoding?: 'axb1' } {
  const encoding = negotiatedEncoding();
  if (!encoding) return { seq };
  return { seq, encoding };
}

const FAILURE_COOLDOWN_MS = 60_000;
/** PYNE history ensure of a painted 5m window routinely exceeds 30s. */
const SNAPSHOT_WAIT_MS = 120_000;
const LOADING_WAIT_CAP_MS = 120_000;

function historyBarsOf(meta: Record<string, unknown> | undefined): number {
  const n = Number(meta?.history_bars);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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
  const times = raw && raw.length === count ? raw : null;
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
    { script: string; indicatorId?: string; bars: Bar[] }
  >();
  /** Input signature of each script subscription (a change forces a re-subscribe). */
  private readonly scriptInputSig = new Map<string, string>();
  /** Subs with an outstanding axis-resubscribe (one resub per full snapshot). */
  private readonly axisResubPending = new Set<string>();
  /** `history_bars` the script subscription was created with. */
  private readonly scriptDepth = new Map<string, number>();
  /** Inbox for frames that arrive before their waiter (one TCP segment can
   * carry status+full together). Drained by `awaitFull`. */
  private readonly inbox = new Map<string, WireFrame[]>();
  /** Fan-out waiters — a second waiter must not steal the first. */
  private readonly inboxWaiters = new Map<string, Array<() => void>>();

  constructor(
    private readonly client: WireClient,
    private readonly handlers: WireHandlers,
    private readonly apply: (
      script: string,
      indicatorId: string | undefined,
      full: Record<string, unknown>,
      via: 'stream-full' | 'stream-delta',
      bars: Bar[],
    ) => Promise<RunResult>,
  ) {
    this.client.addReconnectHandler(() => this.resumeAll());
  }

  get cooledDown(): boolean {
    return Date.now() < this.coolUntil;
  }

  private fail(reason: string, message?: string): never {
    // Re-arming here latched forever: live ticks called fail() every flush.
    if (this.cooledDown) {
      throw new StreamFallbackError('cooldown', message ?? 'stream in failure cooldown');
    }
    this.failures += 1;
    this.coolUntil = Date.now() + FAILURE_COOLDOWN_MS;
    this.lastFail = { reason, message: message ?? reason, at: Date.now() };
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
  }

  /** Every inbound frame lands in the inbox AND the router — neither path
   * can starve the other when frames arrive back-to-back. */
  private ingest(frame: WireFrame): void {
    if (frame.id) {
      const queue = this.inbox.get(frame.id) ?? [];
      queue.push(frame);
      this.inbox.set(frame.id, queue);
      this.notifyInboxWaiters(frame.id);
    }
    this.routeFrame(frame);
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
    this.handlers.onStatus(subId, 'connecting');
    try {
      const encoding = negotiatedEncoding();
      this.client.subscribe(subId, 'series', meta, encoding ? { encoding } : undefined);
      const full = await this.awaitFull(subId, SNAPSHOT_WAIT_MS);
      if (full.type === 'error') {
        this.handlers.onStatus(subId, 'error', {
          message: String((full.payload as Record<string, unknown>)?.message ?? 'subscribe failed'),
        });
        this.fail('subscribe-error');
      }
      if (full.type !== 'full') {
        this.fail('no-snapshot', `expected full, got ${full.type}`);
      }
      const bars = toBars((full.payload as Record<string, unknown>)?.bars);
      if (!bars.length) this.fail('empty-snapshot', 'series snapshot held no bars');
      this.appliedSeq.set(subId, typeof full.seq === 'number' ? full.seq : 0);
      this.seriesBars.set(subId, bars);
      this.handlers.onStatus(subId, 'live');
      return bars;
    } catch (e) {
      if (e instanceof StreamFallbackError) throw e;
      this.fail('series-failed', e instanceof Error ? e.message : String(e));
    }
  }

  /** Evaluate a script over the latest merged stream state (no re-run). */
  async evalScript(input: EvalScriptInput): Promise<RunResult> {
    await this.ensureConnected();
    this.scriptCtx.set(input.subId, {
      script: input.script,
      indicatorId: input.indicatorId,
      bars: input.bars,
    });
    // A changed input must re-subscribe: the engine evaluates the script with
    // the values it was subscribed with, so the cached state (and every delta
    // merged into it) would keep the old ones.
    const sig = inputSignature(input.inputs);
    const depth = historyBarsOf(input.meta);
    const prevSig = this.scriptInputSig.get(input.subId);
    const prevDepth = this.scriptDepth.get(input.subId);
    let applier = this.appliers.get(input.subId);
    const identityChanged =
      !!applier &&
      ((prevSig !== undefined && prevSig !== sig) ||
        (prevDepth !== undefined && prevDepth !== depth));
    if (identityChanged) {
      this.appliers.delete(input.subId);
      this.appliedSeq.delete(input.subId);
      this.scriptInputSig.delete(input.subId);
      this.scriptDepth.delete(input.subId);
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
        throw new StreamFallbackError('cooldown', 'stream in failure cooldown');
      }
      applier = new Redesign2DeltaApplier();
      this.appliers.set(input.subId, applier);
      this.scriptInputSig.set(input.subId, sig);
      this.scriptDepth.set(input.subId, depth);
      this.handlers.onStatus(input.subId, 'connecting');
      try {
        const encoding = negotiatedEncoding();
        this.client.subscribe(input.subId, 'script', input.meta, {
          script: input.script,
          ...(input.inputs ? { inputs: input.inputs } : {}),
          ...(encoding ? { encoding } : {}),
        });
        const full = await this.awaitFull(input.subId, SNAPSHOT_WAIT_MS, { fatal: false });
        if (full.type === 'error' || full.type !== 'full') {
          this.appliers.delete(input.subId);
          this.scriptInputSig.delete(input.subId);
          this.scriptDepth.delete(input.subId);
          throw new StreamFallbackError(
            'script-subscribe-failed',
            `expected full, got ${full.type}`,
          );
        }
        const payload = full.payload as Record<string, unknown>;
        this.axisResubPending.delete(input.subId);
        applier.applyFull(scriptFullForApplier(payload, full.seq));
        this.appliedSeq.set(input.subId, typeof full.seq === 'number' ? full.seq : 0);
        this.handlers.onStatus(input.subId, 'live');
      } catch (e) {
        this.appliers.delete(input.subId);
        this.scriptInputSig.delete(input.subId);
        this.scriptDepth.delete(input.subId);
        if (e instanceof StreamFallbackError) throw e;
        throw new StreamFallbackError('script-failed', e instanceof Error ? e.message : String(e));
      }
      const cached = applier.cached;
      if (!cached) {
        throw new StreamFallbackError('no-state', 'script snapshot produced no state');
      }
      return this.apply(
        input.script,
        input.indicatorId,
        cached,
        'stream-full',
        this.barsForScript(input.bars),
      );
    }
    const cached = applier.cached;
    if (!cached) {
      throw new StreamFallbackError('no-state', 'script has no merged state yet');
    }
    return this.apply(
      input.script,
      input.indicatorId,
      cached,
      'stream-delta',
      this.barsForScript(input.bars),
    );
  }

  /** Route an inbound frame to appliers + handlers. Never throws. */
  routeFrame(frame: WireFrame): void {
    try {
      if (frame.type === 'status' && frame.id) {
        this.routeStatusFrame(frame);
        return;
      }
      if ((frame.type === 'full' || frame.type === 'delta') && (frame.sessionId || frame.id)) {
        void this.applyRemoteFrame(frame);
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
    this.handlers.onStatus(frame.id, String(payload.code ?? 'live') as SubscriptionStatus, {
      message: payload.message as string | undefined,
      have: typeof payload.have === 'number' ? payload.have : undefined,
      need: typeof payload.need === 'number' ? payload.need : undefined,
    });
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
    for (const [subId, seq] of this.appliedSeq) {
      const bars = this.seriesBars.get(subId) ?? this.scriptCtx.get(subId)?.bars ?? [];
      try {
        this.client.resumeSubscription(subId, bars.length, this.lastBarTime(bars), resumeExtra(seq));
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
    const seq = typeof frame.seq === 'number' ? frame.seq : 0;
    if (frame.type === 'full') {
      if (!bars.length) return;
      this.seriesBars.set(subId, bars);
      this.appliedSeq.set(subId, seq);
      this.handlers.onSeriesFull(bars);
    } else if (bars.length) {
      this.appliedSeq.set(subId, seq);
      this.handlers.onSeriesDelta(bars, true);
      this.seriesBars.set(subId, mergeTip(this.seriesBars.get(subId) ?? [], bars));
    } else if (typeof frame.seq === 'number') {
      this.appliedSeq.set(subId, seq);
    }
    this.handlers.onStatus(subId, 'live');
  }

  private applyScriptPush(
    subId: string,
    cached: Record<string, unknown>,
    via: 'stream-full' | 'stream-delta',
  ): void {
    const ctx = this.scriptCtx.get(subId);
    if (!ctx) return;
    // The subscription captured the window at subscribe time. A new candle
    // replaces that array when the chart slides, so the paint has to use the
    // window on screen or the closed %B lands on the next bar.
    const bars = this.barsForScript(ctx.bars);
    if (bars !== ctx.bars) this.scriptCtx.set(subId, { ...ctx, bars });
    void this.apply(ctx.script, ctx.indicatorId, cached, via, bars);
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

  private async applyRemoteFrame(frame: WireFrame): Promise<void> {
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
      this.axisResubPending.delete(subId);
      applier.applyFull(scriptFullForApplier(payload, frame.seq));
      if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
      this.handlers.onStatus(subId, 'live');
      if (wasLive) {
        const cached = applier.cached;
        if (cached) this.applyScriptPush(subId, cached, 'stream-full');
      }
      return;
    }
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
    const delta = {
      seq: typeof frame.seq === 'number' ? frame.seq : -1,
      base_index: baseIndex,
      count,
      tail_len: tailLen,
      plots: payload.plots as Record<string, unknown[]> | undefined,
      series: payload.series as Record<string, unknown[]> | undefined,
      forming: payload.forming === true,
      unchanged: payload.unchanged === true,
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
      if (classifySeqGap(applier.lastSeq, incomingSeq).kind !== 'continuous') {
        v1Count('resync');
        this.handlers.onStatus(subId, 'degraded', { message: 'delta gap — resubscribing' });
        const gapCtx = this.scriptCtx.get(subId);
        const gapBars = gapCtx?.bars ?? [];
        try {
          this.client.resumeSubscription(
            subId,
            gapBars.length,
            this.lastBarTime(gapBars),
            resumeExtra(this.appliedSeq.get(subId) ?? 0),
          );
        } catch {
          /* resume is best-effort; HUD already shows degraded */
        }
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
      commit: () => {
        if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
        this.handlers.onStatus(subId, 'live');
        if (!out.replayed) this.applyScriptPush(subId, out.full, 'stream-delta');
      },
      onStale: (reason) => {
        this.handlers.onStatus(subId, 'degraded', { message: `apply aborted — ${reason}` });
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
        resumeExtra(this.appliedSeq.get(subId) ?? 0),
      );
    } catch {
      /* resume is best-effort; HUD already shows degraded */
    }
  }

  release(subId: string): void {
    this.axisResubPending.delete(subId);
    this.appliers.delete(subId);
    this.appliedSeq.delete(subId);
    this.seriesBars.delete(subId);
    this.seriesInflight.delete(subId);
    this.scriptCtx.delete(subId);
    this.scriptInputSig.delete(subId);
    this.scriptDepth.delete(subId);
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
    this.seriesInflight.clear();
    this.scriptCtx.clear();
    this.scriptInputSig.clear();
    this.scriptDepth.clear();
    this.inbox.clear();
    this.inboxWaiters.clear();
    this.failures = 0;
    this.coolUntil = 0;
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
    this.seriesInflight.clear();
    this.scriptCtx.clear();
    this.scriptInputSig.clear();
    this.scriptDepth.clear();
    try {
      this.client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
