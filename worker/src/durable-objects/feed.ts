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
 * Durable Object: shared market feed (Binance spot klines), one instance per
 * feed key (`idFromName(canonicalFeedKey)`). Phase 1: public scope only.
 *
 * Phase-1 invariants:
 * - Binance spot only, public scope only, whitelisted kline intervals.
 * - No SQLite persistence. Bars live in memory only; on cold start they are
 *   rebuilt from Binance REST klines (`limit=1000`). DO eviction loses nothing
 *   but in-memory state, which is rebuilt identically.
 * - `seq` is a single monotonic counter shared by snapshots and deltas. Every
 *   delta emission increments it by exactly 1. A snapshot reads the current
 *   value (starting at 1) without advancing it, so a late-joining client or a
 *   REST snapshot never gap-breaks already-connected WebSocket consumers.
 * - Bars are capped at 1500; the oldest bars drop off on backfill/push overflow.
 *
 * Flow: first REST GET or WS connect triggers a REST backfill (Binance first,
 * then MEXC/Bybit mirrors as configured in `venue-klines.ts`). Once bars exist,
 * a {@link buildSnapshotFrame} is sent (WS) or returned (REST). Live bars are
 * polled from the venue once per second (`pollOnce`); any change fans a
 * {@link buildDeltaFrame} delta out to every accepted WebSocket.
 *
 * `venues` are `mexc` and `bybit` (Binance blocks Cloudflare egress with 403).
 * On poll failure the error is
 * logged; clients keep the last committed bars. The idle alarm stops polling
 * when no client remains.
 */

import type { Env } from '../index';
import { fetchKlines } from '../feed/venue-klines';
import {
  INTERVAL_TO_MS,
  feedKeyToString,
  parseFeedKeyAllowUserScope,
  type FeedKey,
} from '../feed/feed-key';
import {
  buildDeltaFrame,
  buildSnapshotFrame,
  type FeedBar,
  type FeedDeltaArrays,
} from '../feed/frames';
import { type DeltaRingEntry, deltasSince, pushDelta, validateIngestBars } from '../feed/ingest';

const MAX_BARS = 1500;
const REST_LIMIT = 1000;
const IDLE_CLOSE_MS = 10 * 60_000;
const BACKFILL_WAIT_MS = 8_000;

// Cloudflare Workers egress gets 403/418b from the main hostnames, so the DO
// talks to the *.binance.vision mirrors instead.
/** Peer poll cadence for the REST fallback (venue WS is not used on CF egress). */
const POLL_INTERVAL_MS = 1_000;

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
}

function unsupportedFeed(): Response {
  return jsonResponse({ error: 'feed_unsupported', code: 'feed_unsupported' }, 400);
}

export class FeedDO {
  /** In-memory bars, oldest → newest. */
  private bars: FeedBar[] = [];
  private ctx: DurableObjectState;
  private env: Env;
  /** Shared snapshot/delta sequence counter (deltas increment by exactly 1). */
  private seq = 0;
  private feedKey: FeedKey | null = null;
  /** Poll cadence for the venue REST klines endpoint (1s while clients are connected). */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Last tip we emitted; used to suppress no-change emissions. */
  private lastEmittedTip: { time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean } | null = null;
  private backfilling = false;
  private backfillPromise: Promise<void> | null = null;
  /** When the last client disconnected (epoch ms), for the 10-minute idle stop. */
  private idleSince: number | null = null;
  /** Last time any REST endpoint was hit; REST consumers keep the poller alive. */
  private lastRestAt = 0;

  /** Last {@link DELTA_RING_CAP} emitted deltas, for `GET /api/feed/delta`. */
  private deltaRing: DeltaRingEntry[] = [];
  /**
   * Where this feed's bars come from, derived from the key's auth scope:
   * `public` keys are polled from Binance; `user:*` keys have no upstream and
   * are written exclusively through `POST /api/feed/bars`.
   */
  private feedKind: 'public-polled' | 'user-fed' | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  /** `GET /api/feed?feed=…` (snapshot/WS), `GET …/delta`, `POST …/bars`. */
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parsed = parseFeedKeyAllowUserScope(url.searchParams.get('feed') ?? '');
    if (!parsed) return unsupportedFeed();
    const canonical = feedKeyToString(parsed);
    if (this.feedKey && feedKeyToString(this.feedKey) !== canonical) {
      return jsonResponse({ error: 'feed_mismatch', code: 'feed_mismatch' }, 400);
    }
    this.feedKey = parsed;
    this.feedKind = parsed.authScope === 'public' ? 'public-polled' : 'user-fed';

