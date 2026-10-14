// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /compile/prewarm` client: request shaping (script cap, force), result
 * parsing, and the typed-failure paths callers render (no endpoint, older
 * backend, backend error envelope, declined key consent, timeout).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { prewarmEngine, MAX_PREWARM_SCRIPTS, prewarmAppliedScripts, collectAppliedScriptSources, _resetPrewarmMemoForTests } from '../src/engines/prewarm';
import { setActivePlugin, setStore } from '../src/store';

const ENDPOINT = 'http://prewarm.test:5002';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

let restore: (() => void) | null = null;
let calls: Call[] = [];

function install(handler: (call: Call) => Response | Promise<Response>): void {
  restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: String(init?.method || 'GET').toUpperCase(),
      path: url.pathname,
      headers: (init?.headers as Record<string, string>) || {},
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
}

const WARMED = {
  status: 'success',
  prewarm_ms: 812.5,
  has_numba: true,
  builtins_warmed: true,
  disk_cache_enabled: true,
  disk_cache_dir: '/var/cache/pyne',
  source_entries: 12,
  ir_entries: 9,
  scripts_ok: 2,
  scripts_failed: 1,
  errors: ['scripts[2]: SyntaxError: unexpected indent'],
};

beforeEach(() => {
  calls = [];
  setStore('endpoint', ENDPOINT);
  setStore('pluginsConfig', { 'engine:server': { mode: 'auto' } });
  setActivePlugin('engine', 'server');
});

afterEach(() => {
  restore?.();
  restore = null;
});

describe('prewarmEngine', () => {
  it('posts scripts + force and parses the warm result', async () => {
    install(() => jsonResponse(WARMED));

    const r = await prewarmEngine({ scripts: ['indicator("a")\nplot(close)', 'indicator("b")\nplot(open)'], force: true });

    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/compile/prewarm');
    expect(call.body).toEqual({
      scripts: ['indicator("a")\nplot(close)', 'indicator("b")\nplot(open)'],
      force: true,
    });

    expect(r.ok).toBe(true);
    expect(r.hasNumba).toBe(true);
    expect(r.builtinsWarmed).toBe(true);
    expect(r.prewarmMs).toBe(812.5);
    expect(r.scriptsOk).toBe(2);
    expect(r.scriptsFailed).toBe(1);
    expect(r.errors).toEqual(['scripts[2]: SyntaxError: unexpected indent']);
    expect(r.error).toBeNull();
  });

  it('sends an empty body when no scripts are given (builtins only)', async () => {
    install(() => jsonResponse({ status: 'success', has_numba: true, builtins_warmed: true }));
    const r = await prewarmEngine();
    expect(calls[0]!.body).toEqual({});
    expect(r.ok).toBe(true);
    expect(r.scriptsOk).toBe(0);
    expect(r.prewarmMs).toBeNull();
  });

  it('caps scripts at the backend limit and drops blank sources', async () => {
    install(() => jsonResponse(WARMED));
    const many = Array.from({ length: MAX_PREWARM_SCRIPTS + 6 }, (_, i) => `indicator("s${i}")\nplot(close)`);
    await prewarmEngine({ scripts: ['', '   ', ...many] });
    const body = calls[0]!.body as { scripts: string[] };
    expect(body.scripts.length).toBe(MAX_PREWARM_SCRIPTS);
    expect(body.scripts[0]).toBe('indicator("s0")\nplot(close)');
  });

  it('fails without a request when no endpoint is configured', async () => {
    install(() => jsonResponse(WARMED));
    const r = await prewarmEngine({ endpoint: '' });
    expect(calls.length).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No backend endpoint');
  });

  it('reports Pyodide as not prewarmable over HTTP', async () => {
    install(() => jsonResponse(WARMED));
    const r = await prewarmEngine({ endpoint: 'pyodide://local' });
    expect(calls.length).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Pyodide');
  });

  it('reports an older backend as unsupported', async () => {
    install(() => jsonResponse({ status: 'error' }, 404));
    const r = await prewarmEngine();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no /compile/prewarm route');
  });

  it('maps a non-ok HTTP status to a typed failure', async () => {
    install(() => jsonResponse({ status: 'error' }, 500));
    const r = await prewarmEngine();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Prewarm failed (HTTP 500)');
  });

  it('surfaces a 200 error envelope with the backend message', async () => {
    install(() => jsonResponse({ status: 'error', message: 'PREWARM_ERROR: boom' }));
    const r = await prewarmEngine();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('PREWARM_ERROR: boom');
  });

  it('sends the API key headers when configured', async () => {
    install(() => jsonResponse(WARMED));
    await prewarmEngine({ apiKey: 'pn_test_key' });
    expect(calls[0]!.headers['X-API-Key']).toBe('pn_test_key');
    expect(calls[0]!.headers.Authorization).toBe('Bearer pn_test_key');
  });

  it('withholds the key (and the request) when consent is declined', async () => {
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    globalThis.location = { origin: 'https://app.example' } as unknown as Location;
    globalThis.window = {
      ...(originalWindow as unknown as Record<string, unknown>),
      confirm: () => false,
    } as unknown as Window & typeof globalThis;
    try {
      install(() => jsonResponse(WARMED));
      const r = await prewarmEngine({
        endpoint: 'https://untrusted.example',
        apiKey: 'pn_secret',
      });
      expect(calls.length).toBe(0);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('withheld');
    } finally {
      globalThis.location = originalLocation;
      globalThis.window = originalWindow;
    }
  });

  it('reports a caller abort as cancelled, not as a backend error', async () => {
    install(
      (_call) =>
        new Promise<Response>((_resolve, reject) => {
          // Never settles; the abort below must win.
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 5);
        }),
    );
    const controller = new AbortController();
    const pending = prewarmEngine({ signal: controller.signal });
    controller.abort();
    const r = await pending;
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Prewarm cancelled');
  });
});

