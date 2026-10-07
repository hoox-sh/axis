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
 * Allowlisted proxy router for the `/api/onchain/*` and `/api/market/*` planes.
 *
 * Extracted from two hand-rolled if-ladders (`onchain.ts`, `market.ts`) that
 * shared the same shape: prefix claim → `OPTIONS` preflight → non-`GET` 405 →
 * literal health path → ordered route table → family `NOT_FOUND`.
 *
 * **Why a route table.** These planes are not an open reverse proxy; the
 * allowlist *is* the security boundary. In an if-ladder the allowlist is
 * implicit in evaluation order, so adding a route means editing control flow
 * and a missing route falls through to a generic 404. Here the accepted paths
 * are data, reviewable in one place, and a new route cannot silently widen
 * anything else.
 *
 * **Ordering is significant.** Entries are evaluated top to bottom, first match
 * wins. A `startsWith` entry is a *family fallback*: place it after the
 * specific routes of that family so those keep winning.
 *
 * @module worker/proxy-router
 */

import { methodNotAllowed, preflight } from './http';

export interface ProxyContext {
  req: Request;
  /** Parsed `req.url`. */
  url: URL;
  /** Resolved CORS origin from the entry `fetch`. */
  origin: string;
  /** Capture groups from a {@link ProxyRoute.match} regex, in order. */
  params: string[];
}

export type ProxyHandler = (ctx: ProxyContext) => Response | Promise<Response>;

export interface ProxyRoute {
  /** Literal path after the prefix, e.g. `/health`, `/llama/protocols`. */
  path?: string;
  /** Parametric match against the prefix-relative path; groups land in `ctx.params`. */
  match?: RegExp;
  /** Family fallback for any prefix-relative path starting with this segment. */
  startsWith?: string;
  /** Optional trailing-slash tolerance for a `path` entry. */
  trailingSlash?: boolean;
  /**
   * Readable form of this route for {@link ProxyRouter.allowedPaths}, e.g.
   * `/llama/protocol/:slug`. Required for a `match` route — a regex `source` is
   * not a useful thing to publish as the plane's public surface.
   */
  label?: string;
  handle: ProxyHandler;
}

export interface NotFoundBody {
  message: string;
  /** Extra fields merged into the error envelope (e.g. `hint`). */
  extra?: Record<string, unknown>;
}

export interface ProxyRouterOptions {
  /** Full path prefix claimed by this router, e.g. `/api/onchain`. */
  prefix: string;
  /** CORS header set; also used for the preflight and 405. */
  cors: (origin: string) => Record<string, string>;
  /** Body for `<prefix>`, `<prefix>/`, and `<prefix>/health`. Evaluated per request. */
  health: () => unknown;
  /** Ordered allowlist. First match wins. */
  routes: ProxyRoute[];
  /** Fallback for a path no entry claimed. */
  notFound: NotFoundBody;
}

export interface ProxyRouter {
  /**
   * @returns `null` when `pathname` is outside this router's prefix, so the
   *   caller can try the next handler; otherwise a `Response`.
   */
  handle(req: Request, origin: string, pathname: string): Promise<Response> | null;
  /**
   * Full paths this router accepts, for docs and allowlist tests. A `match`
   * route is rendered with its `label`.
   */
  allowedPaths(): string[];
}

export function createProxyRouter(opts: ProxyRouterOptions): ProxyRouter {
  const { prefix, cors, health, routes, notFound } = opts;

  const relative = (pathname: string): string | null => {
    if (pathname === prefix) return '/';
    if (!pathname.startsWith(`${prefix}/`)) return null;
    return pathname.slice(prefix.length);
  };

  const matches = (route: ProxyRoute, rel: string): string[] | null => {
    if (route.path !== undefined) {
      if (route.path === rel) return [];
      if (route.trailingSlash && rel === `${route.path}/`) return [];
      return null;
    }
    if (route.startsWith !== undefined) {
      return rel === route.startsWith || rel.startsWith(`${route.startsWith}/`) ? [] : null;
    }
    if (route.match) {
      const m = route.match.exec(rel);
      return m ? m.slice(1) : null;
    }
    return null;
  };

  return {
    handle(req: Request, origin: string, pathname: string): Promise<Response> | null {
      const rel = relative(pathname);
      if (rel === null) return null;

      if (req.method === 'OPTIONS') return Promise.resolve(preflight(cors, origin));
      if (req.method !== 'GET') return Promise.resolve(methodNotAllowed('GET', { origin, cors }));

      const json = proxyJson(cors);

      if (rel === '/' || rel === '/health') return Promise.resolve(json(health(), origin));

      for (const route of routes) {
        const params = matches(route, rel);
        if (!params) continue;
        return Promise.resolve(route.handle({ req, url: new URL(req.url), origin, params }));
      }

      return Promise.resolve(
        json(
          { status: 'error', code: 'NOT_FOUND', message: notFound.message.replace('%s', rel), ...notFound.extra },
          origin,
          404,
        ),
      );
    },

    allowedPaths(): string[] {
      const out: string[] = [`${prefix}/health`];
      for (const route of routes) {
        if (route.path !== undefined) out.push(`${prefix}${route.path}`);
        else if (route.startsWith !== undefined) out.push(`${prefix}${route.startsWith}/*`);
        else if (route.match) {
          if (!route.label) {
            throw new Error(`proxy-router: route ${route.match} needs a label for allowedPaths()`);
          }
          out.push(`${prefix}${route.label}`);
        }
      }
      return out;
    },
  };
}

/** Encode `body` with the router's CORS set — the common "return JSON" case. */
export function proxyJson(
  cors: (origin: string) => Record<string, string>,
): (body: unknown, origin: string, status?: number, extraHeaders?: Record<string, string>) => Response {
  return (body, origin, status = 200, extraHeaders) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...cors(origin),
        ...(extraHeaders || {}),
      },
    });
}