    const path = url.pathname;
    if (path.endsWith('/delta')) {
      if (req.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed', code: 'method_not_allowed' }, 405);
      }
      return this.deltaResponse(url);
    }
    if (path.endsWith('/bars')) {
      if (req.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed', code: 'method_not_allowed' }, 405);
      }
      return this.postBars(req);
    }

    const isUpgrade = (req.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
    if (isUpgrade) return this.acceptClient();

    return this.restSnapshot();
  }

  /** REST snapshot: backfill (bounded wait) then answer, or 503 while cold. */
  private async restSnapshot(): Promise<Response> {
    this.lastRestAt = Date.now();
    if (this.feedKind !== 'user-fed') this.startPolling();
    if (this.bars.length === 0) {
      if (this.feedKind === 'user-fed') {
        // No upstream poller for user feeds — an empty history is a valid state.
        return jsonResponse({ status: 'no_bars', code: 'no_bars' }, 503, {
          'Cache-Control': 'no-store',
        });
      }
      const done = await this.ensureBackfill(BACKFILL_WAIT_MS);
      if (!done || this.bars.length === 0) {
        return jsonResponse({ status: 'backfilling' }, 503, { 'Cache-Control': 'no-store' });
      }
    }
    // Emissions share the seq counter; REST does not advance it.
    const frame = this.snapshotFrame();
    return new Response(frame, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  /** Accept a WebSocket client; send snapshot or a backfilling status. */
  private acceptClient(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.idleSince = null;

    const feed = this.feedString();
    if (this.bars.length > 0) {
      this.safeSend(server, this.snapshotFrame());
    } else if (this.feedKind === 'user-fed') {
      this.safeSend(server, JSON.stringify({ kind: 'feedStatus', feed, state: 'empty' }));
    } else {
      this.safeSend(server, JSON.stringify({ kind: 'feedStatus', feed, state: 'backfilling' }));
      void this.ensureBackfill();
    }
    if (this.feedKind !== 'user-fed') this.startPolling();
    return new Response(null, { status: 101, webSocket: client });
  }

  private feedString(): string {
    // fetch() always sets this before any path that needs it.
    return this.feedKey ? feedKeyToString(this.feedKey) : '';
  }

  /** Next value for the shared seq counter (1-based). */
  private peekSeq(): number {
    return this.seq === 0 ? 1 : this.seq;
  }

  private snapshotFrame(): string {
    const seq = this.peekSeq();
    if (this.seq === 0) this.seq = 1;
    return buildSnapshotFrame(this.feedString(), seq, this.bars);
  }

  /** Broadcast a snapshot to all connected clients (post-backfill resync). */
  private broadcastSnapshot(): void {
    if (this.bars.length === 0) return;
    this.broadcast(this.snapshotFrame());
  }

  private broadcast(payload: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.safeSend(ws, payload);
    }
  }

  private safeSend(ws: WebSocket, payload: string): void {
    try {
      ws.send(payload);
    } catch {
      /* client already gone */
    }
  }

  /**
   * Assign the next seq, build and broadcast the delta frame, and retain it in
   * the ring buffer backing `GET /api/feed/delta`. Exactly one seq increment
   * per call. Returns the seq used.
   */
  private emitDelta(forming: boolean, upTo: number, arrays: FeedDeltaArrays): number {
    this.seq += 1;
    const frame = buildDeltaFrame(this.feedString(), this.seq, forming, upTo, arrays);
    pushDelta(this.deltaRing, {
      seq: this.seq,
      delta: JSON.parse(frame) as Record<string, unknown>,
    });
    this.broadcast(frame);
    return this.seq;
  }

  /** Test hook: push `count` synthetic deltas through the normal emission path. */
  __pushDeltaForTests(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      this.emitDelta(false, 0, {
        times: [0],
        open: [1],
        high: [1],
        low: [1],
        close: [1],
        volume: [0],
      });
    }
  }

