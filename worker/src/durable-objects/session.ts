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
 * Durable Object: per-session WebSocket relay for live market streams.
 *
 * ## Entry
 * Browser hits Worker `GET /api/stream?session=&symbol=&interval=` (see
 * `index.ts`). The Worker selects a DO via `idFromName(session)` and
 * rewrites the request to `/ws` on this object.
 *
 * ## Behavior
 * - Accepts browser WebSocket upgrades (`Upgrade: websocket`).
 * - Opens one upstream Binance kline socket per DO (`@kline_<interval>`).
 * - Forwards raw upstream frames to all connected clients (broadcast).
 * - Client control messages (JSON):
 *   - `{ action: "subscribe", symbol, interval }` — rebind upstream
 *   - `{ action: "ping" }` → `{ action: "pong", t }`
 * - When the last client disconnects, upstream is closed so the DO can
 *   hibernate and release sockets.
 *
 * Future: multi-symbol fan-out / shared upstream across sessions.
 */

import type { Env } from '../index';

/** Binance kline intervals accepted into the upstream path. */
const ALLOWED_INTERVALS = new Set([
    '1s',
    '1m',
    '3m',
    '5m',
    '15m',
    '30m',
    '1h',
    '2h',
    '4h',
    '6h',
    '8h',
    '12h',
    '1d',
    '3d',
    '1w',
    '1M',
]);

/**
 * Sanitize symbol for Binance WS path segments.
 * Only alphanumerics (uppercase), length 1–20 — blocks path injection.
 */
export function sanitizeStreamSymbol(raw: unknown): string | null {
    const s = String(raw ?? '')
        .trim()
        .toUpperCase();
    if (!/^[A-Z0-9]{1,20}$/.test(s)) return null;
    return s;
}

/** Return interval if in the Binance kline allowlist; otherwise null. */
export function sanitizeStreamInterval(raw: unknown): string | null {
    const s = String(raw ?? '').trim();
    if (!ALLOWED_INTERVALS.has(s)) return null;
    return s;
}

/** In-memory session fields kept on the DO instance (not durable storage). */
interface SessionState {
    symbol: string;
    interval: string;
    /** Single upstream exchange WebSocket, or null when idle. */
    upstream: WebSocket | null;
    /** Browser-side sockets accepted via `state.acceptWebSocket`. */
    clients: WebSocket[];
}

/**
 * Cloudflare Durable Object class exported as `SessionDO` from the Worker.
 * Bind via `wrangler.toml` `durable_objects` + migrations; namespace name `SESSIONS`.
 */
export class SessionDO {
    private state: DurableObjectState;
    private env: Env;
    private sess: SessionState;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
        this.sess = { symbol: '', interval: '', upstream: null, clients: [] };
    }

    /**
     * Only `/ws` with WebSocket upgrade is supported. Query: `symbol`, `interval`.
     * Returns 101 with the client half of a `WebSocketPair`.
     */
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname !== '/ws') {
            return new Response('not found', { status: 404 });
        }

        if (req.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }

        const symbol =
            sanitizeStreamSymbol(url.searchParams.get('symbol') ?? 'BTCUSDT') ?? 'BTCUSDT';
        const interval =
            sanitizeStreamInterval(url.searchParams.get('interval') ?? '1m') ?? '1m';
        // Reject clearly malicious query values instead of falling through to defaults only
        const rawSym = url.searchParams.get('symbol');
        const rawIv = url.searchParams.get('interval');
        if (rawSym != null && sanitizeStreamSymbol(rawSym) == null) {
            return new Response(JSON.stringify({ status: 'error', code: 'BAD_SYMBOL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (rawIv != null && sanitizeStreamInterval(rawIv) == null) {
            return new Response(JSON.stringify({ status: 'error', code: 'BAD_INTERVAL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        this.sess.symbol = symbol;
        this.sess.interval = interval;

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        // Hibernation-friendly accept so CF can wake us on messages.
        this.state.acceptWebSocket(server);
        this.sess.clients.push(server);
        server.addEventListener('close', () => {
            this.sess.clients = this.sess.clients.filter((c) => c !== server);
            if (this.sess.clients.length === 0) this.closeUpstream();
        });
        server.addEventListener('error', () => this.closeUpstream());

        this.ensureUpstream();
        return new Response(null, { status: 101, webSocket: client });
    }

    /** Hibernation API: client → DO control messages. */
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        try {
            const msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
            if (msg.action === 'subscribe') {
                const nextSym =
                    msg.symbol != null
                        ? sanitizeStreamSymbol(msg.symbol)
                        : this.sess.symbol;
                const nextIv =
                    msg.interval != null
                        ? sanitizeStreamInterval(msg.interval)
                        : this.sess.interval;
                if (nextSym == null || nextIv == null) {
                    try {
                        ws.send(
                            JSON.stringify({
                                type: 'error',
                                code: 'BAD_SUBSCRIBE',
                                message: 'invalid symbol or interval',
                            }),
                        );
                    } catch {
                        /* ignore */
                    }
                    return;
                }
                if (nextSym !== this.sess.symbol || nextIv !== this.sess.interval) {
                    this.sess.symbol = nextSym;
                    this.sess.interval = nextIv;
                    this.closeUpstream();
                    this.ensureUpstream();
                }
            } else if (msg.action === 'ping') {
                ws.send(JSON.stringify({ action: 'pong', t: Date.now() }));
            }
        } catch (_) {
            // ignore non-JSON
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
        try { ws.close(code, reason); } catch (_) { /* ignore */ }
    }

    async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
        try { ws.close(1011, 'upstream error'); } catch (_) { /* ignore */ }
    }

    /** Open Binance kline WS if not already connected for current symbol/interval. */
    private ensureUpstream(): void {
        if (this.sess.upstream) return;
        const symbol = sanitizeStreamSymbol(this.sess.symbol);
        const interval = sanitizeStreamInterval(this.sess.interval);
        if (!symbol || !interval) {
            this.broadcast(
                JSON.stringify({
                    type: 'error',
                    code: 'BAD_STREAM',
                    message: 'invalid symbol or interval for upstream',
                }),
            );
            return;
        }
        const url = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`;
        try {
            const upstream = new WebSocket(url);
            upstream.addEventListener('open', () => this.broadcast(JSON.stringify({ type: 'status', state: 'open', url })));
            upstream.addEventListener('close', () => {
                this.sess.upstream = null;
                this.broadcast(JSON.stringify({ type: 'status', state: 'closed' }));
            });
            upstream.addEventListener('message', (ev) => {
                // Raw Binance kline payloads — browser normalizes to OHLCV like direct WS.
                this.broadcast(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
            });
            this.sess.upstream = upstream;
        } catch (err) {
            this.broadcast(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
        }
    }

    /** Tear down upstream when idle or on resubscribe. */
    private closeUpstream(): void {
        if (this.sess.upstream) {
            try { this.sess.upstream.close(); } catch (_) { /* ignore */ }
            this.sess.upstream = null;
        }
    }

    /** Best-effort send to every accepted client socket. */
    private broadcast(payload: string): void {
        for (const c of this.sess.clients) {
            try { c.send(payload); } catch (_) { /* ignore */ }
        }
    }
}
