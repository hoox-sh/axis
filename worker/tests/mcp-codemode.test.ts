/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { Env } from '../src/index';
import { MCP_TOOLS } from '../src/mcp/catalog';
import { compactCatalog, shortToolName } from '../src/mcp/codemode/catalog';
import { createCodeModeHandlers } from '../src/mcp/codemode/handlers';
import {
  DEFAULT_LIMITS,
  type CodeModeHandlers,
} from '../src/mcp/codemode/protocol';
import {
  SANDBOX_MAIN_MODULE,
  buildSandboxModule,
  buildWorkerCode,
  dispatchCall,
  runInSandbox,
  type MakeDispatcher,
  type SandboxStats,
} from '../src/mcp/codemode/sandbox';
import {
  CODE_MODE_TOOL_DEFS,
  CODE_MODE_TOOL_NAMES,
  allToolDefs,
  codeModeEnabled,
  runCodeModeTool,
} from '../src/mcp/codemode/tools';
import { _resetMcpRateForTests, handleMcp } from '../src/mcp/handler';
import { jsonText } from '../src/mcp/protocol';
import { callTool, listTools, type ToolContext } from '../src/mcp/tools';

const origin = 'http://localhost:3000';
const KEY = `pn_${'a'.repeat(48)}`;
const AUTH = { key: KEY, userId: 'b'.repeat(32), tier: 'hobby' };

const envOff: Env = { ALLOW_OPEN_KEYS: '1' };
const envOn: Env = { ALLOW_OPEN_KEYS: '1', AXIS_MCP_CODE_MODE: '1' };

function ctx(env: Env): ToolContext {
  return { env, origin, auth: AUTH };
}

function rpc(method: string, params?: unknown, id: number | string = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

async function post(
  body: string,
  env: Env,
): Promise<{ status: number; json: unknown }> {
  const req = new Request('https://worker.axis.hoox.sh/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body,
  });
  const res = await handleMcp(req, env, origin, '/mcp');
  expect(res).toBeTruthy();
  return { status: res?.status, json: await res?.json() };
}

/** Small, stable hash so "byte-identical" is one comparable number. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface FakeLoader {
  loader: WorkerLoader;
  lastCode(): WorkerLoaderWorkerCode | undefined;
}

function fakeLoader(
  onEvaluate: (dispatch: unknown, catalog: unknown) => Promise<unknown>,
): FakeLoader {
  let last: WorkerLoaderWorkerCode | undefined;
  const loader = {
    load(code: WorkerLoaderWorkerCode): WorkerStub {
      last = code;
      return {
        getEntrypoint() {
          return { evaluate: onEvaluate };
        },
      } as unknown as WorkerStub;
    },
    get(): WorkerStub {
      throw new Error('get() is not used by Code Mode');
    },
  } as unknown as WorkerLoader;
  return { loader, lastCode: () => last };
}

/** Test dispatcher: same dispatch logic, no workerd RpcTarget needed. */
const fakeMakeDispatcher: MakeDispatcher = (handlers, limits, stats) => ({
  call: (name: string, argsJson?: string) => dispatchCall(handlers, limits, stats, name, argsJson),
});

function asStats(): SandboxStats {
  return { calls: 0 };
}

