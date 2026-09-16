/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Allowlist for {@link axis_request} — Worker HTTP paths an MCP client may call.
 *
 * Not an open proxy: only AXIS JSON APIs. Stream / MCP / OAuth device-flow
 * endpoints are excluded (they need WS or a browser).
 *
 * @module worker/mcp/allowlist
 */

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

/** Exact path + method pairs. */
const EXACT: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/'],
  ['GET', '/health'],
  ['POST', '/api/run'],
  ['GET', '/api/keys'],
  ['POST', '/api/keys'],
  ['GET', '/api/usage'],
  ['GET', '/api/scripts'],
  ['POST', '/api/scripts'],
  ['GET', '/api/scripts/_draft'],
  ['PUT', '/api/scripts/_draft'],
  ['GET', '/api/onchain'],
  ['GET', '/api/onchain/health'],
  ['GET', '/api/market'],
  ['GET', '/api/market/health'],
];

const PREFIX_GET = [
  '/api/onchain/',
  '/api/market/',
] as const;

/**
 * `/api/scripts/:id`, `/api/scripts/:id/versions`, `/api/scripts/:id/versions/:rev`
 * — ids are `s_<base36>` plus `_draft` (already exact).
 */
const SCRIPT_ID = /^[A-Za-z0-9._-]{1,80}$/;

export interface AllowlistDecision {
  ok: boolean;
  method: string;
  path: string;
  reason?: string;
}

function normalizePath(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s.startsWith('/')) return null;
  if (s.includes('://') || s.includes('..') || s.includes('\\') || s.includes('\0')) {
    return null;
  }
  // Strip query/hash — callers pass query separately.
  const cut = s.split(/[?#]/, 1)[0] ?? s;
  if (cut.length > 512) return null;
  return cut.replace(/\/+$/, '') || '/';
}

function scriptsAllowed(method: string, path: string): boolean {
  if (path === '/api/scripts' || path === '/api/scripts/_draft') {
    return EXACT.some(([m, p]) => m === method && p === path);
  }
  if (!path.startsWith('/api/scripts/')) return false;
  const rest = path.slice('/api/scripts/'.length);
  const parts = rest.split('/').filter(Boolean);
  const id0 = parts[0];
  const id2 = parts[2];
  if (parts.length === 1 && id0) {
    return SCRIPT_ID.test(id0) && (method === 'GET' || method === 'PUT' || method === 'DELETE');
  }
  if (parts.length === 2 && parts[1] === 'versions' && id0) {
    return SCRIPT_ID.test(id0) && method === 'GET';
  }
  if (parts.length === 3 && parts[1] === 'versions' && id0 && id2) {
    return SCRIPT_ID.test(id0) && SCRIPT_ID.test(id2) && method === 'GET';
  }
  return false;
}

/**
 * Return whether an MCP `axis_request` may hit this Worker path.
 * Query strings are not part of the decision (handlers validate their own keys).
 */
export function allowWorkerRequest(methodRaw: unknown, pathRaw: unknown): AllowlistDecision {
  const method = String(methodRaw || 'GET').trim().toUpperCase();
  const path = normalizePath(String(pathRaw || ''));
  if (!path) {
    return { ok: false, method, path: String(pathRaw || ''), reason: 'invalid path' };
  }
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, method, path, reason: 'method not allowed' };
  }
  if (path === '/mcp' || path.startsWith('/mcp/') || path.startsWith('/api/mcp')) {
    return { ok: false, method, path, reason: 'mcp recursion blocked' };
  }
  if (path === '/api/stream' || path.startsWith('/api/stream/')) {
    return { ok: false, method, path, reason: 'websocket endpoints are not HTTP tools' };
  }
  if (path.startsWith('/api/git/')) {
    return { ok: false, method, path, reason: 'oauth device-flow is interactive' };
  }
  for (const [m, p] of EXACT) {
    if (m === method && p === path) return { ok: true, method, path };
  }
  if (method === 'GET') {
    for (const prefix of PREFIX_GET) {
      if (path.startsWith(prefix)) return { ok: true, method, path };
    }
  }
  if (scriptsAllowed(method, path)) return { ok: true, method, path };
  return { ok: false, method, path, reason: 'path not in AXIS MCP allowlist' };
}

/** Human-readable allowlist for the `axis://allowlist` resource. */
export function describeAllowlist(): {
  methods: string[];
  exact: Array<{ method: string; path: string }>;
  prefixes: Array<{ method: string; pathPrefix: string }>;
  scripts: string;
} {
  return {
    methods: [...ALLOWED_METHODS],
    exact: EXACT.map(([method, path]) => ({ method, path })),
    prefixes: PREFIX_GET.map((pathPrefix) => ({ method: 'GET', pathPrefix })),
    scripts:
      'GET|POST /api/scripts; GET|PUT /api/scripts/_draft; GET|PUT|DELETE /api/scripts/:id; GET /api/scripts/:id/versions[/:rev]',
  };
}
