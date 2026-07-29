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
 * AXIS Cloudflare Worker entrypoint — JSON API + WebSocket relay for the charting PWA.
 *
 * Runs beside the static PWA (Cloudflare Pages or any static host). CORS echoes
 * local-dev Origins (`localhost` / `127.0.0.1`) and otherwise uses `ALLOWED_ORIGIN`.
 *
 * ## Routes
 * | Method / path        | Handler              | Auth / notes |
 * |----------------------|----------------------|--------------|
 * | GET `/`, `/health`   | health JSON          | public; reports D1/KV binding presence |
 * | POST `/api/run`      | {@link handleRun}    | optional Bearer; proxies or Pyodide |
 * | `/api/keys`          | {@link handleKeys}   | create needs `X-Admin-Token`; validate uses Bearer/`?key=` |
 * | GET `/api/usage`     | stub usage           | public placeholder |
 * | `/api/scripts…`      | {@link handleScripts}| Bearer API key; D1 or in-memory |
 * | GET `/api/stream`    | SessionDO upgrade    | requires `SESSIONS` DO binding |
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
import { handleKeys } from './keys';
import { handleScripts } from './scripts';
import { SessionDO } from './durable-objects/session';

export { SessionDO };

/** Worker bindings and wrangler `[vars]` consumed by handlers. All optional for local stubs. */
export interface Env {
  /** KV: API key lookup (`key:<pn_…>` JSON). When unbound, dev accepts well-formed `pn_` keys. */
  API_KEYS?: KVNamespace;
  /** KV: optional per-key `/api/run` call counter. */
  USAGE?: KVNamespace;
  /** D1: scripts + script_drafts tables. When unbound, scripts use process memory. */
  DB?: D1Database;
  /** R2: future pynescript wheel / bundle storage for in-worker Pyodide. */
  BUNDLES?: R2Bucket;
  /** Durable Object namespace for `/api/stream` WebSocket sessions. */
  SESSIONS?: DurableObjectNamespace;

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
}

const CORS_HEADERS = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, If-Match',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

/**
 * Local-dev browser origins (Vite :3000, axis_pwa :8081, arbitrary ports).
 * Match pyne Pro API default: ^https?://(localhost|127.0.0.1)(:\\d+)?$
 *
 * Do **not** allow `http://0.0.0.0:…` — browsers almost never send that Origin,
 * and binding/listening on 0.0.0.0 is unrelated to CORS. Prefer localhost/127.0.0.1.
 */
const LOCAL_DEV_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

/**
 * Resolve `Access-Control-Allow-Origin` for this request.
 * Local-dev Origins are echoed (credential-safe for Vite/wrangler); otherwise
 * fall back to `env.ALLOWED_ORIGIN` or the production default.
 * Exported for unit tests (`worker/tests/cors-origin.test.ts`).
 */
export function pickOrigin(req: Request, env: Env): string {
  const reqOrigin = req.headers.get('Origin') ?? '';
  if (reqOrigin && LOCAL_DEV_ORIGIN_RE.test(reqOrigin)) {
    return reqOrigin;
  }
  return env.ALLOWED_ORIGIN || 'https://pynescript.ai';
}

/** JSON body + CORS headers shared by all non-stream routes. */
function jsonResponse(body: unknown, init: ResponseInit, origin: string): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
      ...CORS_HEADERS(origin),
    },
  });
}

export default {
  /**
   * Single `fetch` entry: CORS → stream DO upgrade → scripts → switch routes.
   * Uncaught handler errors become `{ status:'error', code:'INTERNAL' }` 500s.
   */
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = pickOrigin(req, env);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS(origin) });
    }

    const url = new URL(req.url);

    // WebSocket session relay: /api/stream?session=&symbol=&interval= → SessionDO
    // DO is named by `session` query (default "default"); request rewritten to /ws.
    if (url.pathname === '/api/stream') {
      if (!env.SESSIONS) {
        return jsonResponse(
          {
            status: 'error',
            code: 'NO_DO',
            message: 'SESSIONS Durable Object not bound. Run `wrangler deploy` after provisioning.',
          },
          { status: 503 },
          origin,
        );
      }
      const id = env.SESSIONS.idFromName(url.searchParams.get('session') ?? 'default');
      const stub = env.SESSIONS.get(id);
      const wsReq = new Request(`${url.origin}/ws?${url.searchParams.toString()}`, req);
      return stub.fetch(wsReq);
    }

    try {
      // Script library: /api/scripts, /api/scripts/:id, /api/scripts/_draft
      if (url.pathname === '/api/scripts' || url.pathname.startsWith('/api/scripts/')) {
        return await handleScripts(req, env, origin, url.pathname);
      }

      switch (url.pathname) {
        case '/':
        case '/health':
          return jsonResponse(
            {
              status: 'healthy',
              service: 'pynescript-axis-worker',
              timestamp: Date.now(),
              features: {
                scripts: true,
                d1: !!env.DB,
                keys: !!env.API_KEYS,
              },
            },
            { status: 200 },
            origin,
          );
        case '/api/run':
          return req.method !== 'POST'
            ? jsonResponse(
                { status: 'error', code: 'METHOD', message: 'POST required' },
                { status: 405 },
                origin,
              )
            : await handleRun(req, env, origin);
        case '/api/keys':
          return await handleKeys(req, env, origin);
        case '/api/usage':
          return jsonResponse(
            { status: 'success', usage: { calls_used: 0, calls_remaining: null } },
            { status: 200 },
            origin,
          );
        default:
          return jsonResponse(
            { status: 'error', code: 'NOT_FOUND', message: `Endpoint ${url.pathname} not found` },
            { status: 404 },
            origin,
          );
      }
    } catch (err) {
      return jsonResponse(
        {
          status: 'error',
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
        origin,
      );
    }
  },
} satisfies ExportedHandler<Env>;
