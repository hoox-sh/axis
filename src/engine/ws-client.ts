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
 * Phase 2 WebSocket transport for Redesign2.
 *
 * This is a scaffold/client foundation, not yet wired into the evaluation
 * pipeline. It implements the connection lifecycle that Redesign2 requires:
 * origin URL mapping, auth handshake, reconnect backoff, heartbeat, and frame
 * routing hooks. Frame payload validation lives in the dedicated frame validators
 * (subtask 13), which this client calls through its `onFrame` Hook.
 *
 * @module engine/ws-client
 */

import type {
  Redesign2RepairFrame,
  Redesign2ResumeFrame,
  Redesign2SubscribeFrame,
  SeriesMeta,
} from './frames';
import {
  normalizeRedesign2Frame,
  reconnectDelayMs,
  shouldAuthBlock,
  stripSeqAck,
  validateRedesign2Frame,
} from './frames';
import { axisDebugSafeUrl, engineDebug } from '../debug';
import {
  liveTicketRetryable,
  mintLiveTicket,
  workerLiveWsUrl,
  type LiveProxy,
} from './live-ticket';
import { isFormingTipFrame, sendBufferHeld } from './v1/backpressure';
import { PendingRequests, ReconnectHandlers, wireStats } from './wire-bookkeeping';

export type Redesign2WsFrameType =
  | 'auth'
  | 'auth.ok'
  | 'subscribe'
  | 'resume'
  | 'repair'
  | 'unsubscribe'
  | 'status'
  | 'full'
  | 'delta'
  | 'close'
  | 'verify.result'
  | 'ping'
  | 'pong'
  | 'error';

export interface Redesign2WsFrame {
  type: Redesign2WsFrameType;
  id?: string;
  sessionId?: string;
  ts?: number;
  payload?: unknown;
}

export interface Redesign2WsAuth {
  token?: string;
}

export interface Redesign2WsClientOptions {
  endpoint: string;
  authToken?: string;
  /**
   * AXIS Worker live-proxy. When set, each connect mints a one-time ticket
   * and upgrades `/api/ws/live?ticket=` — the engine key stays off the URL
   * and still rides the `auth` frame.
   */
  liveProxy?: LiveProxy;
  /** Initial connect timeout in ms. */
  connectTimeoutMs?: number;
  /** Delay before first reconnect attempt in ms. */
  initialReconnectDelayMs?: number;
  /** Maximum reconnect delay in ms. */
  maxReconnectDelayMs?: number;
  /** Heartbeat interval in ms. */
  heartbeatIntervalMs?: number;
  /** Pong timeout in ms. */
  pongTimeoutMs?: number;
}

const DEFAULTS = {
  connectTimeoutMs: 5_000,
  initialReconnectDelayMs: 500,
  maxReconnectDelayMs: 30_000,
  heartbeatIntervalMs: 15_000,
  pongTimeoutMs: 5_000,
} as const;

/**
 * Map an engine HTTP(S) endpoint to the engine-owned data plane WebSocket URL.
 *
 * Pinned contract (final/plan.mdx §6): `${origin}/ws/live`. Any path on the
 * configured endpoint is dropped — the live route lives at the origin root.
 */
export function endpointToRedesign2WsUrl(endpoint: string, authToken?: string): string {
  const base = endpoint.replace(/\/$/, '');
  let u: URL;
  try {
    u = new URL(base.includes('://') ? base : `http://${base}`);
  } catch {
    u = new URL(`http://${base}`);
  }
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/live';
  u.search = '';
  u.hash = '';
  const token = String(authToken || '').trim();
  // Direct PYNE: browsers cannot set Authorization, so the engine accepts
  // ?api_key= on upgrade. The Worker live-proxy path uses a ticket instead.
  if (token) u.searchParams.set('api_key', token);
  return u.toString();
}

export class Redesign2WsClient {
  private readonly options: Omit<Required<Redesign2WsClientOptions>, 'authToken' | 'liveProxy'> & {
    authToken?: string;
    liveProxy?: LiveProxy;
  };
  private url: string;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectAttempts = 0;
  /** A non-retryable connection error. `connect()` clears it. */
  private authBlocked = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Outbound buffer is over the cap. Forming tips are not delivered. */
  private sendHeld = false;