describe('prewarmAppliedScripts', () => {
  const indicator = (id: string, code: string, visible = true) => ({
    id,
    name: id,
    code,
    paneId: 'price',
    visible,
    plots: {},
  });

  beforeEach(() => {
    calls = [];
    _resetPrewarmMemoForTests();
    setStore('endpoint', ENDPOINT);
    setStore('pluginsConfig', { 'engine:server': { mode: 'auto' } });
    setActivePlugin('engine', 'server');
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('collects only visible, non-library scripts and caps at the backend limit', async () => {
    setStore('scripts', [
      indicator('a', 'indicator("a")\nplot(close)'),
      indicator('hidden', 'indicator("h")\nplot(close)', false),
      indicator('lib', 'library("l")'),
      indicator('strat', 'strategy("s")'),
      ...Array.from({ length: 20 }, (_, i) => indicator(`s${i}`, `indicator("s${i}")\nplot(close)`)),
    ]);
    const sources = await collectAppliedScriptSources();
    expect(sources.length).toBe(MAX_PREWARM_SCRIPTS);
    expect(sources).toContain('indicator("a")\nplot(close)');
    expect(sources).toContain('strategy("s")');
    expect(sources).not.toContain('indicator("h")\nplot(close)');
    expect(sources).not.toContain('library("l")');
  });

  it('warms an identical source set only once per session', async () => {
    install(() => jsonResponse(WARMED));
    const scripts = ['indicator("a")\nplot(close)'];
    const first = await prewarmAppliedScripts({ scripts });
    const second = await prewarmAppliedScripts({ scripts });
    expect(first?.ok).toBe(true);
    expect(second).toBeNull();
    expect(calls.length).toBe(1);
  });

  it('re-warms when the source set changes', async () => {
    install(() => jsonResponse(WARMED));
    await prewarmAppliedScripts({ scripts: ['indicator("a")\nplot(close)'] });
    await prewarmAppliedScripts({ scripts: ['indicator("b")\nplot(close)'] });
    expect(calls.length).toBe(2);
  });

  it('retries after a failed warm instead of memoising the failure', async () => {
    install(() => jsonResponse({ status: 'error' }, 500));
    const scripts = ['indicator("a")\nplot(close)'];
    const first = await prewarmAppliedScripts({ scripts });
    expect(first?.ok).toBe(false);
    install(() => jsonResponse(WARMED));
    const second = await prewarmAppliedScripts({ scripts });
    expect(second?.ok).toBe(true);
  });

  it('is a no-op when nothing is applied', async () => {
    install(() => jsonResponse(WARMED));
    setStore('scripts', []);
    expect(await prewarmAppliedScripts()).toBeNull();
    expect(calls.length).toBe(0);
  });
});
