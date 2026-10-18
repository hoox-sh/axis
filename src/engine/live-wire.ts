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
 *   cooldown after a failure keeps a flapping backend from stalling live;
 *   throwing while already cooled down does not re-arm the timer.
 *
 * Transport + apply are injected (fakes in tests; real client/bridge in prod).
 *
 * @module engine/live-wire
 */

import type { RunResult } from '../plugins/types';
import type { Bar } from '../store/types';
import { Redesign2DeltaApplier } from './client-apply';
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
  seq?: number;
  payload?: Record<string, unknown>;
}

export interface WireClient {
  connect(): Promise<void>;
  disconnect(): void;
  readonly isOpen: boolean;
  subscribe(id: string, kind: 'series' | 'script', meta: Record<string, unknown>, opts?: Record<string, unknown>): void;
  resumeSubscription(id: string, count: number, lastTime: number, extra?: Record<string, unknown>): void;
  requestRepair?(id: string, fromTime: number): void;
  unsubscribe(id: string): void;
  awaitFrame(id: string, timeoutMs?: number): Promise<WireFrame>;
  onFrame: ((frame: WireFrame) => void) | undefined;
  addReconnectHandler(fn: () => void): () => void;
  /** Optional connection counters for diagnostics (MCP `stream.get`). */
  stats?(): { open: boolean; openedOnce: boolean; reconnectAttempts: number; stopped: boolean };
}

export interface WireHandlers {
  onStatus(subId: string, status: SubscriptionStatus, extra?: { message?: string; have?: number; need?: number }): void;
  onSeriesFull(bars: Bar[]): void;
  onSeriesDelta(bars: Bar[], append: boolean): void;
  onCloseVerified(time: number, result: 'match' | 'mismatch' | 'unknown', ohlcv?: Record<string, number>): void;
}

export interface EvalScriptInput {
  subId: string;
  script: string;
  indicatorId?: string;
  meta: Record<string, unknown>;
  bars: Bar[];
}

const FAILURE_COOLDOWN_MS = 60_000;