describe('Code Mode flag', () => {
  beforeEach(() => _resetMcpRateForTests());

  it('flag off leaves tools/list byte-identical', () => {
    const expected = MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    const actual = listTools(false);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    expect(fnv1a(JSON.stringify(actual))).toBe(fnv1a(JSON.stringify(expected)));
    expect(allToolDefs(false)).toBe(MCP_TOOLS);
  });

  it('flag off keeps the wire tool list unchanged', async () => {
    const { json } = await post(rpc('tools/list'), envOff);
    const names = (json as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(names.length).toBe(MCP_TOOLS.length);
    expect(names).not.toContain('search');
    expect(names).not.toContain('execute');
  });

  it('flag on adds exactly search and execute', async () => {
    const { json } = await post(rpc('tools/list'), envOn);
    const names = (json as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(names.length).toBe(MCP_TOOLS.length + 2);
    expect(names.slice(0, -2)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(names.slice(-2)).toEqual([...CODE_MODE_TOOL_NAMES]);
    expect(CODE_MODE_TOOL_DEFS.map((t) => t.name)).toEqual([...CODE_MODE_TOOL_NAMES]);
  });

  it('reads the flag as a Worker var only', () => {
    expect(codeModeEnabled(undefined)).toBe(false);
    expect(codeModeEnabled({ AXIS_MCP_CODE_MODE: '0' })).toBe(false);
    expect(codeModeEnabled({ AXIS_MCP_CODE_MODE: '1' })).toBe(true);
    expect(codeModeEnabled({ AXIS_MCP_CODE_MODE: 'true' })).toBe(true);
  });

  it('flag off rejects search/execute as unknown tools', async () => {
    for (const name of CODE_MODE_TOOL_NAMES) {
      const result = await callTool(ctx(envOff), name, { code: 'async () => 1' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain(
        `Unknown tool: ${name}`,
      );
    }
  });
});

describe('Code Mode search', () => {
  beforeEach(() => _resetMcpRateForTests());

  it('receives a compact catalog and narrows it', async () => {
    const fake = fakeLoader(async (_dispatch, catalog) => ({
      value: (catalog as Array<{ short: string }>).filter((row) => row.short === 'health'),
      logs: ['search'],
    }));
    const env: Env = { ...envOn, LOADER: fake.loader };
    const code = 'async () => catalog.filter((r) => r.short === "health")';
    const { status, json } = await post(
      rpc('tools/call', { name: 'search', arguments: { code } }),
      env,
    );
    expect(status).toBe(200);
    const result = (
      json as {
        result: {
          structuredContent: { mode: string; value: Array<{ name: string }>; calls: number };
        };
      }
    ).result;
    expect(result.structuredContent.mode).toBe('search');
    expect(result.structuredContent.value).toEqual([
      expect.objectContaining({ name: 'axis_health' }),
    ]);
    expect(result.structuredContent.calls).toBe(0);

    // The generated child module embeds the model's code; the catalog passed
    // over RPC is the compact view, not full input schemas.
    const workerCode = fake.lastCode();
    expect(workerCode).toBeTruthy();
    const source = workerCode?.modules[SANDBOX_MAIN_MODULE];
    expect(typeof source).toBe('string');
    expect(String(source)).toContain('catalog.filter');
    const rows = compactCatalog();
    expect(rows.length).toBe(MCP_TOOLS.length);
    expect(rows.every((row) => !('inputSchema' in row))).toBe(true);
    const shorts = rows.map((row) => row.short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it('search has no tool access', async () => {
    const fake = fakeLoader(async () => {
      const stats = asStats();
      const handlers: CodeModeHandlers = Object.create(null) as CodeModeHandlers;
      const raw = await dispatchCall(handlers, DEFAULT_LIMITS, stats, 'axis_health', '{}');
      return { value: JSON.parse(raw), logs: [] };
    });
    const env: Env = { ...envOn, LOADER: fake.loader };
    const { json } = await post(
      rpc('tools/call', { name: 'search', arguments: { code: 'async () => 1' } }),
      env,
    );
    const value = (
      json as { result: { structuredContent: { value: { error: string } } } }
    ).result.structuredContent.value;
    expect(value.error).toContain('Unknown tool');
  });
});

describe('Code Mode execute', () => {
  beforeEach(() => _resetMcpRateForTests());

  it('runs a read-only axis tool through the parent handler', async () => {
    const fake = fakeLoader(async (dispatch) => {
      const raw = await (dispatch as { call: (n: string, a: string) => Promise<string> }).call(
        'health',
        '{}',
      );
      return { value: JSON.parse(raw).result, logs: [] };
    });
    const env: Env = { ...envOn, LOADER: fake.loader };
    const result = await runCodeModeTool(
      ctx(env),
      'execute',
      { code: 'async () => axis.health()' },
      callTool,
      { makeDispatcher: fakeMakeDispatcher },
    );
    expect(result.isError).toBeUndefined();
    const value = (result.structuredContent as { value: { body: { status: string } } }).value;
    expect(value.body.status).toBe('healthy');
    expect((result.structuredContent as { calls: number }).calls).toBe(1);
  });

  it('reports a missing LOADER binding instead of failing open', async () => {
    const result = await callTool(ctx(envOn), 'execute', { code: 'async () => axis.health()' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('LOADER');
  });

  it('enforces the code size and call budgets', async () => {
    const tooLong = await runInSandbox(
      { mode: 'execute', code: 'x'.repeat(32), handlers: {}, limits: { maxCodeChars: 8 } },
      { loader: fakeLoader(async () => ({ value: null })).loader },
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.message).toContain('exceeds 8');

    const stats = asStats();
    const handlers: CodeModeHandlers = Object.create(null) as CodeModeHandlers;
    handlers.health = async () => ({ ok: true });
    const first = await dispatchCall(handlers, { ...DEFAULT_LIMITS, maxCalls: 1 }, stats, 'health', '{}');
    const second = await dispatchCall(handlers, { ...DEFAULT_LIMITS, maxCalls: 1 }, stats, 'health', '{}');
    expect(JSON.parse(first)).toEqual({ result: { ok: true } });
    expect(JSON.parse(second).error).toContain('Call limit exceeded');
  });
});

describe('Code Mode sandbox isolation', () => {
  it('loads the child with no env and no outbound network', () => {
    const workerCode = buildWorkerCode({
      mode: 'execute',
      code: 'async () => axis.health()',
    });
    expect(workerCode.globalOutbound).toBeNull();
    expect(Object.keys(workerCode)).not.toContain('env');
    expect(workerCode.env).toBeUndefined();
    expect(workerCode.compatibilityDate).toBe('2025-06-01');
    expect(workerCode.mainModule).toBe(SANDBOX_MAIN_MODULE);

    const source = String(workerCode.modules[SANDBOX_MAIN_MODULE]);
    expect(source).not.toContain('process.');
    expect(source).not.toContain('require(');
    expect(source).not.toContain('env.');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('connect(');
  });

  it('exposes only own tool names, never prototype keys', async () => {
    const stats = asStats();
    const handlers: CodeModeHandlers = Object.create(null) as CodeModeHandlers;
    handlers.health = async () => 'ok';
    for (const name of ['__proto__', 'constructor', 'prototype', 'fetch']) {
      const raw = await dispatchCall(handlers, DEFAULT_LIMITS, stats, name, '{}');
      expect(JSON.parse(raw).error).toContain('Unknown tool');
    }
    expect(stats.calls).toBe(0);
  });

  it('generates a namespaced axis client, not a raw dispatcher', () => {
    const source = buildSandboxModule({
      mode: 'execute',
      code: 'async () => axis.health()',
      limits: DEFAULT_LIMITS,
    });
    expect(source).toContain('const axis = new Proxy');
    expect(source).toContain('__dispatch.call');
    expect(source).toContain('const catalog = __catalog');
  });

  it('does not accept model-supplied limits', async () => {
    const fake = fakeLoader(async () => ({ value: 'ok' }));
    const env: Env = { ...envOn, LOADER: fake.loader };
    const result = await runCodeModeTool(
      ctx(env),
      'execute',
      { code: 'async () => 1', limits: { timeoutMs: 600_000, maxCalls: 1_000_000 } },
      callTool,
      { makeDispatcher: fakeMakeDispatcher },
    );
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { value: string }).value).toBe('ok');
  });
});

describe('Code Mode axis_request boundary', () => {
  it('routes axis_request through the caller-authenticated tool path', async () => {
    const calls: Array<{ ctx: ToolContext; name: string; args: unknown }> = [];
    const invoke = async (c: ToolContext, name: string, args: unknown) => {
      calls.push({ ctx: c, name, args });
      return jsonText({ ok: true, status: 200, body: { status: 'healthy' } });
    };
    const caller = ctx(envOn);
    const handlers = createCodeModeHandlers(caller, invoke);

    const result = await handlers.request?.({
      method: 'GET',
      path: '/health',
      headers: { Authorization: 'Bearer pn_attacker' },
    });

    expect(result).toEqual({ ok: true, status: 200, body: { status: 'healthy' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ctx).toBe(caller);
    expect(calls[0]?.ctx.auth.key).toBe(KEY);
    expect(calls[0]?.name).toBe('axis_request');
  });

  it('offers no fetch primitive and no ambient env to sandbox code', () => {
    const handlers = createCodeModeHandlers(ctx(envOn), callTool);
    expect(Object.hasOwn(handlers, 'fetch')).toBe(false);
    expect(shortToolName('axis_request')).toBe('request');
    expect(compactCatalog().some((row) => row.short === 'request')).toBe(true);

    const workerCode = buildWorkerCode({ mode: 'execute', code: 'async () => 1' });
    expect(workerCode.globalOutbound).toBeNull();
    expect(workerCode.env).toBeUndefined();
  });
});
