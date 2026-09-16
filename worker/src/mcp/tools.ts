/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * MCP tool handlers — Worker plane (HTTP APIs) + app plane (bridge RPC).
 *
 * @module worker/mcp/tools
 */

import type { Env } from '../index';
import type { AuthContext } from '../auth';
import { WORKER_VERSION } from '../version';
import { findPrompt, findTool, MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS } from './catalog';
import { describeAllowlist } from './allowlist';
import { proxyWorkerRequest, type ProxyResult } from './proxy';
import {
  jsonError,
  jsonText,
  sessionIdFromApiKey,
  type AppInvokeResponse,
  type McpToolResult,
} from './protocol';

export interface ToolContext {
  env: Env;
  origin: string;
  auth: AuthContext;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function queryBag(v: unknown): Record<string, string | number | boolean> | undefined {
  const rec = asRecord(v);
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, val] of Object.entries(rec)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[k] = val;
      n += 1;
    }
  }
  return n ? out : undefined;
}

function headerBag(v: unknown): Record<string, string> | undefined {
  const rec = asRecord(v);
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, val] of Object.entries(rec)) {
    if (typeof val === 'string') {
      out[k] = val;
      n += 1;
    }
  }
  return n ? out : undefined;
}

function suffixPath(base: string, raw: string): string {
  const s = String(raw || '').trim().replace(/^\/+/, '');
  return s ? `${base}/${s}` : base;
}

function fromProxy(res: ProxyResult): McpToolResult {
  const payload = {
    ok: res.ok,
    status: res.status,
    body: res.body,
  };
  if (!res.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
  return jsonText(payload, true);
}

/**
 * Bridge DO name is the API-key partition. An explicit session is honored
 * only when it is that id or a suffix (`userId:workspace`).
 */
async function sessionName(ctx: ToolContext, explicit: unknown): Promise<string> {
  const id = ctx.auth.userId || (await sessionIdFromApiKey(ctx.auth.key));
  const s = str(explicit).trim().slice(0, 80);
  if (!s || s === id) return id;
  if (s.startsWith(`${id}:`)) return s;
  return id;
}

async function bridgeStatus(ctx: ToolContext, session: string): Promise<ProxyResult> {
  const ns = ctx.env.MCP_BRIDGE;
  if (!ns) {
    return {
      ok: false,
      status: 503,
      body: {
        status: 'error',
        code: 'NO_MCP_BRIDGE',
        message: 'MCP_BRIDGE Durable Object is not bound. Add the binding in wrangler.toml and deploy.',
        connected: 0,
      },
      headers: {},
    };
  }
  const stub = ns.get(ns.idFromName(session));
  const res = await stub.fetch(new Request('https://axis.internal/status'));
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body, headers: {} };
}

async function bridgeInvoke(
  ctx: ToolContext,
  session: string,
  capability: string,
  payload: unknown,
): Promise<AppInvokeResponse> {
  const ns = ctx.env.MCP_BRIDGE;
  if (!ns) {
    return {
      id: '',
      ok: false,
      error: {
        code: 'NO_MCP_BRIDGE',
        message: 'MCP_BRIDGE Durable Object is not bound. Add the binding in wrangler.toml and deploy.',
      },
    };
  }
  const stub = ns.get(ns.idFromName(session));
  const res = await stub.fetch(
    new Request('https://axis.internal/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability, payload }),
    }),
  );
  const body = (await res.json().catch(() => null)) as AppInvokeResponse | null;
  if (!body || typeof body !== 'object') {
    return { id: '', ok: false, error: { code: 'BRIDGE_BAD', message: `HTTP ${res.status}` } };
  }
  return body;
}

function invokeResult(res: AppInvokeResponse): McpToolResult {
  if (!res.ok) {
    return jsonError(res.error?.message || 'app invoke failed', res.error);
  }
  return jsonText(res.result ?? null, true);
}

