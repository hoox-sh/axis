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
 * Local Bun sidecar — optional CCXT Pro datafeed gateway.
 *
 * Mirrors the PYNE datafeed gateway contract so AXIS (or any consumer)
 * can talk to it for REST OHLCV, market lists, and live WS watches.
 *
 * ## Endpoints
 * - `GET  /datafeed/ohlcv?exchange=&symbol=&timeframe=&since=&limit=`
 * - `GET  /datafeed/markets?exchange=`
 * - `WS   /datafeed/watch?exchange=&symbol=&timeframe=`
 * - `POST /datafeed/session` — store credentials (RAM only)
 * - `DELETE /datafeed/session?cred=` — remove credentials
 * - `GET  /health` — returns `{ status: 'ok', version }`
 *
 * @module datafeed/index
 */

import { fetchOHLCV, fetchMarkets, watchOHLCV, putCredential, deleteCredential, closeAll } from './gateway';
import type { SessionBody, WatchStream } from './types';

const PORT = Number(process.env.DATAFEED_PORT ?? 5003);
const VERSION = '0.1.0';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ── Server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,

  // Bun WebSocket handler — receives the `data` from server.upgrade()
  websocket: {
    open(ws) {
      const data = (ws as any).data as { stream?: WatchStream } | undefined;
      const stream = data?.stream;
      if (!stream) { ws.close(1011, 'no stream'); return; }
      (async () => {
        try {
          while (true) {
            const bar = await stream.next();
            ws.send(JSON.stringify(bar));
          }
        } catch {
          try { ws.close(); } catch { /* ignore */ }
        }
      })();
    },
    message() { /* client messages ignored — this is a broadcast stream */ },
    close(_ws) { /* stream cleanup via abort on next call */ },
  } as any,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.startsWith('/datafeed/')
      ? url.pathname.slice('/datafeed'.length)
      : url.pathname;

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── Health ────────────────────────────────────────────────────
    if (path === '/health') {
      return json({ status: 'ok', version: VERSION, uptime: process.uptime() });
    }

    // ── GET /datafeed/ohlcv ───────────────────────────────────────
    if (path === '/ohlcv' && req.method === 'GET') {
      const exchange = url.searchParams.get('exchange');
      const symbol = url.searchParams.get('symbol');
      if (!exchange || !symbol) return err('missing exchange or symbol');
      try {
        const timeframe = url.searchParams.get('timeframe') ?? '1d';
        const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
        const credId = url.searchParams.get('cred') ?? undefined;
        const bars = await fetchOHLCV(exchange, symbol, timeframe, since, limit, credId);
        return json(bars);
      } catch (e: any) {
        return err(e?.message ?? String(e), 502);
      }
    }

    // ── GET /datafeed/markets ─────────────────────────────────────
    if (path === '/markets' && req.method === 'GET') {
      const exchange = url.searchParams.get('exchange');
      if (!exchange) return err('missing exchange');
      try {
        const markets = await fetchMarkets(exchange);
        return json(markets);
      } catch (e: any) {
        return err(e?.message ?? String(e), 502);
      }
    }

    // ── POST /datafeed/session ────────────────────────────────────
    if (path === '/session' && req.method === 'POST') {
      try {
        const body = (await req.json()) as SessionBody;
        if (!body.exchange || !body.credentialId || !body.apiKey || !body.secret) {
          return err('missing required fields (exchange, credentialId, apiKey, secret)');
        }
        putCredential(body.credentialId, {
          exchange: body.exchange,
          apiKey: body.apiKey,
          secret: body.secret,
          password: body.password,
          uid: body.uid,
        });
        return new Response(null, { status: 204 });
      } catch {
        return err('invalid JSON body');
      }
    }

    // ── DELETE /datafeed/session ──────────────────────────────────
    if (path === '/session' && req.method === 'DELETE') {
      const credId = url.searchParams.get('cred');
      if (!credId) return err('missing cred param');
      const ok = deleteCredential(credId);
      return ok ? new Response(null, { status: 204 }) : err('not found', 404);
    }

    // ── WS /datafeed/watch ────────────────────────────────────────
    if (path === '/watch') {
      const exchange = url.searchParams.get('exchange');
      const symbol = url.searchParams.get('symbol');
      if (!exchange || !symbol) return err('missing exchange or symbol');

      const timeframe = url.searchParams.get('timeframe') ?? '1m';
      const credId = url.searchParams.get('cred') ?? undefined;
      const stream = watchOHLCV(exchange, symbol, timeframe, credId);

      const upgraded = (server as any).upgrade(req, { data: { stream } });
      if (!upgraded) return err('websocket upgrade failed', 500);
      return undefined as any;
    }

    return err('not found', 404);
  },
});

console.log(`[datafeed] sidecar listening on http://localhost:${server.port}`);
console.log(`[datafeed] OHLCV: GET  /datafeed/ohlcv?exchange=&symbol=`);
console.log(`[datafeed] watch: WS   /datafeed/watch?exchange=&symbol=`);
console.log(`[datafeed] keys:  POST /datafeed/session`);

process.on('SIGINT', () => { closeAll(); server.stop(); process.exit(0); });
process.on('SIGTERM', () => { closeAll(); server.stop(); process.exit(0); });
