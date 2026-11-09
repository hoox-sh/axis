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
import {
  READ_CORS,
  clientIp,
  errorBody,
  fetchUpstreamJson,
  scopedJson,
  upstreamDetail,
  upstreamReason,
  type JsonBuilder,
  type UpstreamReason,
} from './http';
import { allowRate } from './rate-limit';
import { createProxyRouter } from './proxy-router';
import { createProxyPlane } from './proxy-plane';

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

/** Shared per-IP window for gecko + per-protocol TVL (health is unmetered). */
export const ONCHAIN_IP_LIMIT = 120;
export const ONCHAIN_IP_WINDOW_MS = 60_000;

/**
 * Dedicated budget for the DefiLlama protocols list. Ten full list fetches
 * per IP per minute; advertised on the response (`RateLimit-Limit`).
 */
export const LLAMA_PROTOCOLS_RATE_LIMIT = 10;
export const LLAMA_PROTOCOLS_RATE_WINDOW_MS = 60_000;

/** Guest-facing slim list cap — never emit the raw ~9.5 MB dump. */
export const LLAMA_PROTOCOLS_RESPONSE_MAX_BYTES = 1 * 1024 * 1024;

/** Upstream read budget so we can slim once; still fail-closed. */
export const LLAMA_PROTOCOLS_UPSTREAM_MAX_BYTES = 16 * 1024 * 1024;

/** Default on-chain upstream body cap (gecko / per-protocol TVL). */
export const ONCHAIN_UPSTREAM_MAX_BYTES = 8 * 1024 * 1024;

const GECKO_OHLCV_QUERY_KEYS = [
  'aggregate',
  'limit',
  'currency',
  'before_timestamp',
] as const;

const GECKO_SEARCH_QUERY_KEYS = ['query', 'network', 'page', 'include'] as const;

const json: JsonBuilder = scopedJson(READ_CORS);

/**
 * The on-chain proxy plane.
 *
 * It states its differences — the cache header, the eviction policy, the
 * upstream transport — and shares the cache, the coalescing and the response
 * builder with the market plane.
 */
const plane = createProxyPlane({
  cors: READ_CORS,
  cacheHeader: 'X-Axis-Onchain-Cache',
  maxEntries: 64,
  // Soft cap — drop oldest-ish by clearing all when huge
  eviction: 'clear',
  fetchUpstream: (url) =>
    fetchUpstreamJson(url, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      headers: { 'User-Agent': 'axis-worker-onchain/1.0' },
      maxBytes: ONCHAIN_UPSTREAM_MAX_BYTES,
    }),
  json: (body, status, origin, headers) => json(body, status, origin, headers),
});

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

type UpstreamOutcome =
  | { kind: 'response'; status: number; ok: boolean; text: string; contentType: string }
  | { kind: 'network-error'; message: string; reason: UpstreamReason };

function tooLargeResponse(origin: string): Response {
  return json(
    errorBody('PAYLOAD_TOO_LARGE', 'Upstream response exceeds size cap'),
    413,
    origin,
  );
}

function llamaProtocolsRateHeaders(): Record<string, string> {
  return {
    'RateLimit-Limit': String(LLAMA_PROTOCOLS_RATE_LIMIT),
    'RateLimit-Policy': `${LLAMA_PROTOCOLS_RATE_LIMIT};w=${LLAMA_PROTOCOLS_RATE_WINDOW_MS / 1000}`,
  };
}

interface LlamaProtocolSummary {
  slug: string;
  name: string;
  tvl?: number;
  category?: string;
}

