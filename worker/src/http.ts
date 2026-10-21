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
 * Every route answers through these helpers. A route picks its CORS policy
 * once — {@link scopedJson} binds a builder to that policy — so a route can
 * never answer with another route's headers by accident, and the error
 * envelope has exactly one shape across the Worker.
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
  Vary: 'Origin',
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

/**
 * A response builder bound to one CORS policy.
 *
 * The policy is fixed when the builder is created, so a route cannot answer
 * with another route's headers by accident.
 */
export type JsonBuilder = (
  body: unknown,
  status?: number,
  origin?: string,
  headers?: Record<string, string>,
) => Response;

/** Bind {@link jsonResponse} to one CORS policy. */
export function scopedJson(cors: (origin: string) => Record<string, string>): JsonBuilder {
  return (body, status = 200, origin, headers) =>
    jsonResponse(body, {
      status,
      ...(origin ? { origin, cors } : {}),
      ...(headers ? { headers } : {}),
    });
}

/**
 * A JSON builder with **no** CORS.
 *
 * For WebSocket-adjacent replies, where the socket is the transport and a
 * preflight would be meaningless.
 */
export const plainJson: JsonBuilder = (body, status = 200) => jsonResponse(body, { status });

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
export function errorResponse(
  code: string,
  message: string | undefined,
  opts: JsonOptions = {},
): Response {
  return jsonResponse(errorBody(code, message), { ...opts, status: opts.status ?? 400 });
}

export interface ErrorResponseOptions extends JsonOptions {
  status?: number;
}

/** Options for {@link handleError}. */
export interface HandleErrorOptions {
  /** Request path, echoed into the server-side log record only. */
  path?: string;
  /** Resolved origin — echoed in `Access-Control-Allow-Origin`. */
  origin?: string;
  /** CORS header set for the resolved origin. */
  cors?: (origin: string) => Record<string, string>;
  /** Extra headers for the response (e.g. `Retry-After`). */
  headers?: Record<string, string>;
  /** Extra fields merged into the server-side log record. */
  log?: Record<string, unknown>;
}

/**
 * Server-side log + canonical 500 envelope for an uncaught handler error.
 *
 * Every Worker route funnels its failures through here so no path can escape
 * as an unhandled rejection (A8). The error text is **never** reflected to the
 * caller — it goes to the server-side log line only.
 */
