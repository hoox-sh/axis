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
 * Shared Worker HTTP helpers: CORS headers, JSON responses, error envelopes,
 * client IP resolution.
 *
 * Extracted from per-module copies that had drifted apart:
 * `index.ts` (CORS_HEADERS / jsonResponse), `onchain.ts` (corsHeaders / json),
 * `market.ts` (corsHeaders / json), `git-oauth.ts` (json), `scripts.ts`
 * (corsJson), `runtime.ts` (jsonError).
 *
 * Header **values are preserved verbatim** per call site so this stays a pure
 * refactor — `worker/tests/http.test.ts` pins them.
 *
 * @module worker/http
 */

import { WORKER_VERSION } from './version';

/** Allowed request headers, narrowest set used by on-chain / scripts routes. */
const BASE_HEADERS = 'Content-Type, Authorization, X-Admin-Token, If-Match';

/** Adds signed-exchange credentials (`X-Exchange-*`) for `/api/market`. */
const EXCHANGE_HEADERS = `${BASE_HEADERS}, X-Exchange-Key, X-Exchange-Secret, X-Exchange-Passphrase`;

/** Everything, including MCP stream-replay headers (`Last-Event-ID`, …). */
const FULL_HEADERS = `${EXCHANGE_HEADERS}, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID`;

/** Read-only public proxy routes. */
const READ_METHODS = 'GET, OPTIONS';

/** Mutating routes (scripts PUT/DELETE, OAuth device flow, `/api/run`). */
const WRITE_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

export interface CorsOptions {
  /** `Access-Control-Allow-Methods`. Defaults to {@link READ_METHODS}. */
  methods?: string;
  /** `Access-Control-Allow-Headers`. Defaults to {@link BASE_HEADERS}. */
  allowHeaders?: string;
  /** `Access-Control-Max-Age` in seconds. Pass `0` to omit the header. */
  maxAge?: number;
  /** Emit `Vary: Origin`. Default `true`. */
  vary?: boolean;
}

/** `Access-Control-*` header set for a resolved origin. */
export function corsHeaders(origin: string, opts: CorsOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': opts.methods ?? READ_METHODS,
    'Access-Control-Allow-Headers': opts.allowHeaders ?? BASE_HEADERS,
  };
  if (opts.maxAge !== 0) headers['Access-Control-Max-Age'] = String(opts.maxAge ?? 86_400);
  if (opts.vary !== false) headers.Vary = 'Origin';
  return headers;
}

/**
 * Origin echo only — no preflight metadata.
 *
 * For authenticated POST routes where the browser never needs a preflight
 * (`/api/run`, `/api/keys`) and the extra headers would only be noise.
 * Carries `Vary: Origin` because the ACAO value depends on the request Origin.
 */
export const ORIGIN_ONLY = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Vary': 'Origin',
});

/** On-chain proxy CORS: read-only methods, no exchange or MCP headers. */
export const READ_CORS = (origin: string): Record<string, string> => corsHeaders(origin);

/** Market proxy CORS: read-only methods plus signed-exchange credentials. */
export const MARKET_CORS = (origin: string): Record<string, string> =>
  corsHeaders(origin, { allowHeaders: EXCHANGE_HEADERS });

/** Scripts / OAuth CORS: mutating methods, no exchange or MCP headers. */
export const WRITE_CORS = (origin: string): Record<string, string> =>
  corsHeaders(origin, { methods: WRITE_METHODS });

/** MCP transport headers: `GET`/`POST`/`DELETE` per Streamable HTTP, plus session ids. */
const MCP_HEADERS =
  'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID, X-Admin-Token';

/** Streamable-HTTP MCP transport CORS. */
export const MCP_CORS = (origin: string): Record<string, string> => ({
  ...corsHeaders(origin, {
    methods: 'GET, POST, DELETE, OPTIONS',
    allowHeaders: MCP_HEADERS,
    maxAge: 0,
  }),
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id',
});

