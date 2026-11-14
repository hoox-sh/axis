// Copyright (c) 2026 HOOX - AXIS - hoox-sh (jango_blockchained)
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
 * Client session for the engine-owned shared market-data feed.
 *
 * One {@link FeedSession} owns one feed subscription: it opens a WebSocket,
 * sends the `feed` subscribe frame, and turns `snapshot` / `delta` frames
 * into {@link FeedSessionOptions.onBars} callbacks. Sequencing is delegated
 * to {@link FeedSeqTracker} and bar merging to {@link applyFeedDelta} - this
 * module never re-implements wire parsing or merging; it only wires them to
 * a socket.
 *
 * Lifecycle:
 * - `start()` opens the socket (default factory uses the global `WebSocket`;
 *   throws a clean error when it is unavailable) and subscribes on `open`.
 * - `snapshot` frames replace the in-memory window and flip the session to
 *   `ready`. The tracker is seeded with the snapshot seq so the first delta
 *   must arrive as `seq + 1`.
 * - `delta` frames are merged in seq order. A gap sends
 *   `{ kind: 'resume', afterSeq }` and flips the session to `degraded`; a
 *   duplicate is ignored; a structurally invalid delta is rejected (`bad_delta`);
 *   a delta that would rewrite sealed history is rejected as
 *   `sealed_bar_conflict` and logged. Both rejections ask the server to resume.
 * - `stop()` closes the socket and clears all in-memory state.
 *
 * The session never reconnects on its own - callers decide what a drop
 * means (for the load path: fall back to the legacy venue fetch).
 *
 * @module engine/feed-session
 */

import { applyFeedDelta, FeedSeqTracker, parseFeedMessage } from './feed-client';
import type { Bar } from '../store/types';

/**
 * Delay before a caller-driven resubscribe / resume attempt after a feed
 * failure. Exported so callers share one constant; the session itself does
 * not schedule reconnects.
 */
export const FEED_RETRY_DELAY_MS = 1000;

/**
 * Derive the feed WebSocket URL from an engine HTTP(S) endpoint.
 * `http://` -> `ws://`, `https://` -> `wss://`; any path prefix is preserved
 * and `/ws/feed` is appended. Query strings and fragments are dropped.
 *
 * Examples:
 * - `http://127.0.0.1:5002`  -> `ws://127.0.0.1:5002/ws/feed`
 * - `https://x.example.com/` -> `wss://x.example.com/ws/feed`
 * - `https://x/api/`         -> `wss://x/api/ws/feed`
 */