  public onFrame?: (frame: Redesign2WsFrame) => void;
  public onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
  /** Outbound buffer crossed or left the 1 MB cap. The socket stays open. */
  public onBackpressure?: (held: boolean) => void;
  /** Called for frames that fail contract validation (logged + skipped by default). */
  public onMalformed?: (raw: unknown) => void;

  private readonly pending = new PendingRequests<Redesign2WsFrame>();
  private readonly reconnects = new ReconnectHandlers();
  private openedOnce = false;

  constructor(options: Redesign2WsClientOptions) {
    this.options = {
      ...DEFAULTS,
      ...options,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
      initialReconnectDelayMs: options.initialReconnectDelayMs ?? DEFAULTS.initialReconnectDelayMs,
      maxReconnectDelayMs: options.maxReconnectDelayMs ?? DEFAULTS.maxReconnectDelayMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs,
      pongTimeoutMs: options.pongTimeoutMs ?? DEFAULTS.pongTimeoutMs,
    };
    this.url = options.liveProxy
      ? workerLiveWsUrl(options.liveProxy.endpoint)
      : endpointToRedesign2WsUrl(options.endpoint, options.authToken);
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === 1;
  }

  get urlValue(): string {
    return this.url;
  }

  /**
   * Diagnostic counters for MCP `stream.get` — connection bookkeeping only,
   * never the auth token (it travels as a frame, not in the URL).
   */
  stats(): { open: boolean; openedOnce: boolean; reconnectAttempts: number; stopped: boolean } {
    return wireStats({
      open: this.isOpen,
      openedOnce: this.openedOnce,
      reconnectAttempts: this.reconnectAttempts,
      stopped: this.stopped,
    });
  }

  /**
   * Detach and close a socket this client no longer owns, without letting its
   * late events reach the client (never throws).
   */
  private closeQuietly(ws: WebSocket): void {
    try {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    } catch {
      /* already gone */
    }
  }

  async connect(): Promise<void> {
    // Explicit stop sets stopped; a later connect() must still be able to open.
    this.stopped = false;
    this.authBlocked = false;
    if (this.isOpen) return;
    if (this.connectPromise) return this.connectPromise;

    const attempt = (async () => {
      if (this.options.liveProxy) {
        try {
          const ticket = await mintLiveTicket(this.options.liveProxy);
          if (this.stopped) return;
          this.url = workerLiveWsUrl(this.options.liveProxy.endpoint, ticket);
        } catch (e) {
          if (this.stopped) return;
          this.onStatus?.('error');
          if (!liveTicketRetryable(e)) {
            this.authBlocked = true;
            this.clearReconnect();
          } else {
            this.scheduleReconnect();
          }
          throw e instanceof Error ? e : new Error(String(e));
        }
      }
      if (this.stopped) return;
      engineDebug('ws.connect', {
        url: axisDebugSafeUrl(this.url),
        attempt: this.reconnectAttempts,
      });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let ws: WebSocket;
        try {
          ws = new WebSocket(this.url);
        } catch (e) {
          this.onStatus?.('error');
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        this.ws = ws;

        /**
         * True while `ws` is still the client's live socket. A superseded socket
         * — its attempt timed out or errored while a later attempt took over
         * `this.ws` — must not touch client state: its late open / error / close
         * and its frames all belong to a dead connection. Nulling `this.ws` from
         * a stale close used to tear down the *live* socket, so the auth frame
         * sent from the live socket's `onopen` threw `WebSocket not open` out of
         * the handler (an uncaught window error) and the client sat degraded
         * until some later reconnect happened to win the race.
         */
        const owns = (): boolean => this.ws === ws;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (owns()) this.ws = null;
          this.onStatus?.('error');
          reject(new Error('Redesign2 WebSocket connect timeout'));
          this.scheduleReconnect();
        }, this.options.connectTimeoutMs);

        ws.onopen = () => {
          if (settled) {
            // Opened after this attempt was abandoned: never adopt it, and never
            // leak a live socket whose later events would hit the client.
            if (!owns()) this.closeQuietly(ws);
            return;
          }
          if (!owns()) {
            settled = true;
            clearTimeout(timer);
            this.closeQuietly(ws);
            reject(new Error('Redesign2 WebSocket superseded'));
            return;
          }
          settled = true;
          clearTimeout(timer);
          engineDebug('ws.open', {
            url: axisDebugSafeUrl(this.url),
            first: !this.openedOnce,
            reconnectAttempts: this.reconnectAttempts,
          });
          this.reconnectAttempts = 0;
          this.onStatus?.('open');
          this.startHeartbeat();
          const first = !this.openedOnce;
          this.openedOnce = true;
          const fireResume = () => {
            if (first) return;
            this.reconnects.fire();
          };
          if (this.options.authToken) {
            this.send({
              type: 'auth',
              ts: Date.now(),
              payload: { token: this.options.authToken },
            });
          }
          // Direct PYNE still handshakes with ?api_key=; the Worker proxy uses a
          // ticket. Do not block connect on auth.ok — production timed out here
          // while the engine was still hashing the key, and subscribe never ran.
          fireResume();
          resolve();
        };

        ws.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!owns()) {
            // A superseded socket failed: report this attempt, leave the live
            // socket (and its reconnect bookkeeping) alone.
            reject(new Error('Redesign2 WebSocket superseded'));
            return;
          }
          this.ws = null;
          this.onStatus?.('error');
          reject(new Error('Redesign2 WebSocket error'));
          this.scheduleReconnect();
        };

