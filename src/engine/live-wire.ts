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
 * - `ensureSeries` connects, subscribes the chart series, and resolves with
 *   the snapshot bars (the caller paints them).
 * - `evalScript` subscribes a script on first call (awaiting its snapshot)
 *   and applies the latest merged state on later calls — deltas land
 *   asynchronously through the frame router, never via re-evaluation.
 * - Every failure (connect, subscribe, snapshot, merge) throws a
 *   `StreamFallbackError` so the caller drops to the legacy path. A 60s
 *   cooldown after a failure keeps a flapping backend from stalling live.
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
  unsubscribe(id: string): void;
  awaitFrame(id: string, timeoutMs?: number): Promise<WireFrame>;
  onFrame: ((frame: WireFrame) => void) | undefined;
  addReconnectHandler(fn: () => void): () => void;
}

export interface WireHandlers {
  onStatus(subId: string, status: SubscriptionStatus, extra?: { message?: string; have?: number; need?: number }): void;
  onSeriesFull(bars: Bar[]): void;
  onSeriesDelta(bars: Bar[], append: boolean): void;
  onCloseVerified(time: number, result: 'match' | 'mismatch' | 'unknown'): void;
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

export class StreamLiveWire {
  private failures = 0;
  private coolUntil = 0;
  private readonly appliers = new Map<string, Redesign2DeltaApplier>();
  private readonly appliedSeq = new Map<string, number>();
  /** Inbox for frames that arrive before their waiter (one TCP segment can
   * carry status+full together). Drained by `awaitFull`. */
  private readonly inbox = new Map<string, WireFrame[]>();
  private readonly inboxWaiters = new Map<string, () => void>();

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
  ) {}

  get cooledDown(): boolean {
    return Date.now() < this.coolUntil;
  }

  private fail(reason: string, message?: string): never {
    this.failures += 1;
    this.coolUntil = Date.now() + FAILURE_COOLDOWN_MS;
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
      const notify = this.inboxWaiters.get(frame.id);
      if (notify) {
        this.inboxWaiters.delete(frame.id);
        notify();
      }
    }
    this.routeFrame(frame);
  }

  /** Subscribe the chart series; resolves with snapshot bars for paint. */
  async ensureSeries(subId: string, meta: Record<string, unknown>): Promise<Bar[]> {
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
      if ((frame.type === 'full' || frame.type === 'delta') && frame.sessionId) {
        void this.applyRemoteFrame(frame);
        return;
      }
      if (frame.type === 'close' && frame.id) {
        const payload = (frame.payload as Record<string, unknown>) ?? {};
        this.handlers.onCloseVerified(Number(payload.time ?? 0), 'unknown');
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

  /**
   * Wait for the snapshot (`full` or terminal `error`), draining the inbox
   * first so back-to-back status+full delivery never loses the snapshot.
   * Preceding `status` frames route to the handlers.
   */
  private async awaitFull(subId: string, timeoutMs: number): Promise<WireFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const queue = this.inbox.get(subId) ?? [];
      while (queue.length) {
        const frame = queue.shift()!;
        if (frame.type === 'status') {
          this.routeStatusFrame(frame);
          continue;
        }
        return frame;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) this.fail('snapshot-timeout', `no snapshot for ${subId}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.inboxWaiters.delete(subId);
          resolve();
        }, remaining);
        this.inboxWaiters.set(subId, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private async applyRemoteFrame(frame: WireFrame): Promise<void> {
    const subId = frame.id;
    if (!subId) return;
    const applier = this.appliers.get(subId);
    if (!applier) return;
    const payload = (frame.payload as Record<string, unknown>) ?? {};
    if (frame.type === 'full') {
      applier.applyFull({
        plots: payload.plots as Record<string, unknown[]> | undefined,
        series: payload.series as Record<string, unknown[]> | undefined,
        count: Number(payload.count ?? 0),
        seq: typeof frame.seq === 'number' ? frame.seq : undefined,
      });
      if (frame.sessionId && payload.bars) {
        this.handlers.onSeriesDelta(toBars(payload.bars), true);
      }
      this.handlers.onStatus(subId, 'live');
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
    }
  }

  release(subId: string): void {
    this.appliers.delete(subId);
    this.appliedSeq.delete(subId);
    try {
      this.client.unsubscribe(subId);
    } catch {
      /* already gone */
    }
  }

  disconnect(): void {
    this.appliers.clear();
    this.appliedSeq.clear();
    try {
      this.client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
