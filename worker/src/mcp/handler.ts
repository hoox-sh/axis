/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Streamable HTTP MCP endpoint (`POST /mcp`) + discovery GETs.
 *
 * Auth: same {@link requireApiKey} as `/api/scripts`. JSON-RPC 2.0.
 *
 * @module worker/mcp/handler
 */

import type { Env } from '../index';
import { requireApiKey, type AuthContext } from '../auth';
import { WORKER_VERSION } from '../version';
import {
  JSONRPC_INTERNAL,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  pickProtocolVersion,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol';
import { isNotification, parseJsonText, rpcError, rpcResult } from './jsonrpc';
import {
  callTool,
  getPrompt,
  listPrompts,
  listResources,
  listTools,
  readResource,
  type ToolContext,
} from './tools';

const MCP_RATE_LIMIT = 60;
const MCP_RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function allowRate(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.windowStart > MCP_RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) {
        if (now - v.windowStart > MCP_RATE_WINDOW_MS * 2) rateBuckets.delete(k);
      }
    }
    return true;
  }
  b.count += 1;
  return b.count <= MCP_RATE_LIMIT;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function wwwAuthenticate(_origin: string): Record<string, string> {
  return {
    'WWW-Authenticate': 'Bearer realm="axis", error="invalid_token"',
    'Content-Type': 'application/json',
  };
}

function jsonHeaders(origin: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID, X-Admin-Token',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id',
    Vary: 'Origin',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    ...(extra ?? {}),
  };
}

async function dispatchMethod(ctx: ToolContext, req: JsonRpcRequest): Promise<unknown> {
  const params = asRecord(req.params);
  switch (req.method) {
    case 'initialize': {
      const version = pickProtocolVersion(params.protocolVersion);
      return {
        protocolVersion: version,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: WORKER_VERSION,
          title: 'AXIS',
        },
        instructions:
          'AXIS MCP controls the charting PWA and Worker APIs. Use axis_* tools without a live tab. Use app_* tools when a PWA session is connected (Settings → MCP). Never invent Pine APIs or TradingView host methods. Secrets (API keys, exchange credentials) must not be echoed.',
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: listTools() };
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) throw Object.assign(new Error('name required'), { rpcCode: JSONRPC_INVALID_PARAMS });
      return await callTool(ctx, name, params.arguments ?? {});
    }
    case 'resources/list':
      return { resources: listResources() };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'resources/read': {
      const uri = typeof params.uri === 'string' ? params.uri : '';
      if (!uri) throw Object.assign(new Error('uri required'), { rpcCode: JSONRPC_INVALID_PARAMS });
      return await readResource(ctx, uri);
    }
    case 'prompts/list':
      return { prompts: listPrompts() };
    case 'prompts/get': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) throw Object.assign(new Error('name required'), { rpcCode: JSONRPC_INVALID_PARAMS });
      return getPrompt(name, params.arguments ?? {});
    }
    case 'logging/setLevel':
      return {};
    default:
      throw Object.assign(new Error(`Method not found: ${req.method}`), {
        rpcCode: JSONRPC_METHOD_NOT_FOUND,
      });
  }
}

async function handleOne(ctx: ToolContext, req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (isNotification(req)) {
    // notifications/initialized, notifications/cancelled, …
    return null;
  }
  const id = req.id ?? null;
  try {
    const result = await dispatchMethod(ctx, req);
    return rpcResult(id, result);
  } catch (err) {
    const e = err as { rpcCode?: number; message?: string };
    const code = typeof e.rpcCode === 'number' ? e.rpcCode : JSONRPC_INTERNAL;
    return rpcError(id, code, e.message || 'internal error');
  }
}

function discoveryDoc(url: URL): unknown {
  return {
    name: MCP_SERVER_NAME,
    version: WORKER_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: 'streamable-http',
    instructions:
      'POST JSON-RPC 2.0 to /mcp with Authorization: Bearer <pn_…>. App-plane tools need a connected AXIS tab.',
    tools: listTools().map((t) => t.name),
    resources: listResources().map((r) => r.uri),
    prompts: listPrompts().map((p) => p.name),
    resourceMetadata: `${url.origin}/.well-known/oauth-protected-resource`,
  };
}

function protectedResource(url: URL): unknown {
  return {
    resource: `${url.origin}/mcp`,
    authorization_servers: [] as string[],
    bearer_methods_supported: ['header', 'query'],
    scopes_supported: ['axis'],
    resource_name: 'AXIS MCP',
  };
}

export async function handleMcp(
  req: Request,
  env: Env,
  origin: string,
  pathname: string,
): Promise<Response | null> {
  if (pathname === '/.well-known/oauth-protected-resource') {
    const url = new URL(req.url);
    return new Response(JSON.stringify(protectedResource(url)), {
      status: 200,
      headers: jsonHeaders(origin),
    });
  }

  if (pathname !== '/mcp' && !pathname.startsWith('/mcp/')) return null;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders(origin) });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    return new Response(JSON.stringify(discoveryDoc(url), null, 2), {
      status: 200,
      headers: jsonHeaders(origin),
    });
  }

  if (req.method === 'DELETE') {
    // Stateless: nothing to tear down.
    return new Response(null, { status: 204, headers: jsonHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ status: 'error', code: 'METHOD', message: 'POST required' }), {
      status: 405,
      headers: jsonHeaders(origin),
    });
  }

  const auth = await requireApiKey(req, env);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ status: 'error', code: auth.code, message: auth.message }),
      { status: auth.status, headers: { ...jsonHeaders(origin), ...wwwAuthenticate(origin) } },
    );
  }

  const rateKey = auth.ctx.userId || 'anon';
  if (!allowRate(rateKey)) {
    return new Response(
      JSON.stringify({ status: 'error', code: 'RATE', message: 'MCP rate limit exceeded' }),
      { status: 429, headers: jsonHeaders(origin) },
    );
  }

  const text = await req.text();
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return new Response(JSON.stringify(parsed.response), {
      status: 200,
      headers: jsonHeaders(origin),
    });
  }

  const ctx: ToolContext = { env, origin, auth: auth.ctx };
  if (parsed.batch) {
    const out: JsonRpcResponse[] = [];
    for (const item of parsed.requests) {
      const res = await handleOne(ctx, item);
      if (res) out.push(res);
    }
    if (!out.length) return new Response(null, { status: 202, headers: jsonHeaders(origin) });
    return new Response(JSON.stringify(out), { status: 200, headers: jsonHeaders(origin) });
  }

  const res = await handleOne(ctx, parsed.request);
  if (!res) return new Response(null, { status: 202, headers: jsonHeaders(origin) });
  return new Response(JSON.stringify(res), { status: 200, headers: jsonHeaders(origin) });
}

/** Exported for unit tests. */
export function _resetMcpRateForTests(): void {
  rateBuckets.clear();
}

export type { AuthContext };
