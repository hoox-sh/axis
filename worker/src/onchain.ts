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
 * On-chain data plane (Worker) — allowlisted proxy for public analytics APIs.
 *
 * Browser CORS often blocks `api.llama.fi` and `api.geckoterminal.com`. The PWA calls:
 *
 * | Client path | Upstream |
 * |-------------|---------|
 * | `GET /api/onchain/llama/protocols` | `https://api.llama.fi/protocols` |
 * | `GET /api/onchain/llama/protocol/:slug` | `https://api.llama.fi/protocol/:slug` |
 * | `GET /api/onchain/gecko/networks/:network/pools/:address/ohlcv/:timeframe` | GeckoTerminal OHLCV |
 * | `GET /api/onchain/gecko/search/pools` | GeckoTerminal pool search |
 * | `GET /api/onchain/health` | local feature flags |
 *
 * No API keys required for DefiLlama or GeckoTerminal public endpoints. Responses
 * are short-TTL cached in isolate memory to blunt rate limits (not multi-isolate durable).
 *
 * @module worker/onchain
 */

import type { Env } from './index';

const LLAMA_UPSTREAM = 'https://api.llama.fi';
const GECKO_UPSTREAM = 'https://api.geckoterminal.com/api/v2';

/** Safe protocol slug: lowercase letters, digits, hyphens, underscores, dots. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/** GeckoTerminal network id (eth, solana, polygon_pos, …). */
const GECKO_NETWORK_RE = /^[a-z0-9_]+$/;

/** EVM pool/token address. */
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Solana (and similar) base58 address — no 0,O,I,l. */
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

/** Gecko OHLCV timeframe path segment. */
const GECKO_TIMEFRAME_RE = /^(day|hour|minute)$/;

const PROTOCOLS_TTL_MS = 10 * 60 * 1000;
const PROTOCOL_TTL_MS = 2 * 60 * 1000;
const GECKO_OHLCV_TTL_MS = 60 * 1000;
const GECKO_SEARCH_TTL_MS = 120 * 1000;
const UPSTREAM_TIMEOUT_MS = 25_000;

const GECKO_OHLCV_QUERY_KEYS = [
  'aggregate',
  'limit',
  'currency',
  'before_timestamp',
] as const;

const GECKO_SEARCH_QUERY_KEYS = ['query', 'network', 'page', 'include'] as const;

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
      'X-Axis-Onchain-Cache': cacheStatus,
      ...corsHeaders(origin),
    },
  });
}

function getCached(key: string): CacheEntry | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return e;
}

function putCached(key: string, entry: CacheEntry): void {
  // Soft cap — drop oldest-ish by clearing all when huge
  if (memCache.size > 64) memCache.clear();
  memCache.set(key, entry);
}