export async function callTool(ctx: ToolContext, name: string, argsUnknown: unknown): Promise<McpToolResult> {
  const tool = findTool(name);
  if (!tool) return jsonError(`Unknown tool: ${name}`);
  const args = asRecord(argsUnknown);

  switch (name) {
    case 'axis_health': {
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'GET',
        path: '/health',
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_request': {
      const method = str(args.method || 'GET') || 'GET';
      const path = str(args.path);
      const reqCall: Parameters<typeof proxyWorkerRequest>[2] = {
        method,
        path,
        bearer: ctx.auth.key,
      };
      const q = queryBag(args.query);
      if (q) reqCall.query = q;
      if (args.body !== undefined) reqCall.body = args.body;
      const hdrs = headerBag(args.headers);
      if (hdrs) reqCall.headers = hdrs;
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, reqCall);
      return fromProxy(res);
    }
    case 'axis_run': {
      const body: Record<string, unknown> = { script: str(args.script) };
      if (args.data !== undefined) body.data = args.data;
      if (args.ticker) body.ticker = str(args.ticker);
      if (args.timeframe) body.timeframe = str(args.timeframe);
      if (args.inputs !== undefined) body.inputs = args.inputs;
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'POST',
        path: '/api/run',
        body,
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_scripts_list': {
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'GET',
        path: '/api/scripts',
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_scripts_get': {
      const id = encodeURIComponent(str(args.id));
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'GET',
        path: `/api/scripts/${id}`,
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_scripts_put': {
      const id = str(args.id).trim();
      const payload: Record<string, unknown> = {
        name: str(args.name),
        content: str(args.content),
      };
      if (args.description !== undefined) payload.description = str(args.description);
      if (args.path !== undefined) payload.path = str(args.path);
      if (args.revision !== undefined) payload.revision = str(args.revision);
      const headers: Record<string, string> = {};
      if (args.revision) headers['If-Match'] = str(args.revision);
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: id ? 'PUT' : 'POST',
        path: id ? `/api/scripts/${encodeURIComponent(id)}` : '/api/scripts',
        body: payload,
        headers,
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_scripts_delete': {
      const id = encodeURIComponent(str(args.id));
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'DELETE',
        path: `/api/scripts/${id}`,
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_keys_validate': {
      const key = str(args.key).trim() || ctx.auth.key;
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'GET',
        path: '/api/keys',
        query: { action: 'validate' },
        bearer: key,
      });
      return fromProxy(res);
    }
    case 'axis_keys_create': {
      const adminToken = str(args.adminToken);
      const headers: Record<string, string> = {};
      if (adminToken) headers['X-Admin-Token'] = adminToken;
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'POST',
        path: '/api/keys',
        body: { tier: str(args.tier || 'hobby') || 'hobby' },
        headers,
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_usage': {
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
        method: 'GET',
        path: '/api/usage',
        bearer: ctx.auth.key,
      });
      return fromProxy(res);
    }
    case 'axis_onchain': {
      const onchainCall: Parameters<typeof proxyWorkerRequest>[2] = {
        method: 'GET',
        path: suffixPath('/api/onchain', str(args.path)),
        bearer: ctx.auth.key,
      };
      const onchainQ = queryBag(args.query);
      if (onchainQ) onchainCall.query = onchainQ;
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, onchainCall);
      return fromProxy(res);
    }
    case 'axis_market': {
      const marketCall: Parameters<typeof proxyWorkerRequest>[2] = {
        method: 'GET',
        path: suffixPath('/api/market', str(args.path)),
        bearer: ctx.auth.key,
      };
      const marketQ = queryBag(args.query);
      if (marketQ) marketCall.query = marketQ;
      const res = await proxyWorkerRequest(ctx.env, ctx.origin, marketCall);
      return fromProxy(res);
    }
    case 'app_session_status': {
      const session = await sessionName(ctx, args.session);
      const res = await bridgeStatus(ctx, session);
      return jsonText({ session, ...(typeof res.body === 'object' && res.body ? res.body : { body: res.body }) }, true);
    }
    case 'app_capabilities': {
      const session = await sessionName(ctx, args.session);
      const res = await bridgeInvoke(ctx, session, 'app.capabilities', {});
      return invokeResult(res);
    }
    case 'app_invoke': {
      const session = await sessionName(ctx, args.session);
      const capability = str(args.capability);
      if (!capability) return jsonError('capability is required');
      const res = await bridgeInvoke(ctx, session, capability, args.payload);
      return invokeResult(res);
    }
    case 'app_get': {
      const session = await sessionName(ctx, args.session);
      const res = await bridgeInvoke(ctx, session, 'app.get', { path: str(args.path) || undefined });
      return invokeResult(res);
    }
    case 'app_set': {
      const session = await sessionName(ctx, args.session);
      const path = str(args.path);
      if (!path) return jsonError('path is required');
      const res = await bridgeInvoke(ctx, session, 'app.set', { path, value: args.value });
      return invokeResult(res);
    }
    default:
      return jsonError(`Unhandled tool: ${name}`);
  }
}

