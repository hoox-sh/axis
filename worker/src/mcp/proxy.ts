/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Internal HTTP dispatcher for MCP `axis_request` — reuses Worker handlers
 * without a public fetch hop.
 *
 * @module worker/mcp/proxy
 */

import type { Env } from '../index';
import { WORKER_VERSION } from '../version';
import { handleRun } from '../runtime';
import { handleKeys } from '../keys';
import { handleScripts } from '../scripts';
import { handleOnchain } from '../onchain';
import { handleMarket } from '../market';
import { allowWorkerRequest } from './allowlist';

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

function healthBody(env: Env): unknown {
  return {
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
    },
  };
}

/**
 * Execute an allowlisted Worker route and return status + parsed JSON.
 */
export async function proxyWorkerRequest(
  env: Env,
  origin: string,
  call: ProxyCall,
): Promise<ProxyResult> {
  const gate = allowWorkerRequest(call.method, call.path);
  if (!gate.ok) {
    return {
      ok: false,
      status: 403,
      body: { status: 'error', code: 'MCP_ALLOWLIST', message: gate.reason, path: gate.path },
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

  let res: Response;
  if (path === '/' || path === '/health') {
    res = new Response(JSON.stringify(healthBody(env)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } else if (path === '/api/run') {
    res = await handleRun(req, env, origin);
  } else if (path === '/api/keys') {
    res = await handleKeys(req, env, origin);
  } else if (path === '/api/usage') {
    res = new Response(
      JSON.stringify({ status: 'success', usage: { calls_used: 0, calls_remaining: null } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } else if (path === '/api/scripts' || path.startsWith('/api/scripts/')) {
    res = await handleScripts(req, env, origin, path);
  } else if (path.startsWith('/api/onchain')) {
    const onchain = await handleOnchain(req, env, origin, path);
    res =
      onchain ??
      new Response(JSON.stringify({ status: 'error', code: 'NOT_FOUND', message: path }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
  } else if (path.startsWith('/api/market')) {
    const market = await handleMarket(req, env, origin, path);
    res =
      market ??
      new Response(JSON.stringify({ status: 'error', code: 'NOT_FOUND', message: path }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
  } else {
    res = new Response(JSON.stringify({ status: 'error', code: 'NOT_FOUND', message: path }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = await readBody(res);
  return {
    ok: res.ok,
    status: res.status,
    body: parsed,
    headers: asRecord(res.headers),
  };
}