function toBars(raw: unknown): Bar[] {
  if (!Array.isArray(raw)) return [];
  const out: Bar[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const time = Number(r.time);
    if (!Number.isFinite(time)) continue;
    out.push({
      time,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    });
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

export class StreamLiveWire {
  private failures = 0;
  private coolUntil = 0;
  private readonly appliers = new Map<string, Redesign2DeltaApplier>();
  private readonly appliedSeq = new Map<string, number>();
  /** Last series snapshot per sub, returned on subscribe-once. */
  private readonly seriesBars = new Map<string, Bar[]>();
  /** In-flight `ensureSeries` so concurrent ticks join one snapshot wait. */
  private readonly seriesInflight = new Map<string, Promise<Bar[]>>();
  /** Last script + bars so a push delta can apply without waiting on scheduleRerun. */
  private readonly scriptCtx = new Map<string, { script: string; indicatorId?: string; bars: Bar[] }>();
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
    // The client retries on close independently of coolUntil once it has opened.
    try {
      this.client.disconnect();
    } catch {
      /* already gone */
    }
    throw new StreamFallbackError(reason, message);
  }

  async ensureConnected(): Promise<void> {
    if (this.cooledDown) this.fail('cooldown', 'stream in failure cooldown');
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
    this.handlers.onStatus(subId, 'connecting');
    try {
      this.client.subscribe(subId, 'series', meta);
      const full = await this.awaitFull(subId, 30_000);
      if (full.type === 'error') {
        this.handlers.onStatus(subId, 'error', { message: String((full.payload as Record<string, unknown>)?.message ?? 'subscribe failed') });
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
    let applier = this.appliers.get(input.subId);
    if (!applier) {
      applier = new Redesign2DeltaApplier();
      this.appliers.set(input.subId, applier);
      this.handlers.onStatus(input.subId, 'connecting');
      try {
        this.client.subscribe(input.subId, 'script', input.meta, { script: input.script });
        const full = await this.awaitFull(input.subId, 30_000);
        if (full.type === 'error' || full.type !== 'full') {
          this.appliers.delete(input.subId);
          this.fail('script-subscribe-failed', `expected full, got ${full.type}`);
        }
        const payload = full.payload as Record<string, unknown>;
        applier.applyFull({
          plots: payload.plots as Record<string, unknown[]> | undefined,
          series: payload.series as Record<string, unknown[]> | undefined,
          count: Number(payload.count ?? 0),
          seq: typeof full.seq === 'number' ? full.seq : undefined,
        });
        this.appliedSeq.set(input.subId, typeof full.seq === 'number' ? full.seq : 0);
        this.handlers.onStatus(input.subId, 'live');
      } catch (e) {
        this.appliers.delete(input.subId);
        if (e instanceof StreamFallbackError) throw e;
        this.fail('script-failed', e instanceof Error ? e.message : String(e));
      }
      const cached = applier.cached;
      if (!cached) this.fail('no-state', 'script snapshot produced no state');
      return this.apply(input.script, input.indicatorId, cached, 'stream-full', input.bars);
    }
    const cached = applier.cached;
    if (!cached) this.fail('no-state', 'script has no merged state yet');
    return this.apply(input.script, input.indicatorId, cached, 'stream-delta', input.bars);
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
   * Preceding `status` frames route to the handlers. Leftover `delta` /
   * `close` frames stay in the inbox — they are not a failed snapshot.
   */
  private async awaitFull(subId: string, timeoutMs: number): Promise<WireFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const queue = this.inbox.get(subId) ?? [];
      const leftover: WireFrame[] = [];
      let found: WireFrame | undefined;
      while (queue.length) {
        const frame = queue.shift();
        if (!frame) break;
        if (frame.type === 'status') {
          this.routeStatusFrame(frame);
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
      if (remaining <= 0) this.fail('snapshot-timeout', `no snapshot for ${subId}`);
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
        this.client.resumeSubscription(subId, bars.length, this.lastBarTime(bars), { seq });
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

  private applyScriptPush(subId: string, cached: Record<string, unknown>, via: 'stream-full' | 'stream-delta'): void {
    const ctx = this.scriptCtx.get(subId);
    if (!ctx) return;
    void this.apply(ctx.script, ctx.indicatorId, cached, via, ctx.bars);
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
      applier.applyFull({
        plots: payload.plots as Record<string, unknown[]> | undefined,
        series: payload.series as Record<string, unknown[]> | undefined,
        count: Number(payload.count ?? 0),
        seq: typeof frame.seq === 'number' ? frame.seq : undefined,
      });
      if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
      this.handlers.onStatus(subId, 'live');
      if (wasLive) {
        const cached = applier.cached;
        if (cached) this.applyScriptPush(subId, cached, 'stream-full');
      }
      return;
    }
    const out = applier.applyDelta({
      seq: typeof frame.seq === 'number' ? frame.seq : -1,
      base_index: Number(payload.base_index ?? -1),
      count: Number(payload.count ?? -1),
      tail_len: Number(payload.tail_len ?? -1),
      plots: payload.plots as Record<string, unknown[]> | undefined,
      series: payload.series as Record<string, unknown[]> | undefined,
    });
    if (!out.ok) {
      this.handlers.onStatus(subId, 'degraded', { message: 'delta rejected — resubscribing' });
      const ctx = this.scriptCtx.get(subId);
      const bars = ctx?.bars ?? [];
      try {
        this.client.resumeSubscription(subId, bars.length, this.lastBarTime(bars), {
          seq: this.appliedSeq.get(subId) ?? 0,
        });
      } catch {
        /* resume is best-effort; HUD already shows degraded */
      }
      return;
    }
    if (typeof frame.seq === 'number') this.appliedSeq.set(subId, frame.seq);
    this.handlers.onStatus(subId, 'live');
    if (!out.replayed) this.applyScriptPush(subId, out.full, 'stream-delta');
  }

  release(subId: string): void {
    this.appliers.delete(subId);
    this.appliedSeq.delete(subId);
    this.seriesBars.delete(subId);
    this.seriesInflight.delete(subId);
    this.scriptCtx.delete(subId);
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
    try {
      this.client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
