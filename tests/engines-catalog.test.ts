/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine catalog — server success/error (mocked); isReady.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  serverEngine,
  listEngines,
  getEngine,
  registerDynamicEngine,
  ensureEnginesRegistered,
  _resetEngineRegistrationFlag,
} from '../src/engines/catalog';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { setStore } from '../src/store';
import { SAMPLE_BARS } from './fixtures/bars';

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  registry.clear();
  _resetEngineRegistrationFlag();
  _resetBootstrapFlag();
  ensureEnginesRegistered();
  setStore('endpoint', 'http://engine.test:5002');
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe('engines catalog', () => {
  it('lists server and pyodide', () => {
    const ids = listEngines().map((e) => e.id);
    expect(ids).toContain('server');
    expect(ids).toContain('pyodide');
  });

  it('server run success', async () => {
    restoreFetch = mockFetch(async (input) => {
      const url = String(input);
      expect(url).toContain('/run');
      expect(url).toContain('mode=compile');
      return jsonResponse({
        status: 'success',
        plots: [1, 2, 3],
        series: { a: [1, 2, 3] },
        events: [],
        meta: { script_name: 't' },
        mode: 'compile',
      });
    });
    // preferWs: false forces REST so mockFetch is exercised (WS not mocked here)
    const r = await serverEngine.run({
      script: 'plot(close)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', mode: 'compile', preferWs: false },
    });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([1, 2, 3]);
    expect(r.meta?.mode).toBe('compile');
  });

  it('server run error status', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({ status: 'error', message: 'bad pine' }, 400),
    );
    const r = await serverEngine.run({
      script: 'bad',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/bad pine|HTTP/);
  });

  it('server catalog exposes interpret|compile|auto modes', () => {
    const mode = serverEngine.configSchema?.mode;
    expect(mode?.type).toBe('select');
    expect(mode?.options).toEqual(['interpret', 'compile', 'auto']);
    expect(mode?.default).toBe('interpret');
  });

  it('server isReady probes root', async () => {
    restoreFetch = mockFetch(async () => new Response('ok', { status: 200 }));
    expect(await serverEngine.isReady()).toBe(true);
  });

  it('registerDynamicEngine', () => {
    registerDynamicEngine({
      id: 'dyn-eng',
      name: 'D',
      kind: 'engine',
      async isReady() {
        return true;
      },
      async run() {
        return { status: 'success', plots: [], events: [], series: {} };
      },
    });
    expect(getEngine('dyn-eng')).toBeDefined();
  });
});
