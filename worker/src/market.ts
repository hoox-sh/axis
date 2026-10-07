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
 * | `GET /api/market/mexc/ticker/24hr` | MEXC `/api/v3/ticker/24hr` (optional `symbol=`; else full book) |
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
import { MARKET_CORS, jsonResponse } from './http';
import { createProxyRouter } from './proxy-router';

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
 * AXIS TFs plus venue `1M`. No `1s`, `3m`, `2h`, `6h`, `8h`, `12h`, `3d`. */
const MEXC_INTERVAL_RE = /^(1m|5m|15m|30m|60m|4h|1d|1W|1M)$/;

interface CacheEntry {
  body: string;
  status: number;
  contentType: string;
  expiresAt: number;
}

const memCache = new Map<string, CacheEntry>();

function json(
  body: unknown,
  status: number,
  origin: string,
  extra?: Record<string, string>,
): Response {
  return jsonResponse(body, { status, origin, cors: MARKET_CORS, headers: extra });
}

function cachedResponse(entry: CacheEntry, origin: string, cacheStatus: string): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      'Content-Type': entry.contentType || 'application/json',
      'X-Axis-Market-Cache': cacheStatus,
      ...MARKET_CORS(origin),
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

async function proxyPublicPath(
  upstreams: readonly string[],
  pathAndQuery: string,
  origin: string,
  ttlMs: number,
  cacheKey: string,
  venueLabel: string,
): Promise<Response> {
  const hit = getCached(cacheKey);
  if (hit) return cachedResponse(hit, origin, 'HIT');

  let lastErr = 'unreachable';
  let lastStatus = 502;
  let lastBody = '';
  let lastContentType = 'application/json';
  for (const base of upstreams) {
    const upstreamUrl = `${base}${pathAndQuery}`;
    try {
      const upstream = await fetchUpstream(upstreamUrl);
      const text = await upstream.text();
      const contentType = upstream.headers.get('Content-Type') || 'application/json';
      // Geo / WAF blocks (403/451) and rate limits (429) on one host should
      // fail over to the next upstream instead of surfacing HTML to the PWA.
      if (upstream.status === 403 || upstream.status === 451 || upstream.status === 429) {
        lastErr = `${base} → HTTP ${upstream.status}`;
        lastStatus = upstream.status;
        lastBody = text;
        lastContentType = contentType;
        continue;
      }
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
          ...MARKET_CORS(origin),
        },
      });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  // All upstreams blocked — surface the last upstream body (usually Binance
  // 403 HTML) with its status so callers can distinguish geo-block from
  // network failure, plus a structured hint.
  if (lastBody && (lastStatus === 403 || lastStatus === 451 || lastStatus === 429)) {
    return new Response(lastBody, {
      status: lastStatus,
      headers: {
        'Content-Type': lastContentType,
        'X-Axis-Market-Cache': 'MISS',
        'X-Axis-Market-Upstream': 'all-blocked',
        ...MARKET_CORS(origin),
      },
    });
  }

  return json(
    {
      status: 'error',
      code: 'UPSTREAM_NETWORK',
      message: `${venueLabel} upstream unreachable: ${lastErr}`,
    },
    502,
    origin,
  );
}

function proxyBinancePath(
  pathAndQuery: string,
  origin: string,
  ttlMs: number,
  cacheKey: string,
): Promise<Response> {
  return proxyPublicPath(
    BINANCE_UPSTREAMS,
    pathAndQuery,
    origin,
    ttlMs,
    cacheKey,
    'Binance',
  );
}

