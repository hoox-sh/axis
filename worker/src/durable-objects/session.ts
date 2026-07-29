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

        const symbol = url.searchParams.get('symbol') ?? 'BTCUSDT';
        const interval = url.searchParams.get('interval') ?? '1m';
        this.sess.symbol = symbol.toUpperCase();
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
            if (msg.action === 'subscribe' && (msg.symbol !== this.sess.symbol || msg.interval !== this.sess.interval)) {
                this.sess.symbol = String(msg.symbol ?? this.sess.symbol).toUpperCase();
                this.sess.interval = String(msg.interval ?? this.sess.interval);
                this.closeUpstream();
                this.ensureUpstream();
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
        const url = `wss://stream.binance.com:9443/ws/${this.sess.symbol.toLowerCase()}@kline_${this.sess.interval}`;
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