export function listTools() {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function listResources() {
  return MCP_RESOURCES.map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  }));
}

export function listPrompts() {
  return MCP_PROMPTS.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: p.arguments ?? [],
  }));
}

export async function readResource(ctx: ToolContext, uri: string): Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}> {
  const def = MCP_RESOURCES.find((r) => r.uri === uri);
  if (!def) throw new Error(`Unknown resource: ${uri}`);
  let payload: unknown;
  if (uri === 'axis://health') {
    const res = await proxyWorkerRequest(ctx.env, ctx.origin, {
      method: 'GET',
      path: '/health',
      bearer: ctx.auth.key,
    });
    payload = res.body;
  } else if (uri === 'axis://capabilities') {
    payload = {
      server: { name: 'axis', version: WORKER_VERSION },
      tools: MCP_TOOLS.map((t) => ({ name: t.name, plane: t.plane, description: t.description })),
      resources: MCP_RESOURCES.map((r) => r.uri),
      prompts: MCP_PROMPTS.map((p) => p.name),
    };
  } else if (uri === 'axis://allowlist') {
    payload = describeAllowlist();
  } else if (uri === 'axis://session') {
    const session = await sessionName(ctx, undefined);
    const res = await bridgeStatus(ctx, session);
    payload = { session, body: res.body };
  } else {
    payload = { uri };
  }
  return {
    contents: [{ uri, mimeType: def.mimeType, text: JSON.stringify(payload, null, 2) }],
  };
}

export function getPrompt(name: string, argsUnknown: unknown): {
  description: string;
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
} {
  const def = findPrompt(name);
  if (!def) throw new Error(`Unknown prompt: ${name}`);
  const args = asRecord(argsUnknown);
  const lines: string[] = [`You are controlling AXIS via MCP tools.`, def.description, ''];
  if (name === 'run_script') {
    lines.push('1. If a connected PWA session exists, prefer app_invoke capability editor.set then editor.run (or chart.load first).');
    lines.push('2. Otherwise call axis_run with the script and any OHLCV you have.');
    lines.push('3. Summarize plots, strategy trades, and errors honestly — do not invent Pine APIs.');
    if (args.script) lines.push('', 'Script:', '```pine', str(args.script), '```');
    if (args.symbol) lines.push(`Symbol: ${str(args.symbol)}`);
    if (args.interval) lines.push(`Interval: ${str(args.interval)}`);
  } else if (name === 'debug_last_run') {
    lines.push('Call app_invoke with capability results.get (or app_get path lastRun). Read logs.get. Explain errors with the actual engine message.');
  } else if (name === 'analyze_strategy') {
    lines.push('Call app_invoke results.get / results.strategy. Report net profit, win rate, max drawdown, and trade count. Do not fabricate stats.');
  } else if (name === 'load_symbol') {
    lines.push(`Load ${str(args.symbol) || 'the requested symbol'} via app_invoke capability chart.load.`);
    if (args.interval) lines.push(`Interval: ${str(args.interval)}`);
    lines.push('Then app_get path bars.summary and confirm last close.');
  } else if (name === 'audit_workspace') {
    lines.push('Call app_invoke workspace.export (or app.snapshot). List active source/stream/engine, open panels, applied scripts, and alerts. Flag missing API keys only as presence, never print secrets.');
  }
  return {
    description: def.description,
    messages: [{ role: 'user', content: { type: 'text', text: lines.join('\n') } }],
  };
}