export function defaultFeedUrl(endpoint: string): string {
  const raw = String(endpoint ?? '').trim();
  if (!raw) {
    throw new Error('feed-session: endpoint must be a non-empty URL');
  }
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  let scheme = match ? match[1]!.toLowerCase() : 'https';
  const rest = match ? raw.slice(match[0].length) : raw;
  if (scheme === 'http') scheme = 'ws';
  else if (scheme === 'https') scheme = 'wss';
  else if (scheme !== 'ws' && scheme !== 'wss') {
    throw new Error(`feed-session: unsupported endpoint scheme: ${scheme}`);
  }
  const slash = rest.indexOf('/');
  const authority = (slash === -1 ? rest : rest.slice(0, slash)).split(/[?#]/)[0];
  if (!authority) {
    throw new Error(`feed-session: endpoint has no host: ${raw}`);
  }
  let path = slash === -1 ? '' : rest.slice(slash);
  path = path.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return `${scheme}://${authority}${path}/ws/feed`;
}

/**
 * Resolve the feed WebSocket URL for the AXIS PWA.
 *
 * The feed is hosted on the Cloudflare worker (`/api/feed`), not on the pyne
 * engine, so the endpoint is independent of the engine endpoint. Override with:
 * - build env `VITE_AXIS_FEED_URL` (deploy-time), or
 * - runtime localStorage `axis.engine.feed.url` (per browser, e.g. pointing at
 *   a local worker for development).
 *
 * Any value may be `ws(s)://…` as-is or `http(s)://…` (auto-converted).
 */
export function resolveFeedUrl(): string {
  let stored = '';
  try {
    if (typeof localStorage !== 'undefined') {
      stored = String(localStorage.getItem('axis.engine.feed.url') ?? '').trim();
    }
  } catch {
    stored = '';
  }
  const fromEnv =
    typeof import.meta !== 'undefined'
      ? String(
          (import.meta as { env?: Record<string, string | undefined> }).env?.[
            'VITE_AXIS_FEED_URL'
          ] ?? '',
        ).trim()
      : '';
  const raw = stored || fromEnv || 'wss://worker.axis.hoox.sh/api/feed';
  if (/^wss?:\/\//i.test(raw)) return raw;
  return defaultFeedUrl(raw).replace(/\/ws\/feed$/, '/api/feed');
}

/** Message payload delivered to {@link WebSocketLike.addEventListener} handlers. */
export interface FeedSocketEvent {
  /** `message` events carry the raw frame here (string for JSON frames). */
  data?: unknown;
}

/**
 * Minimal WebSocket surface the session needs. Declared locally (not
 * `lib.dom`) so tests can inject a fake and the module stays headless.
 */
export interface WebSocketLike {
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: FeedSocketEvent) => void,
  ): void;
  send(data: string): void;
  close(): void;
}

/** Feed connection states surfaced to the UI / load path. */
export type FeedSessionState = 'connecting' | 'ready' | 'degraded' | 'closed';

/** Status payload for {@link FeedSessionOptions.onStatus}. */
export interface FeedSessionStatus {
  state: FeedSessionState;
  /** Machine-ish reason, e.g. `seq_gap`, `bad_delta`, `sealed_bar_conflict`, `socket_error`. */
  reason?: string;
}

export interface FeedSessionOptions {
  /** Absolute ws(s):// URL of the feed endpoint (see {@link defaultFeedUrl}). */
  url: string;
  /** Canonical feed key (`venue|market|SYMBOL|interval|adjustment|authScope`). */
  feed: string;
  /** Requested rolling window; the server may cap it. */
  windowBars: number;
  /** Called with the merged window on every accepted frame. */
  onBars(bars: readonly Bar[], kind: 'snapshot' | 'delta'): void;
  /** Called on every state transition. */
  onStatus(s: FeedSessionStatus): void;
  /** Injectable socket factory (tests). Defaults to the global `WebSocket`. */
  socketFactory?: () => WebSocketLike;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  now?: () => number;
}

/** Default socket factory: the platform `WebSocket`, or a clean error. */
function defaultSocketFactory(url: string): WebSocketLike {
  const WS = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (typeof WS !== 'function') {
    throw new Error('feed-session: global WebSocket is not available in this environment');
  }
  return new WS(url) as unknown as WebSocketLike;
}

/**
 * Detect a delta that tries to rewrite already-sealed history: its first
 * point is older than the window tip, or lands exactly on a tip bar that is
 * already `closed`. Mid-batch points cannot conflict (times are strictly
 * increasing and only the tip can be rewritten), so checking the first point
 * is sufficient. Returns the offending time, or `null` when the delta is not
 * a sealed-bar conflict.
 */
function sealedBarConflict(
  bars: readonly Bar[],
  delta: { times: readonly number[] },
): number | null {
  if (bars.length === 0) return null;
  const first = delta.times[0];
  if (first === undefined) return null;
  const tip = bars[bars.length - 1];
  if (tip === undefined) return null;
  if (first < tip.time) return first;
  if (first === tip.time && tip.closed === true) return first;
  return null;
}

/**
 * One subscription to one feed. Not reusable after {@link FeedSession.stop};
 * create a fresh session instead.
 */
export class FeedSession {
  private readonly opts: FeedSessionOptions;
  private readonly now: () => number;
  private socket: WebSocketLike | null = null;
  private tracker = new FeedSeqTracker();
  private bars: Bar[] = [];
  private stopped = true;
  private lastFrameAt = 0;

  constructor(opts: FeedSessionOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Timestamp (ms) of the last frame received, `0` before the first. */
  get lastEventAt(): number {
    return this.lastFrameAt;
  }

  /** A copy of the currently held window, oldest first. */
  get currentBars(): Bar[] {
    return this.bars.slice();
  }

  /** Last accepted seq, or `null` before the first snapshot/delta. */
  get lastSeq(): number | null {
    return this.tracker.lastSeq;
  }

  /** Open the socket and subscribe. Idempotent while a socket is live. */
  start(): void {
    if (this.socket) return;
    this.stopped = false;
    let sock: WebSocketLike;
    try {
      sock = this.opts.socketFactory
        ? this.opts.socketFactory()
        : defaultSocketFactory(this.opts.url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.emitStatus('closed', reason);
      throw err instanceof Error ? err : new Error(reason);
    }
    this.socket = sock;
    this.emitStatus('connecting');

    sock.addEventListener('open', () => {
      if (this.stopped) return;
      this.lastFrameAt = this.now();
      this.sendSubscribe();
    });
    sock.addEventListener('message', (event) => {
      if (this.stopped) return;
      this.handleMessage(event);
    });
    sock.addEventListener('close', () => {
      if (this.stopped) return;
      this.stopped = true;
      this.socket = null;
      this.emitStatus('closed');
    });
    sock.addEventListener('error', () => {
      if (this.stopped) return;
      this.emitStatus('degraded', 'socket_error');
    });
  }

  /** Close the socket and clear all in-memory state. */
  stop(): void {
    if (this.stopped && !this.socket) {
      // Still emit so callers can rely on stop() always settling status.
      this.emitStatus('closed', 'stopped');
      return;
    }
    this.stopped = true;
    const sock = this.socket;
    this.socket = null;
    this.bars = [];
    this.tracker.reset();
    if (sock) {
      try {
        sock.close();
      } catch {
        /* closing must not throw into callers */
      }
    }
    this.emitStatus('closed', 'stopped');
  }

  private sendSubscribe(): void {
    const frame: Record<string, unknown> = {
      kind: 'feed',
      feed: this.opts.feed,
      windowBars: this.opts.windowBars,
    };
    // Carry a resume token when we already hold state (e.g. re-start).
    const resumeSeq = this.tracker.lastSeq;
    if (resumeSeq !== null) frame['resumeSeq'] = resumeSeq;
    this.send(frame);
  }

  private sendResume(): void {
    this.send({ kind: 'resume', afterSeq: this.tracker.lastSeq ?? 0 });
  }

  private send(payload: Record<string, unknown>): void {
    const sock = this.socket;
    if (!sock) return;
    try {
      sock.send(JSON.stringify(payload));
    } catch {
      this.emitStatus('degraded', 'send_failed');
    }
  }

  private handleMessage(event: FeedSocketEvent): void {
    this.lastFrameAt = this.now();
    const raw = event?.data;
    let payload: unknown = raw;
    if (typeof raw === 'string') {
      try {
        payload = JSON.parse(raw);
      } catch {
        // Unparseable frame - ignore; a well-formed feed never sends one.
        return;
      }
    }
    const parsed = parseFeedMessage(payload);
    if (!parsed) return; // Unknown/malformed frame - ignore.

    if (parsed.kind === 'snapshot') {
      const snapshot = parsed.snapshot;
      if (snapshot.feed !== this.opts.feed) {
        this.emitStatus('degraded', 'feed_mismatch');
        return;
      }
      this.bars = snapshot.bars.slice();
      // Seed the tracker with the snapshot seq so the first delta must be seq + 1.
      this.tracker.reset();
      this.tracker.push(snapshot.seq);
      this.emitStatus('ready');
      this.opts.onBars(this.bars.slice(), 'snapshot');
      return;
    }

    const delta = parsed.delta;
    if (delta.feed !== this.opts.feed) {
      this.emitStatus('degraded', 'feed_mismatch');
      return;
    }
    // Duplicates never enter the merge path (a replayed seq would look like a
    // backwards delta to the merger).
    const lastSeq = this.tracker.lastSeq;
    if (lastSeq !== null && delta.seq <= lastSeq) return;
    // Merge first so a structurally invalid delta never advances the tracker.
    const merged = applyFeedDelta(this.bars, null, delta);
    if (!merged) {
      const sealedAt = sealedBarConflict(this.bars, delta);
      if (sealedAt !== null) {
        // Attempt to rewrite sealed history — reject explicitly and loudly.
        console.warn(
          `[feed] sealed_bar_conflict feed=${this.opts.feed} time=${sealedAt} seq=${delta.seq}: delta rejected; sealed bars are immutable`,
        );
        this.emitStatus('degraded', 'sealed_bar_conflict');
        this.sendResume();
        return;
      }
      this.emitStatus('degraded', 'bad_delta');
      this.sendResume();
      return;
    }
    const verdict = this.tracker.push(delta.seq);
    if (verdict === 'duplicate') return; // unreachable given the pre-check; defensive
    if (verdict === 'gap') {
      this.emitStatus('degraded', 'seq_gap');
      this.sendResume();
      return;
    }
    this.bars = merged.bars;
    this.emitStatus('ready');
    this.opts.onBars(this.bars.slice(), 'delta');
  }

  private emitStatus(state: FeedSessionState, reason?: string): void {
    try {
      this.opts.onStatus(reason === undefined ? { state } : { state, reason });
    } catch {
      /* a throwing status handler must not kill the wire loop */
    }
  }
}
