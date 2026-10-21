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
 * The Worker's route table.
 *
 * The route knowledge used to live in four places: the entry dispatcher's
 * `switch`, its ad-hoc `if` / `startsWith` guards, the MCP proxy's own
 * dispatcher, and the MCP allowlist's method+path pairs. They drifted.
 *
 * One table declares the routes now. The entry dispatcher and the MCP proxy
 * both read it, and the MCP allowlist is checked against it by a test.
 *
 * @module worker/routes
 */

import type { Env } from './index';
import { handleRun } from './runtime';
import { handleKeys } from './keys';
import { handleScripts } from './scripts';
import { handleOnchain } from './onchain';
import { handleMarket } from './market';
import { handleGitOAuth } from './git-oauth';
import { handleLiveProxy } from './live-proxy';
import { API_CORS, buildHealthBody, jsonResponse, probeUpstream, type DeepHealth } from './http';

/** How a route is served. */
export type RouteKind =
  /** A normal JSON route. */
  | 'http'
  /** The MCP Streamable-HTTP transport. */
  | 'mcp'
  /** A WebSocket upgrade (the MCP bridge and the stream relay). */
  | 'upgrade';

/** Context handed to a route handler. */
export interface RouteContext {
  req: Request;
  env: Env;
  origin: string;
  ctx: ExecutionContext;
  /** The request URL. */
  url: URL;
  /** The `?deep=1` health probe was requested. */
  deepHealth?: boolean;
}

/** One declared route. */
export interface RouteDef {
  /** What kind of route this is. */
  kind: RouteKind;
  /**
   * A name for the non-HTTP routes, so the dispatcher can tell the MCP
   * bridge from the stream relay.
   */
  name?: string;
  /** Exact paths this route answers on. */
  paths?: readonly string[];
  /** Path prefix this route owns. */
  startsWith?: string;
  /**
   * Methods the route accepts. `undefined` means "any" — the handler decides
   * (the health and usage stubs answer every method, and the script handler
   * has its own method rules).
   */
  methods?: readonly string[];
  /**
   * Handle an HTTP route.
   *
   * A handler may answer `null` when it owns no route for the path (the
   * on-chain and market proxies do) — the dispatcher answers 404 then.
   */
  handle?: (ctx: RouteContext) => Promise<Response | null> | Response | null;
  /**
   * Whether an MCP `axis_request` may call this route.
   *
   * The MCP allowlist has its own, finer-grained rules (the script id shape,
   * the version paths); this flag says "this route is reachable over MCP at
   * all". The allowlist stays the authority — the table says which plane.
   */
  mcp?: boolean;
}

/** The MCP transport route name. */
export const MCP_ROUTE = 'mcp';
/** The MCP bridge (WebSocket) route name. */
export const BRIDGE_ROUTE = 'bridge';
/** The stream relay (WebSocket) route name. */
export const STREAM_ROUTE = 'stream';

/**
 * Health body — shared with the MCP proxy.
 *
 * `?deep=1` pays for one real egress probe per upstream so a dead proxy
 * plane can never report `market` / `onchain: true` again.
 */
export async function healthBody(env: Env, deep = false): Promise<unknown> {
  // Shared with the entry `/health` route (A22) — one builder, no drift.
  const report = deep ? await deepUpstreamHealth() : undefined;
  return buildHealthBody(
    { db: !!env.DB, keys: !!env.API_KEYS, mcpBridge: !!env.MCP_BRIDGE },
    report,
  );
}

/** Cheapest path that proves each egress peer answers — one small GET each. */
const UPSTREAM_PROBES: ReadonlyArray<readonly [host: string, url: string]> = [
  ['binance', 'https://data-api.binance.vision/api/v3/ping'],
  ['mexc', 'https://api.mexc.com/api/v3/ping'],
  ['defillama', 'https://api.llama.fi/protocols?limit=1'],
  ['geckoterminal', 'https://api.geckoterminal.com/api/v2/networks?page=1'],
];

