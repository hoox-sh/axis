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
 * Reconnectable WebSocket with exponential backoff for AXIS venue streams
 * and watchlist quote muxes.
 *
 * Shared by `streams/catalog` (kline feeds) and `data/watchlist-live` (tickers).
 * On unexpected close, schedules reconnect until `maxAttempts` is exhausted,
 * then fires `onError`. Explicit `stop()` closes without further attempts and
 * is idempotent (safe to call more than once).
 *
 * Defaults: base 1s, max delay 30s, 8 attempts (`delay = min(max, base * 2^(n-1))`).
 *
 * @module streams/reconnect-ws
 */

/** Default hard caps (exported for docs / tests). */
export const RECONNECT_DEFAULTS = {
  maxAttempts: 8,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
} as const;

/** Status payload forwarded to stream/watchlist UI telemetry. */
export type WsStatus = {
  state: 'open' | 'closed' | 'reconnecting' | string;
  url?: string;
  detail?: string;
};

/** Options for {@link openReconnectableWs}. */
export interface ReconnectableWsOpts {
  url: string;
  /** Called after each successful open (re-subscribe here). */
  onOpen?: (ws: WebSocket) => void;
  onMessage: (ev: MessageEvent, ws: WebSocket) => void;
  onStatus: (s: WsStatus) => void;
  /** Hard failure only (construct error or reconnect exhausted). */
  onError: (e: Error) => void;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Open a WebSocket that reconnects on unexpected close.
 * @returns `stop()` that closes without further reconnect attempts (idempotent).
 */
export function openReconnectableWs(opts: ReconnectableWsOpts): () => void {
  const maxAttempts = Math.max(0, opts.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts);
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? RECONNECT_DEFAULTS.baseDelayMs);
  const maxDelayMs = Math.max(baseDelayMs, opts.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs);

  let stopped = false;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let openedOnce = false;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Detach listeners and close without triggering reconnect path. */
  const detachAndClose = (sock: WebSocket | null) => {
    if (!sock) return;
    try {
      sock.onclose = null;
      sock.onerror = null;
      sock.onmessage = null;
      sock.onopen = null;
      sock.close();
    } catch {
      /* ignore */
    }
  };

  const connect = () => {
    if (stopped) return;
    clearTimer();
    // Drop any prior socket reference before constructing a new one
    if (ws) {
      detachAndClose(ws);
      ws = null;
    }
    try {
      ws = new WebSocket(opts.url);
    } catch (e) {
      stopped = true;
      opts.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    ws.onopen = () => {
      if (stopped) {
        detachAndClose(ws);
        ws = null;
        return;
      }
      attempt = 0;
      openedOnce = true;
      opts.onStatus({ state: 'open', url: opts.url, detail: opts.url });
      try {
        opts.onOpen?.(ws!);
      } catch (e) {
        opts.onError(e instanceof Error ? e : new Error(String(e)));
      }
    };

    ws.onmessage = (ev) => {
      if (stopped) return;
      try {
        opts.onMessage(ev, ws!);
      } catch {
        /* ignore parse errors in caller */
      }
    };

    // Rely on close for reconnect; some browsers fire error then close.
    ws.onerror = () => {
      /* no-op — handled in onclose */
    };

    ws.onclose = () => {
      ws = null;
      if (stopped) {
        return;
      }
      attempt += 1;
      if (attempt > maxAttempts) {
        // Terminal — no further reconnects; treat as stopped so stop() is a no-op
        stopped = true;
        opts.onStatus({ state: 'closed', detail: 'reconnect exhausted' });
        opts.onError(
          new Error(
            openedOnce
              ? `WebSocket reconnect exhausted after ${maxAttempts} attempts`
              : 'WebSocket failed to connect',
          ),
        );
        return;
      }
      const delay = nextBackoffMs(attempt, baseDelayMs, maxDelayMs);
      opts.onStatus({
        state: 'reconnecting',
        url: opts.url,
        detail: `attempt ${attempt}/${maxAttempts} in ${delay}ms`,
      });
      timer = setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    const sock = ws;
    ws = null;
    detachAndClose(sock);
    opts.onStatus({ state: 'closed' });
  };
}

/** Compute next backoff delay (exported for unit tests). Always capped at maxDelayMs. */
export function nextBackoffMs(
  attempt: number,
  baseDelayMs: number = RECONNECT_DEFAULTS.baseDelayMs,
  maxDelayMs: number = RECONNECT_DEFAULTS.maxDelayMs,
): number {
  if (attempt < 1) return Math.min(maxDelayMs, baseDelayMs);
  // attempt 1 → base, 2 → 2*base, … always ≤ maxDelayMs
  const raw = baseDelayMs * 2 ** (attempt - 1);
  if (!Number.isFinite(raw) || raw < 0) return maxDelayMs;
  return Math.min(maxDelayMs, raw);
}