export function handleError(err: unknown, opts: HandleErrorOptions = {}): Response {
  console.error(
    JSON.stringify({
      type: 'worker_internal',
      path: opts.path ?? '',
      error: err instanceof Error ? err.message : String(err),
      ...(opts.log || {}),
    }),
  );
  return errorResponse('INTERNAL', 'internal error', {
    status: 500,
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.cors ? { cors: opts.cors } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
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
export function preflight(
  cors: (origin: string) => Record<string, string>,
  origin: string,
): Response {
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

/* ------------------------------------------------------------------------- *
 * Upstream fetch (market + on-chain proxies)
 *
 * Workerd implements only `redirect: "follow"` and `redirect: "manual"`.
 * `redirect: "error"` throws a TypeError at the edge, so every proxied call
 * returned 502 `UPSTREAM_NETWORK` in production while the whole Bun test suite
 * stayed green (undici does support "error"). Refuse redirects with `manual` +
 * an explicit 3xx check so the A10 intent survives on every runtime.
 * ------------------------------------------------------------------------- */

/** Why an upstream call failed. Safe to hand back to a client. */
export type UpstreamReason = 'network' | 'timeout' | 'redirect';

export interface UpstreamResult {
  status: number;
  text: string;
  contentType: string;
}

/** Client-safe text per reason — never leak raw runtime/undici messages. */
const REASON_TEXT: Record<UpstreamReason, string> = {
  network: 'upstream unreachable',
  timeout: 'upstream timed out',
  redirect: 'upstream redirect refused',
};

/** Error thrown by {@link fetchUpstreamJson}; `reason` is the only safe field. */
export class UpstreamError extends Error {
  readonly reason: UpstreamReason;
  constructor(reason: UpstreamReason) {
    super(REASON_TEXT[reason]);
    this.name = 'UpstreamError';
    this.reason = reason;
  }
}

/** Reduce any thrown value to a client-safe phrase (A23 — no error-text leak). */
export function upstreamReason(err: unknown): UpstreamReason {
  if (err instanceof UpstreamError) return err.reason;
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  return 'network';
}

/** `{ reason }` suffix callers append to a provider label. */
export function upstreamDetail(err: unknown): string {
  return REASON_TEXT[upstreamReason(err)];
}

/** `manual` + explicit 3xx rejection — the only redirect mode workerd accepts. */
function assertNoRedirect(res: Response): void {
  // workerd surfaces the real 3xx under `manual`; a browser-style runtime hides it
  // behind `opaqueredirect`. Cover both so no runtime can slip a redirect through.
  const type = res.type as string;
  if (type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new UpstreamError('redirect');
  }
}

export interface UpstreamFetchOptions {
  /** Abort the whole call (headers + body) after this many ms. */
  timeoutMs: number;
  /** Extra request headers (e.g. `X-MBX-APIKEY`). */
  headers?: Record<string, string>;
  /**
   * Verbs to allow. Reachability probes use `HEAD` — DefiLlama's cheapest GET is
   * still ~9 MB, which must never be fetched just to answer "is this peer up?".
   */
  method?: 'GET' | 'HEAD';
}

/** Read `res`, or release the connection instead of buffering a huge body. */
async function drain(res: Response, method: 'GET' | 'HEAD' | undefined): Promise<string> {
  if (method !== 'HEAD') return res.text();
  try {
    await res.body?.cancel();
  } catch {
    /* already consumed or closed */
  }
  return '';
}

/**
 * GET a fixed allowlisted upstream URL and buffer its body.
 *
 * Never follows redirects (A10), caps the time to headers *and* body
 * (A10 — a stalled sender must not pin the isolate), and throws
 * {@link UpstreamError} rather than leaking runtime text.
 */
export async function fetchUpstreamJson(
  url: string,
  opts: UpstreamFetchOptions,
): Promise<UpstreamResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const method = opts.method ?? 'GET';
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
    });
    assertNoRedirect(res);
    // Body read stays inside the abort window (A10).
    const text = await drain(res, method);
    return {
      status: res.status,
      text,
      contentType: res.headers.get('Content-Type') || 'application/json',
    };
  } catch (err) {
    throw err instanceof UpstreamError ? err : new UpstreamError(upstreamReason(err));
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- *
 * Upstream reachability (health plane)
 * ------------------------------------------------------------------------- */

/** Last-known reachability per upstream host, for `/health` deep checks. */
interface Reachability {
  ok: boolean;
  at: number;
  detail: string;
}

const reachability = new Map<string, Reachability>();

/** @internal test helper — drop cached reachability between cases. */
export function _resetUpstreamHealthForTests(): void {
  reachability.clear();
}

/** Snapshot of cached reachability, newest state per host. */
export function upstreamHealth(): Record<
  string,
  { ok: boolean; checkedAt: number; detail: string }
> {
  const out: Record<string, { ok: boolean; checkedAt: number; detail: string }> = {};
  for (const [host, r] of reachability) out[host] = { ok: r.ok, checkedAt: r.at, detail: r.detail };
  return out;
}

/**
 * Probe one upstream host with a short timeout and cache the verdict.
 *
 * Health must not report `market` / `onchain` as up purely because the route is
 * registered — a green flag while every proxy call 502s is the failure mode this
 * replaces. Results are cached so `/health` stays cheap and self-limiting.
 */
export async function probeUpstream(
  host: string,
  url: string,
  timeoutMs = 4_000,
): Promise<Reachability> {
  try {
    // `HEAD` — a reachability check must not buffer a 9 MB protocol list.
    const res = await fetchUpstreamJson(url, { timeoutMs, method: 'HEAD' });
    // 4xx still proves the peer answered; only a network/timeout failure is "down".
    const ok = res.status < 500;
    const r: Reachability = { ok, at: Date.now(), detail: ok ? 'ok' : `HTTP ${res.status}` };
    reachability.set(host, r);
    return r;
  } catch (err) {
    const r: Reachability = { ok: false, at: Date.now(), detail: REASON_TEXT[upstreamReason(err)] };
    reachability.set(host, r);
    return r;
  }
}

/** Binding presence flags for the shared `/health` body. */
export interface HealthFlags {
  db: boolean;
  keys: boolean;
  mcpBridge: boolean;
}

/** Deep-probe opt-in for `/health?deep=1` — upstream egress costs a fetch. */
export type DeepHealth = { deep: true; report: Record<string, { ok: boolean; detail: string }> };

/**
 * Single shared `/health` body builder (A22) — the entry `fetch` and the MCP
 * `axis_request` proxy must not drift apart.
 *
 * `market` / `onchain` stay route-registration flags unless a deep probe ran;
 * `upstream` then carries the live verdict so a dead proxy can never read green.
 */
export function buildHealthBody(flags: HealthFlags, deep?: DeepHealth): unknown {
  const features: Record<string, boolean> = {
    scripts: true,
    d1: flags.db,
    keys: flags.keys,
    onchain: true,
    market: true,
    mcp: true,
    mcpBridge: flags.mcpBridge,
  };
  const upstreams = deep ? Object.entries(deep.report) : [];
  const degraded = upstreams.some(([, r]) => !r.ok);
  if (deep && upstreams.length > 0) {
    // Only downgrade on a host that was actually probed and failed.
    features.onchain =
      deep.report['defillama']?.ok !== false && deep.report['geckoterminal']?.ok !== false;
    features.market = deep.report['binance']?.ok !== false && deep.report['mexc']?.ok !== false;
  }
  return {
    status: degraded ? 'degraded' : 'healthy',
    service: 'worker-axis',
    version: WORKER_VERSION,
    timestamp: Date.now(),
    features,
    ...(deep ? { upstream: deep.report } : {}),
  };
}