/** Shrink DefiLlama `/protocols` to the search fields the PWA actually uses. */
export function slimLlamaProtocols(raw: string, maxBytes: number): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rows: LlamaProtocolSummary[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const slugRaw = typeof rec['slug'] === 'string' ? rec['slug'] : typeof rec['name'] === 'string' ? rec['name'] : '';
    const slug = slugRaw.trim().toLowerCase();
    if (!slug || slug.length > 128 || !SLUG_RE.test(slug)) continue;
    const name = typeof rec['name'] === 'string' && rec['name'].trim() ? rec['name'].trim() : slug;
    const tvl = Number(rec['tvl']);
    const row: LlamaProtocolSummary = { slug, name };
    if (Number.isFinite(tvl)) row.tvl = tvl;
    if (typeof rec['category'] === 'string' && rec['category'].length > 0 && rec['category'].length <= 64) {
      row.category = rec['category'];
    }
    rows.push(row);
  }
  rows.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  return fitJsonBytes(rows, maxBytes);
}

function fitJsonBytes(rows: LlamaProtocolSummary[], maxBytes: number): string {
  const encode = (value: LlamaProtocolSummary[]) => JSON.stringify(value);
  let n = rows.length;
  let text = encode(rows);
  let bytes = new TextEncoder().encode(text).byteLength;
  if (bytes <= maxBytes) return text;
  while (n > 0 && bytes > maxBytes) {
    const ratio = maxBytes / bytes;
    const next = Math.max(0, Math.min(n - 1, Math.floor(n * ratio * 0.95)));
    n = next;
    text = encode(rows.slice(0, n));
    bytes = new TextEncoder().encode(text).byteLength;
  }
  return n > 0 ? text : '[]';
}

/** Keep cache keys bounded: client-controlled values are truncated (A5). */
function keyPart(s: string): string {
  return s.length > 256 ? s.slice(0, 256) : s;
}

