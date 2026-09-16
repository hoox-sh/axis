/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { handleMcp } from '../src/mcp/handler';
import { allowWorkerRequest, describeAllowlist } from '../src/mcp/allowlist';
import { MCP_TOOLS } from '../src/mcp/catalog';
import { _resetMcpRateForTests } from '../src/mcp/handler';
import type { Env } from '../src/index';

const env: Env = { ALLOW_OPEN_KEYS: '1' };
const origin = 'http://localhost:3000';
const KEY = 'pn_' + 'a'.repeat(48);

function rpc(method: string, params?: unknown, id: number | string = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

async function post(body: string, key = KEY): Promise<{ status: number; json: unknown }> {
  const req = new Request('https://worker.axis.hoox.sh/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body,
  });
  const res = await handleMcp(req, env, origin, '/mcp');
  expect(res).toBeTruthy();
  const json = await res!.json();
  return { status: res!.status, json };
}

describe('MCP allowlist', () => {
  it('allows health, run, scripts, onchain, market', () => {
    expect(allowWorkerRequest('GET', '/health').ok).toBe(true);
    expect(allowWorkerRequest('POST', '/api/run').ok).toBe(true);
    expect(allowWorkerRequest('GET', '/api/scripts/s_abc').ok).toBe(true);
    expect(allowWorkerRequest('GET', '/api/onchain/llama/protocols').ok).toBe(true);
    expect(allowWorkerRequest('GET', '/api/market/binance/klines').ok).toBe(true);
  });

  it('blocks MCP recursion, stream, oauth, path traversal', () => {
    expect(allowWorkerRequest('POST', '/mcp').ok).toBe(false);
    expect(allowWorkerRequest('GET', '/api/stream').ok).toBe(false);
    expect(allowWorkerRequest('GET', '/api/git/oauth/github').ok).toBe(false);
    expect(allowWorkerRequest('GET', '/api/../secrets').ok).toBe(false);
  });

  it('describeAllowlist lists methods', () => {
    const d = describeAllowlist();
    expect(d.methods).toContain('GET');
    expect(d.exact.some((e) => e.path === '/health')).toBe(true);
  });
});

describe('MCP handler', () => {
  beforeEach(() => _resetMcpRateForTests());

  it('GET /mcp is public discovery', async () => {
    const req = new Request('https://worker.axis.hoox.sh/mcp');
    const res = await handleMcp(req, env, origin, '/mcp');
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { name: string; tools: string[] };
    expect(body.name).toBe('axis');
    expect(body.tools).toContain('axis_health');
    expect(body.tools).toContain('app_invoke');
  });

  it('POST without key is 401', async () => {
    const req = new Request('https://worker.axis.hoox.sh/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rpc('initialize', { protocolVersion: '2025-03-26' }),
    });
    const res = await handleMcp(req, env, origin, '/mcp');
    expect(res?.status).toBe(401);
  });

  it('initialize returns serverInfo and capabilities', async () => {
    const { status, json } = await post(
      rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } }),
    );
    expect(status).toBe(200);
    const body = json as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown } } };
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.serverInfo.name).toBe('axis');
    expect(body.result.capabilities.tools).toBeTruthy();
  });

  it('tools/list includes worker and app planes', async () => {
    const { json } = await post(rpc('tools/list'));
    const body = json as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('axis_request');
    expect(names).toContain('axis_run');
    expect(names).toContain('app_invoke');
    expect(names.length).toBe(MCP_TOOLS.length);
  });

  it('tools/call axis_health', async () => {
    const { json } = await post(rpc('tools/call', { name: 'axis_health', arguments: {} }));
    const body = json as { result: { structuredContent: { body: { status: string; features: { mcp: boolean } } } } };
    expect(body.result.structuredContent.body.status).toBe('healthy');
    expect(body.result.structuredContent.body.features.mcp).toBe(true);
  });

  it('axis_request rejects disallowed paths', async () => {
    const { json } = await post(
      rpc('tools/call', { name: 'axis_request', arguments: { method: 'GET', path: '/api/stream' } }),
    );
    const body = json as { result: { isError?: boolean; structuredContent?: { body: { code: string } } } };
    expect(body.result.isError || body.result.structuredContent?.body?.code === 'MCP_ALLOWLIST').toBe(true);
  });

  it('resources/read axis://allowlist', async () => {
    const { json } = await post(rpc('resources/read', { uri: 'axis://allowlist' }));
    const body = json as { result: { contents: Array<{ text: string }> } };
    expect(body.result.contents[0]?.text).toContain('scripts');
  });

  it('prompts/get run_script', async () => {
    const { json } = await post(
      rpc('prompts/get', { name: 'run_script', arguments: { script: '//@version=6\nindicator("x")' } }),
    );
    const body = json as { result: { messages: Array<{ content: { text: string } }> } };
    expect(body.result.messages[0]?.content.text).toContain('axis_run');
  });

  it('unknown method is -32601', async () => {
    const { json } = await post(rpc('nope/unknown'));
    const body = json as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it('well-known oauth-protected-resource', async () => {
    const req = new Request('https://worker.axis.hoox.sh/.well-known/oauth-protected-resource');
    const res = await handleMcp(req, env, origin, '/.well-known/oauth-protected-resource');
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { resource: string; bearer_methods_supported: string[] };
    expect(body.resource).toContain('/mcp');
    expect(body.bearer_methods_supported).toContain('header');
  });
});
