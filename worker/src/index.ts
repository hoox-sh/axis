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
 * AXIS Cloudflare Worker entrypoint — JSON API + WebSocket relay for the charting PWA.
 *
 * Runs beside the static PWA (Cloudflare Pages or any static host). CORS echoes
 * local-dev Origins (`localhost` / `127.0.0.1`) and otherwise uses `ALLOWED_ORIGIN`.
 *
 * ## Routes
 * | Method / path        | Handler              | Auth / notes |
 * |----------------------|----------------------|--------------|
 * | GET `/`, `/health`   | health JSON          | public; reports D1/KV binding presence |
 * | POST `/api/run`      | {@link handleRun}    | auth when API_KEYS / REQUIRE_RUN_AUTH; always rate-limited; body caps |
 * | `/api/keys`          | {@link handleKeys}   | create needs `X-Admin-Token`; validate uses Bearer/`?key=` |
 * | GET `/api/usage`     | stub usage           | public placeholder |
 * | `/api/scripts…`      | {@link handleScripts}| Bearer API key; D1 or in-memory |
 * | `/api/git/oauth/…`   | {@link handleGitOAuth}| public; device-flow proxy (GitHub/GitLab) |
 * | `/api/onchain/…`     | {@link handleOnchain}| public; DefiLlama + GeckoTerminal allowlisted proxy |
 * | `/api/market/…`      | {@link handleMarket}| public Binance + MEXC GET proxy; optional request-scoped signed Binance klines |
 * | GET `/api/stream`    | SessionDO upgrade    | requires `SESSIONS` DO binding; `hx_live_…` verifies live (`axis:stream`) + meters |
 * | POST `/mcp`          | MCP Streamable HTTP  | Bearer API key (same as scripts) |
 * | GET `/mcp`           | MCP discovery JSON   | public |
 * | GET `/api/mcp/bridge`| McpBridgeDO upgrade  | `?ticket=` (one-time) or Authorization header; `hx_live_…` verifies live; never the long-lived key in the query |
 * | GET `/api/mcp/bridge`| McpBridgeDO /status  | Bearer; no Upgrade header → `{ status, connected }` tab count |
 * | GET `/api/mcp/bridge?issue=ticket` | mint one-time WS ticket | Bearer |
 * | OPTIONS `*`          | CORS preflight       | 204 |
 *
 * ## Bindings (`Env`)
 * - `API_KEYS` (KV) — key records `key:<token>` → `{ tier, createdAt, … }`
 * - `USAGE` (KV) — per-key run counters (`usage:<token>`)
 * - `DB` (D1) — user script library (see `schemas/scripts.sql`)
 * - `BUNDLES` (R2) — reserved for Pyodide/pynescript wheels
 * - `SESSIONS` (DO) — live kline fan-out ({@link SessionDO})
 *
 * Vars: `EXTERNAL_BACKEND`, `ALLOWED_ORIGIN`, `ADMIN_TOKEN`,
 * `PYODIDE_IN_WORKER`, `ALLOW_OPEN_KEYS` (dev-only open auth).
 */

import { handleRun } from './runtime';
import { WORKER_VERSION } from './version';
import { handleKeys } from './keys';
import { handleScripts } from './scripts';
import { handleGitOAuth } from './git-oauth';
import { handleOnchain } from './onchain';
import { handleMarket } from './market';
import { SessionDO } from './durable-objects/session';
import { handleMcp, McpBridgeDO, parseBridgeTicket, formatBridgeTicket } from './mcp';
import { requireApiKey } from './auth';
import { gateTenantKey, meterTenantUsage } from './tenant';
import { API_CORS, errorResponse, jsonResponse, methodNotAllowed, preflight } from './http';

export { SessionDO, McpBridgeDO };

/** Worker bindings and wrangler `[vars]` consumed by handlers. All optional for local stubs. */
export interface Env {
  /** KV: API key lookup (`key:<pn_…>` JSON). When unbound, dev accepts well-formed `pn_` keys. */
  API_KEYS?: KVNamespace;
  /** KV: tenant verify cache (`hx:<hash16>` JSON). Optional — verify works without it (L1 + live). */
  TENANT_KEYS?: KVNamespace;
  /** KV: optional per-key `/api/run` call counter. */
  USAGE?: KVNamespace;
  /** D1: scripts + script_drafts tables. When unbound, scripts use process memory. */
  DB?: D1Database;
  /** R2: future pynescript wheel / bundle storage for in-worker Pyodide. */
  BUNDLES?: R2Bucket;
  /** Durable Object namespace for `/api/stream` WebSocket sessions. */
  SESSIONS?: DurableObjectNamespace;
  /** Durable Object namespace for MCP ↔ PWA control-plane WebSockets. */
  MCP_BRIDGE?: DurableObjectNamespace;