function proxyMexcPath(
  pathAndQuery: string,
  origin: string,
  ttlMs: number,
  cacheKey: string,
): Promise<Response> {
  return proxyPublicPath(MEXC_UPSTREAMS, pathAndQuery, origin, ttlMs, cacheKey, 'MEXC');
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
 * AXIS TFs plus venue `1M`; other Binance intervals are rejected.
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

type MexcTickerQuery =
  | { ok: true; pathAndQuery: string; cacheKey: string }
  | { ok: false; message: string };

/**
 * Optional `symbol=` (single object ~400 B). No `symbols=` batch param.
 * Omit query for the full book. Unknown keys are rejected.
 */
function parseMexcTickerQuery(url: URL): MexcTickerQuery {
  for (const key of url.searchParams.keys()) {
    if (key === 'symbol') continue;
    if (key === 'symbols') {
      return {
        ok: false,
        message: 'MEXC has no symbols= batch; use symbol= or omit',
      };
    }
    return { ok: false, message: `unexpected query ${key}` };
  }
  const symbolOne = String(url.searchParams.get('symbol') || '')
    .trim()
    .toUpperCase();
  if (!symbolOne) {
    return {
      ok: true,
      pathAndQuery: '/api/v3/ticker/24hr',
      cacheKey: 'mexc:ticker:all',
    };
  }
  if (!SYMBOL_RE.test(symbolOne)) {
    return { ok: false, message: 'invalid symbol' };
  }
  return {
    ok: true,
    pathAndQuery: `/api/v3/ticker/24hr?symbol=${symbolOne}`,
    cacheKey: `mexc:ticker:${symbolOne}`,
  };
}

/** @internal test helper — clear the in-memory market cache between cases. */
export function _resetMarketCacheForTests(): void {
  memCache.clear();
}

/** 400 envelope shared by every query-validation failure. */
function badRequest(origin: string, message: string): Response {
  return json({ status: 'error', code: 'BAD_REQUEST', message }, 400, origin);
}

/**
 * Binance signed klines — request-scoped `X-Exchange-Key` / `X-Exchange-Secret`
 * (never stored, never cached).
 */
async function signedKlines(req: Request, url: URL, origin: string): Promise<Response> {
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
  if (!parsed.ok) return badRequest(origin, parsed.message);

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
        ...MARKET_CORS(origin),
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

/** Binance 24h ticker: batch `symbols=[…]` (1–100) or a single `symbol=`. */
function binanceTicker(url: URL, origin: string): Promise<Response> {
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
      return Promise.resolve(badRequest(origin, 'symbols must be JSON array'));
    }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) {
      return Promise.resolve(badRequest(origin, 'symbols array size 1–100'));
    }
    const syms: string[] = [];
    for (const s of parsed) {
      const u = String(s || '')
        .trim()
        .toUpperCase();
      if (!SYMBOL_RE.test(u)) return Promise.resolve(badRequest(origin, `invalid symbol ${u}`));
      syms.push(u);
    }
    pathAndQuery = `/api/v3/ticker/24hr?symbols=${JSON.stringify(syms)}`;
  } else if (SYMBOL_RE.test(symbolOne)) {
    pathAndQuery = `/api/v3/ticker/24hr?symbol=${symbolOne}`;
  } else {
    return Promise.resolve(badRequest(origin, 'provide symbols=[…] or symbol='));
  }

  return proxyBinancePath(pathAndQuery, origin, TICKER_TTL_MS, `ticker:${pathAndQuery}`);
}

/**
 * Market allowlist. Literal paths only — every upstream path is fixed, so a
 * client can never steer the Worker at an arbitrary venue URL.
 */
const ROUTER = createProxyRouter({
  prefix: '/api/market',
  cors: MARKET_CORS,
  health: () => ({
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
  }),
  routes: [
    {
      path: '/binance/klines',
      handle: ({ url, origin }) => {
        const parsed = parseKlinesQuery(url);
        if (!parsed.ok) return badRequest(origin, parsed.message);
        const pathAndQuery = `/api/v3/klines?${parsed.params}`;
        return proxyBinancePath(pathAndQuery, origin, KLINES_TTL_MS, `klines:${pathAndQuery}`);
      },
    },
    {
      path: '/binance/signed/klines',
      handle: ({ req, url, origin }) => signedKlines(req, url, origin),
    },
    {
      path: '/binance/ticker/24hr',
      handle: ({ url, origin }) => binanceTicker(url, origin),
    },
    {
      path: '/binance/exchangeInfo',
      // No query params — full spot catalog (cached longer).
      handle: ({ origin }) =>
        proxyBinancePath('/api/v3/exchangeInfo', origin, EXCHANGE_INFO_TTL_MS, 'exchangeInfo'),
    },
    {
      path: '/mexc/klines',
      handle: ({ url, origin }) => {
        const parsed = parseMexcKlinesQuery(url);
        if (!parsed.ok) return badRequest(origin, parsed.message);
        const pathAndQuery = `/api/v3/klines?${parsed.params}`;
        return proxyMexcPath(pathAndQuery, origin, MEXC_KLINES_TTL_MS, `mexc:klines:${pathAndQuery}`);
      },
    },
    {
      path: '/mexc/ticker/24hr',
      handle: ({ url, origin }) => {
        const parsed = parseMexcTickerQuery(url);
        if (!parsed.ok) return badRequest(origin, parsed.message);
        return proxyMexcPath(parsed.pathAndQuery, origin, MEXC_TICKER_TTL_MS, parsed.cacheKey);
      },
    },
    {
      path: '/mexc/exchangeInfo',
      handle: ({ origin }) =>
        proxyMexcPath('/api/v3/exchangeInfo', origin, MEXC_EXCHANGE_INFO_TTL_MS, 'mexc:exchangeInfo'),
    },
  ],
  notFound: { message: 'Unknown market path /api/market%s' },
});

/** Accepted market paths, for docs and allowlist tests. */
export function marketAllowlist(): string[] {
  return ROUTER.allowedPaths();
}

/**
 * Handle `/api/market/*` routes. Returns `null` if the path is not market.
 */
export function handleMarket(
  req: Request,
  _env: Env,
  origin: string,
  pathname: string,
): Promise<Response> | null {
  return ROUTER.handle(req, origin, pathname);
}
