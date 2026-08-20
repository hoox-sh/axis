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
 * Browser hits Worker `GET /api/stream?session=&venue=&symbol=&interval=` (see
 * `index.ts`). The Worker selects a DO via `idFromName(session)` and
 * rewrites the request to `/ws` on this object.
 *
 * ## Behavior
 * - Accepts browser WebSocket upgrades (`Upgrade: websocket`).
 * - Opens one upstream venue kline socket per DO (Binance, OKX, Bybit, Coinbase, Kraken).
 * - Forwards raw upstream frames to all connected clients (broadcast).
 * - Client control messages (JSON):
 *   - `{ action: "subscribe", symbol, interval }` — rebind upstream
 *   - `{ action: "ping" }` → `{ action: "pong", t }`
 * - When the last client disconnects, upstream is closed so the DO can
 *   hibernate and release sockets.
 *
 * ## Venue support
 * Each venue has a different WS URL and subscription model:
 * - **Binance**: URL-based (`/ws/{sym}@kline_{iv}`)
 * - **OKX**: JSON subscribe `{ op, args }`
 * - **Bybit**: JSON subscribe `{ op, args }`
 * - **Coinbase**: JSON subscribe `{ type, product_ids, channel }`
 * - **Kraken**: JSON subscribe `{ event, pair, subscription }`
 */

import type { Env } from '../index';

type VenueId = 'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken';

const VALID_VENUES = new Set<string>(['binance', 'okx', 'bybit', 'coinbase', 'kraken']);

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
 * Sanitize symbol for WS path segments.
 * Only alphanumerics (uppercase), length 1–20 — blocks path injection.
 */
export function sanitizeStreamSymbol(raw: unknown): string | null {
    const s = String(raw ?? '')
        .trim()
        .toUpperCase();
    if (!/^[A-Z0-9]{1,20}$/.test(s)) return null;
    return s;
}

/** Return interval if in the allowlist; otherwise null. */
export function sanitizeStreamInterval(raw: unknown): string | null {
    const s = String(raw ?? '').trim();
    if (ALLOWED_INTERVALS.has(s)) return s;
    return null;
}

// ── Venue WS builders (duplicated from src/streams/ws-venues.ts — DO is a separate bundle) ──

function okxInstId(symbol: string): string {
    const s = symbol.toUpperCase().replace(/[-_/]/g, '');
    if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
    return `${s}-USDT`;
}

function coinbaseProduct(symbol: string): string {
    const s = symbol.toUpperCase().replace(/[-_/]/g, '');
    if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
    if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
    return `${s}-USD`;
}

function krakenPair(symbol: string): string {
    const s = symbol.toUpperCase().replace(/[-_/]/g, '');
    let base = s;
    let quote = 'USD';
    if (s.endsWith('USDT')) { base = s.slice(0, -4); quote = 'USDT'; }
    else if (s.endsWith('USD')) { base = s.slice(0, -3); quote = 'USD'; }
    if (base === 'BTC') base = 'XBT';
    return `${base}${quote}`;
}

const OKX_CHANNEL: Record<string, string> = {
    '1m': 'candle1m', '5m': 'candle5m', '15m': 'candle15m',
    '1h': 'candle1H', '4h': 'candle4H', '1d': 'candle1D', '1w': 'candle1W',
};

const BYBIT_TOPIC: Record<string, string> = {
    '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W',
};

const KRAKEN_INTERVAL: Record<string, number> = {
    '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080,
};

interface VenueWsConfig {
    url: string;
    subscribe: Record<string, unknown> | string | null;
}