  /** Upstream Pine runtime base URL (e.g. local pyne `http://127.0.0.1:5002`). */
  EXTERNAL_BACKEND?: string;
  /** Production browser origin for CORS when request Origin is not local-dev. */
  ALLOWED_ORIGIN?: string;
  /** Shared secret for `/api/keys` create; compared to `X-Admin-Token`. */
  ADMIN_TOKEN?: string;
  /** Set to `"enabled"` to attempt in-worker Pyodide before proxying. */
  PYODIDE_IN_WORKER?: string;
  /** When `"1"` / `"true"`, accept any non-empty Bearer key (local demos only). */
  ALLOW_OPEN_KEYS?: string;
  /**
   * When `"1"` / `"true"`, require API key on `/api/run` even without `API_KEYS` KV.
   * Production should bind `API_KEYS` instead; this flag is for staged hardening.
   */
  REQUIRE_RUN_AUTH?: string;
  /** Public GitHub OAuth App client id (Device Flow enabled). */
  GITHUB_OAUTH_CLIENT_ID?: string;
  /** Public GitLab OAuth application id (device grant). */
  GITLAB_OAUTH_CLIENT_ID?: string;
  /**
   * Console base URL for live `hx_live_…` tenant verify + usage flush
   * (e.g. `https://console.hoox.sh`). Unset = self-host: tenant verify is
   * unavailable and tenant keys fall back to the legacy path (degraded) or
   * fail closed when they have no legacy match.
   */
  CONSOLE_URL?: string;
  /** Service key for usage-flush auth (hash-on-wire tenant hash otherwise). */
  USAGE_SERVICE_KEY?: string;
}

const CORS_HEADERS = API_CORS;

/**
 * Local-dev browser origins (Vite :3000, axis_pwa :8081, arbitrary ports).
 * Match pyne Pro API default: ^https?://(localhost|127.0.0.1)(:\\d+)?$
 *
 * Do **not** allow `http://0.0.0.0:…` — browsers almost never send that Origin,
 * and binding/listening on 0.0.0.0 is unrelated to CORS. Prefer localhost/127.0.0.1.
 */
const LOCAL_DEV_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

/**
 * Production AXIS / HOOX / Pages origins that may call this Worker (on-chain proxy,
 * scripts, run). Echo exact Origin when matched so credential-less browser GETs work
 * from axis.hoox.sh while still rejecting arbitrary third-party sites.
 */
/**
 * Known product hosts only — not open `*.pages.dev` (any third-party Pages
 * project). AXIS Cloudflare Pages project is `axis.pages.dev` (legacy
 * `pynescript-axis.pages.dev` still echoed). Additional preview hosts can
 * be listed in `ALLOWED_ORIGIN`.
 */
const PRODUCT_ORIGIN_RE =
  /^https:\/\/(?:(?:[\w-]+\.)*(?:hoox\.sh|pynescript\.online)|(?:[\w-]+\.)*(?:axis|pynescript-axis)\.pages\.dev)$/i;

/**
 * Resolve `Access-Control-Allow-Origin` for this request.
 * Local-dev and known product Origins are echoed; otherwise fall back to
 * `env.ALLOWED_ORIGIN` or the production default.
 * Exported for unit tests (`worker/tests/cors-origin.test.ts`).
 */
export function pickOrigin(req: Request, env: Env): string {
  const reqOrigin = req.headers.get('Origin') ?? '';
  if (reqOrigin && LOCAL_DEV_ORIGIN_RE.test(reqOrigin)) {
    return reqOrigin;
  }
  if (reqOrigin && PRODUCT_ORIGIN_RE.test(reqOrigin)) {
    return reqOrigin;
  }
  // Comma-separated allowlist in ALLOWED_ORIGIN (e.g. "https://a.com,https://b.com")
  const allowed = String(env.ALLOWED_ORIGIN || 'https://pynescript.online')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (reqOrigin && allowed.includes(reqOrigin)) {
    return reqOrigin;
  }
  return allowed[0] || 'https://pynescript.online';
}

/** JSON body + CORS headers shared by all non-stream routes. */
function apiJson(
  body: unknown,
  status: number,
  origin: string,
  headers?: Record<string, string>,
): Response {
  return jsonResponse(body, { status, origin, cors: CORS_HEADERS, headers });
}

/**
 * Tenant-gate denial as an error envelope (401 / 402 / 429 / 503).
 * `Retry-After` is passed through on console rate limits.
 */
function tenantDeny(
  gate: { status: number; code: string; message: string; retryAfter?: number },
  origin: string,
): Response {
  return errorResponse(gate.code, gate.message, {
    status: gate.status,
    origin,
    cors: CORS_HEADERS,
    ...(gate.retryAfter !== undefined
      ? { headers: { 'Retry-After': String(gate.retryAfter) } }
      : {}),
  });
}

