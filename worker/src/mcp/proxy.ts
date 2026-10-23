/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Internal HTTP dispatcher for MCP `axis_request` — reuses Worker handlers
 * without a public fetch hop.
 *
 * @module worker/mcp/proxy
 */

import type { Env } from '../index';
import { allowWorkerRequest } from './allowlist';
import { errorBody, notFoundResponse } from '../http';
import { ROUTES, matchRoute } from '../routes';

const INTERNAL_ORIGIN = 'https://axis.internal';

export interface ProxyCall {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Forwarded Bearer (already authenticated for MCP). */
  bearer: string;
}

export interface ProxyResult {
  ok: boolean;
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function asRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildUrl(path: string, query?: ProxyCall['query']): URL {
  const url = new URL(path, INTERNAL_ORIGIN);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url;
}

/**
 * Execute an allowlisted Worker route and return status + parsed JSON.
 *
 * `ctx` is threaded through so usage-metering flushes survive past the
 * response via `ctx.waitUntil` instead of being cancelled with the request
 * lifetime (A13).
 */
export async function proxyWorkerRequest(
  env: Env,
  origin: string,
  call: ProxyCall,
  ctx?: ExecutionContext,
): Promise<ProxyResult> {
  const gate = allowWorkerRequest(call.method, call.path);
  if (!gate.ok) {
    return {
      ok: false,
      status: 403,
      body: { ...errorBody('MCP_ALLOWLIST', gate.reason), path: gate.path },
      headers: {},
    };
  }

  const method = gate.method;
  const path = gate.path;
  const url = buildUrl(path, call.query);
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  if (call.bearer) headers.set('Authorization', `Bearer ${call.bearer}`);
  if (call.headers) {
    for (const [k, v] of Object.entries(call.headers)) {
      const name = k.trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (lower === 'authorization' || lower === 'host' || lower === 'content-length') continue;
      headers.set(name, v);
    }
  }

  let body: string | undefined;
  if (method === 'POST' || method === 'PUT') {
    if (call.body !== undefined) {
      body = typeof call.body === 'string' ? call.body : JSON.stringify(call.body);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  const req = new Request(url, init);

  // The dispatch comes from the shared route table — the same one the entry
  // dispatcher reads. The allowlist above stays the authority on *whether* a
  // path may be reached over MCP; the table says *how* it is served.
  const match = matchRoute(ROUTES, method, path);
  let res: Response;
  if (!match || match.route.kind !== 'http' || match.route.mcp !== true || !match.route.handle) {
    res = notFoundResponse(path, { status: 404 });
  } else {
    const handled = await match.route.handle({
      req,
      env,
      origin,
      ctx: ctx as ExecutionContext,
      url,
      // The MCP plane must never pay for the deep egress probe.
      deepHealth: false,
    });
    res = handled ?? notFoundResponse(path, { status: 404 });
  }

  const parsed = await readBody(res);
  return {
    ok: res.ok,
    status: res.status,
    body: parsed,
    headers: asRecord(res.headers),
  };
}