async function fetchUpstream(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'axis-worker-onchain/1.0',
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Forward only allowlisted query keys from the client request.
 */
function pickQuery(req: Request, keys: readonly string[]): string {
  let search = '';
  try {
    search = new URL(req.url).search;
  } catch {
    return '';
  }
  if (!search || search === '?') return '';
  const src = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out = new URLSearchParams();
  for (const key of keys) {
    const v = src.get(key);
    if (v != null && v !== '') out.set(key, v);
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

function isValidGeckoAddress(address: string): boolean {
  return ETH_ADDRESS_RE.test(address) || SOL_ADDRESS_RE.test(address);
}

async function proxyJson(
  cacheKey: string,
  upstreamUrl: string,
  origin: string,
  ttlMs: number,
  providerLabel = 'Upstream',
): Promise<Response> {
  const hit = getCached(cacheKey);
  if (hit) return cachedResponse(hit, origin, 'HIT');

  let upstream: Response;
  try {
    upstream = await fetchUpstream(upstreamUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(
      {
        status: 'error',
        code: 'UPSTREAM_NETWORK',
        message: `${providerLabel} upstream unreachable: ${msg}`,
      },
      502,
      origin,
    );
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('Content-Type') || 'application/json';

  // Cache successful and 404 bodies briefly (404 avoids stampede on bad paths)
  if (upstream.ok || upstream.status === 404) {
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
      'X-Axis-Onchain-Cache': 'MISS',
      ...corsHeaders(origin),
    },
  });
}

function decodePathSegment(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  return s.trim();
}

/**
 * Handle `/api/onchain/*` routes. Returns `null` if the path is not on-chain.
 */
export async function handleOnchain(
  req: Request,
  _env: Env,
  origin: string,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/onchain')) return null;

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

  if (pathname === '/api/onchain' || pathname === '/api/onchain/' || pathname === '/api/onchain/health') {
    return json(
      {
        status: 'healthy',
        service: 'axis-onchain',
        providers: {
          defillama: {
            id: 'defillama',
            proxyBase: '/api/onchain/llama',
            upstream: LLAMA_UPSTREAM,
            paths: ['/protocols', '/protocol/:slug'],
          },
          geckoterminal: {
            id: 'geckoterminal',
            proxyBase: '/api/onchain/gecko',
            upstream: GECKO_UPSTREAM,
            paths: [
              '/networks/:network/pools/:address/ohlcv/:timeframe',
              '/search/pools',
            ],
          },
        },
        cache: { entries: memCache.size },
      },
      200,
      origin,
    );
  }

  // Path rewrite: /api/onchain/llama/... → api.llama.fi/...
  if (pathname === '/api/onchain/llama/protocols') {
    return proxyJson(
      'llama:protocols',
      `${LLAMA_UPSTREAM}/protocols`,
      origin,
      PROTOCOLS_TTL_MS,
      'DefiLlama',
    );
  }

  const protoMatch = /^\/api\/onchain\/llama\/protocol\/([^/]+)\/?$/.exec(pathname);
  if (protoMatch) {
    const slug = decodePathSegment(protoMatch[1] || '');
    if (!SLUG_RE.test(slug)) {
      return json(
        {
          status: 'error',
          code: 'BAD_SLUG',
          message: 'Invalid protocol slug (use letters, digits, ._- only)',
        },
        400,
        origin,
      );
    }
    const normalized = slug.toLowerCase();
    return proxyJson(
      `llama:protocol:${normalized}`,
      `${LLAMA_UPSTREAM}/protocol/${encodeURIComponent(normalized)}`,
      origin,
      PROTOCOL_TTL_MS,
      'DefiLlama',
    );
  }

  // GeckoTerminal: /api/onchain/gecko/search/pools
  if (pathname === '/api/onchain/gecko/search/pools') {
    const qs = pickQuery(req, GECKO_SEARCH_QUERY_KEYS);
    const cacheKey = `gecko:search:${qs}`;
    return proxyJson(
      cacheKey,
      `${GECKO_UPSTREAM}/search/pools${qs}`,
      origin,
      GECKO_SEARCH_TTL_MS,
      'GeckoTerminal',
    );
  }

  // GeckoTerminal: /api/onchain/gecko/networks/:network/pools/:address/ohlcv/:timeframe
  const ohlcvMatch =
    /^\/api\/onchain\/gecko\/networks\/([^/]+)\/pools\/([^/]+)\/ohlcv\/([^/]+)\/?$/.exec(
      pathname,
    );
  if (ohlcvMatch) {
    const network = decodePathSegment(ohlcvMatch[1] || '').toLowerCase();
    const address = decodePathSegment(ohlcvMatch[2] || '');
    const timeframe = decodePathSegment(ohlcvMatch[3] || '').toLowerCase();

    if (!GECKO_NETWORK_RE.test(network)) {
      return json(
        {
          status: 'error',
          code: 'BAD_NETWORK',
          message: 'Invalid network id (use lowercase letters, digits, underscore)',
        },
        400,
        origin,
      );
    }
    if (!isValidGeckoAddress(address)) {
      return json(
        {
          status: 'error',
          code: 'BAD_ADDRESS',
          message:
            'Invalid pool address (EVM 0x+40 hex or Solana-style base58 32–48 chars)',
        },
        400,
        origin,
      );
    }
    if (!GECKO_TIMEFRAME_RE.test(timeframe)) {
      return json(
        {
          status: 'error',
          code: 'BAD_TIMEFRAME',
          message: 'Invalid timeframe (use day, hour, or minute)',
        },
        400,
        origin,
      );
    }

    const qs = pickQuery(req, GECKO_OHLCV_QUERY_KEYS);
    const addrKey = address.toLowerCase().startsWith('0x')
      ? address.toLowerCase()
      : address;
    const cacheKey = `gecko:ohlcv:${network}:${addrKey}:${timeframe}:${qs}`;
    const upstream = `${GECKO_UPSTREAM}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(address)}/ohlcv/${encodeURIComponent(timeframe)}${qs}`;
    return proxyJson(cacheKey, upstream, origin, GECKO_OHLCV_TTL_MS, 'GeckoTerminal');
  }

  // Reject other /api/onchain/gecko/* paths explicitly
  if (pathname.startsWith('/api/onchain/gecko')) {
    return json(
      {
        status: 'error',
        code: 'NOT_FOUND',
        message: `Unknown GeckoTerminal path ${pathname}`,
        hint:
          'Use /api/onchain/gecko/networks/:network/pools/:address/ohlcv/:timeframe or /api/onchain/gecko/search/pools',
      },
      404,
      origin,
    );
  }

  return json(
    {
      status: 'error',
      code: 'NOT_FOUND',
      message: `Unknown on-chain path ${pathname}`,
      hint:
        'Use /api/onchain/health, /api/onchain/llama/…, or /api/onchain/gecko/…',
    },
    404,
    origin,
  );
}

/** Test helper — clear isolate memory cache. */
export function _resetOnchainCacheForTests(): void {
  memCache.clear();
}
