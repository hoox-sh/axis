/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultPyneUrl, prewarmBackend } from '../src/services/prewarm.js';

const realFetch = globalThis.fetch;
let restore: (() => void) | null = null;

function install(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  restore = () => {
    globalThis.fetch = realFetch;
  };
}

afterEach(() => {
  restore?.();
  restore = null;
  delete process.env.AXIS_PYNE_URL;
  delete process.env.AXIS_PYNE_API_KEY;
});

describe('defaultPyneUrl', () => {
  test('defaults to the hosted Pro API and honours AXIS_PYNE_URL', () => {
    expect(defaultPyneUrl()).toBe('https://pynescript.online');
    process.env.AXIS_PYNE_URL = 'http://127.0.0.1:5002/';
    expect(defaultPyneUrl()).toBe('http://127.0.0.1:5002');
  });
});

describe('prewarmBackend', () => {
  test('POSTs scripts + force and parses the warm result', async () => {
    let seen: { url: string; body: unknown; method?: string } | null = null;
    install((url, init) => {
      seen = { url, body: JSON.parse(String(init?.body || '{}')), method: init?.method };
      return new Response(
        JSON.stringify({
          status: 'success',
          prewarm_ms: 640.4,
          has_numba: true,
          builtins_warmed: true,
          scripts_ok: 1,
          scripts_failed: 0,
          errors: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const r = await prewarmBackend('http://127.0.0.1:5002/', {
      scripts: ['indicator("a")\nplot(close)'],
      force: true,
    });

    expect(seen!.method).toBe('POST');
    expect(seen!.url).toBe('http://127.0.0.1:5002/compile/prewarm');
    expect(seen!.body).toEqual({ scripts: ['indicator("a")\nplot(close)'], force: true });
    expect(r.ok).toBe(true);
    expect(r.prewarmMs).toBe(640.4);
    expect(r.hasNumba).toBe(true);
    expect(r.builtinsWarmed).toBe(true);
    expect(r.scriptsOk).toBe(1);
  });

  test('sends the key headers when configured', async () => {
    let headers: Record<string, string> = {};
    install((_url, init) => {
      headers = (init?.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ status: 'success', has_numba: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await prewarmBackend('http://127.0.0.1:5002', { key: 'pn_cli_key' });
    expect(headers['X-API-Key']).toBe('pn_cli_key');
    expect(headers.Authorization).toBe('Bearer pn_cli_key');
  });

  test('caps scripts at the backend limit', async () => {
    let body: { scripts?: string[] } = {};
    install((_url, init) => {
      body = JSON.parse(String(init?.body || '{}')) as { scripts?: string[] };
      return new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await prewarmBackend('http://127.0.0.1:5002', {
      scripts: Array.from({ length: 30 }, (_, i) => `indicator("s${i}")`),
    });
    expect(body.scripts!.length).toBe(16);
  });

  test('reports an older backend as unsupported', async () => {
    install(() => new Response('not found', { status: 404 }));
    const r = await prewarmBackend('http://127.0.0.1:5002');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no /compile/prewarm route');
  });

  test('surfaces a backend error envelope', async () => {
    install(
      () =>
        new Response(JSON.stringify({ status: 'error', message: 'PREWARM_ERROR: boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const r = await prewarmBackend('http://127.0.0.1:5002');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('PREWARM_ERROR: boom');
  });

  test('fails fast without a URL', async () => {
    install(() => {
      throw new Error('fetch must not be called');
    });
    const r = await prewarmBackend('  ');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No backend URL');
  });

  test('reports a non-JSON response instead of throwing', async () => {
    install(() => new Response('<html>nginx</html>', { status: 200 }));
    const r = await prewarmBackend('http://127.0.0.1:5002');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Non-JSON');
  });
});
