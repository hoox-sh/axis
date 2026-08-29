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
 * | `GET /api/market/binance/signed/klines` | `api.binance.com` HMAC-signed `/api/v3/klines` |
 * | `GET /api/market/binance/ticker/24hr` | Binance `/api/v3/ticker/24hr` |
 * | `GET /api/market/binance/exchangeInfo` | Binance `/api/v3/exchangeInfo` |
 * | `GET /api/market/mexc/klines` | MEXC `/api/v3/klines` (allowlisted intervals) |
 * | `GET /api/market/mexc/ticker/24hr` | MEXC `/api/v3/ticker/24hr` (full book) |
 * | `GET /api/market/mexc/exchangeInfo` | MEXC `/api/v3/exchangeInfo` |
 * | `GET /api/market/health` | local feature flags |
 *
 * Not an open reverse proxy: only fixed Binance / MEXC GET paths with
 * allowlisted query keys. Public GETs use a short isolate-memory TTL.
 * Signed GETs take request-scoped `X-Exchange-Key` / `X-Exchange-Secret`
 * (never stored).
 *
 * @module worker/market
 */

import type { Env } from './index';

/** Prefer vision data API (public market data), then classic spot API. */
const BINANCE_UPSTREAMS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
] as const;

/** Signed USER_DATA endpoints are not served on data-api.binance.vision. */
const BINANCE_SIGNED_UPSTREAM = 'https://api.binance.com';

/** Public MEXC REST origin (no fallback — single canonical host). */
const MEXC_UPSTREAMS = ['https://api.mexc.com'] as const;

const UPSTREAM_TIMEOUT_MS = 20_000;
const KLINES_TTL_MS = 15_000;
const TICKER_TTL_MS = 10_000;
const EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;

/** MEXC kline / ticker / exchangeInfo TTLs (public, unauthenticated). */
const MEXC_KLINES_TTL_MS = 15_000;
const MEXC_TICKER_TTL_MS = 10_000;
const MEXC_EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;