/** Script library CORS: mutating methods, no preflight caching hints. */
export const SCRIPTS_CORS = (origin: string): Record<string, string> =>
  corsHeaders(origin, { methods: WRITE_METHODS, maxAge: 0 });

/** Top-level dispatcher CORS: every header the Worker understands. */
export const API_CORS = (origin: string): Record<string, string> =>
  corsHeaders(origin, { methods: WRITE_METHODS, allowHeaders: FULL_HEADERS });

export interface JsonOptions {
  status?: number | undefined;
  origin?: string | undefined;
  /** CORS header set for `origin`. Omit for no CORS (e.g. WebSocket upgrade). */
  cors?: ((origin: string) => Record<string, string>) | undefined;
  /** Merged last so callers can add or override headers. */
  headers?: Record<string, string> | undefined;
}

/** `Response` with a JSON body, optional CORS, optional extra headers. */
export function jsonResponse(body: unknown, opts: JsonOptions = {}): Response {
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.origin && opts.cors ? opts.cors(opts.origin) : {}),
      ...(opts.headers || {}),
    },
  });
}

/** Canonical error envelope shared by every Worker route. */
export interface ErrorBody {
  status: 'error';
  code: string;
  message?: string;
}

export function errorBody(code: string, message?: string): ErrorBody {
  return message === undefined ? { status: 'error', code } : { status: 'error', code, message };
}

/** {@link errorBody} as a `Response`. */
export function errorResponse(code: string, message: string | undefined, opts: JsonOptions = {}): Response {
  return jsonResponse(errorBody(code, message), { ...opts, status: opts.status ?? 400 });
}

export interface ErrorResponseOptions extends JsonOptions {
  status?: number;
}

/** `METHOD` rejection for routes that only accept one verb. */
export function methodNotAllowed(allowed: string, opts: JsonOptions = {}): Response {
  return jsonResponse(errorBody('METHOD', `${allowed} required`), {
    ...opts,
    status: 405,
    headers: { ...(opts.headers || {}), Allow: allowed },
  });
}

/** Preflight / bare CORS 204. */
export function preflight(cors: (origin: string) => Record<string, string>, origin: string): Response {
  return new Response(null, { status: 204, headers: cors(origin) });
}

/**
 * Best-effort caller IP for rate limiting.
 *
 * Uses Cloudflare's `CF-Connecting-IP` only. `X-Forwarded-For` is
 * client-spoofable and must not feed rate buckets (A18).
 */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/**
 * Read a JSON body with a fail-closed byte cap.
 *
 * Checks `Content-Length` before touching the stream, then caps the buffered
 * read — bodies are never fully parsed before the size check (A9).
 * Parse failures resolve to `{ ok: true, value: null }` so callers keep their
 * existing empty-body handling; over-cap resolves to `{ ok: false }` (413).
 */
export async function readCappedJson(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const cl = req.headers.get('content-length');
  if (cl !== null && cl !== '') {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false };
  }
  let buf: ArrayBuffer;
  try {
    buf = await req.arrayBuffer();
  } catch {
    return { ok: true, value: null };
  }
  if (buf.byteLength > maxBytes) return { ok: false };
  if (buf.byteLength === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: true, value: null };
  }
}

/** Binding presence flags for the shared `/health` body. */
export interface HealthFlags {
  db: boolean;
  keys: boolean;
  mcpBridge: boolean;
}

/**
 * Single shared `/health` body builder (A22) — the entry `fetch` and the MCP
 * `axis_request` proxy must not drift apart.
 */
export function buildHealthBody(flags: HealthFlags): unknown {
  return {
    status: 'healthy',
    service: 'worker-axis',
    version: WORKER_VERSION,
    timestamp: Date.now(),
    features: {
      scripts: true,
      d1: flags.db,
      keys: flags.keys,
      onchain: true,
      market: true,
      mcp: true,
      mcpBridge: flags.mcpBridge,
    },
  };
}