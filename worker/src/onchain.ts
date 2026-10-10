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
import { READ_CORS, jsonResponse } from './http';
import { createProxyRouter } from './proxy-router';

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

function json(
  body: unknown,
  status: number,
  origin: string,
  extra?: Record<string, string>,
): Response {
  return jsonResponse(body, { status, origin, cors: READ_CORS, headers: extra });
}

function cachedResponse(entry: CacheEntry, origin: string, cacheStatus: string): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      'Content-Type': entry.contentType || 'application/json',
      'X-Axis-Onchain-Cache': cacheStatus,
      ...READ_CORS(origin),
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

async function fetchUpstream(url: string): Promise<{ status: number; text: string; contentType: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      // Never follow a cross-origin redirect with the caller's implied trust (A10).
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'axis-worker-onchain/1.0',
      },
    });
    // Body read stays inside the abort window — a stalled sender must not pin
    // the isolate after headers resolve (A10).
    const text = await res.text();
    return { status: res.status, text, contentType: res.headers.get('Content-Type') || 'application/json' };
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

/** Coalesce concurrent identical upstream fetches (A5) — one flight per cache key. */
const inflight = new Map<string, Promise<UpstreamOutcome>>();

type UpstreamOutcome =
  | { kind: 'response'; status: number; ok: boolean; text: string; contentType: string }
  | { kind: 'network-error'; message: string };

/** Keep cache keys bounded: client-controlled values are truncated (A5). */
function keyPart(s: string): string {
  return s.length > 256 ? s.slice(0, 256) : s;
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

  let pending = inflight.get(cacheKey);
  if (!pending) {
    pending = (async (): Promise<UpstreamOutcome> => {
      try {
        const up = await fetchUpstream(upstreamUrl);
        return {
          kind: 'response',
          status: up.status,
          ok: up.status >= 200 && up.status < 300,
          text: up.text,
          contentType: up.contentType,
        };
      } catch (err) {
        return { kind: 'network-error', message: err instanceof Error ? err.message : String(err) };
      }
    })();
    inflight.set(cacheKey, pending);
    const done = pending;
    void done.finally(() => {
      if (inflight.get(cacheKey) === done) inflight.delete(cacheKey);
    });
  }
  const up = await pending;

  if (up.kind === 'network-error') {
    return json(
      {
        status: 'error',
        code: 'UPSTREAM_NETWORK',
        message: `${providerLabel} upstream unreachable: ${up.message}`,
      },
      502,
      origin,
    );
  }

  // Cache successful and 404 bodies briefly (404 avoids stampede on bad paths)
  if (up.ok || up.status === 404) {
    putCached(cacheKey, {
      body: up.text,
      status: up.status,
      contentType: up.contentType,
      expiresAt: Date.now() + ttlMs,
    });
  }

  return new Response(up.text, {
    status: up.status,
    headers: {
      'Content-Type': up.contentType,
      'X-Axis-Onchain-Cache': 'MISS',
      ...READ_CORS(origin),
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
 * On-chain allowlist. Order matters: `/gecko/*` is a family fallback and sits
 * after the two concrete GeckoTerminal routes so they keep winning.
 */
const ROUTER = createProxyRouter({
  prefix: '/api/onchain',
  cors: READ_CORS,
  // Public, unauthenticated — per-IP window is the only abuse backstop (A5).
  ipLimit: { limit: 120, windowMs: 60_000 },
  health: () => ({
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
  }),
  routes: [
    {
      path: '/llama/protocols',
      handle: ({ origin }) =>
        proxyJson('llama:protocols', `${LLAMA_UPSTREAM}/protocols`, origin, PROTOCOLS_TTL_MS, 'DefiLlama'),
    },
    {
      match: /^\/llama\/protocol\/([^/]+)\/?$/,
      label: '/llama/protocol/:slug',
      handle: ({ origin, params }) => {
        const slug = decodePathSegment(params[0] || '');
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
      },
    },
    {
      path: '/gecko/search/pools',
      handle: ({ req, origin }) => {
        const qs = pickQuery(req, GECKO_SEARCH_QUERY_KEYS);
        return proxyJson(
          `gecko:search:${keyPart(qs)}`,
          `${GECKO_UPSTREAM}/search/pools${qs}`,
          origin,
          GECKO_SEARCH_TTL_MS,
          'GeckoTerminal',
        );
      },
    },
    {
      match: /^\/gecko\/networks\/([^/]+)\/pools\/([^/]+)\/ohlcv\/([^/]+)\/?$/,
      label: '/gecko/networks/:network/pools/:address/ohlcv/:timeframe',
      handle: ({ req, origin, params }) => {
        const network = decodePathSegment(params[0] || '').toLowerCase();
        const address = decodePathSegment(params[1] || '');
        const timeframe = decodePathSegment(params[2] || '').toLowerCase();

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
        const addrKey = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : address;
        const upstream = `${GECKO_UPSTREAM}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(address)}/ohlcv/${encodeURIComponent(timeframe)}${qs}`;
        return proxyJson(
          `gecko:ohlcv:${network}:${keyPart(addrKey)}:${timeframe}:${keyPart(qs)}`,
          upstream,
          origin,
          GECKO_OHLCV_TTL_MS,
          'GeckoTerminal',
        );
      },
    },
    {
      // Family fallback: reject unknown /api/onchain/gecko/* explicitly.
      startsWith: '/gecko',
      handle: ({ origin, req }) => {
        const pathname = new URL(req.url).pathname;
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
      },
    },
  ],
  notFound: {
    message: 'Unknown on-chain path /api/onchain%s',
    extra: { hint: 'Use /api/onchain/health, /api/onchain/llama/…, or /api/onchain/gecko/…' },
  },
});

/** Accepted on-chain paths, for docs and allowlist tests. */
export function onchainAllowlist(): string[] {
  return ROUTER.allowedPaths();
}

/**
 * Handle `/api/onchain/*` routes. Returns `null` if the path is not on-chain.
 */
export function handleOnchain(
  req: Request,
  _env: Env,
  origin: string,
  pathname: string,
): Promise<Response> | null {
  return ROUTER.handle(req, origin, pathname);
}

/** Test helper — clear isolate memory cache. */
export function _resetOnchainCacheForTests(): void {
  memCache.clear();
  inflight.clear();
}