const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;
const INTERVAL_RE = /^(1s|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/;

/** MEXC REST `interval` (chart TF `1h` → `60m`, `1w` → `1W`).
 * Tighter than Binance — MEXC does not support `1s`, `3m`, `2h`, `6h`,
 * `8h`, `12h`, `3d`, or `1M`. */
const MEXC_INTERVAL_RE = /^(1m|5m|15m|30m|60m|4h|1d|1W)$/;

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
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Admin-Token, If-Match, X-Exchange-Key, X-Exchange-Secret, X-Exchange-Passphrase',
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

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** HMAC-SHA256 hex digest of `message` with request-scoped user secret. Never log `secret`. */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

async function fetchSignedBinance(url: string, apiKey: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'X-MBX-APIKEY': apiKey,
      },
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

/**
 * Like {@link proxyBinancePath} but for MEXC: single canonical upstream
 * (`https://api.mexc.com`), short isolate-memory TTL. The client is
 * responsible for symbol normalization (`mexcSpotSymbol`) and interval
 * mapping (`mexcKlineInterval`) before constructing the query — the Worker
 * only validates against `MEXC_INTERVAL_RE` (tighter than Binance) and the
 * shared `SYMBOL_RE`.
 */
async function proxyMexcPath(
  pathAndQuery: string,
  origin: string,
  ttlMs: number,
  cacheKey: string,
): Promise<Response> {
  const hit = getCached(cacheKey);
  if (hit) return cachedResponse(hit, origin, 'HIT');

  let lastErr = 'unreachable';
  for (const base of MEXC_UPSTREAMS) {
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
      message: `MEXC upstream unreachable: ${lastErr}`,
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

type KlinesQuery = { ok: true; params: URLSearchParams } | { ok: false; message: string };

/** Shared allowlist for public and signed `/klines` (symbol, interval, limit, startTime, endTime). */
function parseKlinesQuery(url: URL): KlinesQuery {
  const symbol = String(url.searchParams.get('symbol') || '')
    .trim()
    .toUpperCase();
  const interval = String(url.searchParams.get('interval') || '').trim();
  const limit = parseLimit(url.searchParams.get('limit'), 1000, 500);
  const startTime = parseOptionalMs(url.searchParams.get('startTime'));
  const endTime = parseOptionalMs(url.searchParams.get('endTime'));

  if (!SYMBOL_RE.test(symbol)) {
    return { ok: false, message: 'invalid symbol' };
  }
  if (!INTERVAL_RE.test(interval)) {
    return { ok: false, message: 'invalid interval' };
  }
  if (limit == null || startTime === null || endTime === null) {
    return { ok: false, message: 'invalid limit/startTime/endTime' };
  }

  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (startTime != null) params.set('startTime', String(startTime));
  if (endTime != null) params.set('endTime', String(endTime));
  return { ok: true, params };
}

/**
 * MEXC klines allowlist (symbol, interval, limit, startTime, endTime).
 * Tighter interval set than Binance — MEXC spot REST rejects the rest.
 * Symbol is already normalized by the client (`mexcSpotSymbol`).
 */
function parseMexcKlinesQuery(url: URL): KlinesQuery {
  const symbol = String(url.searchParams.get('symbol') || '')
    .trim()
    .toUpperCase();
  const interval = String(url.searchParams.get('interval') || '').trim();
  const limit = parseLimit(url.searchParams.get('limit'), 1000, 500);
  const startTime = parseOptionalMs(url.searchParams.get('startTime'));
  const endTime = parseOptionalMs(url.searchParams.get('endTime'));

  if (!SYMBOL_RE.test(symbol)) {
    return { ok: false, message: 'invalid symbol' };
  }
  if (!MEXC_INTERVAL_RE.test(interval)) {
    return { ok: false, message: 'invalid interval' };
  }
  if (limit == null || startTime === null || endTime === null) {
    return { ok: false, message: 'invalid limit/startTime/endTime' };
  }

  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (startTime != null) params.set('startTime', String(startTime));
  if (endTime != null) params.set('endTime', String(endTime));
  return { ok: true, params };
}

/** @internal test helper — clear the in-memory market cache between cases. */
export function _resetMarketCacheForTests(): void {
  memCache.clear();
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
          mexc: {
            id: 'mexc',
            proxyBase: '/api/market/mexc',
            upstreams: [...MEXC_UPSTREAMS],
            paths: ['klines', 'ticker/24hr', 'exchangeInfo'],
          },
        },
        signed: { binance: ['klines'] },
      },
      200,
      origin,
    );
  }

  const url = new URL(req.url);

  if (pathname === '/api/market/binance/klines') {
    const parsed = parseKlinesQuery(url);
    if (!parsed.ok) {
      return json(
        { status: 'error', code: 'BAD_REQUEST', message: parsed.message },
        400,
        origin,
      );
    }
    const pathAndQuery = `/api/v3/klines?${parsed.params}`;
    return proxyBinancePath(pathAndQuery, origin, KLINES_TTL_MS, `klines:${pathAndQuery}`);
  }

  if (pathname === '/api/market/binance/signed/klines') {
    const apiKey = (req.headers.get('X-Exchange-Key') || '').trim();
    const apiSecret = (req.headers.get('X-Exchange-Secret') || '').trim();
    if (!apiKey || !apiSecret) {
      return json(
        {
          status: 'error',
          code: 'AUTH',
          message: 'X-Exchange-Key and X-Exchange-Secret required',
        },
        401,
        origin,
      );
    }

    const parsed = parseKlinesQuery(url);
    if (!parsed.ok) {
      return json(
        { status: 'error', code: 'BAD_REQUEST', message: parsed.message },
        400,
        origin,
      );
    }

    const qs = parsed.params;
    qs.set('timestamp', String(Date.now()));
    qs.set('recvWindow', '5000');
    const query = qs.toString();
    const signature = await hmacSha256Hex(apiSecret, query);
    qs.set('signature', signature);

    const upstreamUrl = `${BINANCE_SIGNED_UPSTREAM}/api/v3/klines?${qs}`;
    try {
      const upstream = await fetchSignedBinance(upstreamUrl, apiKey);
      const text = await upstream.text();
      const contentType = upstream.headers.get('Content-Type') || 'application/json';
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': contentType,
          'X-Axis-Market-Cache': 'BYPASS',
          'X-Axis-Market-Upstream': BINANCE_SIGNED_UPSTREAM,
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      const lastErr = err instanceof Error ? err.message : 'unreachable';
      return json(
        {
          status: 'error',
          code: 'UPSTREAM_NETWORK',
          message: `Binance signed upstream unreachable: ${lastErr}`,
        },
        502,
        origin,
      );
    }
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

  if (pathname === '/api/market/mexc/klines') {
    const parsed = parseMexcKlinesQuery(url);
    if (!parsed.ok) {
      return json(
        { status: 'error', code: 'BAD_REQUEST', message: parsed.message },
        400,
        origin,
      );
    }
    const pathAndQuery = `/api/v3/klines?${parsed.params}`;
    return proxyMexcPath(
      pathAndQuery,
      origin,
      MEXC_KLINES_TTL_MS,
      `mexc:klines:${pathAndQuery}`,
    );
  }

  // MEXC does not support `?symbols=…` on ticker/24hr — it always returns
  // the full book. The client filters by symbol after parsing the array.
  if (pathname === '/api/market/mexc/ticker/24hr') {
    return proxyMexcPath(
      '/api/v3/ticker/24hr',
      origin,
      MEXC_TICKER_TTL_MS,
      'mexc:ticker:all',
    );
  }

  if (pathname === '/api/market/mexc/exchangeInfo') {
    return proxyMexcPath(
      '/api/v3/exchangeInfo',
      origin,
      MEXC_EXCHANGE_INFO_TTL_MS,
      'mexc:exchangeInfo',
    );
  }

  return json(
    { status: 'error', code: 'NOT_FOUND', message: `Unknown market path ${pathname}` },
    404,
    origin,
  );
}