export default {
  /**
   * Single `fetch` entry: CORS → stream DO upgrade → scripts → switch routes.
   * Uncaught handler errors become `{ status:'error', code:'INTERNAL' }` 500s.
   */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = pickOrigin(req, env);
    if (req.method === 'OPTIONS') {
      return preflight(CORS_HEADERS, origin);
    }

    const url = new URL(req.url);

    const mcpRes = await handleMcp(req, env, origin, url.pathname);
    if (mcpRes) return mcpRes;

    // PWA MCP control plane: /api/mcp/bridge → McpBridgeDO (partitioned by API key)
    if (url.pathname === '/api/mcp/bridge') {
      if (!env.MCP_BRIDGE) {
        return errorResponse(
          'NO_MCP_BRIDGE',
          'MCP_BRIDGE Durable Object not bound. Add the binding in wrangler.toml and deploy.',
          { status: 503, origin, cors: CORS_HEADERS },
        );
      }
      const isUpgrade = (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
      const issueTicket = !isUpgrade && url.searchParams.get('issue') === 'ticket';

      if (isUpgrade) {
        const ticket = (url.searchParams.get('ticket') || '').trim();
        let userId: string | null = null;
        let nonce = '';
        let bridgeHeaderDegraded = false;
        if (ticket) {
          const parsed = parseBridgeTicket(ticket);
          if (!parsed) {
            return errorResponse('INVALID_TICKET', 'bridge ticket missing, expired, or already used', {
              status: 401,
              origin,
              cors: CORS_HEADERS,
            });
          }
          userId = parsed.userId;
          nonce = parsed.nonce;
        } else {
          // Browser WebSocket cannot set Authorization — prefer ?ticket=.
          // Header auth remains for tests / non-browser clients. Never ?key=.
          const header = req.headers.get('Authorization') || '';
          if (!/^Bearer\s+\S+/i.test(header)) {
            return errorResponse('NO_KEY', 'bridge ticket or Authorization: Bearer required', {
              status: 401,
              origin,
              cors: CORS_HEADERS,
            });
          }
          // SaaS tenant keys (hx_live_…) verify live against the console
          // (`axis:stream` scope); all other bearers use the legacy path below.
          const headerGate = await gateTenantKey(env, req, 'axis:stream');
          if (headerGate) {
            if (headerGate.decision === 'deny') return tenantDeny(headerGate, origin);
            userId = headerGate.userId;
            bridgeHeaderDegraded = headerGate.degraded;
          } else {
            const authReq = new Request(`${url.origin}${url.pathname}`, {
              headers: { Authorization: header },
            });
            const auth = await requireApiKey(authReq, env);
            if (!auth.ok) {
              return errorResponse(auth.code, auth.message, {
                status: auth.status,
                origin,
                cors: CORS_HEADERS,
              });
            }
            userId = auth.ctx.userId;
          }
        }
        const stub = env.MCP_BRIDGE.get(env.MCP_BRIDGE.idFromName(userId));
        const dest = new URL(`${url.origin}/ws`);
        if (nonce) dest.searchParams.set('ticket', nonce);
        const bridgeUpgradeRes = await stub.fetch(new Request(dest, req));
        // Mutate headers in place: rebuilding the Response would drop the upgrade webSocket.
        if (bridgeHeaderDegraded) bridgeUpgradeRes.headers.set('X-Hoox-Verify', 'degraded');
        return bridgeUpgradeRes;
      }

      // Tenant SaaS keys verify live here too; legacy bearers unchanged.
      let bridgeDegraded = false;
      let bridgeUserId: string | null = null;
      const bridgeGate = await gateTenantKey(env, req, 'axis:stream');
      if (bridgeGate) {
        if (bridgeGate.decision === 'deny') return tenantDeny(bridgeGate, origin);
        bridgeUserId = bridgeGate.userId;
        bridgeDegraded = bridgeGate.degraded;
      } else {
        const auth = await requireApiKey(req, env);
        if (!auth.ok) {
          return errorResponse(auth.code, auth.message, {
            status: auth.status,
            origin,
            cors: CORS_HEADERS,
          });
        }
        bridgeUserId = auth.ctx.userId;
      }
      const stub = env.MCP_BRIDGE.get(env.MCP_BRIDGE.idFromName(bridgeUserId));
      const bridgeHeaders = bridgeDegraded ? { 'X-Hoox-Verify': 'degraded' } : undefined;

      if (issueTicket || req.method === 'POST') {
        const ticketRes = await stub.fetch(new Request(`${url.origin}/ticket`, { method: 'POST' }));
        const payload = (await ticketRes.json()) as { nonce?: unknown; expiresIn?: unknown };
        const nonce = typeof payload.nonce === 'string' ? payload.nonce : '';
        if (!nonce) {
          return errorResponse('TICKET_FAILED', 'failed to mint bridge ticket', {
            status: 502,
            origin,
            cors: CORS_HEADERS,
          });
        }
        const expiresIn =
          typeof payload.expiresIn === 'number' && Number.isFinite(payload.expiresIn)
            ? payload.expiresIn
            : 30;
        return apiJson(
          {
            status: 'ok',
            ticket: formatBridgeTicket(bridgeUserId, nonce),
            expiresIn,
          },
          200,
          origin,
          bridgeHeaders,
        );
      }

      // Plain GET → DO /status: how many PWA tabs are attached to this key.
      const res = await stub.fetch(new Request(`${url.origin}/status`, req));
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS(origin))) headers.set(k, v);
      if (bridgeDegraded) headers.set('X-Hoox-Verify', 'degraded');
      return new Response(res.body, { status: res.status, headers });
    }

    // WebSocket session relay: /api/stream?session=&symbol=&interval= → SessionDO
    // DO is named by `session` query (default "default"); request rewritten to /ws.
    // SaaS tenant keys (hx_live_…) verify live (`axis:stream` scope) and meter
    // one `streams` unit per session create. Open self-host path unchanged:
    // non-tenant callers never touch the console.
    if (url.pathname === '/api/stream') {
      if (!env.SESSIONS) {
        return errorResponse(
          'NO_DO',
          'SESSIONS Durable Object not bound. Run `wrangler deploy` after provisioning.',
          { status: 503, origin, cors: CORS_HEADERS },
        );
      }
      let streamDegraded = false;
      const streamGate = await gateTenantKey(env, req, 'axis:stream');
      if (streamGate) {
        if (streamGate.decision === 'deny') return tenantDeny(streamGate, origin);
        streamDegraded = streamGate.degraded;
        if (!streamDegraded) {
          meterTenantUsage(env, streamGate, 'axis:stream', { streams: 1 }, ctx);
        }
      }
      const id = env.SESSIONS.idFromName(url.searchParams.get('session') ?? 'default');
      const stub = env.SESSIONS.get(id);
      const wsReq = new Request(`${url.origin}/ws?${url.searchParams.toString()}`, req);
      const streamRes = await stub.fetch(wsReq);
      // Mutate headers in place: rebuilding the Response would drop the upgrade webSocket.
      if (streamDegraded) streamRes.headers.set('X-Hoox-Verify', 'degraded');
      return streamRes;
    }

    try {
      // Script library: /api/scripts, /api/scripts/:id, /api/scripts/_draft
      if (url.pathname === '/api/scripts' || url.pathname.startsWith('/api/scripts/')) {
        return await handleScripts(req, env, origin, url.pathname);
      }

      // GitHub / GitLab device-flow OAuth proxy (no CORS on forge hosts)
      if (url.pathname.startsWith('/api/git/oauth/')) {
        return await handleGitOAuth(req, env, origin, url.pathname, CORS_HEADERS);
      }

      // On-chain analytics proxy (DefiLlama + GeckoTerminal allowlist — public, no auth)
      if (url.pathname.startsWith('/api/onchain')) {
        const onchainRes = await handleOnchain(req, env, origin, url.pathname);
        if (onchainRes) return onchainRes;
      }

      // CEX market data proxy (public Binance GET + optional request-scoped signed klines)
      if (url.pathname.startsWith('/api/market')) {
        const marketRes = await handleMarket(req, env, origin, url.pathname);
        if (marketRes) return marketRes;
      }

      switch (url.pathname) {
        case '/':
        case '/health':
          return apiJson(
            {
              status: 'healthy',
              service: 'worker-axis',
              version: WORKER_VERSION,
              timestamp: Date.now(),
              features: {
                scripts: true,
                d1: !!env.DB,
                keys: !!env.API_KEYS,
                onchain: true,
                market: true,
                mcp: true,
                mcpBridge: !!env.MCP_BRIDGE,
              },
            },
            200,
            origin,
          );
        case '/api/run':
          return req.method !== 'POST'
            ? methodNotAllowed('POST', { origin, cors: CORS_HEADERS })
            : await handleRun(req, env, origin);
        case '/api/keys':
          return await handleKeys(req, env, origin);
        case '/api/usage':
          return apiJson(
            { status: 'success', usage: { calls_used: 0, calls_remaining: null } },
            200,
            origin,
          );
        default:
          return errorResponse('NOT_FOUND', `Endpoint ${url.pathname} not found`, {
            status: 404,
            origin,
            cors: CORS_HEADERS,
          });
      }
    } catch (err) {
      return errorResponse('INTERNAL', err instanceof Error ? err.message : String(err), {
        status: 500,
        origin,
        cors: CORS_HEADERS,
      });
    }
  },
} satisfies ExportedHandler<Env>;
