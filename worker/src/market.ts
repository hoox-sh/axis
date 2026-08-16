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
 * Market data plane (Worker) — allowlisted proxy for public CEX REST.
 *
 * Browser environments often block `api.binance.com` (geo, firewall, port,
 * extension). The PWA can fall back to same-Worker proxy paths:
 *
 * | Client path | Upstream |
 * |-------------|---------|
 * | `GET /api/market/binance/klines` | Binance `/api/v3/klines` |
 * | `GET /api/market/binance/ticker/24hr` | Binance `/api/v3/ticker/24hr` |
 * | `GET /api/market/binance/exchangeInfo` | Binance `/api/v3/exchangeInfo` |
 * | `GET /api/market/health` | local feature flags |
 *
 * Not an open reverse proxy: only fixed Binance public GET paths with
 * allowlisted query keys. Short isolate-memory TTL blunts rate limits.
 *
 * @module worker/market
 */

import type { Env } from './index';

/** Prefer vision data API (public market data), then classic spot API. */
const BINANCE_UPSTREAMS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
] as const;

const UPSTREAM_TIMEOUT_MS = 20_000;
const KLINES_TTL_MS = 15_000;
const TICKER_TTL_MS = 10_000;
const EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;

const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;
const INTERVAL_RE = /^(1s|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/;

interface CacheEntry {
  body: string;
  status: number;
  contentType: string;
  expiresAt: number;
}

const memCache = new Map<string, CacheEntry>();

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, If-Match',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(
  body: unknown,
  status: number,
  origin: string,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
      ...(extra || {}),
    },
  });
}

function cachedResponse(entry: CacheEntry, origin: string, cacheStatus: string): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      'Content-Type': entry.contentType || 'application/json',
      'X-Axis-Market-Cache': cacheStatus,
      ...corsHeaders(origin),
    },
  });
}

function getCached(key: string): CacheEntry | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return hit;
}

function putCached(key: string, entry: CacheEntry): void {
  memCache.set(key, entry);
  // Soft bound — drop oldest when large
  if (memCache.size > 128) {
    const first = memCache.keys().next().value;
    if (first) memCache.delete(first);
  }
}