function buildVenueWs(venue: VenueId, symbol: string, interval: string): VenueWsConfig | null {
    const sym = symbol.toUpperCase();
    switch (venue) {
        case 'binance': {
            return {
                url: `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@kline_${interval}`,
                subscribe: null,
            };
        }
        case 'okx': {
            return {
                url: 'wss://ws.okx.com:8443/ws/v5/business',
                subscribe: { op: 'subscribe', args: [{ channel: OKX_CHANNEL[interval] || 'candle1D', instId: okxInstId(sym) }] },
            };
        }
        case 'bybit': {
            return {
                url: 'wss://stream.bybit.com/v5/public/spot',
                subscribe: { op: 'subscribe', args: [`kline.${BYBIT_TOPIC[interval] || 'D'}.${sym}`] },
            };
        }
        case 'coinbase': {
            return {
                url: 'wss://advanced-trade-ws.coinbase.com',
                subscribe: { type: 'subscribe', product_ids: [coinbaseProduct(sym)], channel: 'candles' },
            };
        }
        case 'kraken': {
            return {
                url: 'wss://ws.kraken.com/',
                subscribe: { event: 'subscribe', pair: [krakenPair(sym)], subscription: { name: 'ohlc', interval: KRAKEN_INTERVAL[interval] || 1440 } },
            };
        }
        default:
            return null;
    }
}

/** In-memory session fields kept on the DO instance (not durable storage). */
interface SessionState {
    venue: VenueId;
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
        this.sess = { venue: 'binance', symbol: '', interval: '', upstream: null, clients: [] };
    }

    /**
     * Only `/ws` with WebSocket upgrade is supported. Query: `venue`, `symbol`, `interval`.
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

        const rawVenue = url.searchParams.get('venue') ?? 'binance';
        const venue = VALID_VENUES.has(rawVenue) ? (rawVenue as VenueId) : 'binance';
        const symbol =
            sanitizeStreamSymbol(url.searchParams.get('symbol') ?? 'BTCUSDT') ?? 'BTCUSDT';
        const interval =
            sanitizeStreamInterval(url.searchParams.get('interval') ?? '1m') ?? '1m';

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
        this.sess.venue = venue;
        this.sess.symbol = symbol;
        this.sess.interval = interval;

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
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
                const nextVenue = msg.venue != null && VALID_VENUES.has(msg.venue)
                    ? (msg.venue as VenueId)
                    : this.sess.venue;
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
                    } catch { /* ignore */ }
                    return;
                }
                if (nextVenue !== this.sess.venue || nextSym !== this.sess.symbol || nextIv !== this.sess.interval) {
                    this.sess.venue = nextVenue;
                    this.sess.symbol = nextSym;
                    this.sess.interval = nextIv;
                    this.closeUpstream();
                    this.ensureUpstream();
                }
            } else if (msg.action === 'ping') {
                ws.send(JSON.stringify({ action: 'pong', t: Date.now() }));
            }
        } catch {
            // ignore non-JSON
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
        try { ws.close(code, reason); } catch { /* ignore */ }
    }

    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
        try { ws.close(1011, 'upstream error'); } catch { /* ignore */ }
    }

    /** Open venue kline WS if not already connected for current venue/symbol/interval. */
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

        const cfg = buildVenueWs(this.sess.venue, symbol, interval);
        if (!cfg) {
            this.broadcast(
                JSON.stringify({
                    type: 'error',
                    code: 'UNSUPPORTED_VENUE',
                    message: `venue ${this.sess.venue} has no WS relay`,
                }),
            );
            return;
        }

        try {
            const upstream = new WebSocket(cfg.url);
            upstream.addEventListener('open', () => {
                this.broadcast(JSON.stringify({ type: 'status', state: 'open', venue: this.sess.venue, url: cfg.url }));
                // Send subscribe message for venues that need it (not Binance)
                if (cfg.subscribe) {
                    try {
                        upstream.send(typeof cfg.subscribe === 'string' ? cfg.subscribe : JSON.stringify(cfg.subscribe));
                    } catch { /* ignore */ }
                }
            });
            upstream.addEventListener('close', () => {
                this.sess.upstream = null;
                this.broadcast(JSON.stringify({ type: 'status', state: 'closed' }));
            });
            upstream.addEventListener('message', (ev) => {
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
            try { this.sess.upstream.close(); } catch { /* ignore */ }
            this.sess.upstream = null;
        }
    }

    /** Best-effort send to every accepted client socket. */
    private broadcast(payload: string): void {
        for (const c of this.sess.clients) {
            try { c.send(payload); } catch { /* ignore */ }
        }
    }
}