async function proxyUpstream(
  cacheKey: string,
  upstreamUrl: string,
  origin: string,
  ttlMs: number,
  providerLabel = 'Upstream',
): Promise<Response> {
  const hit = plane.get(cacheKey);
  if (hit) return plane.cachedResponse(hit, origin, 'HIT');

  // Coalesce concurrent identical upstream fetches (A5) — one flight per key.
  const up = await plane.coalesce(cacheKey, async (): Promise<UpstreamOutcome> => {
    try {
      const up = await plane.fetch(upstreamUrl);
      return {
        kind: 'response',
        status: up.status,
        ok: up.status >= 200 && up.status < 300,
        text: up.text,
        contentType: up.contentType,
      };
    } catch (err) {
      // Client-safe phrase only — raw runtime text never leaves the isolate.
      return { kind: 'network-error', message: upstreamDetail(err), reason: upstreamReason(err) };
    }
  });

  if (up.kind === 'network-error') {
    if (up.reason === 'too-large') return tooLargeResponse(origin);
    return json(
      errorBody('UPSTREAM_NETWORK', `${providerLabel} upstream unreachable: ${up.message}`),
      502,
      origin,
    );
  }

  // Cache successful and 404 bodies briefly (404 avoids stampede on bad paths)
  if (up.ok || up.status === 404) {
    plane.put(cacheKey, {
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

async function proxyLlamaProtocols(req: Request, origin: string): Promise<Response> {
  const ip = clientIp(req);
  const rateHeaders = llamaProtocolsRateHeaders();
  if (!allowRate(`onchain:llama-protocols:${ip}`, LLAMA_PROTOCOLS_RATE_LIMIT, LLAMA_PROTOCOLS_RATE_WINDOW_MS)) {
    return json(errorBody('RATE_LIMIT', 'Too many DefiLlama protocol-list requests'), 429, origin, {
      'Retry-After': String(Math.ceil(LLAMA_PROTOCOLS_RATE_WINDOW_MS / 1000)),
      ...rateHeaders,
    });
  }

  const cacheKey = 'llama:protocols:slim';
  const hit = plane.get(cacheKey);
  if (hit) {
    const cached = plane.cachedResponse(hit, origin, 'HIT');
    for (const [k, v] of Object.entries(rateHeaders)) cached.headers.set(k, v);
    return cached;
  }

  const up = await plane.coalesce(cacheKey, async (): Promise<UpstreamOutcome> => {
    try {
      const fetched = await fetchUpstreamJson(`${LLAMA_UPSTREAM}/protocols`, {
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        headers: { 'User-Agent': 'axis-worker-onchain/1.0' },
        maxBytes: LLAMA_PROTOCOLS_UPSTREAM_MAX_BYTES,
      });
      if (fetched.status === 404) {
        return {
          kind: 'response',
          status: 404,
          ok: false,
          text: fetched.text,
          contentType: fetched.contentType,
        };
      }
      if (!(fetched.status >= 200 && fetched.status < 300)) {
        return {
          kind: 'response',
          status: fetched.status,
          ok: false,
          text: fetched.text,
          contentType: fetched.contentType,
        };
      }
      const slim = slimLlamaProtocols(fetched.text, LLAMA_PROTOCOLS_RESPONSE_MAX_BYTES);
      if (slim === null) {
        return { kind: 'network-error', message: 'upstream unreachable', reason: 'network' };
      }
      return {
        kind: 'response',
        status: 200,
        ok: true,
        text: slim,
        contentType: 'application/json',
      };
    } catch (err) {
      return { kind: 'network-error', message: upstreamDetail(err), reason: upstreamReason(err) };
    }
  });

  if (up.kind === 'network-error') {
    if (up.reason === 'too-large') return tooLargeResponse(origin);
    return json(
      errorBody('UPSTREAM_NETWORK', `DefiLlama upstream unreachable: ${up.message}`),
      502,
      origin,
      rateHeaders,
    );
  }

  if (up.ok || up.status === 404) {
    plane.put(cacheKey, {
      body: up.text,
      status: up.status,
      contentType: up.contentType,
      expiresAt: Date.now() + PROTOCOLS_TTL_MS,
    });
  }

  return new Response(up.text, {
    status: up.status,
    headers: {
      'Content-Type': up.contentType,
      'X-Axis-Onchain-Cache': 'MISS',
      ...READ_CORS(origin),
      ...rateHeaders,
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
  // Health JSON stays unmetered; llama/protocols has its own tighter bucket.
  ipLimit: { limit: ONCHAIN_IP_LIMIT, windowMs: ONCHAIN_IP_WINDOW_MS, skipHealth: true },
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
    cache: { entries: plane.size },
  }),
  routes: [
    {
      path: '/llama/protocols',
      handle: ({ req, origin }) => proxyLlamaProtocols(req, origin),
    },
    {
      match: /^\/llama\/protocol\/([^/]+)\/?$/,
      label: '/llama/protocol/:slug',
      handle: ({ origin, params }) => {
        const slug = decodePathSegment(params[0] || '');
        if (!SLUG_RE.test(slug)) {
          return json(
            errorBody('BAD_SLUG', 'Invalid protocol slug (use letters, digits, ._- only)'),
            400,
            origin,
          );
        }
        const normalized = slug.toLowerCase();
        return proxyUpstream(
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
        return proxyUpstream(
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
            errorBody('BAD_NETWORK', 'Invalid network id (use lowercase letters, digits, underscore)'),
            400,
            origin,
          );
        }
        if (!isValidGeckoAddress(address)) {
          return json(
            errorBody('BAD_ADDRESS', 'Invalid pool address (EVM 0x+40 hex or Solana-style base58 32–48 chars)'),
            400,
            origin,
          );
        }
        if (!GECKO_TIMEFRAME_RE.test(timeframe)) {
          return json(
            errorBody('BAD_TIMEFRAME', 'Invalid timeframe (use day, hour, or minute)'),
            400,
            origin,
          );
        }

        const qs = pickQuery(req, GECKO_OHLCV_QUERY_KEYS);
        const addrKey = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : address;
        const upstream = `${GECKO_UPSTREAM}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(address)}/ohlcv/${encodeURIComponent(timeframe)}${qs}`;
        return proxyUpstream(
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
          { ...errorBody('NOT_FOUND', `Unknown GeckoTerminal path ${pathname}`), hint: 'Use /api/onchain/gecko/networks/:network/pools/:address/ohlcv/:timeframe or /api/onchain/gecko/search/pools' },
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
  plane._resetCache();
}