  /** `GET /delta?feed=…&after=<seq>` — retained deltas newer than `after`. */
  private deltaResponse(url: URL): Response {
    this.lastRestAt = Date.now();
    if (this.feedKind !== 'user-fed') this.startPolling();
    const noStore = { 'Cache-Control': 'no-store' };
    const afterRaw = url.searchParams.get('after');
    if (afterRaw === null || !/^\d+$/.test(afterRaw)) {
      return jsonResponse(
        {
          error: 'invalid_after',
          code: 'invalid_after',
          reason: 'after must be a non-negative integer (unix sequence number)',
        },
        400,
        noStore,
      );
    }
    const after = Number(afterRaw);
    const result = deltasSince(this.deltaRing, after);
    if (!result.ok) {
      return jsonResponse(
        {
          error: 'delta_gone',
          code: 'delta_gone',
          hint: 're-GET /api/feed (snapshot) to resync',
        },
        410,
        noStore,
      );
    }
    return jsonResponse({ seq: this.seq, deltas: result.deltas }, 200, noStore);
  }

  /**
   * `POST /bars` — user-fed ingest. Auth and key-scope checks happen in the
   * Worker (`feed/feed-http.ts`); this handler enforces the builtin-source
   * conflict and the bar contract, merges through the same path as venue
   * bars, and emits exactly one delta for the whole batch.
   */
  private async postBars(req: Request): Promise<Response> {
    if (this.feedKind !== 'user-fed') {
      return jsonResponse(
        { error: 'feed_has_builtin_source', code: 'feed_has_builtin_source' },
        409,
        { 'Cache-Control': 'no-store' },
      );
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: 'invalid_json', code: 'invalid_json', reason: 'body must be JSON' },
        400,
      );
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse(
        {
          error: 'invalid_body',
          code: 'invalid_body',
          reason: 'body must be an object {feed, bars}',
        },
        400,
      );
    }
    const record = body as Record<string, unknown>;
    const bodyFeed = record['feed'];
    if (bodyFeed !== undefined) {
      const parsedBodyFeed =
        typeof bodyFeed === 'string' ? parseFeedKeyAllowUserScope(bodyFeed) : null;
      if (!parsedBodyFeed || feedKeyToString(parsedBodyFeed) !== this.feedString()) {
        return jsonResponse(
          {
            error: 'feed_mismatch',
            code: 'feed_mismatch',
            reason: 'body feed does not match the request feed',
          },
          400,
        );
      }
    }
    const result = validateIngestBars(record['bars']);
    if (!result.ok) {
      return jsonResponse(
        { error: 'invalid_bars', code: 'invalid_bars', reason: result.reason },
        400,
      );
    }
    const bars = result.bars;
    this.mergeBars(bars);
    const last = bars[bars.length - 1] as FeedBar;
    const seq = this.emitDelta(false, last.time, {
      times: bars.map((b) => b.time),
      open: bars.map((b) => b.open),
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      volume: bars.map((b) => b.volume),
    });
    return jsonResponse({ seq, accepted: true, bars: bars.length }, 202, {
      'Cache-Control': 'no-store',
    });
  }

  /** Merge bars by time; incoming wins on conflict; cap at MAX_BARS. */
  private mergeBars(incoming: FeedBar[]): void {
    if (incoming.length === 0) return;
    const byTime = new Map<number, FeedBar>();
    for (const bar of this.bars) byTime.set(bar.time, bar);
    for (const bar of incoming) byTime.set(bar.time, bar);
    const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
    this.bars = merged.length > MAX_BARS ? merged.slice(merged.length - MAX_BARS) : merged;
  }

  /** Kick off a backfill if one is not already running. */
  private ensureBackfill(timeoutMs?: number): Promise<boolean> {
    if (this.feedKind === 'user-fed') return Promise.resolve(false);
    if (this.bars.length > 0) return Promise.resolve(true);
    if (!this.backfilling) {
      this.backfilling = true;
      this.backfillPromise = this.backfillRange(null, null)
        .catch((err: unknown) => {
          console.error(
            JSON.stringify({
              type: 'feed_backfill_error',
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        })
        .finally(() => {
          this.backfilling = false;
          this.backfillPromise = null;
        });
    }
    const wait = this.backfillPromise;
    if (timeoutMs === undefined || !wait)
      return (wait ?? Promise.resolve()).then(() => this.bars.length > 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    return Promise.race([wait.then(() => this.bars.length > 0), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Fetch klines from Binance REST and merge. `fromMs`/`toMs` bound the range;
   * omitted → the most recent {@link REST_LIMIT} bars.
   */
  private async backfillRange(fromMs: number | null, toMs: number | null): Promise<void> {
    const key = this.feedKey;
    if (!key) return;
    const intervalMs = INTERVAL_TO_MS[key.interval] ?? 60_000;
    const end = toMs ?? Date.now();
    const start = fromMs ?? Math.max(0, end - intervalMs * REST_LIMIT);
    const bars = await fetchKlines(key.venue, key.symbol, key.interval, {
      limit: REST_LIMIT,
      startMs: Math.floor(start),
      endMs: Math.floor(end),
    });
    if (bars.length === 0) return;
    this.mergeBars(bars);
    // Clients that were waiting on a cold backfill get their snapshot now.
    this.broadcastSnapshot();
  }

  /** Poll the venue klines endpoint until the last client disconnects. */
  private startPolling(): void {
    if (this.pollTimer !== null) return;
    if (this.feedKind === 'user-fed') return;
    this.pollTimer = setInterval(() => {
      void this.pollOnce().catch((err: unknown) => {
        console.error(
          JSON.stringify({
            type: 'feed_poll_error',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Fetch the newest few bars and emit a delta if anything moved. */
  private async pollOnce(): Promise<void> {
    const key = this.feedKey;
    if (!key) return;
    const clientCount = this.ctx.getWebSockets().length;
    if (clientCount === 0 && Date.now() - this.lastRestAt > 60_000) {
      this.stopPolling();
      return;
    }
    const bars = await fetchKlines(key.venue, key.symbol, key.interval, { limit: 3 });
    if (bars.length === 0) return;
    const tipBefore = this.bars[this.bars.length - 1];
    this.mergeBars(bars);
    const tip = this.bars[this.bars.length - 1];
    if (!tip) return;
    const solo = this.lastEmittedTip;
    const unchanged =
      solo !== null &&
      tip.time === solo.time &&
      tip.open === solo.open &&
      tip.high === solo.high &&
      tip.low === solo.low &&
      tip.close === solo.close &&
      tip.volume === solo.volume &&
      tip.closed === solo.closed;
    if (unchanged) return;
    const startIdx = this.bars.findIndex((b) => tip.time >= b.time && b.time >= (solo?.time ?? tip.time));
    const from = Math.max(0, startIdx === -1 ? this.bars.length - 1 : startIdx);
    const slice = this.bars.slice(from);
    this.emitDelta(!tip.closed, this.lastClosedTime(), {
      times: slice.map((b) => b.time),
      open: slice.map((b) => b.open),
      high: slice.map((b) => b.high),
      low: slice.map((b) => b.low),
      close: slice.map((b) => b.close),
      volume: slice.map((b) => b.volume),
    });
    this.lastEmittedTip = { ...tip };
  }

  private lastClosedTime(): number {
    for (let i = this.bars.length - 1; i >= 0; i -= 1) {
      const bar = this.bars[i];
      if (bar?.closed) return bar.time;
    }
    return 0;
  }

  /** Enforce the idle-client stop: no clients for 10 minutes ⇒ stop polling. */
  async alarm(): Promise<void> {
    const clients = this.ctx.getWebSockets();
    if (clients.length === 0) {
      if (this.idleSince === null) this.idleSince = Date.now();
      if (Date.now() - this.idleSince >= IDLE_CLOSE_MS) {
        this.stopPolling();
        this.idleSince = null;
        return;
      }
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }
    this.idleSince = null;
    // Gap check: refill missing history before reconnecting.
    const key = this.feedKey;
    if (key && this.feedKind !== 'user-fed') {
      const intervalMs = INTERVAL_TO_MS[key.interval] ?? 60_000;
      const last = this.bars[this.bars.length - 1];
      const nowMs = Date.now();
      if (last && nowMs - last.time * 1000 > intervalMs * 2) {
        try {
          await this.backfillRange(last.time * 1000 + 1, nowMs);
          this.broadcastSnapshot();
        } catch (err) {
          console.error(
            JSON.stringify({
              type: 'feed_gap_backfill_error',
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    }
    this.startPolling();
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    if (msg && typeof msg === 'object' && (msg as Record<string, unknown>)['action'] === 'ping') {
      this.safeSend(ws, JSON.stringify({ action: 'pong', t: Date.now() }));
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      this.idleSince = Date.now();
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
    }
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      this.idleSince = Date.now();
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
    }
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}