async function fetchUpstream(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyBinancePath(
  pathAndQuery: string,
  origin: string,
  ttlMs: number,
  cacheKey: string,
): Promise<Response> {
  const hit = getCached(cacheKey);
  if (hit) return cachedResponse(hit, origin, 'HIT');

  let lastErr = 'unreachable';
  for (const base of BINANCE_UPSTREAMS) {
    const upstreamUrl = `${base}${pathAndQuery}`;
    try {
      const upstream = await fetchUpstream(upstreamUrl);
      const text = await upstream.text();
      const contentType = upstream.headers.get('Content-Type') || 'application/json';
      if (upstream.ok || upstream.status === 400 || upstream.status === 404) {
        putCached(cacheKey, {
          body: text,
          status: upstream.status,
          contentType,
          expiresAt: Date.now() + ttlMs,
        });
      }
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': contentType,
          'X-Axis-Market-Cache': 'MISS',
          'X-Axis-Market-Upstream': base,
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  return json(
    {
      status: 'error',
      code: 'UPSTREAM_NETWORK',
      message: `Binance upstream unreachable: ${lastErr}`,
    },
    502,
    origin,
  );
}

function parseLimit(raw: string | null, max: number, fallback: number): number | null {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(max, Math.floor(n));
}

function parseOptionalMs(raw: string | null): number | null | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Handle `/api/market/*` routes. Returns `null` if the path is not market.
 */
export async function handleMarket(
  req: Request,
  _env: Env,
  origin: string,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/market')) return null;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'GET') {
    return json(
      { status: 'error', code: 'METHOD', message: 'GET required' },
      405,
      origin,
    );
  }

  if (
    pathname === '/api/market' ||
    pathname === '/api/market/' ||
    pathname === '/api/market/health'
  ) {
    return json(
      {
        status: 'healthy',
        service: 'axis-market',
        providers: {
          binance: {
            id: 'binance',
            proxyBase: '/api/market/binance',
            upstreams: [...BINANCE_UPSTREAMS],
            paths: ['klines', 'ticker/24hr', 'exchangeInfo'],
          },
        },
      },
      200,
      origin,
    );
  }

  const url = new URL(req.url);

  if (pathname === '/api/market/binance/klines') {
    const symbol = String(url.searchParams.get('symbol') || '')
      .trim()
      .toUpperCase();
    const interval = String(url.searchParams.get('interval') || '').trim();
    const limit = parseLimit(url.searchParams.get('limit'), 1000, 500);
    const startTime = parseOptionalMs(url.searchParams.get('startTime'));
    const endTime = parseOptionalMs(url.searchParams.get('endTime'));

    if (!SYMBOL_RE.test(symbol)) {
      return json(
        { status: 'error', code: 'BAD_REQUEST', message: 'invalid symbol' },
        400,
        origin,
      );
    }
    if (!INTERVAL_RE.test(interval)) {
      return json(
        { status: 'error', code: 'BAD_REQUEST', message: 'invalid interval' },
        400,
        origin,
      );
    }
    if (limit == null || startTime === null || endTime === null) {
      return json(
        { status: 'error', code: 'BAD_REQUEST', message: 'invalid limit/startTime/endTime' },
        400,
        origin,
      );
    }

    const qs = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit),
    });
    if (startTime != null) qs.set('startTime', String(startTime));
    if (endTime != null) qs.set('endTime', String(endTime));
    const pathAndQuery = `/api/v3/klines?${qs}`;
    return proxyBinancePath(pathAndQuery, origin, KLINES_TTL_MS, `klines:${pathAndQuery}`);
  }

  if (pathname === '/api/market/binance/ticker/24hr') {
    // Prefer batch `symbols=["BTCUSDT",…]`; also allow single `symbol=`
    const symbolsRaw = url.searchParams.get('symbols');
    const symbolOne = String(url.searchParams.get('symbol') || '')
      .trim()
      .toUpperCase();

    let pathAndQuery = '';
    if (symbolsRaw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(symbolsRaw);
      } catch {
        return json(
          { status: 'error', code: 'BAD_REQUEST', message: 'symbols must be JSON array' },
          400,
          origin,
        );
      }
      if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) {
        return json(
          { status: 'error', code: 'BAD_REQUEST', message: 'symbols array size 1–100' },
          400,
          origin,
        );
      }
      const syms: string[] = [];
      for (const s of parsed) {
        const u = String(s || '')
          .trim()
          .toUpperCase();
        if (!SYMBOL_RE.test(u)) {
          return json(
            { status: 'error', code: 'BAD_REQUEST', message: `invalid symbol ${u}` },
            400,
            origin,
          );
        }
        syms.push(u);
      }
      pathAndQuery = `/api/v3/ticker/24hr?symbols=${JSON.stringify(syms)}`;
    } else if (SYMBOL_RE.test(symbolOne)) {
      pathAndQuery = `/api/v3/ticker/24hr?symbol=${symbolOne}`;
    } else {
      return json(
        {
          status: 'error',
          code: 'BAD_REQUEST',
          message: 'provide symbols=[…] or symbol=',
        },
        400,
        origin,
      );
    }

    return proxyBinancePath(pathAndQuery, origin, TICKER_TTL_MS, `ticker:${pathAndQuery}`);
  }

  if (pathname === '/api/market/binance/exchangeInfo') {
    // No query params — full spot catalog (cached longer)
    return proxyBinancePath(
      '/api/v3/exchangeInfo',
      origin,
      EXCHANGE_INFO_TTL_MS,
      'exchangeInfo',
    );
  }

  return json(
    { status: 'error', code: 'NOT_FOUND', message: `Unknown market path ${pathname}` },
    404,
    origin,
  );
}