        ws.onclose = () => {
          // Only the socket this client currently owns may close the client down:
          // a superseded socket's late close must not null the live socket, stop
          // its heartbeat, or drop its pending frames.
          if (!owns()) return;
          engineDebug('ws.close', {
            url: axisDebugSafeUrl(this.url),
            settled,
            reconnectAttempts: this.reconnectAttempts,
          });
          this.stopHeartbeat();
          this.ws = null;
          this.dropPending(new Error('Redesign2 WebSocket closed'));
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.onStatus?.('closed');
            reject(new Error('Redesign2 WebSocket closed before open'));
            this.scheduleReconnect();
            return;
          }
          this.onStatus?.('closed');
          this.scheduleReconnect();
        };

        ws.onmessage = (ev) => {
          // Frames from a superseded socket are stale by definition — never let
          // them reach the router (they would double-feed a subscription).
          if (!owns()) return;
          this.handleMessage(ev?.data);
        };
      });
    })();

    this.connectPromise = attempt;
    const clear = () => {
      if (this.connectPromise === attempt) this.connectPromise = null;
    };
    attempt.then(clear, clear);
    this.onStatus?.('connecting');
    return attempt;
  }

  send(frame: Redesign2WsFrame): void {
    if (!this.isOpen || !this.ws) throw new Error('WebSocket not open');
    this.ws.send(JSON.stringify(frame));
    this.noteSendBuffer();
  }

  private noteSendBuffer(): void {
    const held = sendBufferHeld(this.ws?.bufferedAmount);
    if (held === this.sendHeld) return;
    this.sendHeld = held;
    this.onBackpressure?.(held);
  }

  // -------------------------------------------------------------------------
  // Typed send helpers (F-05). Each builds a contract frame and sends it.
  // -------------------------------------------------------------------------

  subscribe(
    id: string,
    kind: 'series' | 'script',
    meta: SeriesMeta,
    opts?: {
      script?: string;
      inputs?: Record<string, unknown>;
      libraries?: unknown;
      mode?: string;
      /** Include only when the caller negotiates AXB1. Omit for JSON. */
      encoding?: 'axb1';
    },
  ): void {
    const { encoding, ...rest } = opts ?? {};
    const frame: Redesign2SubscribeFrame = {
      type: 'subscribe',
      id,
      ts: Date.now(),
      payload: {
        kind,
        meta,
        ...rest,
        ...(encoding !== undefined ? { encoding } : {}),
      },
    };
    this.send(frame);
  }

  resumeSubscription(
    id: string,
    count: number,
    lastTime: number,
    extra?: { closed_upto?: number; seq?: number; encoding?: 'axb1' },
  ): void {
    const { encoding, ...rest } = extra ?? {};
    const frame: Redesign2ResumeFrame = {
      type: 'resume',
      id,
      ts: Date.now(),
      payload: {
        count,
        last_time: lastTime,
        ...rest,
        ...(encoding !== undefined ? { encoding } : {}),
      },
    };
    this.send(frame);
  }

  requestRepair(id: string, fromTime: number): void {
    const frame: Redesign2RepairFrame = {
      type: 'repair',
      id,
      ts: Date.now(),
      payload: { from_time: fromTime },
    };
    this.send(frame);
  }

  unsubscribe(id: string): void {
    this.send({ type: 'unsubscribe', id, ts: Date.now() });
  }

  /**
   * Await the next inbound frame carrying `id` (e.g. a `status` or `error`
   * reply to a `subscribe`). The pending entry also resolves through the
   * normal `onFrame` dispatch. Rejects on timeout; entries are dropped on
   * socket close so a dead connection cannot leak waiters.
   */
  awaitFrame(id: string, timeoutMs = 10_000): Promise<Redesign2WsFrame> {
    return this.pending.awaitFrame(id, timeoutMs);
  }

  /**
   * Register a handler fired on every successful (re)connect — the caller
   * re-issues `subscribe`/`resume` here. Session ids are owned by the caller
   * (see `session-multiplexer`); the client never clears them, so a reconnect
   * preserves every session. Returns an unsubscribe function.
   */
  addReconnectHandler(fn: () => void): () => void {
    return this.reconnects.add(fn);
  }

  disconnect(): void {
    engineDebug('ws.disconnect', { url: axisDebugSafeUrl(this.url) });
    this.stopped = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.dropPending(new Error('Redesign2WsClient stopped'));
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.onStatus?.('closed');
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch {
      this.onStatus?.('error');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const frame = stripSeqAck(normalizeRedesign2Frame(parsed)) as Redesign2WsFrame;
    if (!frame || typeof frame.type !== 'string') return;
    if (frame.type === 'error' && !frame.id) {
      // PYNE UNAUTHORIZED = not yet authed — reconnect / re-auth. Bad keys block.
      if (shouldAuthBlock(frame)) {
        this.authBlocked = true;
        this.clearReconnect();
        this.onStatus?.('error');
      } else if (
        (frame.payload as { retryable?: unknown } | undefined)?.retryable === false ||
        (frame as { retryable?: unknown }).retryable === false
      ) {
        // Soft non-block: drop the socket so reconnect remints ticket + re-auths.
        try {
          this.ws?.close();
        } catch {
          /* onclose schedules reconnect when not authBlocked */
        }
      }
    }
    if (frame.type === 'pong') {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
      return;
    }
    if (!validateRedesign2Frame(frame)) {
      engineDebug('ws.malformed', { type: frame?.type ?? null });
      if (this.onMalformed) {
        this.onMalformed(parsed);
      } else if (typeof console !== 'undefined') {
        console.warn('[engine] skipping malformed frame', frame?.type);
      }
      return;
    }
    this.noteSendBuffer();
    if (this.sendHeld && isFormingTipFrame(frame)) return;
    if (frame.id) {
      this.pending.resolveFrame(frame.id, frame);
    }
    this.onFrame?.(frame);
  }

  private dropPending(err: Error): void {
    this.pending.dropAll(err);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isOpen) return;
      try {
        this.send({ type: 'ping', ts: Date.now() });
      } catch {
        // The socket closed between the check and the send: the close handler
        // nulls it and reconnects, so there is nothing to do here. Never let
        // it escape — a timer throw is an uncaught window error.
        return;
      }
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        // No pong; close and reconnect.
        if (this.ws) {
          try {
            this.ws.close();
          } catch {
            /* ignore */
          }
        }
      }, this.options.pongTimeoutMs);
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.authBlocked) return;
    if (this.reconnectTimer) return;
    const delay = reconnectDelayMs(
      this.reconnectAttempts,
      this.options.initialReconnectDelayMs,
      this.options.maxReconnectDelayMs,
    );
    this.reconnectAttempts += 1;
    engineDebug('ws.reconnect', {
      url: axisDebugSafeUrl(this.url),
      delayMs: delay,
      attempt: this.reconnectAttempts,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // disconnect() can race a timer that already elapsed; connect() un-stops.
      if (this.stopped) return;
      void this.connect().catch(() => {
        /* connect handles retry */
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }
}