/** `/health?deep=1` — live egress verdicts for the market + on-chain planes. */
async function deepUpstreamHealth(): Promise<DeepHealth> {
  const settled = await Promise.all(
    UPSTREAM_PROBES.map(async ([host, url]) => {
      const r = await probeUpstream(host, url);
      return [host, { ok: r.ok, detail: r.detail }] as const;
    }),
  );
  return { deep: true, report: Object.fromEntries(settled) };
}

/**
 * The route table.
 *
 * Order is the match order: the first entry whose path matches wins.
 */
export const ROUTES: readonly RouteDef[] = [
  {
    kind: 'mcp',
    name: MCP_ROUTE,
    paths: ['/mcp', '/.well-known/oauth-protected-resource'],
    startsWith: '/mcp/',
  },
  { kind: 'upgrade', name: BRIDGE_ROUTE, paths: ['/api/mcp/bridge'] },
  { kind: 'upgrade', name: STREAM_ROUTE, paths: ['/api/stream'] },
  {
    kind: 'http',
    paths: ['/', '/health'],
    mcp: true,
    handle: async ({ env, origin, deepHealth }) =>
      jsonResponse(await healthBody(env, deepHealth === true), { status: 200, origin, cors: API_CORS }),
  },
  {
    kind: 'http',
    paths: ['/api/run'],
    methods: ['POST'],
    mcp: true,
    handle: ({ req, env, origin, ctx }) => handleRun(req, env, origin, ctx),
  },
  {
    kind: 'http',
    paths: ['/api/keys'],
    mcp: true,
    handle: ({ req, env, origin }) => handleKeys(req, env, origin),
  },
  {
    kind: 'http',
    paths: ['/api/usage'],
    mcp: true,
    handle: () =>
      jsonResponse({ status: 'success', usage: { calls_used: 0, calls_remaining: null } }),
  },
  {
    kind: 'http',
    startsWith: '/api/scripts',
    mcp: true,
    handle: ({ req, env, origin, url, ctx }) => handleScripts(req, env, origin, url.pathname, ctx),
  },
  {
    kind: 'http',
    startsWith: '/api/git/oauth/',
    handle: ({ req, env, origin, url }) => handleGitOAuth(req, env, origin, url.pathname, API_CORS),
  },
  {
    kind: 'http',
    startsWith: '/api/onchain',
    methods: ['GET'],
    mcp: true,
    handle: ({ req, env, origin, url }) => handleOnchain(req, env, origin, url.pathname),
  },
  {
    kind: 'http',
    startsWith: '/api/market',
    methods: ['GET'],
    mcp: true,
    handle: ({ req, env, origin, url }) => handleMarket(req, env, origin, url.pathname),
  },
  {
    kind: 'http',
    paths: ['/api/ws/live'],
    handle: ({ req, env, origin, url }) => handleLiveProxy(req, env, origin, url.pathname),
  },
];

/** True when `pathname` is one of the route's paths or under its prefix. */
export function routeMatchesPath(route: RouteDef, pathname: string): boolean {
  if (route.paths?.some((p) => p === pathname)) return true;
  if (route.startsWith && pathname.startsWith(route.startsWith)) return true;
  return false;
}

/** A matched route. */
export interface RouteMatch {
  route: RouteDef;
  /** The route matched the path, but not the method. */
  methodMismatch: boolean;
}

/**
 * Find the route for a method + path.
 *
 * The first matching entry wins. A path that matches but whose method does
 * not is reported as a method mismatch, so the caller can answer 405 rather
 * than 404.
 */
export function matchRoute(
  routes: readonly RouteDef[],
  method: string,
  pathname: string,
): RouteMatch | null {
  let mismatch: RouteDef | null = null;
  for (const route of routes) {
    if (!routeMatchesPath(route, pathname)) continue;
    if (!route.methods) return { route, methodMismatch: false };
    if (route.methods.includes(method)) return { route, methodMismatch: false };
    if (!mismatch) mismatch = route;
  }
  return mismatch ? { route: mismatch, methodMismatch: true } : null;
}

/** The routes an MCP `axis_request` may reach. */
export function mcpRoutes(routes: readonly RouteDef[] = ROUTES): readonly RouteDef[] {
  return routes.filter((r) => r.mcp === true && r.kind === 'http');
}
